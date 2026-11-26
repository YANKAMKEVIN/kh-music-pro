/* Vérifie que la version bureau démarre : la fenêtre s'ouvre, l'application se charge et produit du son.
 * Usage : npm run build, puis node qa/desktop-smoke.cjs (sous Linux sans écran : xvfb-run -a node qa/desktop-smoke.cjs). */
const { _electron: electron } = require('playwright');
const path = require('path');
(async () => {
  // Profil temporaire : le test part toujours du projet de démo, sans toucher aux projets enregistrés de l'application.
  const prof = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'kh-smoke-'));
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.cjs'), '--no-sandbox', '--user-data-dir=' + prof] });
  const errors = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', e => errors.push(e.message));
    // Règle de contenu (CSP) : aucun refus, aucun avertissement de sécurité d'Electron.
    win.on('console', m => { if (/Content Security Policy|Electron Security Warning/.test(m.text())) errors.push(m.text().split('\n')[0]); });
    await win.waitForSelector('.clip', { timeout: 30000 });
    // Premier lancement (profil neuf) : l'accueil (UX15) remplace la notice d'aide et s'ouvre par-dessus l'application ;
    // « Commencer » le referme en gardant le morceau d'exemple, comme le fait la campagne web (closeWelcome).
    if (await win.$('#welcome')) { await win.click('#bWelGo'); await win.waitForSelector('#welcome', { state: 'detached' }); }
    const r = await win.evaluate(async () => {
      const k = window.kh, b = await k.renderOffline(k.S.project), d = b.getChannelData(0); let e = 0;
      for (const v of d) e += v * v;
      // Vrai instrument : les fichiers de sons embarqués doivent se charger aussi depuis l'application de bureau.
      const pp = k.demoProject(); pp.tracks = [pp.tracks[3]]; pp.tracks[0].synth = k.makeSynth('r_drawbar'); pp.tracks[0].clips = [{ id: 'held', name: 'Orgue', start: 0, len: 48, offset: 0, patLen: 48, notes: [{ p: 60, s: 0, l: 48, v: 0.8 }] }];
      const pb = await k.renderOffline(pp, false), pd = pb.getChannelData(0); let pe = 0; const from = Math.floor(pb.sampleRate * 4), to = Math.floor(pb.sampleRate * 5); for (let i = from; i < to; i++) pe += pd[i] * pd[i];
      // V17: both new banks must load from local files, including all dynamic layers.
      pp.tracks[0].synth = k.makeSynth('r_salamander');
      const piano = await k.renderOffline(pp, false);
      const kit = k.demoProject(); kit.tracks = [kit.tracks[0]]; kit.tracks[0].kit = 'studio';
      const drums = await k.renderOffline(kit, false);
      const rms = b => { let sum = 0; for (const x of b.getChannelData(0)) sum += x * x; return Math.sqrt(sum / b.length); };
      const expressive = { piano: rms(piano), drums: rms(drums) };
      for (const [key,preset] of [['wurli','r_wurli'],['bass','r_fashionbass']]) { pp.tracks[0].synth = k.makeSynth(preset); expressive[key] = rms(await k.renderOffline(pp,false)); }
      kit.tracks[0].kit='percussion'; expressive.percussion=rms(await k.renderOffline(kit,false));
      // Plugin web fourni (Web Audio Module), sous la règle de contenu : il doit se charger et passer à l'export.
      const pw = k.demoProject(); pw.tracks = [pw.tracks[1]]; const wi = k.newInsert('wam'); wi.url = 'wam/kh-tape/index.js'; wi.name = 'KH Tape Echo'; pw.tracks[0].inserts = [wi];
      await k.renderOffline(pw, false); const wamFailed = k.lastRender.wamFailed;
      const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '';
      return { expressive, wamFailed, csp: csp.includes("object-src 'none'"), sampled: Math.sqrt(pe / (to - from)), title: document.title, tracks: k.S.project.tracks.length, rms: Math.sqrt(e / d.length), dur: b.duration, node: typeof window.require };
    });
    await win.click('.head >> nth=1 >> .ticon'); await win.click('[data-act=sound-browser]');
    const soundCount = await win.$$eval('#sounds [data-sound]', es => es.length);
    await win.fill('[data-role=sound-search]', 'drawbar'); await win.click('[data-sound="r_drawbar"] [data-act=sound-preview]');
    await win.waitForTimeout(350);
    const soundBrowser = soundCount === 57 && await win.evaluate(() => { const k = window.kh, a = k.engine.mix.analyser, d = new Float32Array(a.fftSize); a.getFloatTimeDomainData(d); return !k.engine.playing && d.some(x => Math.abs(x) > 0.001); });
    await win.keyboard.press('Escape'); await win.waitForSelector('#sounds', { state: 'detached' });
    const returnFocus = await win.$eval('[data-act=sound-browser]', b => document.activeElement === b);
    await win.click('#bPlay'); await win.waitForTimeout(600);
    const playing = await win.evaluate(() => window.kh.engine.playing && window.kh.engine.currentStep() > 1);
    console.log(JSON.stringify({ ...r, soundBrowser, returnFocus, playing, errors }));
    const ok = r.expressive.wurli > 0.001 && r.expressive.bass > 0.001 && r.expressive.percussion > 0.005 && r.expressive.piano > 0.001 && r.expressive.drums > 0.005 && r.csp && r.wamFailed === 0 && r.title.endsWith('KH Music Pro') && r.tracks === 5 && r.rms > 0.02 && r.sampled > 0.005 && r.node === 'undefined' && soundBrowser && returnFocus && playing && !errors.length;
    console.log(ok ? 'Version bureau : OK' : 'Version bureau : ÉCHEC');
    process.exitCode = ok ? 0 : 1;
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exit(2); });
