"""Bounded weight search. Fit once on past training windows, freeze, then evaluate."""
import argparse
from datetime import datetime, timezone, timedelta
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd
from backtest_rotation import features, simulate
from rotation_prices import adjust_with_verified_close
from rotation_signals import completed_bars

ROOT = Path(__file__).resolve().parents[1]


def components(prices, benchmark):
    f = features(prices, benchmark, 1.5)
    relative = f.Close / benchmark.Close
    rs20 = (relative / relative.shift(20)-1)*100
    rs5 = (relative / relative.shift(5)-1)*100
    acceleration = rs5-rs5.shift(5)
    ma60 = f.Close.rolling(60).mean()
    high = f.High.shift(1).rolling(20).max()
    values = pd.DataFrame({
        'relative_strength': ((rs20+10)/20).clip(0,1),
        'acceleration': ((acceleration+5)/10).clip(0,1),
        'trend': ((f.Close>f.ma20).astype(float)+(f.ma20>ma60).astype(float))/2,
        'volume': ((f.volume_ratio-.5)/1.5).clip(0,1),
        'breakout': ((f.Close/high-.9)/.1).clip(0,1),
    }, index=f.index)
    f['signal'] &= values.notna().all(axis=1)
    return f, values


def choose(training, config, profile):
    penalty = config['drawdown_penalty'][profile]
    def objective(result):
        if sum(r['trades']-r['forced_exits'] for r in result) < config['minimum_training_trades']:
            return -float('inf')
        if any(r['trades']-r['forced_exits'] < config['minimum_fold_trades'] for r in result):
            return -float('inf')
        return float(np.median([r['annualized_pct']-penalty*abs(r['max_drawdown_pct']) for r in result]))
    objectives = [objective(r) for r in training]
    best = max(range(len(objectives)), key=lambda i:(objectives[i],-i))
    return best if np.isfinite(objectives[best]) else 0, objectives


def compact(report):
    return {k:v for k,v in report.items() if k not in ('curve','recent_trades')}


def dates_and_prices(prices, benchmark, symbols, split):
    train = benchmark.index[65:][benchmark.index[65:]<pd.Timestamp(split)]
    validation = benchmark.index[benchmark.index>=pd.Timestamp(split)]
    coverage = sum(benchmark.index.isin(prices.get(s,pd.DataFrame()).index).astype(int) for s in symbols)
    gaps = validation[coverage[benchmark.index.get_indexer(validation)] < len(symbols)*.8]
    if len(gaps): validation = benchmark.index[benchmark.index.get_loc(gaps[-1])+66:]
    if len(train)<378 or len(validation)<120: raise ValueError('訓練或驗證期間不足')
    valid = {}
    for s in symbols:
        f = prices.get(s)
        if f is None or len(f)<150: raise ValueError(f'{s} 歷史不足')
        required = train.union(validation)
        required = required[required>=f.index[0]]
        if not required.isin(f.index).all() or f.index[-1]!=benchmark.index[-1]: raise ValueError(f'{s} 行情日期缺漏')
        if f.Open.isna().any() or (f.Open<=0).any(): raise ValueError(f'{s} 開盤價缺漏')
        valid[s] = f
    return train,validation,valid,[d.date().isoformat() for d in gaps]


