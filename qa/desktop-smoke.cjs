/* Vérifie que la version bureau démarre : la fenêtre s'ouvre, l'application se charge et produit du son.
 * Usage : npm run build, puis node qa/desktop-smoke.cjs (sous Linux sans écran : xvfb-run -a node qa/desktop-smoke.cjs). */
const { _electron: electron } = require('playwright');
const path = require('path');
(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.cjs'), '--no-sandbox'] });
  const errors = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', e => errors.push(e.message));
    await win.waitForSelector('.clip', { timeout: 30000 });
    if (await win.$eval('#help', d => d.open)) await win.click('#help form button.accent');
    const r = await win.evaluate(async () => {
      const k = window.kh, b = await k.renderOffline(k.S.project), d = b.getChannelData(0); let e = 0;
      for (const v of d) e += v * v;
      // Vrai instrument : les fichiers de sons embarqués doivent se charger aussi depuis l'application de bureau.
      const pp = k.demoProject(); pp.tracks = [pp.tracks[3]]; pp.tracks[0].synth = k.makeSynth('r_drawbar'); pp.tracks[0].clips = [{ id: 'held', name: 'Orgue', start: 0, len: 48, offset: 0, patLen: 48, notes: [{ p: 60, s: 0, l: 48, v: 0.8 }] }];
      const pb = await k.renderOffline(pp, false), pd = pb.getChannelData(0); let pe = 0; const from = Math.floor(pb.sampleRate * 4), to = Math.floor(pb.sampleRate * 5); for (let i = from; i < to; i++) pe += pd[i] * pd[i];
      return { sampled: Math.sqrt(pe / (to - from)), title: document.title, tracks: k.S.project.tracks.length, rms: Math.sqrt(e / d.length), dur: b.duration, node: typeof window.require };
    });
    await win.click('.head >> nth=1 >> .ticon'); await win.click('[data-act=sound-browser]');
    const soundCount = await win.$$eval('#sounds [data-sound]', es => es.length);
    await win.fill('[data-role=sound-search]', 'drawbar'); await win.click('[data-sound="r_drawbar"] [data-act=sound-preview]');
    await win.waitForTimeout(350);
    const soundBrowser = soundCount === 53 && await win.evaluate(() => { const k = window.kh, a = k.engine.mix.analyser, d = new Float32Array(a.fftSize); a.getFloatTimeDomainData(d); return !k.engine.playing && d.some(x => Math.abs(x) > 0.001); });
    await win.keyboard.press('Escape'); await win.waitForSelector('#sounds', { state: 'detached' });
    await win.click('#bPlay'); await win.waitForTimeout(600);
    const playing = await win.evaluate(() => window.kh.engine.playing && window.kh.engine.currentStep() > 1);
    console.log(JSON.stringify({ ...r, soundBrowser, playing, errors }));
    const ok = r.title === 'KH Music Pro' && r.tracks === 5 && r.rms > 0.02 && r.sampled > 0.005 && r.node === 'undefined' && soundBrowser && playing && !errors.length;
    console.log(ok ? 'Version bureau : OK' : 'Version bureau : ÉCHEC');
    process.exitCode = ok ? 0 : 1;
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exit(2); });
