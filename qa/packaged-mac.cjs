/* Vérifie l'application macOS empaquetée (celle de l'installateur), pas la version de développement :
 * le module natif rangé dans l'application se charge, la page reste isolée, un plugin du Mac traite le son,
 * et le moteur audio natif s'allume tout seul au premier lancement (activé par défaut sur Mac depuis le 21/11/2026 ; sans carte
 * son, il échoue proprement en rendant la main au navigateur), puis se désactive à la demande.
 * Usage : npx electron-builder --mac dmg --arm64, puis node qa/packaged-mac.cjs [chemin de KH Music Pro.app] [--strict]
 *   --strict : le moteur natif doit démarrer (sur un vrai Mac ; les machines de GitHub n'ont pas forcément de carte son). */
const { _electron: electron } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const args = process.argv.slice(2), STRICT = args.includes('--strict');
const appDir = args.find(a => a.endsWith('.app')) ?? path.join(__dirname, '..', 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'KH Music Pro.app');
const exe = path.join(appDir, 'Contents', 'MacOS', 'KH Music Pro');

(async () => {
  let ok = true;
  const check = (c, m) => { console.log((c ? '  ok   ' : '  ÉCHEC ') + m); if (!c) ok = false; };
  check(fs.existsSync(path.join(appDir, 'Contents', 'Resources', 'native', 'kh_au_bridge.node')), 'module natif rangé dans l\'application (Resources/native)');
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-pkg-'));
  const app = await electron.launch({ executablePath: exe, args: ['--user-data-dir=' + prof], env: { ...process.env, KH_NATIVE: '' } });
  const errors = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', e => errors.push(e.message));
    await win.waitForSelector('.clip', { timeout: 30000 });
    if (await win.$eval('#help', d => d.open)) await win.click('#help form button.accent');
    const r = await win.evaluate(async () => {
      const k = window.kh, br = k.auBridge(), sr = 48000;
      const start = await k.nativeStartup();
      const res = { bridge: !!br, require: typeof window.require, process: typeof window.process, n: br ? br.list().filter(d => d.type === 'aufx').length : 0, start, native: !!k.engine.native, startBack: k.engine.out === k.engine.ctx.destination, saved: localStorage.getItem('kh-native') };
      if (!br) return res;
      const goertzel = (d, f) => { const w = 2 * Math.PI * f / sr, cw = 2 * Math.cos(w); let s1 = 0, s2 = 0; for (const x of d) { const s = x + cw * s1 - s2; s2 = s1; s1 = s; } return 20 * Math.log10(Math.sqrt(s1 * s1 + s2 * s2 - cw * s1 * s2) * 2 / d.length); };
      const c = new OfflineAudioContext(2, sr, sr), au = await k.createAu(c, 'aufx:lpas:appl', { 0: 1000 }), g = c.createGain();
      for (const f of [200, 8000]) { const o = c.createOscillator(), a = c.createGain(); o.frequency.value = f; a.gain.value = 0.25; o.connect(a).connect(g); o.start(); }
      g.connect(au.audioNode).connect(c.destination);
      const d = (await c.startRendering()).getChannelData(0).subarray(4800); au.audioNode.destroy();
      res.lp200 = goertzel(d, 200); res.lp8k = goertzel(d, 8000);
      res.on = k.engine.native ? true : await k.setNativeEngine(true, true); res.out = k.engine.native ? k.engine.native.info.output : '';
      res.toast = document.querySelector('#toast')?.textContent ?? '';
      res.back = k.engine.out === k.engine.ctx.destination;
      res.off = await k.setNativeEngine(false, true); res.backAfter = !k.engine.native && k.engine.out === k.engine.ctx.destination;
      const piano = k.demoProject(); piano.tracks = [piano.tracks[1]]; piano.tracks[0].synth = k.makeSynth('r_salamander');
      const drums = k.demoProject(); drums.tracks = [drums.tracks[0]]; drums.tracks[0].kit = 'studio';
      const rms = b => { let e = 0; for (const v of b.getChannelData(0)) e += v * v; return Math.sqrt(e / b.length); };
      res.samples = { piano: rms(await k.renderOffline(piano)), drums: rms(await k.renderOffline(drums)) };
      for (const [key,preset] of [['wurli','r_wurli'],['bass','r_fashionbass']]) { piano.tracks[0].synth=k.makeSynth(preset);res.samples[key]=rms(await k.renderOffline(piano)); }
      drums.tracks[0].kit='percussion';res.samples.percussion=rms(await k.renderOffline(drums));
      return res;
    });
    console.log(JSON.stringify(r));
    check(r.bridge && r.n > 0, `pont natif chargé depuis l'application : ${r.n} plugins du Mac`);
    check(r.require === 'undefined' && r.process === 'undefined', 'la page reste isolée (ni require ni process)');
    check(r.saved === null && (r.start && r.native || !STRICT && !r.start && !r.native && r.startBack), r.native ? 'moteur natif allumé par défaut au premier lancement' : 'premier lancement sans carte son : repli sur le navigateur');
    check(Math.abs(r.lp200 + 12) < 1 && r.lp8k < -40, `AULowpass 1 kHz : 200 Hz ${r.lp200?.toFixed(1)} dBFS, 8 kHz ${r.lp8k?.toFixed(1)} dBFS`);
    if (r.on) check(true, `moteur natif activé : le son passe par « ${r.out} »`);
    else check(!STRICT && r.back && /n'a pas pu démarrer/.test(r.toast), `moteur natif non démarré (pas de carte son ?) : message « ${r.toast} », son rendu au navigateur`);
    check(!r.off && r.backAfter, 'moteur natif désactivé : le son repasse par le navigateur');
    check(r.samples?.wurli > 0.001 && r.samples?.bass > 0.001 && r.samples?.percussion > 0.005, 'piano électrique, basse et percussions chargés depuis l’application');
    check(r.samples?.piano > 0.002 && r.samples?.drums > 0.005, 'piano expressif et batterie Studio chargés et rendus depuis les fichiers de l’application');
    check(!errors.length, `aucune erreur dans la page${errors.length ? ' : ' + errors.join(' | ') : ''}`);
  } finally { await app.close(); }
  console.log(ok ? 'Application macOS empaquetée : OK' : 'Application macOS empaquetée : ÉCHEC');
  process.exitCode = ok ? 0 : 1;
})().catch(e => { console.error(e); process.exit(2); });
