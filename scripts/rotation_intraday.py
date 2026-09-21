"""TW exchange quote observations, separate from completed-session strategy results."""
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlencode
import json
import math
from rotation_money import save_archive

ROOT = Path(__file__).resolve().parents[1]
ZONE = ZoneInfo('Asia/Taipei')
SOURCE = 'https://mis.twse.com.tw/stock/index.jsp'
API = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp'
MAX_AGE_MINUTES = 20

def session(now):
    local = now.astimezone(ZONE)
    if local.weekday() >= 5: return 'weekend'
    if local.time() < time(9): return 'premarket'
    if local.time() <= time(13,35): return 'intraday'
    return 'after_close'

def positive(value, zero=False):
    value = float(str(value).replace(',', ''))
    if not math.isfinite(value) or (value < 0 if zero else value <= 0): raise ValueError('invalid number')
    return value

def parse_quote(raw, channel, now):
    exchange, code = channel.split('_',1); code=code.removesuffix('.tw')
    if raw.get('ex') != exchange or raw.get('c') != code: raise ValueError('quote identity mismatch')
    stamp = datetime.strptime(raw['d']+' '+raw['t'], '%Y%m%d %H:%M:%S').replace(tzinfo=ZONE)
    if stamp.time() < time(9) or stamp.time() > time(13,35) or stamp > now.astimezone(ZONE): raise ValueError('quote time invalid')
    price, ref = positive(raw['z']), positive(raw['y'])
    high, low = positive(raw['h']), positive(raw['l'])
    if not low <= price <= high: raise ValueError('price outside session range')
    return {'quote_at':stamp.isoformat(), 'quote_date':stamp.date().isoformat(), 'price':price, 'reference_close':ref,
            'high':high, 'low':low, 'change_pct':round((price/ref-1)*100,4),
            'volume_shares':positive(raw['v'],zero=True)*1000 if code!='t00' else None}

def baseline(row, quote):
    if row.get('status') != 'ok': raise ValueError('daily baseline unavailable')
    if row.get('as_of') == quote['quote_date']:
        base = row.get('prior_session', {})
    else:
        base = {'as_of':row.get('as_of'), 'close':row.get('close'), 'ma20':row.get('ma20'),
                'high20':row.get('next_session_high20'), 'volume_mean20':row.get('next_session_volume_mean20')}
    old = datetime.fromisoformat(base['as_of']).date(); day=datetime.fromisoformat(quote['quote_date']).date()
    if not 0 < (day-old).days <= 4: raise ValueError('daily baseline too old')
    for key in ['close','ma20','high20','volume_mean20']: positive(base.get(key))
    # Do not mix an ex-dividend / split reference price with old adjusted levels.
    if abs(base['close']/quote['reference_close']-1) > .001: raise ValueError('reference price changed; require fresh adjusted baseline')
    return base

def quote_usable(q, now):
    local=now.astimezone(ZONE); stamp=datetime.fromisoformat(q['quote_at'])
    if q['quote_date'] != local.date().isoformat(): return False
    if session(now)=='intraday': return 0 <= (local-stamp).total_seconds() <= MAX_AGE_MINUTES*60
    return session(now)=='after_close' and stamp.time() >= time(13,25)

