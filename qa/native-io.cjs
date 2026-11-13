/* Prototype V14b, étape 5 : entrée et sortie de la carte son par le natif (version bureau, macOS).
 * Prérequis : npm run build ; module natif construit (voir docs/PASSATION.md, section 5).
 * Usage : node qa/native-io.cjs [secondes de tenue, 300 par défaut] [--mesure] [--cible=échantillons] [--cible-entree=échantillons]
 *   Sans --mesure, rien n'est entendu : la tenue joue la démo sur les haut-parleurs à -100 dB.
 *   Avec --mesure, des clics courts (2 kHz, 6 ms) sortent sur les haut-parleurs du Mac, au volume réglé par le propriétaire,
 *   et le micro intégré les capte. Le micro n'est jamais renvoyé vers les haut-parleurs (pas de larsen).
 *   Avec --reduite, la fenêtre est réduite dans le Dock pendant la tenue (usage réel : on travaille dans une autre fenêtre). */
const { _electron: electron } = require('playwright');
const path = require('path');
const args = process.argv.slice(2);
const HOLD = Number(args.find(a => /^\d+$/.test(a)) ?? 300);
const MEASURE = args.includes('--mesure');
const opt = k => Number(args.find(a => a.startsWith(`--${k}=`))?.split('=')[1]) || undefined;
const OUT_T = opt('cible'), IN_T = opt('cible-entree');
const MINI = args.includes('--reduite');

