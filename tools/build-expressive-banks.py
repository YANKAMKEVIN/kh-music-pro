#!/usr/bin/env python3
"""Rebuild redistributable expressive banks. Requires Python 3, curl and ffmpeg
(and, for banks published as 7z archives, the `py7zr` Python module or the `7z` command).

Pinned upstream revisions, source/output SHA256 and transformations are recorded.
Downloads are cached outside the repo; no third-party code is executed.
"""
import array
import concurrent.futures
import hashlib
import json
import math
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.parse
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/banks'
CACHE = pathlib.Path(tempfile.gettempdir()) / 'kh-expressive-sources'
SOURCES = {
    'salamander': ('sfzinstruments/SalamanderGrandPiano', '3382bf9496bba2486f5ab0de55a264d1dfc38404'),
    'studio_drums': ('sfzinstruments/virtuosity_drums', '9f04cf9a734527edfbb0a4eee1f674e45bbf71bc'),
    'wurli': ('sfzinstruments/GregSullivan.E-Pianos', '8c3e581acda3594b553948ff0222d4f84a698376'),
    'fashionbass': ('sfzinstruments/karoryfer.fashionbass', '0703973b300a6bacb837602be9b588ab64732a72'),
    'percussion': ('sgossner/VCSL', 'c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e'),
    'fsbs_guitar': ('freepats/electric-guitar-FSBS-clean', '2026-08-07'),
}
# Banks published only as release archives: URL, SHA256 of the archive, folder inside it.
ARCHIVES = {
    'fsbs_guitar': ('https://github.com/freepats/electric-guitar-FSBS-clean/releases/download/2026-08-07/EGuitarFSBS-clean-SFZ+FLAC-20260807.7z',
                    'a929a3cbfc8289e325be56dab49f5fd560bbc3995c40b69f8f05caee380e8be3', 'EGuitarFSBS-clean SFZ+FLAC-20260807'),
}
SETTINGS = {'salamander': (2, 12, '192k'), 'studio_drums': (1, 6, '128k'),
            'wurli': (1, 8, '160k'), 'fashionbass': (1, 6, '160k'), 'percussion': (1, 6, '128k'),
            'fsbs_guitar': (1, 6, '160k')}
previous_file = OUT / 'expressive-provenance.json'
PREVIOUS = json.loads(previous_file.read_text()) if previous_file.exists() else {}
PREVIOUS_SAMPLES = {r['file']: r for r in PREVIOUS.get('samples', [])}


def unpack(bank):
    url, sha, inner = ARCHIVES[bank]
    root = CACHE / bank / sha
    done = root / '.extracted'
    if not done.exists():
        root.mkdir(parents=True, exist_ok=True)
        archive = root / 'source.7z'
        if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != sha:
            subprocess.run(['curl', '-fsSL', '--retry', '3', '--connect-timeout', '20', url, '-o', str(archive)], check=True)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != sha:
            raise ValueError('Archive checksum mismatch: ' + url)
        try:
            import py7zr
            with py7zr.SevenZipFile(archive) as z: z.extractall(root)
        except ImportError:
            subprocess.run(['7z', 'x', '-y', '-o' + str(root), str(archive)], check=True, stdout=subprocess.DEVNULL)
        done.write_text('ok')
    return root / inner


def download(bank, path):
    if bank in ARCHIVES:
        return unpack(bank) / path
    repo, ref = SOURCES[bank]
    dest = CACHE / bank / ref / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        url = f'https://raw.githubusercontent.com/{repo}/{ref}/' + urllib.parse.quote(path)
        tmp = dest.with_name(dest.name + '.' + uuid.uuid4().hex + '.download')
        subprocess.run(['curl', '-fsSL', '--retry', '3', '--connect-timeout', '20', url, '-o', str(tmp)], check=True)
        tmp.replace(dest)
    return dest


