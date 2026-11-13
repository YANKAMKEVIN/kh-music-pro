/* Prototype V14b : séance d'écoute. Lance la version bureau en mode natif (profil normal, les projets sont gardés)
 * et note toutes les 5 s les incidents du chemin natif (manques, surcharges, trous), avec l'état de lecture.
 * Témoin : les coupures que Chromium compte sur sa propre sortie pendant la même période (mêmes épisodes, autre chemin).
 * S'arrête quand la fenêtre est fermée. Usage : node qa/ecoute-native.cjs > ecoute.log   (KH_RT=1 : calcul audio du navigateur en priorité temps réel)
 * Les débordements d'entrée ne sont pas des incidents : le micro est capté en permanence, même quand rien ne le lit. */
const root = require('path').join(__dirname, '..');
const { _electron: electron } = require('playwright');
const path = require('path');
const t0 = Date.now();
const ts = () => { const s = Math.round((Date.now() - t0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

(async () => {
  const app = await electron.launch({ args: [path.join(root, 'electron', 'main.cjs')], env: { ...process.env, KH_NATIVE: '1' } });
  const win = await app.firstWindow();
  win.on('pageerror', e => console.log(ts(), 'ERREUR page :', e.message));
  win.on('console', m => { if (m.type() === 'error') console.log(ts(), 'console :', m.text()); });
  win.on('crash', () => console.log(ts(), '!! page plantée'));
  let alive = true;
  app.on('close', () => { alive = false; });
  await win.waitForFunction(() => window.kh?.engine?.native, null, { timeout: 30000 }).catch(() => console.log('natif non démarré'));
  console.log(ts(), 'démarré :', JSON.stringify(await win.evaluate(() => window.kh.engine.native.info)));
  let prev = null, quiet = 0;
  while (alive) {
    await new Promise(r => setTimeout(r, 5000));
    let s;
    try {
      s = await win.evaluate(() => ({ playing: window.kh.engine.playing, rec: !!window.kh.engine.recording, opts: window.kh.engine.native.opts, ...window.kh.engine.native.stats(), web: window.kh.engine.ctx.playbackStats?.underrunEvents ?? 0 }));
    } catch { break; }
    const d = prev ? {
      manques: s.outUnderruns - prev.outUnderruns, surcharges: s.overloads - prev.overloads, trous: s.gaps - prev.gaps,
      perdusSortie: s.outDropped - prev.outDropped, temoinNavigateur: s.web - prev.web, perdusEntree: s.inMissed - prev.inMissed, debordEntree: s.inOverflows - prev.inOverflows,
    } : {};
    const { debordEntree: _, ...graves } = d;
    const incident = Object.values(graves).some(v => v > 0);
    const devs = prev && (s.opts.output !== prev.opts.output || s.opts.input !== prev.opts.input);
    if (!prev || incident || devs || s.playing !== prev.playing || ++quiet >= 12) {
      quiet = 0;
      console.log(ts(), s.playing ? 'lecture' : 'arrêt', incident ? 'INCIDENT ' + JSON.stringify(d) : 'propre',
        `| sortie ${Math.round(s.outLevel)} (min ${Math.round(s.outMin)}) ${s.outPpm.toFixed(0)} ppm | entrée ${Math.round(s.inLevel)} | trou max ${s.maxGapMs?.toFixed?.(1)} ms`,
        devs ? `| appareils ${JSON.stringify(s.opts)}` : '');
    }
    prev = s;
  }
  console.log(ts(), 'fenêtre fermée, fin de séance');
  process.exit(0);
})().catch(e => { console.log('arrêt :', e.message); process.exit(1); });
