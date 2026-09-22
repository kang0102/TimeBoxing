"""Public adjusted bars for private, client-side forward evaluation. No portfolios read."""
import math
from rotation_signals import completed_bars


def build_forward_prices(config, downloads, now):
    result = {"schema_version": 1, "generated_at": now.isoformat(),
              "source": "與日線雷達相同來源的還原 OHLC；每次以同一版本計算進出價格，歷史修訂可能影響結果。", "markets": {}, "stocks": {}}
    for market, symbol in config['benchmarks'].items():
        try:
            bars = completed_bars(downloads[symbol], market, now)
            result['markets'][market] = {'dates': [d.date().isoformat() for d in bars.index]}
        except (KeyError, ValueError):
            continue
    for group in config['groups']:
        for symbol, _, market in group['stocks']:
            try:
                bars = completed_bars(downloads[symbol], market, now)
                rows = [[d.date().isoformat(), float(r.Open), float(r.Close)] for d, r in bars.iterrows()
                        if math.isfinite(float(r.Open)) and float(r.Open) > 0]
                result['stocks'][symbol] = {'market': market, 'bars': rows}
            except (KeyError, ValueError, AttributeError):
                continue
    return result