def assess(row, quote, index, now):
    out={**quote,'symbol':row['symbol'],'name':row['name'],'group':row['group'],'group_name':row['group_name'],'status':'unavailable','signal':'unknown'}
    if not quote_usable(quote,now) or not quote_usable(index,now):
        return {**out,'reason':'報價日期或成交時間未齊，暫不判斷'}
    try: base=baseline(row,quote)
    except (ValueError,KeyError,TypeError): return {**out,'reason':'完整日線基準未齊或除權息參考價改變，暫不判斷'}
    relative=quote['change_pct']-index['change_pct']
    price=quote['price']; ma=base['ma20']; high=base['high20']
    if price <= ma: signal='defend'; reason='報價落在前一交易日月線下，先防守'
    elif quote['high'] > high and price <= high: signal='fade'; reason='當天曾越過前高，目前已跌回，先避開追價'
    elif price/ma-1 > .15: signal='hot'; reason='月線乖離超過 15%，先不追高'
    elif price > high and relative > 0: signal='breakout'; reason='價格越過前高且當日強於大盤；是否成立仍以完整日線量價為準'
    else: signal='wait'; reason='突破與相對大盤條件尚未同時成立'
    return {**out,'status':'ok','signal':signal,'reason':reason,'baseline_as_of':base['as_of'], 'ma20':base['ma20'],
            'high20':high,'relative_today_pct':round(relative,4),
            'volume_progress_ratio':round(quote['volume_shares']/base['volume_mean20'],4)}

def fetch_quotes(channels):
    result={};errors=[]
    for start in range(0,len(channels),25):
        batch=channels[start:start+25]
        try:
            url=API+'?'+urlencode({'ex_ch':'|'.join(batch),'json':'1','delay':'0'})
            req=Request(url,headers={'User-Agent':'Mozilla/5.0','Referer':SOURCE})
            data=json.load(urlopen(req,timeout=20))
            if data.get('rtcode') != '0000': raise ValueError('provider unavailable')
            for r in data['msgArray']:
                ch=f"{r.get('ex')}_{r.get('c')}.tw"
                if ch in batch and ch not in result: result[ch]=r
        except Exception: errors.append(f'報價批次 {start//25+1} 未取得')
    return result,errors

def main():
    now=datetime.now(timezone.utc);local=now.astimezone(ZONE)
    data=json.loads((ROOT/'rotation/data.json').read_text(encoding='utf-8'))
    etf=json.loads((ROOT/'rotation/active_etf.json').read_text(encoding='utf-8'))
    rows={r['symbol']:r for r in data['stocks']+etf.get('extra_stocks',[]) if r['market']=='TW'}
    channels={s:('otc_' if s.endswith('.TWO') else 'tse_')+s.split('.')[0]+'.tw' for s in rows}
    raw,errors=fetch_quotes(['tse_t00.tw',*channels.values()]);index={};stocks=[]
    try: index=parse_quote(raw['tse_t00.tw'],'tse_t00.tw',now)
    except (ValueError,KeyError,TypeError): errors.append('加權指數未取得有效報價')
    for symbol,row in rows.items():
        try:
            quote=parse_quote(raw[channels[symbol]],channels[symbol],now)
            stocks.append(assess(row,quote,index,now) if index else {**quote,'symbol':symbol,'name':row['name'],'status':'unavailable','signal':'unknown','reason':'大盤報價未齊'})
        except (ValueError,KeyError,TypeError): stocks.append({'symbol':symbol,'name':row['name'],'status':'unavailable','signal':'unknown','reason':'本次沒有可驗證的成交報價'})
    available=sum(r['status']=='ok' for r in stocks)
    out={'schema_version':1,'generated_at':now.isoformat(),'session_date':local.date().isoformat(),'phase':session(now),
         'status':'ok' if available else 'unavailable','market':'TW','source':SOURCE,'index':index,'stocks':stocks,
         'coverage':{'available':available,'total':len(stocks)},'errors':errors,'max_age_minutes':MAX_AGE_MINUTES,
         'method':'交易時段目標每15分鐘更新，GitHub排程可能延遲。盤中價位與前一完整交易日比較；暫時突破不等於收盤訊號。整股累計量除以歷史全日均量僅供進度參考，不當成同時段量比。ETF及法人為最新已公布持股／籌碼，不是即時交易。'}
    save_archive(ROOT/'rotation/intraday.json',out)
    print(json.dumps({'phase':out['phase'],'quote_date':index.get('quote_date'),'available':available,'total':len(stocks),'errors':errors}))
    if not raw or (session(now)=='intraday' and not available): raise SystemExit(1)

if __name__=='__main__': main()
