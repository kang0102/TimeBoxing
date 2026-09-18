"""Current top-100 ordinary Taiwan shares, ranked from official share counts/prices."""
from copy import deepcopy
from datetime import datetime, timezone
from io import StringIO
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen
import pandas as pd
from rotation_prices import fetch_official_closes, read_json, roc_date, number

ROOT=Path(__file__).resolve().parents[1]
COMPANIES='https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
TPEX_VALUES='https://www.tpex.org.tw/openapi/v1/tpex_daily_market_value'


def ordinary(code):
    return bool(re.fullmatch(r'[1-9][0-9]{3}',str(code))) and not str(code).startswith('91')


def rank_top100(companies, listed_quotes, otc, industries, day):
    rows=[]
    for r in companies:
        code=r['公司代號'];symbol=code+'.TW';quote=listed_quotes.get(symbol)
        if not ordinary(code) or not quote or quote['date']!=day:continue
        shares=number(r['已發行普通股數或TDR原股發行股數'])
        if shares<=0 or quote['Close']<=0 or roc_date(r['出表日期'])>day:continue
        rows.append({'symbol':symbol,'name':r['公司簡稱'],'exchange':'TWSE','close':quote['Close'],
                     'shares':int(shares),'shares_as_of':roc_date(r['出表日期']),
                     'market_cap':round(shares*quote['Close']), 'industry':industries.get(code,'其他上市股票')})
    for r in otc:
        code=r['SecuritiesCompanyCode']
        if not ordinary(code) or roc_date(r['Date'])!=day:continue
        shares,close=number(r['Capitals']),number(r['ClosePrice'])
        if shares<=0 or close<=0:continue
        rows.append({'symbol':code+'.TWO','name':r['CompanyName'],'exchange':'TPEx','close':close,
                     'shares':int(shares),'shares_as_of':day,'market_cap':round(shares*close),
                     'industry':industries.get(code,'其他上櫃股票')})
    if len(rows)<1500 or len({r['symbol'] for r in rows})!=len(rows):
        raise ValueError('全市場市值資料不足或代號重複，保留原百大名單')
    rows.sort(key=lambda r:(-r['market_cap'],r['symbol']))
    return [{**r,'rank':i+1} for i,r in enumerate(rows[:100])],len(rows)


def industry_names():
    output={}
    for mode in (2,4):
        url=f'https://isin.twse.com.tw/isin/C_public.jsp?strMode={mode}'
        request=Request(url,headers={'User-Agent':'Mozilla/5.0'})
        with urlopen(request,timeout=25) as r:html=r.read().decode('cp950',errors='replace')
        table=pd.read_html(StringIO(html))[0]
        for row in table.itertuples(index=False,name=None):
            code=str(row[0]).split()[0]
            if ordinary(code) and pd.notna(row[4]):output[code]=str(row[4])
    return output


def refresh_top100(path=ROOT/'rotation/top100.json'):
    now=datetime.now(timezone.utc)
    previous=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    try:
        quotes,check=fetch_official_closes(now)
        day=check['expected_tw_date']
        if not day:raise ValueError('官方完整交易日期未取得')
        companies=read_json(COMPANIES);otc=read_json(TPEX_VALUES)
        try:industries=industry_names()
        except Exception:industries={r['symbol'].split('.')[0]:r['industry'] for r in previous.get('stocks',[])}
        rows,total=rank_top100(companies,quotes,otc,industries,day)
        snapshot={'schema_version':1,'status':'ok','as_of':day,'generated_at':now.isoformat(),'market_size':total,
                  'method':'上市＋上櫃普通股；最近公告普通股股數 × 同日官方收盤價估算市值，依市值排序取前100，不含ETF與TDR。',
                  'sources':[COMPANIES,TPEX_VALUES,'https://www.twse.com.tw/zh/trading/exchange/MI_INDEX.html'], 'stocks':rows}
    except Exception as error:
        snapshot={**previous,'status':'stale' if previous.get('stocks') else 'unavailable','last_attempt_at':now.isoformat(),'error':str(error)}
    path.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    return snapshot


def expand_universe(base,top100):
    config=deepcopy(base)
    present={s[0] for g in config['groups'] for s in g['stocks']}
    extra={}
    for r in top100.get('stocks',[]):
        if r['symbol'] in present:continue
        group=extra.setdefault(r['industry'],{'id':'industry-'+r['industry'],'name':r['industry'],'stocks':[]})
        group['stocks'].append([r['symbol'],r['name'],'TW'])
        present.add(r['symbol'])
    config['groups'].extend(extra.values())
    config['top100_as_of']=top100.get('as_of')
    return config


if __name__=='__main__':
    snapshot=refresh_top100()
    base=json.loads((ROOT/'rotation/universe.json').read_text(encoding='utf-8'))
    config=expand_universe(base,snapshot)
    (ROOT/'rotation/universe_current.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(snapshot['status'],snapshot.get('as_of'),'top',len(snapshot.get('stocks',[])),'market',snapshot.get('market_size'))
    print([(r['rank'],r['symbol'],r['name'],round(r['market_cap']/1e8,1),r['industry']) for r in snapshot.get('stocks',[])[:12]])
