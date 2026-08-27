import csv
import io
import json
import re
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

OUT = Path('market_data.json')
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/126 Safari/537.36 NeilToolbox/1.0',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8,ja;q=0.7',
}
SESSION = requests.Session()
SESSION.headers.update(HEADERS)


def load_old():
    if OUT.exists():
        try:
            return json.loads(OUT.read_text(encoding='utf-8'))
        except Exception:
            pass
    return {}


def num(v):
    if v is None:
        return None
    s = str(v).replace(',', '').replace('%', '').strip()
    if s in ('', '-', 'N/A', 'NA', 'null', 'None'):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def fmt_date_yyyymmdd(s):
    s = str(s or '').strip()
    m = re.fullmatch(r'(\d{4})(\d{2})(\d{2})', s)
    return f'{m.group(1)}/{m.group(2)}/{m.group(3)}' if m else s


def fetch_taifex():
    url = 'https://openapi.taifex.com.tw/v1/DailyMarketReportFut'
    r = SESSION.get(url, timeout=30)
    r.raise_for_status()
    data = r.json()
    rows = []
    for row in data:
        if row.get('Contract') != 'TX':
            continue
        month = str(row.get('ContractMonth(Week)', '')).strip()
        if not re.fullmatch(r'\d{6}', month):
            continue
        last = num(row.get('Last'))
        if last is None:
            continue
        date = str(row.get('Date', '')).strip()
        rows.append((date, month, row, last))
    if not rows:
        raise RuntimeError('TAIFEX: no TX rows')

    latest_date = max(x[0] for x in rows)
    dated = [x for x in rows if x[0] == latest_date]
    near_month = min(x[1] for x in dated)
    near = [x for x in dated if x[1] == near_month]
    picked = next((x for x in near if x[2].get('TradingSession') == '盤後'), None)
    picked = picked or next((x for x in near if x[2].get('TradingSession') == '一般'), None) or near[0]
    _, month, row, last = picked
    change = num(row.get('Change')) or 0.0
    pct = num(row.get('%'))
    return {
        'value': last,
        'change': change,
        'change_pct': pct,
        'date': fmt_date_yyyymmdd(latest_date),
        'session': '盤後' if row.get('TradingSession') == '盤後' else '一般盤',
        'contract': month,
        'source': '臺灣期貨交易所',
    }


def fetch_us30y():
    year = datetime.now().year
    url = (
        'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/'
        f'daily-treasury-rates.csv/{year}/all?_format=csv&field_tdr_date_value={year}'
        '&page=&type=daily_treasury_yield_curve'
    )
    r = SESSION.get(url, timeout=30)
    r.raise_for_status()
    text = r.content.decode('utf-8-sig', errors='replace')
    rows = list(csv.DictReader(io.StringIO(text)))
    usable = []
    for row in rows:
        val = num(row.get('30 YR') or row.get('30 Yr') or row.get('30YR'))
        if val is None:
            continue
        date_text = (row.get('Date') or '').strip()
        try:
            dt = datetime.strptime(date_text, '%m/%d/%Y')
        except ValueError:
            continue
        usable.append((dt, val, date_text))
    if not usable:
        raise RuntimeError('Treasury: no 30Y rows')
    usable.sort(key=lambda x: x[0])
    latest = usable[-1]
    prev = usable[-2] if len(usable) > 1 else latest
    return {
        'value': latest[1],
        'change_bp': round((latest[1] - prev[1]) * 100, 1),
        'date': latest[2],
        'source': 'U.S. Treasury',
    }


