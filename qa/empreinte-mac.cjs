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
    check(!errors.length, 'aucune erreur dans la page' + (errors.length ? ' : ' + errors[0] : ''));
  } catch (e) { console.error(e); ok = false; }
  finally { await app.close().catch(() => { }); }
  console.log(ok ? '\nEmpreintes des plugins du Mac : conformes' : '\nEmpreintes des plugins du Mac : ÉCHEC');
  process.exit(ok ? 0 : 1);
})();
