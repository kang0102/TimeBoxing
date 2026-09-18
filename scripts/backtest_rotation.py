"""Costed, next-open portfolio backtest with separate training and validation."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from rotation_prices import adjust_with_verified_close, fetch_official_closes
from rotation_signals import completed_bars
from rotation_sync import synchrony_series

ROOT = Path(__file__).resolve().parents[1]


def features(prices, benchmark, volume_threshold):
    frame = prices.reindex(benchmark.index).copy()
    relative = frame.Close / benchmark.Close.reindex(frame.index)
    frame["ma20"] = frame.Close.rolling(20).mean()
    frame["rs5"] = relative / relative.shift(5) - 1
    frame["rank"] = relative / relative.shift(20) - 1
    frame["volume_ratio"] = frame.Volume / frame.Volume.shift(1).rolling(20).mean()
    high = frame.High.shift(1).rolling(20).max()
    frame["signal"] = ((frame.Close > high) & (frame.volume_ratio >= volume_threshold)
                       & (frame.rs5 > 0) & (frame.Close > frame.ma20)
                       & (frame.Close.pct_change(20, fill_method=None) <= .25)
                       & (frame.Close / frame.ma20 <= 1.15))
    frame['signal'] &= frame.Close.notna().rolling(65).sum().eq(65)
    frame.loc[frame.index[:65], "signal"] = False
    return frame


def simulate(frames, sessions, holding_days, cost, max_positions=5):
    """Signals at yesterday's close; fills at today's open; finite cash, no leverage."""
    cash, positions, trades, curve = 100000., {}, [], []
    records = {symbol: {row.Index: row for row in frame.itertuples()} for symbol, frame in frames.items()}
    sessions = list(sessions)
    initial = cash
    for index, day in enumerate(sessions):
        previous_day = sessions[index-1] if index else None
        if previous_day is not None:
            # Exits are based exclusively on information known before this open.
            for symbol, position in list(positions.items()):
                prior, today = records[symbol].get(previous_day), records[symbol].get(day)
                if today is None or prior is None:
                    raise ValueError("持有期間行情缺日，不能假設可成交")
                if index-position["entry_index"] >= holding_days or prior.Close < prior.ma20:
                    proceeds = position["shares"] * float(today.Open) * (1-cost)
                    cash += proceeds
                    trades.append({"symbol": symbol, "entry": position["entry_date"], "exit": day.date().isoformat(),
                                   "return_pct": (proceeds/position["spent"]-1)*100, "reason": "max_hold" if index-position["entry_index"] >= holding_days else "ma20"})
                    del positions[symbol]
            candidates = []
            for symbol, rows in records.items():
                prior, today = rows.get(previous_day), rows.get(day)
                if symbol not in positions and prior is not None and today is not None and bool(prior.signal):
                    candidates.append((float(prior.rank), symbol))
            candidates.sort(key=lambda value: (-value[0], value[1]))
            equity_open = cash + sum(p["shares"]*float(records[s][day].Open) for s,p in positions.items())
            for _, symbol in candidates:
                if len(positions) >= max_positions or cash < 1:
                    break
                budget = min(cash, equity_open/max_positions)
                shares = budget/(float(records[symbol][day].Open)*(1+cost))
                positions[symbol] = {"shares": shares, "spent": budget, "entry_index": index, "entry_date": day.date().isoformat()}
                cash -= budget
        equity = cash + sum(p["shares"]*float(records[s][day].Close) for s,p in positions.items())
        curve.append({"date": day.date().isoformat(), "value": equity/initial*100})
    # Mark to final close and deduct the cost of liquidating remaining positions.
    # These forced period-end exits are shown separately from strategy exits.
    if sessions:
        day = sessions[-1]
        for symbol, position in positions.items():
            proceeds = position["shares"]*float(records[symbol][day].Close)*(1-cost)
            cash += proceeds
            trades.append({"symbol":symbol,"entry":position["entry_date"],"exit":day.date().isoformat(),
                           "return_pct":(proceeds/position["spent"]-1)*100,"reason":"period_end"})
        curve[-1]["value"] = cash/initial*100
    equity = np.array([100.] + [r["value"] for r in curve])
    returns = np.diff(equity)/equity[:-1]
    drawdown = equity/np.maximum.accumulate(equity)-1
    annual = (equity[-1]/100)**(252/max(1,len(sessions)))-1
    sharpe = float(returns.mean()/returns.std(ddof=1)*np.sqrt(252)) if len(returns)>1 and returns.std(ddof=1)>0 else 0.
    return {"return_pct":round((equity[-1]/100-1)*100,2),"annualized_pct":round(annual*100,2),
            "max_drawdown_pct":round(float(drawdown.min())*100,2),"sharpe":round(sharpe,2),
            "trades":len(trades),"win_rate_pct":round(sum(t["return_pct"]>0 for t in trades)/len(trades)*100,1) if trades else None,
            "forced_exits":sum(t["reason"]=="period_end" for t in trades),
            "curve":[{**r,"value":round(r["value"],3)} for r in curve[::5]] + ([{**curve[-1],"value":round(curve[-1]["value"],3)}] if curve and (len(curve)-1)%5 else []),
            "recent_trades":trades[-10:]}


def training_choice(results, default):
    usable = [(threshold, value) for threshold, value in results.items() if value["trades"] >= 20]
    if not usable:
        return default
    return max(usable,key=lambda pair:(pair[1]["sharpe"],-abs(pair[0]-default)))[0]


def evaluate_market(market, prices, benchmark, symbols, settings, groups=None):
    as_of = benchmark.index[-1]
    split = as_of - pd.DateOffset(months=settings["validation_months"])
    train_dates = benchmark.index[65:][benchmark.index[65:] < split]
    test_dates = benchmark.index[benchmark.index >= split]
    # A provider-wide missing session must not become a fictitious zero-return day.
    # Keep the training window fixed; start validation only after the final gap
    # and a fresh 65-session warm-up. This choice uses availability, never returns.
    coverage = pd.Series(0, index=benchmark.index, dtype=float)
    for symbol in symbols:
        if symbol in prices:
            coverage += coverage.index.isin(prices[symbol].index).astype(int)
    gaps = test_dates[coverage.reindex(test_dates).to_numpy() < len(symbols)*.8]
    if len(gaps):
        final_gap = benchmark.index.get_loc(gaps[-1])
        test_dates = benchmark.index[final_gap+66:]
    valid, excluded = {}, []
    for symbol in symbols:
        frame = prices.get(symbol)
        if frame is None or len(frame)<150 or frame.index[-1] != as_of:
            excluded.append({"symbol":symbol,"reason":"歷史或最新日期不足"});continue
        expected = train_dates.union(test_dates)
        expected = expected[expected >= frame.index[0]]
        if not expected.isin(frame.index).all() or "Open" not in frame or frame.Open.isna().any() or (frame.Open<=0).any():
            excluded.append({"symbol":symbol,"reason":"行情缺日或缺開盤價"});continue
        valid[symbol] = frame.loc[frame.index.intersection(benchmark.index)]
    if len(valid) != len(symbols) or len(test_dates)<120 or len(train_dates)<252:
        raise ValueError(f"{market} 回測資料覆蓋或期間不足: {len(valid)}/{len(symbols)}, train={len(train_dates)}, validation={len(test_dates)}, excluded={excluded}")
    prepared = {threshold:{s:features(f,benchmark,threshold) for s,f in valid.items()} for threshold in settings["candidate_volume_ratios"]}
    synchronized = {s:f.copy() for s,f in prepared[settings['volume_ratio']].items()}
    sync_eligible = []
    for group in groups or []:
        members = [s[0] for s in group['stocks'] if s[2] == market]
        if not members: continue
        series, _, _ = synchrony_series(valid, benchmark, members)
        if len(members) >= 3: sync_eligible.extend(members)
        for symbol in members:
            if symbol in synchronized:
                synchronized[symbol]['signal'] &= series.up_anomaly.reindex(synchronized[symbol].index).fillna(False)
    rows = []
    cost, default = settings["one_way_cost"][market], settings["volume_ratio"]
    for holding in settings["holding_days"]:
        training = {threshold:simulate(frames,train_dates,holding,cost,settings["max_positions"]) for threshold,frames in prepared.items()}
        choice = training_choice(training,default)
        test = simulate(prepared[default],test_dates,holding,cost,settings["max_positions"])
        stress = simulate(prepared[default],test_dates,holding,cost*2,settings["max_positions"])
        candidate = test if choice == default else simulate(prepared[choice],test_dates,holding,cost,settings["max_positions"])
        sync = simulate(synchronized,test_dates,holding,cost,settings['max_positions'])
        status = "insufficient" if test["trades"] < settings["minimum_validation_trades"] else "needs_revision" if test["return_pct"] <= 0 or stress["return_pct"] <= 0 else "forward_test"
        rows.append({"holding_days":holding,"volume_ratio":default,"train":{k:v for k,v in training[default].items() if k not in ['curve','recent_trades']},
                     "validation":test,"double_cost_return_pct":stress["return_pct"],"assessment":status,
                     "synchrony_filter":{k:v for k,v in sync.items() if k not in ['curve','recent_trades']},
                     "candidate":{"volume_ratio":choice,"selection":"訓練期夏普值最高，至少20筆交易；不使用驗證期挑參數",
                                  "validation_return_pct":candidate["return_pct"],"validation_drawdown_pct":candidate["max_drawdown_pct"],"applied":False}})
    benchmark_return = (float(benchmark.loc[test_dates[-1],"Close"])/float(benchmark.loc[test_dates[0],"Open"])-1)*100
    return {"market":market,"as_of":as_of.date().isoformat(),"available":len(valid),"total":len(symbols),"excluded":excluded,
            "train_start":train_dates[0].date().isoformat(),"train_end":train_dates[-1].date().isoformat(),
            "validation_start":test_dates[0].date().isoformat(),"validation_end":test_dates[-1].date().isoformat(),
            "data_gaps":[d.date().isoformat() for d in gaps],
            "synchrony_eligible_stocks":len(sync_eligible),
            "benchmark_return_pct":round(benchmark_return,2),"one_way_cost_pct":cost*100,"results":rows}


def main():
    parser=argparse.ArgumentParser();parser.add_argument("--use-cache",action="store_true");args=parser.parse_args()
    settings=json.loads((ROOT/'rotation/strategy.json').read_text(encoding='utf-8'))
    universe=json.loads((ROOT/'rotation/universe.json').read_text(encoding='utf-8'))
    cache=ROOT/'.rotation-cache/backtest_downloads.pkl';cache.parent.mkdir(exist_ok=True)
    now=datetime.now(timezone.utc)
    symbols=sorted(set(universe['benchmarks'].values())|{s[0] for g in universe['groups'] for s in g['stocks']})
    if args.use_cache and cache.exists():
        raw=pd.read_pickle(cache)
    else:
        import yfinance as yf
        yf.set_tz_cache_location(str(ROOT/'.rotation-cache'))
        raw={}
        for start in range(0,len(symbols),8):
            batch=symbols[start:start+8]
            data=yf.download(batch,period=f"{settings['history_years']}y",interval='1d',auto_adjust=False,actions=True,keepna=True,group_by='ticker',threads=4,progress=False,timeout=20)
            for symbol in batch:
                if symbol in data.columns.get_level_values(0):raw[symbol]=data[symbol].dropna(how='all')
        for attempt in range(2):
            missing=[s for s in symbols if s not in raw or raw[s].Close.notna().sum()<150]
            if not missing:break
            time.sleep(attempt+1)
            for symbol in missing:
                data=yf.download([symbol],period=f"{settings['history_years']}y",interval='1d',auto_adjust=False,actions=True,keepna=True,group_by='ticker',threads=False,progress=False,timeout=20)
                if symbol in data.columns.get_level_values(0):raw[symbol]=data[symbol].dropna(how='all')
        pd.to_pickle(raw,cache)
    quotes,diagnostics=fetch_official_closes(now, ROOT/'rotation/official_closes.json', symbols, persist_cache=False)
    print('Official close verification:',json.dumps(diagnostics,ensure_ascii=False),flush=True)
    all_markets={s[0]:s[2] for g in universe['groups'] for s in g['stocks']}
    all_markets.update({symbol:market for market,symbol in universe['benchmarks'].items()})
    prices={}
    for symbol,frame in raw.items():
        try:
            adjusted,_=adjust_with_verified_close(frame,quotes.get(symbol))
            prices[symbol]=completed_bars(adjusted,all_markets[symbol],now)
            if symbol.endswith('.TWO'):
                print(symbol,'raw latest',str(frame.index[-1]),'completed latest',str(prices[symbol].index[-1]),'official',quotes.get(symbol,{}).get('date'),flush=True)
        except (KeyError,ValueError,TypeError):pass
    reports=[]
    for market,benchmark in universe['benchmarks'].items():
        symbols=[s[0] for g in universe['groups'] for s in g['stocks'] if s[2]==market]
        reports.append(evaluate_market(market,prices,prices[benchmark],symbols,settings,universe['groups']))
    result={"schema_version":1,"status":"ok","refresh_status":"ok","last_attempt_at":now.isoformat(),"generated_at":now.isoformat(),"strategy_version":settings['version'],
            "config_hash":hashlib.sha256(json.dumps(settings,sort_keys=True).encode()).hexdigest()[:12],
            "settings":settings,"markets":reports,"official_check":diagnostics,
            "limitations":["回測僅涵蓋量價接棒代理規則，不含新聞催化、人工波次或 Smart Money 法人条件。",
                           "採今天的觀察名單回看歷史，存在存活者及事後選股偏差，不能當作當年可實現的全市場績效。",
                           "成本為研究假設：台股單邊0.3%、美股單邊0.1%，另檢查成本加倍；不是券商實際報價。",
                           "假設可按還原開盤價成交及分割股數；漲跌停排隊、交易衝擊、流動性容量與停牌風險未完整模擬。",
                           "股票還原價含除權息調整；比較用的大盤價格指數不含再投資股息。",
                           "量比參數僅用訓練期挑選，驗證期另列；候選尚未套用，仍需後續新資料前瞻驗證。"]}
    output=ROOT/'rotation/backtest.json';temp=output.with_suffix('.tmp');temp.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8');temp.replace(output)
    history_path=ROOT/'rotation/backtest_history.json'
    history=json.loads(history_path.read_text(encoding='utf-8')) if history_path.exists() else []
    key=now.date().isoformat();history=[h for h in history if h['date']!=key]
    history.append({"date":key,"strategy_version":settings['version'],"config_hash":result['config_hash'],"markets":[{"market":r['market'],"as_of":r['as_of'],"results":[{"holding_days":x['holding_days'],"return_pct":x['validation']['return_pct'],"drawdown_pct":x['validation']['max_drawdown_pct'],"trades":x['validation']['trades'],"assessment":x['assessment']} for x in r['results']]} for r in reports]})
    history_path.write_text(json.dumps(history[-52:],ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for report in reports:
        print(report['market'],report['as_of'],f"coverage {report['available']}/{report['total']}")
        for row in report['results']: print(row['holding_days'],'days',row['validation']['return_pct'],'return',row['validation']['max_drawdown_pct'],'drawdown',row['validation']['trades'],'trades',row['assessment'])


def mark_refresh_failure(path, now):
    report=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'schema_version':1,'status':'failed','markets':[]}
    report.update(refresh_status='failed',last_attempt_at=now.isoformat())
    temp=path.with_suffix('.tmp')
    temp.write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8');temp.replace(path)


if __name__=='__main__':
    try:main()
    except Exception:
        mark_refresh_failure(ROOT/'rotation/backtest.json',datetime.now(timezone.utc))
        raise
