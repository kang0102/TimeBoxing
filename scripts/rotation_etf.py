"""Dated public ETF risk observations. Units, estimated NAV and holdings are distinct."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import math
from pathlib import Path
from urllib.request import Request, urlopen
from rotation_prices import read_json, fetch_official_closes, adjust_with_verified_close, roc_date
from rotation_signals import completed_bars, analyze
from rotation_money import assess_money
from rotation_money import save_archive

ROOT = Path(__file__).resolve().parents[1]
BASIC = 'https://openapi.twse.com.tw/v1/opendata/t187ap47_L'
NAV = 'https://mis.twse.com.tw/stock/data/all_etf.txt'
NOMURA = 'https://www.nomurafunds.com.tw/API/ETFAPI/api/Fund/GetFundAssets'
HOLDING_CODES = ('00980A', '00985A', '00999A')


def number(value):
    n = float(str(value).replace(',', '').replace('%', ''))
    if not math.isfinite(n):
        raise ValueError('非有限數值')
    return n


def domestic_active(basic, day):
    return {r['基金代號']: r for r in basic
            if r['基金類型'] == '國內成分證券主動式交易所交易基金(股票)'
            and r['基金代號'].endswith('A') and roc_date(r['出表日期']) <= day}


def nav_rows(payload, basic, day):
    eligible = domestic_active(basic, day)
    found = {}
    for issuer in payload.get('a1', []):
        if issuer.get('rtCode', issuer.get('rtcode')) != '0000':
            continue
        for raw in issuer.get('msgArray', []):
            code = raw.get('a')
            if code not in eligible:
                continue
            try:
                date = datetime.strptime(raw['i'], '%Y%m%d').date().isoformat()
                clock = datetime.strptime(raw['j'], '%H:%M:%S').time()
                if date != day or str(clock) < '13:30:00' or str(raw['k']) != '1':
                    continue
                price, nav, premium, units, delta = [number(raw[k]) for k in ['e', 'f', 'g', 'c', 'd']]
                if min(price, nav, units, units-delta) <= 0 or abs((price/nav-1)*100-premium) > .15:
                    continue
                found[code] = {'code': code, 'name': eligible[code]['基金簡稱'], 'status': 'ok',
                               'as_of': date, 'time': raw['j'], 'price': price, 'estimated_nav': nav,
                               'estimated_premium_pct': premium, 'units': units, 'units_change': delta,
                               'units_change_pct': round(delta/(units-delta)*100, 4),
                               'source': NAV, 'issuer_url': issuer.get('refURL')}
            except (ValueError, KeyError, TypeError):
                continue
    return [found.get(code, {'code': code, 'name': r['基金簡稱'], 'status': 'unavailable',
                            'as_of': None, 'source': NAV}) for code, r in sorted(eligible.items())]


def parse_holdings(payload, code, day):
    entry = payload.get('Entries', {})
    if payload.get('StatusCode') != 0 or entry.get('FundID') != code:
        raise ValueError('持股回應代號或狀態不符')
    data = entry['Data']; asset = data['FundAsset']
    if asset['NavDate'].replace('/', '-') != day:
        raise ValueError('持股日期未更新')
    table = next(t for t in data['Table'] if t['TableTitle'] == '股票')
    if table['NavDate'].replace('/', '-') != day or [c['Name'] for c in table['Columns']] != ['股票代號', '股票名稱', '股數', '權重(%)']:
        raise ValueError('持股欄位或日期改變')
    holdings = [{'code': str(r[0]), 'name': r[1], 'shares': number(r[2]), 'weight_pct': number(r[3])} for r in table['Rows']]
    units, aum = number(asset['Units']), number(asset['Aum'])
    if min(units, aum) <= 0 or not holdings or len({r['code'] for r in holdings}) != len(holdings):
        raise ValueError('持股不完整')
    if any(r['shares'] <= 0 or not 0 <= r['weight_pct'] <= 100 for r in holdings) or not 50 <= sum(r['weight_pct'] for r in holdings) <= 100.5:
        raise ValueError('持股比重範圍不符')
    return {'code': code, 'as_of': day, 'status': 'ok', 'units': units, 'aum': aum,
            'top10_weight_pct': round(sum(sorted((r['weight_pct'] for r in holdings), reverse=True)[:10]), 2),
            'stock_weight_pct': round(sum(r['weight_pct'] for r in holdings), 2), 'holdings': holdings,
            'source': f'https://www.nomurafunds.com.tw/ETFWEB/product-description?fundNo={code}&tab=Shareholding'}


def fetch_holdings(code, day):
    req = Request(NOMURA, data=json.dumps({'FundID': code, 'SearchDate': day}).encode(),
                  headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
    with urlopen(req, timeout=25) as response:
        return parse_holdings(json.load(response), code, day)


def parse_daily(payload, code, month, day):
    if payload.get('stat') != 'OK' or code not in payload.get('title', '').split() or not str(payload.get('date', '')).startswith(month):
        raise ValueError('ETF官方月行情代號或日期不符')
    fields = payload['fields']
    cols = [fields.index(k) for k in ['日期', '收盤價', '漲跌價差', '註記']]
    prices = {}
    for row in payload['data']:
        date, close, change, note = [row[i] for i in cols]
        date = roc_date(date)
        if date > day: continue
        prices[date] = {'close': number(close), 'corporate_action': 'X' in change or '**' in note}
    return prices


def official_trend(prices, dates):
    wanted = [d.date().isoformat() for d in dates[-21:]]
    if len(wanted) < 21 or any(d not in prices for d in wanted):
        raise ValueError('上市期間或最近21個交易日資料不足')
    if any(prices[d]['corporate_action'] for d in wanted[1:]):
        raise ValueError('近20日有除息／不比價事件，暫停未還原趨勢判斷')
    values = [prices[d]['close'] for d in wanted]
    if min(values) <= 0: raise ValueError('收盤價無效')
    ma = sum(values[-20:])/20; close = values[-1]
    return {'status': 'ok', 'as_of': wanted[-1], 'close': close, 'ma20': round(ma, 4),
            'ma20_distance': round((close/ma-1)*100, 3), 'return_20d': round((close/values[0]-1)*100, 3),
            'source': 'TWSE 官方未還原收盤；窗口內不含不比價事件'}


def risks(row):
    flags = []
    if row['status'] == 'ok':
        if row['estimated_premium_pct'] >= 1:
            flags.append('預估溢價 ≥ 1%，留意溢價收斂')
        if row['units_change_pct'] <= -1:
            flags.append('當日受益單位減少 ≥ 1%，留意申贖壓力')
    price = row.get('trend', {})
    if price.get('status') == 'ok':
        if price['ma20_distance'] > 10 or price['return_20d'] > 20:
            flags.append('短期漲幅／月線乖離偏大，留意追高')
        if price['close'] < price['ma20']:
            flags.append('收盤失守月線，等待站回')
    if row.get('holding', {}).get('status') == 'ok' and row['holding']['top10_weight_pct'] >= 50:
        flags.append('前十大股票權重 ≥ 50%，留意集中風險')
    return flags


def overlap(funds, previous, stocks, top100):
    output = {}; by_code = {r['symbol'].split('.')[0]: r for r in stocks if r['market'] == 'TW'}
    caps = {r['symbol'].split('.')[0]: r for r in top100.get('stocks', [])}
    for fund in funds:
        old = previous.get(fund['code'], {})
        if not old.get('as_of') or old['as_of'] >= fund['as_of'] or old.get('units', 0) <= 0:
            old = {}
        old_stocks = {r['code']: r for r in old.get('holdings', [])}
        for r in fund['holdings']:
            s = output.setdefault(r['code'], {'code': r['code'], 'name': by_code.get(r['code'], {}).get('name', r['name']),
                                            'funds': [], 'shares': 0, 'reduced_funds': [], 'increased_funds': [], 'new_funds': []})
            s['funds'].append({'code': fund['code'], 'as_of': fund['as_of'], 'weight_pct': r['weight_pct']}); s['shares'] += r['shares']
            prior = old_stocks.get(r['code'])
            if prior and old.get('units', 0) > 0 and prior['shares'] > 0:
                change = (r['shares']/fund['units'])/(prior['shares']/old['units'])-1
                if change >= .01:
                    s['increased_funds'].append({'code': fund['code'], 'per_unit_change_pct': round(change*100, 2),
                                                'previous_date': old['as_of'], 'previous_weight_pct': prior['weight_pct'], 'weight_pct': r['weight_pct'],
                                                'source': fund.get('source')})
                if change <= -.01:
                    s['reduced_funds'].append({'code': fund['code'], 'per_unit_change_pct': round(change*100, 2), 'previous_date': old['as_of'],
                                               'previous_weight_pct': prior['weight_pct'], 'weight_pct': r['weight_pct'], 'source': fund.get('source')})
            elif not prior and old.get('units', 0) > 0:
                s['new_funds'].append({'code': fund['code'], 'previous_date': old['as_of'], 'weight_pct': r['weight_pct'], 'source': fund.get('source')})
        # A fully exited stock must remain visible in the reduction observations.
        current_codes = {r['code'] for r in fund['holdings']}
        for code, r in old_stocks.items():
            if code not in current_codes:
                s = output.setdefault(code, {'code': code, 'name': by_code.get(code, {}).get('name', r['name']), 'funds': [], 'shares': 0, 'reduced_funds': [], 'increased_funds': [], 'new_funds': []})
                s['reduced_funds'].append({'code': fund['code'], 'per_unit_change_pct': -100, 'previous_date': old['as_of'],
                                           'previous_weight_pct': r['weight_pct'], 'weight_pct': 0, 'source': fund.get('source')})
    for r in output.values():
        for kind in ('new_funds', 'increased_funds', 'reduced_funds'):
            for move in r[kind]:
                move['as_of'] = next(f['as_of'] for f in funds if f['code'] == move['code'])
        price = by_code.get(r['code'], {})
        r['price_weakening'] = bool(funds and price.get('as_of') == funds[0]['as_of'] and price.get('status') == 'ok' and price.get('stage') == 'weakening')
        r['price_as_of'] = price.get('as_of'); r['symbol'] = price.get('symbol')
        r['ordinary_shares_pct'] = round(r['shares']/caps[r['code']]['shares']*100, 4) if r['code'] in caps else None
    return sorted(output.values(), key=lambda r: (-len(r['reduced_funds']), -len(r['funds']), -max([f['weight_pct'] for f in r['funds']] or [0]), r['code']))


def latest_holdings(days, day):
    """Use only published snapshots, retaining actual dates and an older baseline."""
    current, previous = {}, {}
    for code in HOLDING_CODES:
        available = []
        for date in sorted(days, reverse=True):
            fund = days[date].get('holdings', {}).get(code)
            if date <= day and fund and fund.get('as_of') == date and fund.get('code') == code and fund.get('status') == 'ok' and fund.get('units', 0) > 0 and fund.get('holdings'):
                available.append(fund)
        if available: current[code] = available[0]
        if len(available) > 1: previous[code] = available[1]
    return current, previous


def extra_candidate_prices(candidates, stocks, quotes, benchmark, now, downloader, previous_extra=()):
    """Price newly observed ETF additions even when outside the top-100 watchlist."""
    known = {r['symbol'].split('.')[0] for r in stocks if r['market'] == 'TW'}
    output = []
    for item in candidates:
        code = item['code']
        if code in known or not (item.get('new_funds') or item.get('increased_funds') or item.get('reduced_funds')): continue
        symbol = next((code+suffix for suffix in ['.TW', '.TWO'] if code+suffix in quotes), None)
        if not symbol:
            symbol = next((r['symbol'] for r in previous_extra if r['symbol'].split('.')[0] == code), None)
        if not symbol: continue
        base = {'symbol':symbol,'name':item['name'],'market':'TW','currency':'TWD','group':'etf-additions',
                'group_name':'ETF 布局補充','status':'unavailable','history':[]}
        try:
            downloaded = downloader([symbol],period='1y',auto_adjust=False,actions=True,keepna=True,group_by='ticker',threads=False,progress=False,timeout=20)
            raw = downloaded[symbol].dropna(how='all')
            adjusted, _ = adjust_with_verified_close(raw, quotes.get(symbol))
            bars = completed_bars(adjusted, 'TW', now)
            base.update(analyze(bars, benchmark), status='ok')
            base['smart_money'] = assess_money(base, bars, {})
        except Exception:
            base['error'] = 'ETF 新增觀察股行情未齊，暫不判斷買入條件'
        output.append(base)
    return output


def main():
    import yfinance as yf
    now = datetime.now(timezone.utc)
    old_path = ROOT/'rotation/active_etf.json'
    previous_report = json.loads(old_path.read_text(encoding='utf-8')) if old_path.exists() else {}
    try:
        quotes, check = fetch_official_closes(now, ROOT/'rotation/official_closes.json', persist_cache=False)
        day = check['expected_tw_date']
        if not day or '^TWII' not in quotes:
            raise ValueError('官方交易日期未取得')
        basic = read_json(BASIC); rows = nav_rows(read_json(NAV), basic, day)
        if not rows or not any(r['status'] == 'ok' for r in rows):
            raise ValueError('ETF預估淨值與申贖日期未齊')
        symbols = ['^TWII']
        yf.set_tz_cache_location(str(ROOT/'.rotation-cache'))
        raw = {}
        for start in range(0, len(symbols), 8):
            batch = symbols[start:start+8]
            data = yf.download(batch, period='1y', auto_adjust=False, actions=True, keepna=True, group_by='ticker', threads=4, progress=False, timeout=20)
            for symbol in batch:
                if symbol in data.columns.get_level_values(0):
                    raw[symbol] = data[symbol].dropna(how='all')
        benchmark, _ = adjust_with_verified_close(raw['^TWII'], quotes['^TWII'])
        benchmark = completed_bars(benchmark, 'TW', now)
        dates = benchmark.index
        if dates[-1].date().isoformat() != day:
            raise ValueError('ETF趨勢基準日期未齊')
        prev_day = quotes['^TWII']['previous_date']
        archive_path = ROOT/'rotation/etf_history.json'
        archive = json.loads(archive_path.read_text(encoding='utf-8')) if archive_path.exists() else {'days': {}}
        archive.setdefault('days', {})
        archive.setdefault('prices', {})
        def price_history(code):
            prices = dict(archive['prices'].get(code, {}))
            months = sorted({d.strftime('%Y%m') for d in dates[-21:]})
            for month in months:
                if month != day[:7].replace('-', '') and all(d.date().isoformat() in prices for d in dates[-21:] if d.strftime('%Y%m') == month):
                    continue
                url = f'https://www.twse.com.tw/exchangeReport/STOCK_DAY?date={month}01&stockNo={code}&response=json'
                try: prices.update(parse_daily(read_json(url), code, month, day))
                except Exception: pass
            prices = {d: prices[d] for d in sorted(prices)[-65:] if d <= day}
            try: result = official_trend(prices, dates)
            except ValueError as error: result = {'status': 'unavailable', 'reason': str(error)}
            return code, prices, result
        trends = {}
        with ThreadPoolExecutor(max_workers=3) as pool:
            for code, prices, result in pool.map(price_history, [r['code'] for r in rows]):
                archive['prices'][code] = prices; trends[code] = result
        holding_now, holding_prev, errors = {}, {}, []
        def get(key):
            code, date = key
            cached = archive['days'].get(date, {}).get('holdings', {}).get(code)
            try:
                fund = cached if cached and cached.get('as_of') == date and cached.get('code') == code else fetch_holdings(code, date)
                fund['source'] = f'https://www.nomurafunds.com.tw/ETFWEB/product-description?fundNo={code}&tab=Shareholding'
                return code, date, fund, None
            except Exception:
                return code, date, None, f'{code} {date} 持股尚未取得'
        keys = [(code, date) for code in HOLDING_CODES for date in (day, prev_day)]
        with ThreadPoolExecutor(max_workers=3) as pool:
            for code, date, fund, error in pool.map(get, keys):
                if error: errors.append(error)
                if fund:
                    archive['days'].setdefault(date, {}).setdefault('holdings', {})[code] = fund
        holding_now, holding_prev = latest_holdings(archive['days'], day)
        for r in rows:
            r['trend'] = trends[r['code']]
            fund = holding_now.get(r['code'])
            r['holding'] = {k: v for k, v in fund.items() if k != 'holdings'} if fund else {'status': 'unavailable'}
            if fund:
                r['holding']['comparison_as_of'] = holding_prev.get(r['code'], {}).get('as_of')
                r['holding']['latest_session_available'] = fund['as_of'] == day
            r['risks'] = risks(r)
        market = json.loads((ROOT/'rotation/data.json').read_text(encoding='utf-8'))
        caps = json.loads((ROOT/'rotation/top100.json').read_text(encoding='utf-8'))
        overlaps = overlap(list(holding_now.values()), holding_prev, market['stocks'], caps)
        extras = extra_candidate_prices(overlaps, market['stocks'], quotes, benchmark, now, yf.download, previous_report.get('extra_stocks', []))
        overlaps = overlap(list(holding_now.values()), holding_prev, market['stocks']+extras, caps)
        result = {'schema_version': 1, 'status': 'ok', 'generated_at': now.isoformat(), 'as_of': day,
                  'scope': '台灣上市、投資國內股票的主動式 ETF；不含海外股票與債券型。',
                  'catalog_as_of': max(roc_date(r['出表日期']) for r in domestic_active(basic, day).values()),
                  'funds': rows, 'holdings_coverage': len(holding_now), 'holdings_provider': '野村投信',
                  'holdings_dates': sorted({f['as_of'] for f in holding_now.values()}),
                  'holdings_today_coverage': sum(f['as_of'] == day for f in holding_now.values()),
                  'comparison_coverage': len(set(holding_now)&set(holding_prev)),
                  'overlap': overlaps, 'extra_stocks': extras, 'errors': errors,
                  'sources': [BASIC, NAV, 'https://www.nomurafunds.com.tw/ETFWEB/', 'https://www.twse.com.tw/zh/trading/historical/stock-day.html'],
                  'method': '初始觀察門檻未回測。預估折溢價不是最終淨值折溢價；申贖單位變化不是經理人買賣股票金額。每單位持股減少仍可能受公司行動等影響，不等同確認賣出。持股僅計股票現貨，不含期貨等曝險。'}
        archive['days'].setdefault(day, {})['funds'] = [{k: v for k, v in r.items() if k not in ['holding', 'trend']} for r in rows]
        archive['days'] = {d: archive['days'][d] for d in sorted(archive['days'])[-65:]}
        save_archive(archive_path, archive); save_archive(old_path, result)
        print(f'Active ETF {day}: NAV {sum(r["status"]=="ok" for r in rows)}/{len(rows)}, trend {sum(r["trend"]["status"]=="ok" for r in rows)}, holdings {len(holding_now)}, previous holdings {len(holding_prev)}')
    except Exception as error:
        save_archive(old_path, {**previous_report, 'schema_version': 1, 'status': 'stale' if previous_report else 'unavailable', 'last_attempt_at': now.isoformat(), 'error': str(error)})
        raise


if __name__ == '__main__':
    main()
