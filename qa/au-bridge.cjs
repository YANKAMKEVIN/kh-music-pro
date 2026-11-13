/* Prototype V14b, étape 4 : pont Audio Unit dans la version bureau (macOS).
 * Prérequis : npm run build ; cd native/kh-au-bridge && npx node-gyp rebuild --target=<version d'Electron> --dist-url=https://electronjs.org/headers
 * Usage : node qa/au-bridge.cjs [secondes de tenue, 300 par défaut]
 * Le temps réel tourne sans sortie audio (setSinkId « none ») : rien n'est joué sur les haut-parleurs. */
const { _electron: electron } = require('playwright');
const path = require('path');
const HOLD = Number(process.argv[2] ?? 300);

(async () => {
  // Profil temporaire : le test ne touche pas aux projets enregistrés de l'application.
  const prof = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'kh-au-'));
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.cjs'), '--user-data-dir=' + prof], env: { ...process.env, KH_NATIVE: '1' } });
  const errors = [];
  let ok = true;
  const check = (c, m) => { console.log((c ? '  ok   ' : '  ÉCHEC ') + m); if (!c) ok = false; };
  try {
    const win = await app.firstWindow();
    win.on('pageerror', e => errors.push(e.message));
    // Surveillance : qui ferme quoi, et quand.
    const t00 = Date.now(), when = () => Math.round((Date.now() - t00) / 1000) + ' s';
    win.on('crash', () => console.log('!! page plantée à', when()));
    win.on('close', () => console.log('!! fenêtre fermée à', when()));
    app.process().on('exit', (code, sig) => console.log('!! processus Electron terminé à', when(), 'code', code, 'signal', sig));
    win.on('console', m => { if ((m.type() === 'warning' || m.type() === 'error') && !m.text().includes('Electron Security Warning')) errors.push(m.text()); });
    await win.waitForSelector('.clip', { timeout: 30000 });
    if (await win.$eval('#help', d => d.open)) await win.click('#help form button.accent');

    // 1. Le pont est là.
    const env = await win.evaluate(() => ({ bridge: !!window.kh.auBridge(), sab: typeof SharedArrayBuffer, n: window.kh.auBridge()?.list().length, require: typeof window.require }));
    console.log('Pont :', JSON.stringify(env));
    check(env.bridge && env.sab === 'function' && env.n > 0, 'pont natif chargé, mémoire partagée disponible, Audio Units listés');
    check(env.require === 'undefined', 'la page n\'a toujours pas accès à Node (require)');

    // 2. Traitement exact, et retard ajouté par le pont (rendu hors-ligne, même chemin que l'export).
    const r = await win.evaluate(async () => {
      const k = window.kh, sr = 48000;
      const goertzel = (d, f) => { const w = 2 * Math.PI * f / sr, cw = 2 * Math.cos(w); let s1 = 0, s2 = 0; for (const x of d) { const s = x + cw * s1 - s2; s2 = s1; s1 = s; } return 20 * Math.log10(Math.sqrt(s1 * s1 + s2 * s2 - cw * s1 * s2) * 2 / d.length); };
      const peak = d => { let m = 0; for (let i = 1; i < d.length; i++) if (Math.abs(d[i]) > Math.abs(d[m])) m = i; return m; };
      async function run(url, params, src) {
        const c = new OfflineAudioContext(2, sr * 2, sr), au = await k.createAu(c, url, params);
        src(c).connect(au.audioNode).connect(c.destination);
        const b = await c.startRendering(), st = await au.stats(); au.audioNode.destroy();
        return { d: b.getChannelData(0), st, info: au.info };
      }
      const tones = c => { const g = c.createGain(); for (const f of [200, 8000]) { const o = c.createOscillator(); o.frequency.value = f; const a = c.createGain(); a.gain.value = 0.25; o.connect(a).connect(g); o.start(); } return g; };
      const impulse = c => { const b = c.createBuffer(1, sr * 2, sr); b.getChannelData(0)[sr / 2] = 0.8; const s = c.createBufferSource(); s.buffer = b; s.start(); return s; };
      const lp = await run('aufx:lpas:appl', { 0: 1000 }, tones);
      const flat = await run('aufx:lpas:appl', { 0: 20000 }, impulse);
      const lim = await run('aufx:lmtr:appl', {}, impulse);
      const dly = await run('aufx:dely:appl', { 0: 50, 1: 0.25, 2: 0 }, impulse);
      const d2 = dly.d.slice(sr / 2 + 100);
      return {
        lp200: goertzel(lp.d.subarray(4800), 200), lp8k: goertzel(lp.d.subarray(4800), 8000), lpStats: lp.st,
        flatPeak: peak(flat.d), limPeak: peak(lim.d), limLat: lim.info.latency, echo: sr / 2 + 100 + peak(d2),
      };
    });
    console.log('Hors-ligne :', JSON.stringify(r));
    check(Math.abs(r.lp200 - -12) < 1 && r.lp8k < -40, `passe-bas 1 kHz : 200 Hz ${r.lp200.toFixed(1)} dBFS, 8 kHz ${r.lp8k.toFixed(1)} dBFS`);
    check(r.flatPeak === 24000, `retard ajouté par le pont : ${r.flatPeak - 24000} échantillon(s)`);
    check(Math.abs(r.limPeak - 24000 - r.limLat * 48000) <= 1, `limiteur : décalage ${r.limPeak - 24000} échantillons = sa latence déclarée (${(r.limLat * 1000).toFixed(1)} ms)`);
    check(Math.abs(r.echo - 36000) <= 1, `écho 250 ms à l'échantillon ${r.echo} (attendu 36000 ± 1, interpolation d'AUDelay ; même résultat dans l'hôte Swift)`);
    check(r.lpStats.miss === 0, `aucun bloc manqué hors-ligne (${r.lpStats.n} blocs, attente max ${r.lpStats.spin} tours)`);

    // 3. Une vraie piste du projet, à l'export : avec le plugin, l'aigu disparaît.
    const ex = await win.evaluate(async () => {
      const k = window.kh, p = JSON.parse(JSON.stringify(k.S.project));
      const t = p.tracks.find(t => t.type === 'synth' && t.clips.length) ?? p.tracks[1];
      p.tracks = [t]; t.rev = 0; t.dly = 0;
      const hf = b => { const d = b.getChannelData(0); let e = 0; for (let i = 1; i < d.length; i++) e += (d[i] - d[i - 1]) ** 2; return 10 * Math.log10(e / d.length + 1e-20); };
      const dry = await k.renderOffline(p, false), dry2 = await k.renderOffline(p, false);
      const i = k.newInsert('au'); i.url = 'aufx:lpas:appl'; i.name = 'AULowpass'; i.p = { 0: 300 }; t.inserts = [i];
      const wet = await k.renderOffline(p, false);
      return { track: t.name, dryHf: hf(dry), dry2Hf: hf(dry2), wetHf: hf(wet), failed: k.lastRender.wamFailed };
    });
    console.log('Export :', JSON.stringify(ex));
    check(Math.abs(ex.dryHf - ex.dry2Hf) < 0.5, `rendu sans plugin reproductible (${ex.dryHf.toFixed(1)} / ${ex.dry2Hf.toFixed(1)} dB)`);
    check(ex.failed === 0 && ex.dryHf - ex.wetHf > 6, `piste « ${ex.track} » à l'export : aigus ${ex.dryHf.toFixed(1)} → ${ex.wetHf.toFixed(1)} dB avec AULowpass 300 Hz`);

    // 4. Temps réel : la même piste joue en boucle à travers le plugin, sans sortie audio.
    await win.evaluate(async () => {
      const k = window.kh, e = k.engine;
      // Rien ne doit s'entendre : sortie native à zéro (étape 5) ou, sans elle, Web Audio sans sortie.
      if (e.native) e.native.gain(0); else await e.ctx.setSinkId({ type: 'none' });
      const t = k.S.project.tracks.find(t => t.type === 'synth' && t.clips.length) ?? k.S.project.tracks[1];
      const i = k.newInsert('au'); i.url = 'aufx:lpas:appl'; i.name = 'AULowpass'; i.p = { 0: 1000 }; t.inserts = [i];
      k.S.project.loop = true; k.commit();
    });
    await win.waitForTimeout(1500);
    const live0 = await win.evaluate(() => [...window.kh.liveWams.values()].map(w => w.descriptor?.name));
    check(live0.some(n => n?.includes('AULowpass')), `plugin branché dans le mixeur temps réel (${live0.join(', ')})`);
    await win.click('#bPlay');
    const t0 = Date.now();
    let st;
    while (Date.now() - t0 < HOLD * 1000) {
      await new Promise(r => setTimeout(r, Math.min(30000, HOLD * 1000)));   // horloge de Node : la page peut être ralentie
      st = await win.evaluate(async () => {
        const w = [...window.kh.liveWams.values()].find(w => w.stats);
        return { playing: window.kh.engine.playing, step: window.kh.engine.currentStep(), ...(await w.stats()) };
      });
      console.log(`  ${Math.round((Date.now() - t0) / 1000)} s : ${JSON.stringify(st)}`);
    }
    check(st.playing && st.n > HOLD * 300, `${HOLD} s de lecture à travers le plugin : ${st.n} blocs`);
    check(st.miss === 0, `blocs manqués (le plugin n'a pas répondu à temps) : ${st.miss}`);
    check(!errors.length, `aucune erreur dans la page${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  } finally { await app.close(); }
  console.log(ok ? 'Pont Audio Unit : OK' : 'Pont Audio Unit : ÉCHEC');
  process.exitCode = ok ? 0 : 1;
})().catch(e => { console.error(e); process.exit(2); });
