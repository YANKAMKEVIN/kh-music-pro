/* Latence réelle de KH Music Pro avec une carte son (V19) : la mesure de l'application (clic joué, puis retrouvé à l'entrée),
 * avec le moteur audio natif de la version bureau.
 * Usage : node qa/latence-carte.cjs [nom de la carte] [première voie d'entrée, à partir de 0] [tampons natifs...]
 *   ex. node qa/latence-carte.cjs Scarlett 4        (Scarlett 4i4 3e génération : entrées Loopback 5-6, son renvoyé numériquement)
 * Prérequis : npm run build ; npm run native. Les clics sortent à environ -26 dB dans le casque ou les enceintes de la carte. */
const { _electron: electron } = require('playwright');
const path = require('path');
const [CARD = 'Scarlett', FIRST = '4', ...BUFS] = process.argv.slice(2);

(async () => {
  const prof = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'kh-lat-'));
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.cjs'), '--user-data-dir=' + prof], env: { ...process.env, KH_NATIVE: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.clip', { timeout: 30000 });
    if (await win.$eval('#help', d => d.open)) await win.click('#help form button.accent');
    const res = await win.evaluate(async ([card, first, bufs]) => {
      const k = window.kh, e = k.engine, out = [];
      const s0 = await navigator.mediaDevices.getUserMedia({ audio: true }); s0.getTracks().forEach(t => t.stop());
      const id = (await navigator.mediaDevices.enumerateDevices()).find(d => d.kind === 'audioinput' && d.label.includes(card))?.deviceId;
      if (!id) return { error: 'carte introuvable : ' + card };
      for (const buffer of bufs.length ? bufs.map(Number) : [128, 64]) {
        if (!e.native) await e.useNative({ output: card, input: null, inFirst: first, buffer });
        else { e.closeInput(); await e.native.configure({ output: card, input: null, inFirst: first, buffer }); }
        e.native.gain(0.08);                       // clics à environ -26 dB
        k.S.inputDevice = id; await e.openInput(id);
        const lat = e.latency(), ms = [];
        for (let i = 0; i < 6; i++) { const r = await e.measureLatency(); if (r !== null) ms.push(r * 1000); }
        e.closeInput();
        out.push({ buffer, declaredMs: (lat.output + lat.input) * 1000, outMs: lat.output * 1000, inMs: lat.input * 1000, measured: ms.map(x => +x.toFixed(1)), info: e.native.info });
      }
      e.native.gain(1);
      return { out, rate: e.ctx.sampleRate };
    }, [CARD, Number(FIRST), BUFS]);
    if (res.error) { console.log(res.error); process.exitCode = 1; return; }
    console.log(`Fréquence : ${res.rate} Hz ; carte : ${res.out[0]?.info?.output} ; entrée : ${res.out[0]?.info?.input} (${res.out[0]?.info?.inChannels} voies, à partir de la voie ${+FIRST + 1})`);
    for (const r of res.out) {
      const s = [...r.measured].sort((a, b) => a - b), med = s.length ? s[s.length >> 1] : NaN;
      console.log(`tampon ${String(r.buffer).padStart(4)} | annoncé par KH : ${r.declaredMs.toFixed(1)} ms (sortie ${r.outMs.toFixed(1)} + entrée ${r.inMs.toFixed(1)}) | mesuré par KH : médiane ${med.toFixed(1)} ms ${JSON.stringify(r.measured)}`);
    }
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exit(2); });
