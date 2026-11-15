"""Build the browser's ODbL derivative from a local Weimar SQLite download.
Usage: python3 scripts/build-lickbrowser-corpus.py /path/to/wjazzd.db
The raw database is not committed. Beat ticks are 1/12 quarter note.
"""
import json
import sqlite3
import sys
from pathlib import Path

db = sqlite3.connect(f'file:{Path(sys.argv[1]).resolve()}?mode=ro', uri=True)
db.row_factory = sqlite3.Row
solos = []
for row in db.execute('SELECT melid, performer, title, instrument, avgtempo FROM solo_info'):
    solo = dict(row)
    beats = list(db.execute('SELECT onset, bar, beat, signature, chord FROM beats WHERE melid=? ORDER BY onset', (row['melid'],)))
    notes = list(db.execute('SELECT onset, duration, pitch, bar, beat, tatum, division, beatdur FROM melody WHERE melid=? ORDER BY onset', (row['melid'],)))
    if not beats or not notes:
        continue
    positions = {(b['bar'], b['beat']): i * 12 for i, b in enumerate(beats)}
    bars, changes = [], []
    meter = '4/4'
    for i, b in enumerate(beats):
        meter = b['signature'] or meter
        if b['beat'] == 1:
            bars.append([i * 12, meter, b['bar']])
        if b['chord'] and (not changes or changes[-1][3] != b['chord']):
            changes.append([round(b['onset'], 4), b['bar'], b['beat'], b['chord'], i * 12])
    if not changes:
        continue
    changes.append([round(max(n['onset'] + n['duration'] for n in notes), 4), None, None, None, len(beats) * 12])
    metric = []
    for n in notes:
        tick = positions.get((n['bar'], n['beat']))
        if tick is None:
            metric.append(None)
            continue
        division = max(1, n['division'] or 1)
        grid = 4 if division % 3 == 0 else 3
        at = tick + round(((n['tatum'] or 1) - 1) / division * 12 / grid) * grid
        raw = n['duration'] / max(.01, n['beatdur'] or .5) * 12
        metric.append([at, max(grid, round(raw / grid) * grid), grid, round(raw, 4)])
    solo.update(notes=[[round(n['onset'], 4), round(n['duration'], 4), n['pitch']] for n in notes], metric=metric, bars=bars, changes=changes, beats=[round(b['onset'], 5) for b in beats])
    solos.append(solo)
Path('static/data/weimar-licks.json').write_text(json.dumps(solos, separators=(',', ':')))
print(f'Exported {len(solos)} solos.')