def jobs():
    names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    for midi in range(21, 109, 3):
        note = names[midi % 12] + str(midi // 12 - 1)
        for layer, velocity in enumerate([4, 8, 12, 16]):
            yield 'salamander', midi, layer, 0, f'Samples/{note}v{velocity}.flac'
    # Four velocity layers where present; three genuine repetitions for cymbals,
    # kick and percussion. Snare/toms have distinct dynamics, not round robins.
    definitions = [
        ('kickmic/kick/kickmic_kick_snon_vl{}_rr{}.flac', [1, 2, 3, 4], 3),
        ('oh/snare/oh_snare_center_vl{}.flac', [9, 18, 27, 36], 1),
        ('oh/snare/oh_snare_rimshot_vl{}.flac', [3, 6, 9, 12], 1),
        ('oh/hh/oh_hh_closed_vl{}_rr{}.flac', [1, 2, 3, 4], 3),
        ('oh/hh/oh_hh_open_vl{}_rr{}.flac', [1, 2, 3, 4], 3),
        ('oh/ltom/oh_ltom_center_vl{}.flac', [4, 8, 12, 16], 1),
        ('oh/snare/oh_snare_crossstick_vl{}.flac', [4, 8, 12, 16], 1),
        ('perc/close/cowbell/Cowbell1_Normal_v{}_rr{}_Close.wav', [1, 2, 3], 3),
        ('kickmic/kick/kickmic_kick_snoff_vl{}_rr{}.flac', [1, 2, 3, 4], 3),
        ('oh/snare/oh_snare_muted_vl{}.flac', [4, 8, 12, 16], 1),
        ('oh/htom/oh_htom_offcenter_vl{}.flac', [4, 8, 12, 16], 1),
        ('oh/htom/oh_htom_center_vl{}.flac', [4, 8, 12, 16], 1),
        ('perc/close/shaker/LShaker_Shake1D_rr{}_Close.wav', [0], 3),
        ('oh/crash/oh_crash_crash_vl{}_rr{}.flac', [1, 2, 3], 3),
        ('oh/ride/oh_ride_ride_vl{}_rr{}.flac', [1, 2, 3], 3),
        ('perc/close/conga/Conga_22_HitN_{}_rr{}_Close.wav', ['1_50', '51_100', '101_127'], 3),
    ]
    for pad, (pattern, layers, repeats) in enumerate(definitions):
        for layer, v in enumerate(layers):
            for rr in range(repeats):
                args = [rr + 1] if pad == 12 else [v, rr + 1]
                yield 'studio_drums', pad, layer, rr, 'Samples/' + pattern.format(*args)

    # Read data, not code: preserve the Wurlitzer's original key zones and tuning.
    sfz = download('wurli', 'Wurlitzer EP200/Wurlitzer EP200.sfz').read_text()
    layer, regions = -1, {}
    for line in sfz.splitlines():
        if line.strip() == '<group>': layer += 1
        if not line.startswith('<region>'): continue
        fields = dict(re.findall(r'(\w+)=([^\s]+)', line))
        key = int(fields['pitch_keycenter']); tag = (key, layer)
        lo, hi = int(fields['lokey']), int(fields['hikey'])
        if tag in regions:
            regions[tag][0]['lo'] = min(regions[tag][0]['lo'], lo)
            regions[tag][0]['hi'] = max(regions[tag][0]['hi'], hi)
            continue
        regions[tag] = ({'lo': lo, 'hi': hi, 'tune': float(fields.get('tune', 0))}, fields['sample'].replace('$EXT', 'flac'))
    for (key, layer), (meta, sample) in sorted(regions.items()):
        yield 'wurli', key, layer, 0, 'Wurlitzer EP200/Samples/' + sample, meta

    # Only normal plucked notes; no key-switches, string noises or shifty effect.
    sfz = download('fashionbass', 'fashionbass_clean.sfz').read_text()
    for block in sfz.split('<group>')[1:]:
        root = re.search(r'pitch_keycenter=(\d+)', block)
        if not root: continue
        key = int(root[1])
        if key > 72: continue
        lo, hi = (int(re.search(name + r'=(\d+)', block)[1]) for name in ['lokey', 'hikey'])
        for region in block.split('<region>')[1:]:
            sample = re.search(r'sample=(notes\\[^\s]+)', region)
            if not sample: continue
            source = sample[1].replace('\\', '/')
            match = re.search(r'_(pp|p|mf|f|ff)_rr(\d+)\.wav$', source)
            if not match or int(match[2]) > 2: continue
            yield 'fashionbass', key, ['pp','p','mf','f','ff'].index(match[1]), int(match[2])-1, source, {'lo': lo, 'hi': hi}

    # Clean Fender guitar (FreePats FSBS, CC0): soft and normal pluck layers, two of the four takes.
    sfz = download('fsbs_guitar', 'EGuitarFSBS-clean bridge 20260807.sfz').read_text()
    for block in sfz.split('<group>')[1:]:
        fields = dict(re.findall(r'(\w+)=([^\s]+)', block.split('<region>')[0]))
        if 'key' in fields: fields.update(pitch_keycenter=fields['key'], lokey=fields['key'], hikey=fields['key'])
        key, lo, hi = int(fields['pitch_keycenter']), int(fields['lokey']), int(fields['hikey'])
        # a note recorded at one dynamic only (some high notes) serves both layers, as in the source
        layers = [0] if 'hivel' in fields else [1] if 'lovel' in fields else [0, 1]
        for rr, region in enumerate(block.split('<region>')[1:3]):
            sample = re.search(r'sample=([^\n]+\.flac)', region)[1].strip()
            for layer in layers:
                yield 'fsbs_guitar', key, layer, rr, sample, {'lo': lo, 'hi': hi}

    # 16 named percussion pads; every variant is an actual source recording.
    mem = 'Membranophones/Struck Membranophones/'
    idi = 'Idiophones/Struck Idiophones/'
    definitions = [
        (mem+'Conga/Tumba_HitN_v{}_rr{}_Sum.wav', [1,2,3,4], 2),
        (mem+'Conga/Conga_HitN_v{}_rr{}_Sum.wav', [1,2,3], 2),
        (mem+'Conga/Conga_HitFM_v{}_rr{}_Sum.wav', [1,2], 2),
        (mem+'Conga/Quinto_HitN_v{}_rr{}_Sum.wav', [1,2,3], 2),
        (mem+'Bongos/BongoL_Hit1_v{}_rr{}_Mid.wav', [1,2,3], 2),
        (mem+'Bongos/BongoH_Hit1_v{}_rr{}_Mid.wav', [1,2,3], 2),
        (mem+'Bongos/BongoL_HitMuted2_v{}_rr{}_Mid.wav', [1,2,3], 2),
        (mem+'Bongos/BongoH_HitMuted1_v{}_rr{}_Mid.wav', [1,2,3], 2),
        (mem+'Darbuka/Darbuka_1_hit_vl{}_rr{}.wav', [1,2], 2),
        (mem+'Darbuka/Darbuka_2_hit_vl{}_rr{}.wav', [1,2], 2),
        (idi+'Claves/Claves1_Hit_v{}_rr{}_Mid.wav', [1,2,3], 1),
        (idi+'Claves/Claves2_Hit_v{}_rr{}_Mid.wav', [1,2,3], 1),
        (idi+'Shaker, Small/Mid_ShakerDouble_Down_rr{}.wav', [0], 2),
        (idi+'Tambourine 1/Tamb1_Hit_v{}_rr{}_Mid.wav', [1,2], 1),
        (idi+'Guiro/Guiro_Hit_rr{}_Mid.wav', [0], 2),
        (idi+'Triangles/Triangle3_Hit_v{}_rr{}_Mid.wav', [1,2], 2),
    ]
    for pad, (pattern, levels, repeats) in enumerate(definitions):
        for layer, level in enumerate(levels):
            for rr in range(repeats):
                args = [rr+1] if pad in (12,14) else [level,rr+1]
                yield 'percussion', pad, layer, rr, pattern.format(*args)


def convert(job):
    bank, key, layer, rr, source, *metadata = job
    extra = metadata[0] if metadata else {}
    relative = f'{bank}/{key}_{layer}_{rr}.mp3'
    dest = OUT / relative
    old = PREVIOUS_SAMPLES.get(relative)
    if '--force' not in sys.argv and old and (bank != 'percussion' or 'preGain' in old) and old['source'] == source and dest.exists() and PREVIOUS.get('sources', {}).get(bank, {}).get('revision') == SOURCES[bank][1] and hashlib.sha256(dest.read_bytes()).hexdigest() == old['sha256']:
        return {**old, **extra}
    raw = download(bank, source)
    dest.parent.mkdir(parents=True, exist_ok=True)
    channels, seconds, bitrate = SETTINGS[bank]
    pre_gain = 1.0
    if bank == 'percussion':
        # Some VCSL recordings are very quiet: amplify before lossy encoding.
        data = array.array('f'); data.frombytes(subprocess.check_output(['ffmpeg','-hide_banner','-loglevel','error','-i',str(raw),'-ac',str(channels),'-ar','44100','-t',str(seconds),'-f','f32le','-']))
        raw_peak = max(map(abs, data))
        if raw_peak < 1e-7: raise ValueError('Silent percussion source: ' + source)
        pre_gain = min(10000, 0.7 / raw_peak)
        extra['preGain'] = pre_gain
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw),
                    '-ac', str(channels), '-ar', '44100', '-t', str(seconds),
                    '-af', f'volume={pre_gain},afade=t=out:st={seconds - 0.15}:d=0.15',
                    '-codec:a', 'libmp3lame', '-b:a', bitrate, str(dest)], check=True)
    pcm = subprocess.check_output(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(dest), '-f', 'f32le', '-'])
    floats = array.array('f'); floats.frombytes(pcm)
    peak = max(map(abs, floats))
    if peak < 1e-5 or not math.isfinite(peak):
        raise ValueError(f'Silent/invalid source: {source}')
    # Detect onset across both channels, retaining 1 ms before the transient.
    threshold = max(0.00005, peak * 0.005)
    first = next(i // channels for i, x in enumerate(floats) if abs(x) >= threshold)
    frames = len(floats) // channels
    # RMS of the attack: match layers in loudness, leaving velocity to control
    # amplitude, while retaining their genuinely different recorded timbres.
    end = min(frames, first + 17640)
    rms = math.sqrt(sum(x*x for x in floats[first*channels:end*channels]) / max(1, (end-first)*channels))
    gain = min(0.85 / peak, 0.12 / max(1e-6, rms))
    return dict(bank=bank, key=key, layer=layer, rr=rr, file=relative,
                off=round(max(0, first - 44) / 44100, 7), gain=round(gain, 7),
                source=source, sourceSha256=hashlib.sha256(raw.read_bytes()).hexdigest(),
                sha256=hashlib.sha256(dest.read_bytes()).hexdigest(), bytes=dest.stat().st_size,
                duration=round(frames / 44100, 4), channels=channels, **extra)


def main():
    for bank in SOURCES:
        dest = OUT / bank; dest.mkdir(parents=True, exist_ok=True)
        names = ['LICENSE.txt', 'README.txt'] if bank == 'fsbs_guitar' else ['LICENSE'] + ([] if bank == 'fashionbass' else ['README.md'])
        for name in names:
            (dest / ('SOURCE-' + name)).write_bytes(download(bank, name).read_bytes())
        if bank == 'fashionbass':
            (dest / 'SOURCE-README.md').write_text('Fashionbass by Karoryfer Samples — CC0 1.0.\nSource repository has no README; this notice is generated by KH Music Pro.\nhttps://github.com/sfzinstruments/karoryfer.fashionbass\nNormal plucked notes from fashionbass_clean.sfz, 5 dynamics, 2 repetitions.\n')
        mappings = {'wurli': 'Wurlitzer EP200/Wurlitzer EP200.sfz', 'fashionbass': 'fashionbass_clean.sfz', 'fsbs_guitar': 'EGuitarFSBS-clean bridge 20260807.sfz'}
        if bank in mappings: (dest / 'SOURCE-MAPPING.sfz').write_bytes(download(bank, mappings[bank]).read_bytes())
    tasks = list(jobs())
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        records = list(pool.map(convert, tasks))
    banks = {}
    for bank in SOURCES:
        rows = [r for r in records if r['bank'] == bank]
        banks[bank] = dict(kind='drums' if bank in ('studio_drums','percussion') else 'instrument',
                           samples=[{k: r[k] for k in ['key', 'layer', 'rr', 'file', 'off', 'gain','lo','hi','tune'] if k in r} for r in rows])
        if bank == 'wurli': banks[bank]['velocityEnds'] = [37/127,65/127,89/127,1]
        if bank == 'fashionbass': banks[bank]['velocityEnds'] = [40/127,65/127,85/127,110/127,1]
        if bank == 'fsbs_guitar': banks[bank]['velocityEnds'] = [92/127, 1]
    manifest = ROOT / 'src/audio/expressive-manifest.ts'
    manifest.write_text('// Generated by tools/build-expressive-banks.py; do not edit sample metadata.\n'
                        'export interface ExpressiveEntry { key: number; layer: number; rr: number; file: string; off: number; gain: number; lo?: number; hi?: number; tune?: number }\n'
                        "export const EXPRESSIVE: Record<string, { kind: 'instrument' | 'drums'; velocityEnds?: number[]; samples: ExpressiveEntry[] }> = "
                        + json.dumps(banks, indent=2) + ';\n')
    provenance = dict(sources={k: dict(repository=v[0], revision=v[1], **({'archive': ARCHIVES[k][0], 'archiveSha256': ARCHIVES[k][1]} if k in ARCHIVES else {})) for k, v in SOURCES.items()},
                      conversion='ffmpeg/libmp3lame; 44.1kHz; final150ms fade; runtime gain/onset/tuning metadata', settings=SETTINGS,
                      samples=records)
    (OUT / 'expressive-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    credits = (ROOT / 'tools/expressive-credits.txt').read_text()
    general = OUT / 'CREDITS.txt'
    previous = general.read_text().split('Banques expressives V17 (0.17.0)', 1)[0].rstrip() if general.exists() else ''
    general.write_text(previous + '\n\n' + credits)
    print(f'{len(records)} samples, {sum(r["bytes"] for r in records)/1e6:.1f} MB')


if __name__ == '__main__':
    main()
