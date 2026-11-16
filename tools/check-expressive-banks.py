#!/usr/bin/env python3
"""Offline integrity check of every shipped expressive sample and its mapping."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
base = root / 'public/banks'
provenance = json.loads((base / 'expressive-provenance.json').read_text())
text = (root / 'src/audio/expressive-manifest.ts').read_text()
manifest = json.loads(text.split(' = ', 1)[1].rstrip().removesuffix(';'))
seen = set()
for row in provenance['samples']:
    file = base / row['file']
    assert file.is_file(), file
    data = file.read_bytes()
    assert len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256'], file
    assert 0 <= row['off'] < row['duration'] and 0 < row['gain'] < 100, file
    assert row['duration'] <= (12.1 if row['bank'] == 'salamander' else 6.1), file
    assert len(row['sourceSha256']) == 64, file
    signature = (row['bank'], row['key'], row['layer'], row['rr'])
    assert signature not in seen, signature
    seen.add(signature)
    entry = {k: row[k] for k in ['key', 'layer', 'rr', 'file', 'off', 'gain']}
    assert entry in manifest[row['bank']]['samples'], file
assert sum(len(b['samples']) for b in manifest.values()) == len(seen) == 235
for key in range(21, 109, 3):
    for layer in range(4):
        assert ('salamander', key, layer, 0) in seen
for pad in range(16):
    entries = [s for s in manifest['studio_drums']['samples'] if s['key'] == pad]
    assert entries
    layers = sorted(set(s['layer'] for s in entries))
    assert layers == list(range(len(layers)))
    for layer in layers:
        variants = sorted(s['rr'] for s in entries if s['layer'] == layer)
        assert variants == list(range(len(variants)))
for bank in manifest:
    assert (base / bank / 'SOURCE-LICENSE').is_file()
    assert (base / bank / 'SOURCE-README.md').is_file()
print('235/235 samples: hashes, provenance, notes, layers, variants, offsets and licenses OK.')
