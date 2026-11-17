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
    limit = {'salamander': 12.1, 'wurli': 8.1}.get(row['bank'], 6.1)
    assert row['duration'] <= limit, file
    assert len(row['sourceSha256']) == 64, file
    signature = (row['bank'], row['key'], row['layer'], row['rr'])
    assert signature not in seen, signature
    seen.add(signature)
    entry = {k: row[k] for k in ['key', 'layer', 'rr', 'file', 'off', 'gain','lo','hi','tune'] if k in row}
    assert entry in manifest[row['bank']]['samples'], file
assert sum(len(b['samples']) for b in manifest.values()) == len(seen) == 544
for key in range(21, 109, 3):
    for layer in range(4):
        assert ('salamander', key, layer, 0) in seen
for bank, definition in manifest.items():
    keys = sorted(set(e['key'] for e in definition['samples']))
    if definition['kind'] == 'drums': assert keys == list(range(16))
    for key in keys:
        entries = [s for s in definition['samples'] if s['key'] == key]
        layers = sorted(set(s['layer'] for s in entries))
        if definition['kind'] == 'drums': assert layers == list(range(len(layers)))
        for layer in layers:
            variants = sorted(s['rr'] for s in entries if s['layer'] == layer)
            assert variants == list(range(len(variants)))
    assert len(definition['samples']) == {'salamander':120,'studio_drums':115,'wurli':47,'fashionbass':190,'percussion':72}[bank]
    if bank in ('wurli','fashionbass'):
        for s in definition['samples']: assert s['lo'] <= s['key'] <= s['hi']
        ends = definition['velocityEnds']; assert ends == sorted(set(ends)) and ends[-1] == 1
for bank in manifest:
    assert (base / bank / 'SOURCE-LICENSE').is_file()
    assert (base / bank / 'SOURCE-README.md').is_file()
print('544/544 samples: hashes, provenance, notes, layers, variants, offsets and licenses OK.')