(async () => {
  // Profil temporaire : le test ne touche pas aux projets enregistrés de l'application.
  const prof = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'kh-io-'));
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.cjs'), '--user-data-dir=' + prof], env: { ...process.env, KH_NATIVE: '1' } });
  const errors = [];
  let ok = true;
  const check = (c, m) => { console.log((c ? '  ok   ' : '  ÉCHEC ') + m); if (!c) ok = false; };
  try {
    const win = await app.firstWindow();
    win.on('pageerror', e => errors.push(e.message));
    win.on('console', m => { if ((m.type() === 'warning' || m.type() === 'error') && !m.text().includes('Electron Security Warning')) errors.push(m.text()); });
    win.on('crash', () => console.log('!! page plantée'));
    await win.waitForSelector('.clip', { timeout: 30000 });
    if (await win.$eval('#help', d => d.open)) await win.click('#help form button.accent');

    // 1. Le natif a pris la carte son au démarrage ; Web Audio n'a plus de sortie.
    const env = await win.evaluate(async () => {
      const e = window.kh.engine;
      for (let k = 0; k < 50 && !e.native; k++) await new Promise(r => setTimeout(r, 100));
      return { io: !!window.kh.ioBridge(), native: !!e.native, toNative: e.out === e.native?.sink, info: e.native?.info, require: typeof window.require, rate: e.ctx.sampleRate };
    });
    console.log('Démarrage :', JSON.stringify(env));
    check(env.io && env.native, 'entrée/sortie natives démarrées avec l\'application');
    check(env.toNative, 'le mixage de Web Audio part vers le natif, plus vers la sortie du navigateur');
    check(env.require === 'undefined', 'la page n\'a toujours pas accès à Node (require)');

    // Haut-parleurs et micro intégrés : le seul trajet que le micro entend (la sortie USB est un casque).
    const setup = await win.evaluate(async ([gain, o, i]) => {
      const e = window.kh.engine, io = e.native;
      await e.openInput('');
      const info = await io.configure({ output: 'Haut-parleurs', input: 'Micro', gain, ...(o ? { outTarget: o } : {}), ...(i ? { inTarget: i } : {}) });
      e.setInput(1, false);   // gain unité, écoute de contrôle coupée : jamais de micro vers les haut-parleurs
      return { info, lat: e.latency(), opts: io.opts };
    }, [MEASURE ? 1 : 1e-5, OUT_T, IN_T]);
    console.log('Appareils :', JSON.stringify(setup));
    check(/Haut-parleurs/i.test(setup.info.output) && /Micro/i.test(setup.info.input ?? ''), `sortie « ${setup.info.output} », entrée « ${setup.info.input} »`);

    // 2. Mesure de l'aller-retour (seulement avec --mesure : des clics sortent sur les haut-parleurs).
    if (MEASURE) {
      // Changer d'appareil coupe le son un instant (quelques blocs manqués) : on compte à partir d'ici.
      await win.waitForTimeout(1500);
      await win.evaluate(() => window.kh.engine.native.resetStats());
      const m = await win.evaluate(async () => {
        const e = window.kh.engine, io = e.native, res = [];
        for (let k = 0; k < 6; k++) {
          io.arm(0.3);                              // horodatage natif : le clic quitte le logiciel, puis revient au micro
          const app = await e.measureLatency();     // même mesure qu'à l'étape 1, dans le temps de Web Audio
          const s = io.stats();
          res.push({ app: app === null ? null : app * 1000, trip: s.tripMs, floor: s.floor });
          await new Promise(r => setTimeout(r, 300));
        }
        return { res, stats: io.stats(), lat: e.latency() };
      });
      const r1 = x => x === null || x < 0 ? '—' : x.toFixed(1);
      m.res.forEach((r, k) => console.log(`  clic ${k + 1} : aller-retour dans l'application ${r1(r.app)} ms | trajet natif (sortie → micro) ${r1(r.trip)} ms | bruit ${r.floor.toFixed(4)}`));
      const good = m.res.filter(r => r.app !== null && r.trip > 0).slice(1);   // le premier sert de démarrage, comme aux étapes 1 et 3
      const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
      if (good.length) {
        const app = med(good.map(r => r.app)), trip = med(good.map(r => r.trip));
        console.log(`  Médianes : aller-retour ${app.toFixed(1)} ms (navigateur seul, étape 1 : 108 à 111 ms ; natif seul, étape 3 : ~50 ms) | trajet natif ${trip.toFixed(1)} ms (étape 3 : 46,4 ms)`);
        console.log(`  Part des tampons partagés et de Web Audio : ${(app - trip).toFixed(1)} ms | latences annoncées : sortie ${(m.lat.output * 1000).toFixed(1)} ms, entrée ${(m.lat.input * 1000).toFixed(1)} ms`);
      }
      check(good.length >= 3, `clics entendus : ${good.length + 1}/${m.res.length}`);
      check(m.stats.outUnderruns === 0 && m.stats.inMissed === 0, `aucun manque pendant la mesure (sortie ${m.stats.outUnderruns}, entrée ${m.stats.inMissed})`);
    }

    // 3. Tenue : la démo joue en boucle par le chemin natif.
    // Toujours à -100 dB : la tenue ne doit rien faire entendre, même après la mesure.
    await win.evaluate(() => { window.kh.engine.native.gain(1e-5); window.kh.S.project.loop = true; window.kh.commit(); });
    await win.click('#bPlay');
    if (MINI) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await win.waitForTimeout(2000);
    await win.evaluate(() => window.kh.engine.native.resetStats());
    // Témoin : Chromium compte les coupures de sa propre sortie (celle qui reçoit le signal infime), pendant la même tenue.
    const web = () => win.evaluate(() => { const p = window.kh.engine.ctx.playbackStats; return p ? { ev: p.underrunEvents, ms: p.underrunDuration * 1000 } : { ev: NaN, ms: NaN }; });
    const web0 = await web();
    const t0 = Date.now();
    let st, worstOut = 1e9, worstIn = 1e9;
    while (Date.now() - t0 < HOLD * 1000) {
      await new Promise(r => setTimeout(r, Math.min(30000, HOLD * 1000)));
      st = await win.evaluate(() => ({ playing: window.kh.engine.playing, ...window.kh.engine.native.stats() }));
      const w = await web();
      worstOut = Math.min(worstOut, st.outMin); worstIn = Math.min(worstIn, st.inMin);
      console.log(`  ${Math.round((Date.now() - t0) / 1000)} s : sortie niveau ${Math.round(st.outLevel)} (min ${Math.round(st.outMin)}, max ${Math.round(st.outMax)}), écart d'horloge ${st.outPpm.toFixed(0)} ppm, manques ${st.outUnderruns}, débordements ${st.outDropped} | entrée niveau ${Math.round(st.inLevel)} (min ${Math.round(st.inMin)}), ${st.inPpm.toFixed(0)} ppm, manques ${st.inMissed} | surcharges Core Audio ${st.overloads}, trous ${st.gaps} | témoin navigateur : ${w.ev - web0.ev} coupures (${(w.ms - web0.ms).toFixed(0)} ms)`);
    }
    const tot = await win.evaluate(() => window.kh.engine.native.stats());
    check(st.playing, `${HOLD} s de lecture par le chemin natif (${tot.outBlocks} blocs écrits par Web Audio)`);
    check(tot.outUnderruns === 0 && tot.overloads === 0 && tot.gaps === 0, `aucun manque à la carte son (manques ${tot.outUnderruns}, surcharges Core Audio ${tot.overloads}, trous ${tot.gaps})`);
    check(tot.outDropped === 0 && tot.inMissed === 0, `aucun bloc perdu entre Web Audio et le natif (sortie ${tot.outDropped}, entrée ${tot.inMissed})`);
    check(!errors.length, `aucune erreur dans la page${errors.length ? ' : ' + errors.join(' | ') : ''}`);
    console.log(`  Niveaux les plus bas vus : sortie ${Math.round(worstOut)}, entrée ${Math.round(worstIn)} échantillons`);
  } finally { await app.close(); }
  console.log(ok ? 'Entrée/sortie natives : OK' : 'Entrée/sortie natives : ÉCHEC');
  process.exitCode = ok ? 0 : 1;
})().catch(e => { console.error(e); process.exit(2); });