def era_date(s):
    s = str(s or '').strip()
    m = re.fullmatch(r'R(\d+)\.(\d+)\.(\d+)', s, re.I)
    if m:
        return datetime(2018 + int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.fullmatch(r'H(\d+)\.(\d+)\.(\d+)', s, re.I)
    if m:
        return datetime(1988 + int(m.group(1)), int(m.group(2)), int(m.group(3)))
    for fmt in ('%Y/%m/%d', '%Y-%m-%d'):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return None


def fetch_jp10y():
    url = 'https://www.mof.go.jp/jgbs/reference/interest_rate/jgbcm.csv'
    r = SESSION.get(url, timeout=30)
    r.raise_for_status()
    raw = r.content
    text = None
    for enc in ('cp932', 'shift_jis', 'utf-8-sig'):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = raw.decode('utf-8', errors='replace')

    lines = [line for line in text.splitlines() if line.strip()]
    header_idx = next((i for i, line in enumerate(lines) if '基準日' in line and '10年' in line), -1)
    if header_idx < 0:
        raise RuntimeError('JGB: header not found')
    reader = csv.reader(lines[header_idx:])
    headers = next(reader)
    date_idx = next(i for i, h in enumerate(headers) if '基準日' in h)
    y10_idx = next(i for i, h in enumerate(headers) if h.strip().startswith('10年'))
    usable = []
    for cols in reader:
        if max(date_idx, y10_idx) >= len(cols):
            continue
        v = num(cols[y10_idx])
        dt = era_date(cols[date_idx])
        if v is not None and dt is not None:
            usable.append((dt, v))
    if not usable:
        raise RuntimeError('JGB: no 10Y rows')
    usable.sort(key=lambda x: x[0])
    latest = usable[-1]
    prev = usable[-2] if len(usable) > 1 else latest
    return {
        'value': latest[1],
        'change_bp': round((latest[1] - prev[1]) * 100, 1),
        'date': latest[0].strftime('%Y/%m/%d'),
        'source': '日本財務省',
    }


def parse_dram_row(soup, item_name):
    for tr in soup.find_all('tr'):
        cells = [' '.join(td.stripped_strings) for td in tr.find_all(['td', 'th'])]
        if not cells:
            continue
        if item_name.lower() not in cells[0].lower():
            continue
        values = [num(c) for c in cells[1:]]
        numeric = [v for v in values if v is not None]
        if len(numeric) < 5:
            continue
        avg = numeric[4]
        change = numeric[5] if len(numeric) > 5 else 0.0
        return {'average': avg, 'change_pct': change}
    return None


def fetch_dram():
    urls = ['https://www.dramexchange.com/', 'https://www.trendforce.com/price/dram/dram_spot']
    last_err = None
    for url in urls:
        try:
            r = SESSION.get(url, timeout=35)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, 'html.parser')
            text = ' '.join(soup.stripped_strings)
            m = re.search(r'DRAM\s+Spot\s+Price\s+Last\s+Update:\s*([A-Za-z]{3}\.?\s*\d{1,2}\s*\d{4}\s*\d{1,2}:\d{2})', text, re.I)
            if not m:
                m = re.search(r'Last\s+Update\s+(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2})', text, re.I)
            updated = m.group(1) if m else ''
            ddr5 = parse_dram_row(soup, 'DDR5 16Gb (2Gx8) 4800/5600')
            ddr4 = parse_dram_row(soup, 'DDR4 8Gb (1Gx8) 3200')
            if not ddr5 or not ddr4:
                rx5 = re.search(r'DDR5 16Gb \(2Gx8\) 4800/5600\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+).*?(-?[\d.]+)\s*%', text, re.I)
                rx4 = re.search(r'DDR4 8Gb \(1Gx8\) 3200\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+).*?(-?[\d.]+)\s*%', text, re.I)
                if rx5:
                    ddr5 = {'average': float(rx5.group(5)), 'change_pct': float(rx5.group(6))}
                if rx4:
                    ddr4 = {'average': float(rx4.group(5)), 'change_pct': float(rx4.group(6))}
            if ddr5 and ddr4:
                return {
                    'updated': updated,
                    'ddr5_16gb': ddr5,
                    'ddr4_8gb': ddr4,
                    'source': 'DRAMeXchange / TrendForce',
                }
            raise RuntimeError('DRAM table rows not found')
        except Exception as e:
            last_err = e
    raise last_err or RuntimeError('DRAM fetch failed')


def main():
    data = load_old()
    jobs = [
        ('taifex', fetch_taifex),
        ('us30y', fetch_us30y),
        ('jp10y', fetch_jp10y),
        ('dram', fetch_dram),
    ]
    for key, fn in jobs:
        try:
            data[key] = fn()
            print(f'OK {key}: {data[key]}')
        except Exception as e:
            print(f'WARN {key}: {e}')
            if key not in data:
                data[key] = {'error': str(e)}
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
