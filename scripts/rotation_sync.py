"""Dated sector co-movement; thresholds are research rules, not significance tests."""
import math
import pandas as pd


def synchrony_series(prices, benchmark, symbols):
    index = benchmark.index
    up, down, coverage = pd.DataFrame(index=index), pd.DataFrame(index=index), pd.DataFrame(index=index)
    market_day = benchmark.Close.pct_change(fill_method=None)
    for symbol in symbols:
        f = prices.get(symbol)
        if f is None:
            up[symbol] = False; down[symbol] = False; coverage[symbol] = False
            continue
        f = f.reindex(index)
        change = f.Close.pct_change(fill_method=None)
        rs5 = (f.Close / benchmark.Close).pct_change(5, fill_method=None)
        volume = f.Volume / f.Volume.shift(1).rolling(20).mean()
        ma = f.Close.rolling(20).mean()
        available = f.Close.notna().rolling(65).sum().eq(65) & volume.notna() & rs5.notna()
        coverage[symbol] = available
        up[symbol] = available & (change > 0) & (change > market_day) & (rs5 > 0) & (f.Close > ma) & (volume >= 1.5)
        down[symbol] = available & (change < 0) & (change < market_day) & (rs5 < 0) & (f.Close < ma) & (volume >= 1.5)
    n = len(symbols)
    result = pd.DataFrame(index=index)
    result['coverage'] = coverage.sum(axis=1)
    result['up_count'], result['down_count'] = up.sum(axis=1), down.sum(axis=1)
    result['eligible'] = (n >= 3) & (result.coverage >= math.ceil(n*.8))
    required = max(3, math.ceil(n*.6))
    for side in ('up', 'down'):
        breadth = result[f'{side}_count'] / max(1,n)
        prior = breadth.where(result.eligible).shift(1).rolling(20, min_periods=20)
        average, std = prior.mean(), prior.std(ddof=0)
        result[f'{side}_baseline'] = average
        jump = breadth-average
        result[f'{side}_sync'] = result.eligible & (result[f'{side}_count'] >= required)
        result[f'{side}_anomaly'] = result[f'{side}_sync'] & (jump >= .25) & ((std.eq(0)) | (jump >= 2*std))
    return result, up, down


def build_synchrony(config, prices, benchmarks, rows):
    by_symbol = {r['symbol']:r for r in rows}
    output = []
    for group in config['groups']:
        for market, benchmark in benchmarks.items():
            symbols = [s[0] for s in group['stocks'] if s[2] == market]
            if not symbols or benchmark.empty:
                continue
            # Stale rows cannot participate even if a prior history remains cached.
            valid = {s:prices[s] for s in symbols if s in prices and by_symbol.get(s,{}).get('status')=='ok'}
            series, up, down = synchrony_series(valid, benchmark, symbols)
            last = series.iloc[-1]
            status = ('insufficient' if not last.eligible else 'up_anomaly' if last.up_anomaly else
                      'down_anomaly' if last.down_anomaly else 'up_sync' if last.up_sync else
                      'down_sync' if last.down_sync else 'quiet')
            members = [s for s in symbols if bool(up[s].iloc[-1])]
            sellers = [s for s in symbols if bool(down[s].iloc[-1])]
            money = [s for s in members if by_symbol[s].get('smart_money',{}).get('status')=='ok' and by_symbol[s]['smart_money'].get('bias')=='buying']
            divergence = [s for s in members if by_symbol[s].get('smart_money',{}).get('status')=='ok' and by_symbol[s]['smart_money'].get('bias')=='selling']
            output.append({'id':group['id'],'name':group['name'],'market':market,'as_of':benchmark.index[-1].date().isoformat(),
                           'status':status,'total':len(symbols),'available':int(last.coverage),'up_count':int(last.up_count),
                           'down_count':int(last.down_count),'up_symbols':members,'down_symbols':sellers,
                           'money_confirmed':money,'money_divergence':divergence,
                           'baseline_pct':round(float(last.up_baseline)*100,1) if pd.notna(last.up_baseline) else None})
    return output
