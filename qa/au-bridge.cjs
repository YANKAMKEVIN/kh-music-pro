/* Plugins Audio Unit du Mac dans la version bureau (V14b) : pont natif, traitement exact, export, temps réel, interface.
 * Prérequis : npm run build ; npm run native (module natif construit pour cette machine)
 * Usage : node qa/au-bridge.cjs [secondes de tenue, 300 par défaut]
 * Le temps réel tourne sans sortie audio (setSinkId « none ») : rien n'est joué sur les haut-parleurs. */
const { _electron: electron } = require('playwright');
const path = require('path');
const HOLD = Number(process.argv[2] ?? 300);

(async () => {
  // Profil temporaire : le test ne touche pas aux projets enregistrés de l'application.
  const prof = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'kh-au-'));
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.cjs'), '--user-data-dir=' + prof], env: { ...process.env, KH_NATIVE: '1' } });
  const errors = [], security = [];
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
    win.on('console', m => {
      // L'avertissement sur l'absence de règle de contenu (CSP) existait déjà dans la version normale : seuls les autres comptent ici.
      if (m.text().includes('Electron Security Warning')) { if (!m.text().includes('Content-Security-Policy')) security.push(m.text().split('\n')[0]); }
      else if (m.type() === 'warning' || m.type() === 'error') errors.push(m.text());
    });
    await win.waitForSelector('.clip', { timeout: 30000 });
    if (await win.$eval('#help', d => d.open)) await win.click('#help form button.accent');

    // 1. Le pont est là.
    const env = await win.evaluate(() => ({ bridge: !!window.kh.auBridge(), sab: typeof SharedArrayBuffer, n: window.kh.auBridge()?.list().length, require: typeof window.require }));
    console.log('Pont :', JSON.stringify(env));
    check(env.bridge && env.sab === 'function' && env.n > 0, 'pont natif chargé, mémoire partagée disponible, Audio Units listés');
    check(env.require === 'undefined', 'la page n\'a toujours pas accès à Node (require)');
    const iso = await win.evaluate(() => ({ process: typeof window.process, module: typeof window.module, raw: Object.keys(window.khNative).includes('ioStart') && typeof window.khNative.ioStart === 'function' }));
    check(iso.process === 'undefined' && iso.module === 'undefined' && iso.raw, 'isolation de contexte : ni process ni module dans la page, seulement les fonctions du pont');
    const lpParams = await win.evaluate(async () => {
      const c = new OfflineAudioContext(2, 128, 48000), au = await window.kh.createAu(c, 'aufx:lpas:appl', {});
      const p = au.params; au.audioNode.destroy(); return p;
    });
    check(lpParams.length >= 2 && lpParams.some(p => /cutoff/i.test(p.name) && p.unit === 8), `réglages d'AULowpass lus dans le plugin : ${lpParams.map(p => p.name).join(', ')}`);
    const filt = await win.evaluate(async () => {
      const c = new OfflineAudioContext(2, 128, 48000), au = await window.kh.createAu(c, 'aufx:filt:appl', {});
      const p = au.params.find(x => x.name === 'Low Filter Type'); au.audioNode.destroy(); return p;
    });
    check(filt?.unit === 1 && filt.values?.join('/') === 'Low Shelf/High Pass', `réglage à choix d'AUFilter : « ${filt?.name} » = ${filt?.values?.join(' / ')}`);

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
    await win.click('#bPlay');

    // 5. Interface : chaîne d'effets d'une piste, groupe « Plugins du Mac », curseurs des réglages qui pilotent le vrai plugin.
    await win.evaluate(() => { const k = window.kh, t = k.S.project.tracks[0]; t.inserts = []; k.commit(); k.showRack(t.id); });
    const opts = await win.$$eval('[data-role=aulist] option', o => o.map(x => [x.value, x.textContent]));
    check(opts.length >= 20 && opts.some(([v, n]) => v === 'au:aufx:dely:appl' && n === 'Delay'), `${opts.length} plugins du Mac proposés dans la chaîne d'effets (dont « Delay »)`);
    await win.selectOption('[data-role=fxadd]', 'au:aufx:dely:appl');
    await win.waitForSelector('#fx [data-au=params] input[type=range]', { timeout: 5000 });
    const ui = await win.evaluate(async () => {
      const k = window.kh, t = k.S.project.tracks[0], ins = t.inserts[0], inst = k.liveWams.get(t.id + ':' + ins.id) ?? [...k.liveWams.values()].find(w => w.descriptor?.name?.includes('AUDelay'));
      const sl = [...document.querySelectorAll('#fx [data-au=params] .sl')], time = sl.find(l => /delay time/i.test(l.textContent)), r = time.querySelector('input');
      r.value = '0.5'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(x => setTimeout(x, 200));
      const v = k.auBridge().params(inst.auId).find(p => p.address === +time.dataset.addr).value;
      return { title: document.querySelector('#fx .fxcard strong').textContent, n: sl.length, shown: time.querySelector('.val').textContent, saved: ins.p[time.dataset.addr], native: v, url: ins.url };
    });
    console.log('Interface :', JSON.stringify(ui));
    check(ui.url === 'aufx:dely:appl' && ui.title.includes('Delay') && ui.n >= 3, `effet « ${ui.title} » ajouté, ${ui.n} curseurs de réglage`);
    check(Math.abs(ui.saved - 0.5) < 0.001 && Math.abs(ui.native - ui.saved) < 1e-6 && ui.shown === '0.50 s', `curseur « Delay Time » : 0,5 s enregistré dans le projet et appliqué au plugin (lu : ${ui.native}, affiché ${ui.shown})`);
    // Préréglage d'usine d'un vrai plugin : AUMatrixReverb, « Large Hall ».
    await win.keyboard.press('Escape');
    await win.evaluate(() => { const k = window.kh, t = k.S.project.tracks[0]; t.inserts = []; k.commit(); k.showRack(t.id); });
    await win.selectOption('[data-role=fxadd]', 'au:aufx:mrev:appl');
    await win.waitForSelector('#fx [data-role=aupreset]', { timeout: 5000 });
    const names = await win.$$eval('#fx [data-role=aupreset] option', o => o.map(x => x.textContent));
    const n = await win.$eval('#fx [data-role=aupreset]', s => [...s.options].find(o => o.textContent === 'Large Hall')?.value);
    await win.selectOption('#fx [data-role=aupreset]', n); await win.waitForTimeout(200);
    const pre = await win.evaluate(() => {
      const k = window.kh, t = k.S.project.tracks[0], ins = t.inserts[0], inst = k.liveWams.get(t.id + ':' + ins.id);
      const nat = k.auBridge().params(inst.auId), diff = nat.filter(p => Math.abs((ins.p[p.address] ?? NaN) - p.value) > 1e-6);
      return { preset: ins.preset, n: Object.keys(ins.p).length, params: nat.length, diff: diff.map(p => p.name), changed: nat.filter(p => Math.abs(p.value - p.def) > 1e-6).length };
    });
    console.log('Préréglage :', JSON.stringify(pre));
    check(names.length > 10 && pre.preset !== undefined && pre.n === pre.params && !pre.diff.length && pre.changed > 0, `AUMatrixReverb : ${names.length - 1} préréglages d'usine ; « Large Hall » chargé, ${pre.changed} réglages changés, recopiés dans le projet à l'identique`);
    check(!security.length, `aucun avertissement de sécurité d'Electron${security.length ? ' : ' + security[0] : ''}`);
    check(!errors.length, `aucune erreur dans la page${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  } finally { await app.close(); }
  console.log(ok ? 'Pont Audio Unit : OK' : 'Pont Audio Unit : ÉCHEC');
  process.exitCode = ok ? 0 : 1;
})().catch(e => { console.error(e); process.exit(2); });
