/* Empreinte sonore des plugins du Mac (V17) : la démo réduite passée dans de vrais Audio Units d'Apple, rendue comme à l'export
 * dans la version bureau avec le vrai module natif, puis comparée à son empreinte (qa/empreintes/mac-*.json, voir empreinte.cjs).
 * Prérequis : macOS, npm run build ; npm run native.
 * Usage : node qa/empreinte-mac.cjs        (KH_EMPREINTE=maj pour enregistrer les références après écoute) */
const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EMP = require('./empreinte.cjs');

// Projets : une piste d'instrument et la batterie de la démo, chacune avec une chaîne de plugins Apple.
const CHAINS = {
  'mac-filtre-echo': [['aufx:lpas:appl', 'AULowpass', { 0: 1800, 1: 6 }], ['aufx:dely:appl', 'AUDelay', { 0: 30, 1: 0.375, 2: 40 }]],
  'mac-reverb': [['aufx:rvb2:appl', 'AUReverb2', {}]],
  'mac-dynamique': [['aufx:dcmp:appl', 'AUDynamicsProcessor', {}], ['aufx:lmtr:appl', 'AUPeakLimiter', {}]],
};

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-emp-'));
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.cjs'), '--user-data-dir=' + prof], env: { ...process.env, KH_NATIVE: '1' } });
  let ok = true;
  const check = (c, m) => { console.log((c ? '  ok   ' : '  ÉCHEC ') + m); if (!c) ok = false; };
  try {
    const win = await app.firstWindow();
    const errors = []; win.on('pageerror', e => errors.push(e.message));
    await win.waitForSelector('.clip', { timeout: 30000 });
    check(await win.evaluate(() => !!window.kh.auBridge()), 'module natif chargé (plugins du Mac disponibles)');
    for (const [name, chain] of Object.entries(CHAINS)) {
      const r = await win.evaluate(async chain => {
        const k = window.kh, p = k.demoProject(); p.countIn = false; p.loop = false;
        const synth = p.tracks.find(t => t.type === 'synth' && t.clips.length), drums = p.tracks[0];
        p.tracks = [drums, synth]; for (const t of p.tracks) { t.clips.length = Math.min(2, t.clips.length); t.rev = 0; t.dly = 0; }
        synth.inserts = chain.map(([url, nm, prm]) => { const i = k.newInsert('au'); i.url = url; i.name = nm; i.p = prm; return i; });
        // Même graine que la campagne : la caisse claire et la réverbération interne tirent des nombres au hasard.
        let a = 0x2545f491; const rnd = Math.random;
        Math.random = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
        let b; try { b = await k.renderOffline(p); } finally { Math.random = rnd; }
        const enc = d => { const u = new Uint8Array(d.buffer, d.byteOffset, d.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
        return { sr: b.sampleRate, ch: [enc(b.getChannelData(0)), enc(b.getChannelData(1))], failed: k.lastRender.wamFailed };
      }, chain);
      const audio = { sr: r.sr, ch: r.ch.map(s => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); }) };
      check(r.failed === 0, `${name} : tous les plugins se sont chargés pour le rendu`);
      const c = EMP.check(name, audio);
      check(!c.problems.length, `${name} : ${c.updated ? 'empreinte enregistrée' : 'empreinte conforme'} (${c.fp.lufs} LUFS, crête ${c.fp.peakDb} dB, ${c.fp.clicks.length} clic(s), ${c.fp.drops.length} coupure(s))${c.problems.length ? ' — ' + c.problems.join(' ; ') : ''}`);
    }
    // Automation d'un plugin du Mac à l'export (V17) : la coupure d'AULowpass passe de 10 Hz à 22 kHz au milieu d'une note tenue.
    const au = await win.evaluate(async () => {
      const k = window.kh, p = k.demoProject(); p.countIn = false; p.loop = false; p.tempos = [];
      const t = p.tracks.find(x => x.type === 'synth'); p.tracks = [t]; t.rev = 0; t.dly = 0; t.chorus = 0; t.auto = {};
      Object.assign(t.synth = k.makeSynth('lead'), { engine: 'sub', wave: 'sawtooth', mix2: 0, cutoff: 16000, envAmt: 0, a: 0.005, d: 0.1, s: 1, r: 0.05 });
      t.clips = [{ id: 'tenue', name: 'Tenue', start: 0, len: 64, offset: 0, patLen: 64, notes: [{ p: 48, s: 0, l: 64, v: 0.8 }] }];
      const i = k.newInsert('au'); i.url = 'aufx:lpas:appl'; i.name = 'AULowpass'; i.p = { 0: 6900 }; t.inserts = [i];
      t.auto[`ins:${i.id}:0`] = [{ s: 0, v: 0 }, { s: 31, v: 0 }, { s: 32, v: 1 }];
      const b = await k.renderOffline(p, false), d = b.getChannelData(0), sr = b.sampleRate, mid = k.timeOf(p, 32), end = k.timeOf(p, 64);
      const hf = (a, z) => { let e = 0; for (let n = Math.floor(a * sr) + 1; n < Math.floor(z * sr); n++) e += (d[n] - d[n - 1]) ** 2; return 10 * Math.log10(e / ((z - a) * sr) + 1e-20); };
      return { before: hf(0.3, mid - 0.2), after: hf(mid + 0.2, end - 0.2), failed: k.lastRender.wamFailed };
    });
    check(au.failed === 0 && au.after - au.before > 20, `automation d'AULowpass à l'export : aigus ${au.before.toFixed(1)} dB (coupure basse) → ${au.after.toFixed(1)} dB (coupure ouverte)`);
    check(!errors.length, 'aucune erreur dans la page' + (errors.length ? ' : ' + errors[0] : ''));
  } catch (e) { console.error(e); ok = false; }
  finally { await app.close().catch(() => { }); }
  console.log(ok ? '\nEmpreintes des plugins du Mac : conformes' : '\nEmpreintes des plugins du Mac : ÉCHEC');
  process.exit(ok ? 0 : 1);
})();
