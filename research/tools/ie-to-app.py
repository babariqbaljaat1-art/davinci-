# Put the IE rulebook research (research/ierules-5m.json) at the top of the app's research card (docs/research.json).
# run from the repo root: python3 research/tools/ie-to-app.py
import json, sys
r = json.load(open('docs/research.json'))
ie = json.load(open('research/ierules-5m.json'))
keep = [x for x in r['rows'] if x.get('family') != 'ie']
rows = []
for x in ie['results']:
    if 'IE grade' not in x['variant'] and 'all Da Vinci' not in x['variant']: continue
    if x['manage'].startswith('IE mgmt (50%'): continue
    lab = {'all Da Vinci (no IE grading)': 'Da Vinci, IE grading ke baghair', 'IE grade A+B': 'IE rulebook: grade A+B', 'IE grade A only': 'IE rulebook: sirf grade A'}[x['variant']]
    mg = 'simple' if x['manage'].startswith('simple') else ('IE mgmt, T1 = liquidity' if 'T1=liquidity' in x['manage'] else 'IE mgmt, T1 = 3R')
    rows.append({'tf': x['tf'], 'family': 'ie', 'label': f'{lab} ({mg})', 'settings': 1, 'positiveIS': 1 if x['is']['expectancyR'] > 0 else 0,
                 'isTrades': x['is']['trades'], 'isExp': round(x['is']['expectancyR'], 3), 'oosTrades': x['oos']['trades'], 'oosExp': round(x['oos']['expectancyR'], 3), 'oosWin': round(x['oos']['winRate'], 3)})
r['rows'] = rows + keep
notes = [n for n in r['notes'] if not n.startswith('IE rulebook')]
r['notes'] = json.load(open('research/ie-notes.json')) + notes
json.dump(r, open('docs/research.json', 'w'), ensure_ascii=False, indent=1)
print(len(rows), 'IE rows,', len(r['notes']), 'notes')
