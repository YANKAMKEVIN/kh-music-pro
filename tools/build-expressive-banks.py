#!/usr/bin/env python3
"""Rebuild redistributable expressive banks. Requires Python 3, curl and ffmpeg.

Pinned upstream revisions, source/output SHA256 and transformations are recorded.
Downloads are cached outside the repo; no third-party code is executed.
"""
import array
import concurrent.futures
import hashlib
import json
import math
import pathlib
import subprocess
import tempfile
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/banks'
CACHE = pathlib.Path(tempfile.gettempdir()) / 'kh-expressive-sources'
SOURCES = {
    'salamander': ('sfzinstruments/SalamanderGrandPiano', '3382bf9496bba2486f5ab0de55a264d1dfc38404'),
    'studio_drums': ('sfzinstruments/virtuosity_drums', '9f04cf9a734527edfbb0a4eee1f674e45bbf71bc'),
}


def download(bank, path):
    repo, ref = SOURCES[bank]
    dest = CACHE / bank / ref / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        url = f'https://raw.githubusercontent.com/{repo}/{ref}/' + urllib.parse.quote(path)
        tmp = dest.with_suffix(dest.suffix + '.download')
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


def convert(job):
    bank, key, layer, rr, source = job
    raw = download(bank, source)
    relative = f'{bank}/{key}_{layer}_{rr}.mp3'
    dest = OUT / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    channels, seconds = (2, 12) if bank == 'salamander' else (1, 6)
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw),
                    '-ac', str(channels), '-ar', '44100', '-t', str(seconds),
                    '-af', f'afade=t=out:st={seconds - 0.15}:d=0.15',
                    '-codec:a', 'libmp3lame', '-b:a', '192k' if channels == 2 else '128k', str(dest)], check=True)
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
                duration=round(frames / 44100, 4), channels=channels)


def main():
    for bank in SOURCES:
        dest = OUT / bank; dest.mkdir(parents=True, exist_ok=True)
        for name in ['LICENSE', 'README.md']:
            (dest / ('SOURCE-' + name)).write_bytes(download(bank, name).read_bytes())
    tasks = list(jobs())
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        records = list(pool.map(convert, tasks))
    banks = {}
    for bank in SOURCES:
        rows = [r for r in records if r['bank'] == bank]
        banks[bank] = dict(kind='instrument' if bank == 'salamander' else 'drums',
                           samples=[{k: r[k] for k in ['key', 'layer', 'rr', 'file', 'off', 'gain']} for r in rows])
    manifest = ROOT / 'src/audio/expressive-manifest.ts'
    manifest.write_text('// Generated by tools/build-expressive-banks.py; do not edit sample metadata.\n'
                        'export interface ExpressiveEntry { key: number; layer: number; rr: number; file: string; off: number; gain: number }\n'
                        "export const EXPRESSIVE: Record<string, { kind: 'instrument' | 'drums'; samples: ExpressiveEntry[] }> = "
                        + json.dumps(banks, indent=2) + ';\n')
    provenance = dict(sources={k: dict(repository=v[0], revision=v[1]) for k, v in SOURCES.items()},
                      conversion='ffmpeg/libmp3lame; 44.1kHz; piano stereo 192k max12s, drums mono 128k max6s; final150ms fade; runtime gain/onset metadata',
                      samples=records)
    (OUT / 'expressive-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    credits = (ROOT / 'tools/expressive-credits.txt').read_text()
    general = OUT / 'CREDITS.txt'
    previous = general.read_text().split('Banques expressives V17 (0.17.0)', 1)[0].rstrip() if general.exists() else ''
    general.write_text(previous + '\n\n' + credits)
    print(f'{len(records)} samples, {sum(r["bytes"] for r in records)/1e6:.1f} MB')


if __name__ == '__main__':
    main()
