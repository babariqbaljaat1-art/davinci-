"""Download Dukascopy M1 bid candles and save 5-minute candles (research data).

Runs on GitHub Actions (free). Output: duka/<SYMBOL>_5m.json.gz with rows [t, o, h, l, c]
(t = unix seconds, UTC). Usage: python research/dukascopy.py 2023-01-01 2026-10-31
"""
import gzip, json, lzma, os, struct, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

SYMBOLS = {  # dukascopy name -> (our id, expected price range for scale detection)
    'XAUUSD': ('XAUUSD', (1000, 6000)),
    'EURUSD': ('EURUSD', (0.8, 1.5)),
    'GBPUSD': ('GBPUSD', (1.0, 1.8)),
    'USA30IDXUSD': ('US30', (20000, 70000)),
    'USATECHIDXUSD': ('NAS100', (8000, 40000)),
}
OUT = 'duka'


def fetch(sym, d):
    url = f'https://datafeed.dukascopy.com/datafeed/{sym}/{d.year}/{d.month - 1:02d}/{d.day:02d}/BID_candles_min_1.bi5'
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30) as r:
                raw = r.read()
            if not raw:
                return d, []
            data = lzma.decompress(raw)
            rows = [struct.unpack('>IIIIIf', data[i:i + 24]) for i in range(0, len(data) - 23, 24)]
            return d, rows
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return d, []
            time.sleep(1 + attempt * 2)
        except Exception:
            time.sleep(1 + attempt * 2)
    return d, None


def main():
    start = date.fromisoformat(sys.argv[1]); end = date.fromisoformat(sys.argv[2])
    only = sys.argv[3:] or list(SYMBOLS)
    days = [start + timedelta(n) for n in range((end - start).days + 1) if (start + timedelta(n)).weekday() != 5]  # no Saturday data
    os.makedirs(OUT, exist_ok=True)
    for sym, (sid, (lo, hi)) in SYMBOLS.items():
        if sym not in only:
            continue
        t0 = time.time()
        results = []
        with ThreadPoolExecutor(12) as ex:
            for k, res in enumerate(ex.map(lambda d: fetch(sym, d), days)):
                results.append(res)
                if k % 100 == 0:
                    print(f'{sym}: {k}/{len(days)} days, {time.time() - t0:.0f}s', flush=True)
        results.sort(key=lambda x: x[0])
        failed = [d for d, r in results if r is None]
        m1 = []
        for d, rows in results:
            if not rows:
                continue
            base = int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())
            for (sec, o, c, l, h, v) in rows:
                if v <= 0:          # no trades in that minute (closed market filler)
                    continue
                m1.append((base + sec, o, h, l, c))
        if not m1:
            print(sym, 'no data', flush=True); continue
        # price scale: pick the power of ten that puts the median close in the expected range
        med = sorted(r[4] for r in m1[::97])[len(m1[::97]) // 2]
        scale = next(10 ** p for p in range(0, 7) if lo <= med / 10 ** p <= hi)
        # aggregate to 5 minutes
        out, cur = [], None
        for t, o, h, l, c in m1:
            b = t - t % 300
            if cur is None or cur[0] != b:
                if cur: out.append(cur)
                cur = [b, o, h, l, c]
            else:
                cur[2] = max(cur[2], h); cur[3] = min(cur[3], l); cur[4] = c
        if cur: out.append(cur)
        rows = [[r[0]] + [round(x / scale, 6) for x in r[1:]] for r in out]
        with gzip.open(f'{OUT}/{sid}_5m.json.gz', 'wt') as f:
            json.dump(rows, f, separators=(',', ':'))
        print(f'{sid}: {len(m1)} m1 -> {len(rows)} m5 bars, scale 1e{len(str(scale)) - 1}, '
              f'{rows[0][0]}..{rows[-1][0]}, failed days {len(failed)}, {time.time() - t0:.0f}s, last close {rows[-1][4]}', flush=True)


if __name__ == '__main__':
    main()
