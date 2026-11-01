#!/bin/bash
# Assemble the Windows app folder:  pc/build.sh [output-dir]
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$ROOT/pc/dist/Da Vinci Scanner}
rm -rf "$OUT"
mkdir -p "$OUT/app/web" "$OUT/TradingView indicator"

cp "$ROOT/pc/Da Vinci Scanner.vbs" "$ROOT/pc/Setup - pehli baar yahan double-click karo.bat" "$ROOT/pc/README.txt" "$OUT/"
cp "$ROOT/pc/app/launcher.ps1" "$ROOT/pc/app/server.ps1" "$ROOT/pc/app/install.ps1" "$ROOT/pc/app/icon.ico" "$OUT/app/"

# the same UI as the cloud app, with the live PC provider in front of it
cp -r "$ROOT/docs/engine" "$ROOT/docs/icons" "$OUT/app/web/"
cp "$ROOT/docs/index.html" "$ROOT/docs/app.js" "$ROOT/docs/chart.js" "$ROOT/docs/style.css" "$ROOT/docs/research.json" "$OUT/app/web/"
cp "$ROOT/pc/overlay/"*.js "$ROOT/pc/overlay/"*.html "$OUT/app/web/"
python3 - "$OUT/app/web/index.html" << 'EOF'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
s = s.replace('<script type="module" src="app.js"></script>', '<script type="module" src="pc-provider.js"></script>\n<script type="module" src="app.js"></script>')
s = s.replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
s = s.replace('Data: Yahoo Finance futures (GC=F, NQ=F, YM=F), jo spot/CFD prices se thoda alag ho sakta hai.',
              'Data: Yahoo Finance (gold/indices futures ~10 min delayed, forex near real-time), jo broker prices se thoda alag ho sakta hai.')
open(p, 'w', encoding='utf-8').write(s)
EOF
cp "$ROOT/pine/davinci.pine" "$OUT/TradingView indicator/Da Vinci indicator.pine"
cp "$ROOT/pine/README.txt" "$OUT/TradingView indicator/Kaise lagayein.txt"

# Windows line endings for scripts and text; UTF-8 BOM so Windows PowerShell 5.1 reads .ps1 correctly
python3 - "$OUT" << 'EOF'
import sys, pathlib
for p in pathlib.Path(sys.argv[1]).rglob('*'):
    if p.suffix.lower() in ('.ps1', '.bat', '.vbs', '.txt', '.pine'):
        b = p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
        if p.suffix.lower() == '.ps1' and not b.startswith(b'\xef\xbb\xbf'):
            b = b'\xef\xbb\xbf' + b
        p.write_bytes(b)
EOF
echo "built: $OUT"
find "$OUT" -type f | sed "s#$OUT/##" | sort