def evaluate(market, prices, benchmark, symbols, config, settings, lock=None):
    split = lock['split'] if lock else (benchmark.index[-1]-pd.DateOffset(months=18)).date().isoformat()
    train, validation, valid, gaps = dates_and_prices(prices,benchmark,symbols,split)
    if lock:
        # The historical holdout is fixed. New observations belong only to forward evaluation.
        validation=validation[(validation>=pd.Timestamp(lock['validation_start'])) & (validation<=pd.Timestamp(lock['validation_end']))]
        if len(validation)<120: raise ValueError('固定歷史驗證區間已不完整，保留上次結果')
    prepared = {s:components(f,benchmark) for s,f in valid.items()}
    def frames(weights):
        result={}
        for s,(f,c) in prepared.items():
            result[s]=f.copy(); result[s]['rank']=c.to_numpy().dot(np.asarray(weights))
        return result
    candidates=[frames(w) for w in config['candidates']]
    folds=[pd.DatetimeIndex(x) for x in np.array_split(train,3)]
    cost=settings['one_way_cost'][market]
    result=[]; models=[]
    for holding in config['holding_days']:
        training = None
        if lock is None:
            training=[[compact(simulate(f,dates,holding,cost,config['max_positions'])) for dates in folds] for f in candidates]
        baseline=simulate(candidates[0],validation,holding,cost,config['max_positions'])
        baseline_stress=simulate(candidates[0],validation,holding,cost*2,config['max_positions'])
        validations={0:baseline};stress={}
        for profile in config['drawdown_penalty']:
            if lock:
                frozen=next(m for m in lock['models'] if m['holding_days']==holding and m['profile']==profile)
                index=frozen['candidate_index']; train_info=frozen['training_folds']; objectives=frozen['training_objectives']
            else:
                index,objectives=choose(training,config,profile)
                objectives=[round(x,4) if np.isfinite(x) else None for x in objectives]
                train_info=training[index]
            if index not in validations: validations[index]=simulate(candidates[index],validation,holding,cost,config['max_positions'])
            if index not in stress: stress[index]=simulate(candidates[index],validation,holding,cost*2,config['max_positions'])
            chosen=validations[index]
            # Validation describes the frozen choice; never feeds choose().
            enough=chosen['trades']-chosen['forced_exits']>=config['minimum_validation_trades']
            status='insufficient' if not enough else 'no_improvement' if index==0 or chosen['return_pct']<=baseline['return_pct'] else 'tradeoff' if chosen['max_drawdown_pct']<baseline['max_drawdown_pct'] or stress[index]['return_pct']<=0 else 'forward_only'
            forward=None
            if lock:
                future=benchmark.index[benchmark.index>=pd.Timestamp(lock['forward_start'])]
                if len(future)>=2: forward=compact(simulate(candidates[index],future,holding,cost,config['max_positions']))
            models.append({'holding_days':holding,'profile':profile,'candidate_index':index,'weights':config['candidates'][index],
                           'training_folds':train_info,'training_objectives':objectives})
            result.append({'holding_days':holding,'profile':profile,'weights':config['candidates'][index],
                           'baseline':compact(baseline),'baseline_double_cost':compact(baseline_stress),'candidate':compact(chosen),'double_cost':compact(stress[index]),
                           'assessment':status,'applied':False,'forward':forward,
                           'training_folds':train_info})
        print(market,holding,'days evaluated',flush=True)
    date=lambda x:x.date().isoformat()
    locked={'market':market,'split':split,'train_start':date(train[0]),'train_end':date(train[-1]),
            'validation_start':date(validation[0]),'validation_end':date(validation[-1]),'models':models,'symbols':symbols}
    return {'market':market,'as_of':date(benchmark.index[-1]),'available':len(valid),'total':len(symbols),
            'train_start':lock['train_start'] if lock else date(train[0]),'train_end':lock['train_end'] if lock else date(train[-1]),'validation_start':date(validation[0]),
            'validation_end':date(validation[-1]),'gaps':gaps,'folds':[{'start':date(d[0]),'end':date(d[-1])} for d in folds],
            'results':result},locked


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--fit',action='store_true');args=parser.parse_args()
    config=json.loads((ROOT/'rotation/weight_search.json').read_text(encoding='utf-8'))
    settings=json.loads((ROOT/'rotation/strategy.json').read_text(encoding='utf-8'))
    universe=json.loads((ROOT/'rotation/universe.json').read_text(encoding='utf-8'))
    model_path=ROOT/'rotation/weight_model.json'
    frozen=json.loads(model_path.read_text(encoding='utf-8')) if model_path.exists() else None
    if args.fit and frozen: raise ValueError('已有固定模型；不可覆寫重訓。請以新研究版本另存模型及理由。')
    if not frozen and not args.fit: raise ValueError('首次訓練須明確 --fit')
    config_hash=hashlib.sha256(json.dumps(config,sort_keys=True).encode()).hexdigest()
    if frozen and frozen['config_hash']!=config_hash: raise ValueError('設定已改變，需建立新的研究版本，不能套用舊模型')
    raw=pd.read_pickle(ROOT/'.rotation-cache/backtest_downloads.pkl')
    quotes=json.loads((ROOT/'rotation/official_closes.json').read_text(encoding='utf-8')).get('quotes',{})
    now=datetime.now(timezone.utc)
    markets={s[0]:s[2] for g in universe['groups'] for s in g['stocks']}
    markets.update({s:m for m,s in universe['benchmarks'].items()})
    prices={}
    for s,f in raw.items():
        if s not in markets: continue
        adjusted,_=adjust_with_verified_close(f,quotes.get(s))
        prices[s]=completed_bars(adjusted,markets[s],now)
    reports=[];locks=[]
    forward_start=frozen['forward_start'] if frozen else (now+timedelta(days=1)).date().isoformat()
    for market,benchmark in universe['benchmarks'].items():
        symbols=[s[0] for g in universe['groups'] for s in g['stocks'] if s[2]==market]
        lock=next(m for m in frozen['markets'] if m['market']==market) if frozen else None
        if lock: lock={**lock,'forward_start':forward_start}
        report,model=evaluate(market,prices,prices[benchmark],symbols,config,settings,lock)
        reports.append(report);locks.append(model)
    if not frozen:
        frozen={'version':config['version'],'trained_at':now.isoformat(),'forward_start':forward_start,
                'config_hash':config_hash,'config':config,'markets':locks,'applied':False,
                'note':'初始有界搜尋，僅訓練期選權重。原35/20/20/15/10及原回測不變。'}
        model_path.write_text(json.dumps(frozen,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    output={'schema_version':1,'status':'ok','generated_at':now.isoformat(),'trained_at':frozen['trained_at'],
            'forward_start':forward_start,'version':config['version'],'config':config,'markets':reports,
            'limitations':['僅原台股39檔／美股13檔，今天名單回看歷史存在事後選股及存活者偏差。',
                          '權重只影響同時符合量價條件的排序；不訓練新聞波次、法人、ETF或個人賣出規則。',
                          '歷史驗證未參與挑權重，但該期間的基準績效先前已被查看；新增前瞻資料才是下一階段的獨立檢查。',
                          '僅比較最長5／10／20／60交易日；數月或數年的持股計畫不等於已完成多年策略驗證。',
                          '訓練只搜尋預先列出的11組，不能稱為全域最佳；不自動套用或反覆用驗證期間挑參數。']}
    (ROOT/'rotation/weight_training.json').write_text(json.dumps(output,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')


if __name__=='__main__':
    try: main()
    except Exception:
        from backtest_rotation import mark_refresh_failure
        mark_refresh_failure(ROOT/'rotation/weight_training.json',datetime.now(timezone.utc))
        raise
