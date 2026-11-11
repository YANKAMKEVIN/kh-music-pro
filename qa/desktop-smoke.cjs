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
      return { title: document.title, tracks: k.S.project.tracks.length, rms: Math.sqrt(e / d.length), dur: b.duration, node: typeof window.require };
    });
    await win.click('#bPlay'); await win.waitForTimeout(600);
    const playing = await win.evaluate(() => window.kh.engine.playing && window.kh.engine.currentStep() > 1);
    console.log(JSON.stringify({ ...r, playing, errors }));
    const ok = r.title === 'KH Music Pro' && r.tracks === 5 && r.rms > 0.02 && r.node === 'undefined' && playing && !errors.length;
    console.log(ok ? 'Version bureau : OK' : 'Version bureau : ÉCHEC');
    process.exitCode = ok ? 0 : 1;
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exit(2); });
