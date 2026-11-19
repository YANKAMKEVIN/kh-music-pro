/* Tenue du moteur natif sur une carte son (V19) : la démo joue en boucle à -100 dB (rien ne s'entend), avec les réserves choisies,
 * et on compte les manques (craquements) côté carte son et entre Web Audio et le natif.
 * Usage : node qa/tenue-carte.cjs [carte] [secondes] [réserve de sortie] [réserve d'entrée] [première voie d'entrée] [tampon de la carte] [horloge]
 *   horloge : sortie de Chromium qui cadence Web Audio ; vide = réglage de l'application (une sortie intégrée du Mac quand la carte est une autre), « output » = la carte elle-même,
 *   « none » = aucune,
 *   sinon une partie du nom d'une autre sortie (essai du 19/11/2026 : « MacBook »).
 *   ex. node qa/tenue-carte.cjs Scarlett 300 384 128 4 256
 * Prérequis : npm run build ; npm run native. */
const { _electron: electron } = require('playwright');
const path = require('path');
const [CARD = 'Scarlett', SEC = '300', OUT = '768', IN = '256', FIRST = '4', BUF = '128', CLOCK = ''] = process.argv.slice(2);

(async () => {
  const prof = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'kh-tenue-'));
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.cjs'), '--user-data-dir=' + prof], env: { ...process.env, KH_NATIVE: '1' } });
  let ok = true;
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.clip', { timeout: 30000 });
    if (await win.$eval('#help', d => d.open)) await win.click('#help form button.accent');
    const info = await win.evaluate(async ([card, out, inp, first, buffer, clock]) => {
      const e = window.kh.engine;
      for (let k = 0; k < 50 && !e.native; k++) await new Promise(r => setTimeout(r, 100));
      const s0 = await navigator.mediaDevices.getUserMedia({ audio: true }); s0.getTracks().forEach(t => t.stop());
      const id = (await navigator.mediaDevices.enumerateDevices()).find(d => d.kind === 'audioinput' && d.label.includes(card))?.deviceId;
      const i = await e.native.configure({ output: card, input: null, inFirst: first, outTarget: out, inTarget: inp, buffer, gain: 1e-5 });
      if (clock) await e.native.setClock(clock === 'none' ? null : clock === 'output' ? card : clock, true);
      if (id) { window.kh.S.inputDevice = id; await e.openInput(id); e.setInput(1, false); }
      window.kh.S.project.loop = true; window.kh.commit();
      return { output: i.output, input: e.native.info.input, buffer: e.native.info.buffer, clock: e.native.clock, lat: e.latency() };
    }, [CARD, +OUT, +IN, +FIRST, +BUF, CLOCK]);
    console.log(`Carte : ${info.output} / ${info.input} ; tampon de la carte ${info.buffer} ; horloge ${info.clock === null ? 'aucune' : info.clock || 'la carte'} ; réserves ${OUT} / ${IN} ; latences annoncées : sortie ${(info.lat.output * 1000).toFixed(1)} ms, entrée ${(info.lat.input * 1000).toFixed(1)} ms`);
    await win.click('#bPlay');
    await win.waitForTimeout(2000);
    await win.evaluate(() => window.kh.engine.native.resetStats());
    const t0 = Date.now();
    let st;
    while (Date.now() - t0 < +SEC * 1000) {
      await new Promise(r => setTimeout(r, Math.min(30000, +SEC * 1000)));
      st = await win.evaluate(() => ({ playing: window.kh.engine.playing, ...window.kh.engine.native.stats() }));
      console.log(`  ${Math.round((Date.now() - t0) / 1000)} s : sortie niveau min ${Math.round(st.outMin)}, manques ${st.outUnderruns}, perdus ${st.outDropped} | entrée min ${Math.round(st.inMin)}, manques ${st.inMissed} | surcharges ${st.overloads}, trous ${st.gaps} (max ${Math.round(st.maxGapMs)} ms)`);
    }
    ok = st.playing && st.outUnderruns === 0 && st.outDropped === 0 && st.inMissed === 0;
    console.log(ok ? 'Tenue : aucun manque' : 'Tenue : MANQUES');
  } finally { await app.close(); }
  process.exitCode = ok ? 0 : 1;
})().catch(e => { console.error(e); process.exit(2); });
