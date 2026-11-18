/* Instruments Audio Unit du Mac dans la version bureau (V19, chantier 6) : vrai module natif, instrument d'Apple DLSMusicDevice.
 * Prérequis : npm run build ; npm run native (module natif construit pour cette machine)
 * Usage : node qa/au-instrument.cjs
 * Rien n'est joué sur les haut-parleurs : rendus hors-ligne, et temps réel avec la sortie coupée. */
const { _electron: electron } = require('playwright');
const path = require('path');

(async () => {
  const prof = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'kh-aui-'));
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.cjs'), '--user-data-dir=' + prof], env: { ...process.env, KH_NATIVE: '1' } });
  const errors = [];
  let ok = true;
  const check = (c, m) => { console.log((c ? '  ok   ' : '  ÉCHEC ') + m); if (!c) ok = false; };
  try {
    const win = await app.firstWindow();
    win.on('pageerror', e => errors.push(e.message));
    win.on('console', m => { if (m.type() === 'error' && !m.text().includes('Electron Security Warning')) errors.push(m.text()); });
    await win.waitForSelector('.clip', { timeout: 30000 });
    if (await win.$eval('#help', d => d.open)) await win.click('#help form button.accent');
    await win.evaluate(async () => { const e = window.kh.engine; if (e.native) e.native.gain(0); else await e.ctx.setSinkId({ type: 'none' }); });

    // 1. Les instruments installés sont listés.
    const list = await win.evaluate(() => window.kh.auBridge().list().filter(d => d.type === 'aumu').map(d => d.name));
    console.log('Instruments :', list.join(', '));
    check(list.some(n => /DLSMusicDevice/.test(n)), 'DLSMusicDevice listé parmi les instruments du Mac');

    // 2. Rendu hors-ligne : une note à 0,100 s, relâchée à 0,600 s ; hauteur, instant exact, fin du son ; pitch bend à fond à 0,300 s.
    const r = await win.evaluate(async () => {
      const k = window.kh, sr = 48000, c = new OfflineAudioContext(2, sr * 2, sr), au = await k.createAuInstrument(c, 'aumu:dls :appl', '', 2);
      au.audioNode.connect(c.destination);
      au.midi(0xc0, 16, 0, 0); au.midi(0x90, 69, 100, 0.1); au.midi(0x80, 69, 0, 0.3);   // orgue (programme GM 17) : il tient le son tant que la touche est enfoncée
      au.midi(0x90, 81, 100, 1.0); au.midi(0xe0, 127, 127, 1.3); au.midi(0x80, 81, 0, 1.6);
      await au.flush();
      const b = await c.startRendering(), d = b.getChannelData(0), st = await au.stats(), state = au.getState(); au.audioNode.destroy();
      let first = -1; for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.001) { first = i; break; }
      const win = (t0, t1) => { let q = 0; for (let i = Math.floor(t0 * sr); i < Math.floor(t1 * sr); i++) q += d[i] * d[i]; return Math.sqrt(q / ((t1 - t0) * sr)); };
      const hz = t => k.detectPitch(d.slice(Math.floor(t * sr), Math.floor(t * sr) + 4096), sr);
      // Même note sans relâchement, pour comparer : le piano de DLSMusicDevice a un relâchement naturel, pas une coupure nette.
      const c2 = new OfflineAudioContext(2, sr, sr), au2 = await k.createAuInstrument(c2, 'aumu:dls :appl', '', 2); au2.audioNode.connect(c2.destination);
      au2.midi(0xc0, 16, 0, 0); au2.midi(0x90, 69, 100, 0.1); await au2.flush(); const d2 = (await c2.startRendering()).getChannelData(0); au2.audioNode.destroy();
      let held = 0; for (let i = Math.floor(0.7 * sr); i < Math.floor(0.8 * sr); i++) held += d2[i] * d2[i]; held = Math.sqrt(held / (0.1 * sr));
      return { first: first / sr, before: win(0, 0.095), on: win(0.15, 0.28), after: win(0.7, 0.8), held, hz: hz(0.2), hz2: hz(1.1), hzBent: hz(1.4), miss: st.miss, n: st.n, state: state.length };
    });
    console.log('Rendu :', JSON.stringify(r));
    check(r.before < 1e-4 && Math.abs(r.first - 0.1) < 0.003, `note calée : premier son à ${(r.first * 1000).toFixed(1)} ms (attendu 100 ms)`);
    check(r.on > 0.005, `la note sonne (niveau ${r.on.toFixed(4)})`);
    check(r.after < r.held * 0.1, `l'orgue s'arrête au relâchement de la touche (niveau ${r.after.toFixed(5)}, touche tenue : ${r.held.toFixed(5)})`);
    check(Math.abs(((1200 * Math.log2(r.hz / 440)) % 1200 + 1800) % 1200 - 600) < 25, `hauteur : ${r.hz.toFixed(1)} Hz (un la ; l'orgue a des tirettes à l'octave grave)`);
    check(Math.abs(1200 * Math.log2(r.hzBent / r.hz2) - 200) < 30, `pitch bend à fond : ${r.hz2.toFixed(0)} → ${r.hzBent.toFixed(0)} Hz (+2 demi-tons attendus)`);
    check(r.miss === 0 && r.n > 700, `aucun bloc manqué (${r.n} blocs)`);
    check(r.state > 100, `état complet du plugin lu (${r.state} caractères en base64)`);

    // 3. L'instrument dans un vrai projet : la piste « Basse » jouée par DLSMusicDevice, à l'export (même chemin que l'écoute).
    const ex = await win.evaluate(async () => {
      const k = window.kh, p = k.demoProject(), tr = p.tracks[1]; p.tracks = [tr]; p.target = 0; p.bpm = 120;
      Object.assign(tr.synth, { engine: 'au', auUrl: 'aumu:dls :appl', auName: 'Apple: DLSMusicDevice', octave: 0 });
      Object.assign(tr, { comp: false, drive: 0, chorus: 0, crush: 0, trem: 0, filter: 0, eqLow: 0, eqMid: 0, eqHigh: 0, rev: 0, dly: 0, inserts: [] });
      tr.clips = [{ id: 'c', name: 'c', start: 0, len: 16, offset: 0, patLen: 16, notes: [{ p: 69, s: 4, l: 4, v: 0.8 }], ctl: { pb: [{ s: 6, v: 1 }, { s: 7.9, v: 1 }, { s: 8, v: 0 }] } }];
      const firstOf = x => { for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.001) return i; return -1; };
      const b = await k.renderOffline(p, false), d = b.getChannelData(0), sr = b.sampleRate, first = firstOf(d) - firstOf((await k.renderOffline({ ...p, tracks: [{ ...tr, synth: { ...tr.synth, engine: 'sub', wave: 'square', a: 0.002 }, clips: [{ ...tr.clips[0], ctl: undefined }] }] }, false)).getChannelData(0)) + 0.5 * sr;
      const hz = t => k.detectPitch(d.slice(Math.floor(t * sr), Math.floor(t * sr) + 4096), sr);
      return { first: first / sr, hz: hz(0.6), bent: hz(0.78), failed: k.lastRender.wamFailed };
    });
    console.log('Export :', JSON.stringify(ex));
    check(ex.failed === 0 && Math.abs(ex.first - 0.5) < 0.0015, `export : la note du clip tombe au même instant qu'avec un instrument intégré (écart ${((ex.first - 0.5) * 1000).toFixed(2)} ms)`);
    check(Math.abs(1200 * Math.log2(ex.hz / 440)) < 25 && Math.abs(1200 * Math.log2(ex.bent / ex.hz) - 200) < 30, `export : hauteur ${ex.hz.toFixed(0)} Hz, pitch bend du clip ${ex.bent.toFixed(0)} Hz`);

    // 4. Interface et jeu en direct : choisir l'instrument dans la liste, jouer une note au clavier MIDI simulé.
    await win.evaluate(() => { const k = window.kh, tr = k.S.project.tracks[1]; k.S.selTrack = tr.id; k.S.selClip = ''; k.S.tab = 'editor'; k.commit(); });
    await win.selectOption('[data-role=auinst]', 'aumu:dls :appl');
    await win.waitForSelector('[data-act=auiwindow]:not([disabled])', { timeout: 10000 });
    const live = await win.evaluate(async () => {
      const k = window.kh, tr = k.S.project.tracks[1], w = ms => new Promise(r => setTimeout(r, ms));
      k.onMidi([0x90, 64, 100]); await w(500); const on = k.engine.level(tr.id); k.onMidi([0x80, 64, 0]); await w(1200); const off = k.engine.level(tr.id);
      const st = await k.engine.mix.instOf(tr.id).stats();
      return { on, off, engine: tr.synth.engine, url: tr.synth.auUrl, st };
    });
    console.log('Direct :', JSON.stringify(live));
    check(live.engine === 'au' && live.url === 'aumu:dls :appl', 'instrument choisi dans la liste et gardé dans le projet');
    check(live.on > 0.1 && live.off < live.on, `note jouée en direct (vumètre ${live.on.toFixed(2)} puis ${live.off.toFixed(2)})`);
    check(live.st.miss === 0, `temps réel sans bloc manqué (${live.st.n} blocs)`);
    // État complet : recopié dans le projet à la fermeture de la fenêtre, et rechargé dans l'instrument de l'export.
    const st = await win.evaluate(async () => {
      const k = window.kh, tr = k.S.project.tracks[1], au = k.engine.mix.instOf(tr.id), s = au.getState();
      return { len: s.length, back: au.setState(s) };
    });
    check(st.len > 100 && st.back, `état de l'instrument lu (${st.len} caractères) et rechargé`);
    check(!errors.length, `aucune erreur dans la page${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  } finally { await app.close(); }
  console.log(ok ? 'Instruments du Mac : OK' : 'Instruments du Mac : ÉCHEC');
  process.exitCode = ok ? 0 : 1;
})().catch(e => { console.error(e); process.exit(2); });
