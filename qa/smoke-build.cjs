// Test de fumée de la version construite (dist/, avec sa règle de contenu CSP), dans un vrai navigateur :
//  1. la page se charge sans erreur console ni exception, l'interface et le projet sont en place ;
//  2. les trois onglets (éditeur, mixeur, live) s'affichent ;
//  3. au téléphone (390 × 844, tactile), la page se charge aussi sans erreur ;
//  4. une sauvegarde abîmée dans le navigateur n'empêche pas l'application de démarrer.
// Lancement : npm run build && node qa/smoke-build.cjs  (sert dist/ avec « vite preview »).
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = Number(process.env.SMOKE_PORT) || 4179, URL = `http://localhost:${PORT}/`;
const root = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${msg}`); if (!ok) failed++; };

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(URL); if (r.ok) return; } catch { /* pas encore prêt */ }
    await sleep(250);
  }
  throw new Error('le serveur de prévisualisation ne répond pas');
}

/** Ouvre la page et relève les erreurs ; renvoie la page et la liste des erreurs. */
async function open(ctx) {
  const page = await ctx.newPage(), errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#top')?.children.length && window.kh?.S?.project?.tracks?.length, null, { timeout: 15000 });
  await sleep(800);
  return { page, errors };
}

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  let browser;
  try {
    await waitServer();
    browser = await chromium.launch({ executablePath: process.env.KH_CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });

    // 1 et 2 : ordinateur
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' });
    const { page, errors } = await open(desk);
    check(errors.length === 0, `chargement sans erreur console${errors.length ? ' : ' + errors.slice(0, 3).join(' | ') : ''}`);
    check(await page.evaluate(() => document.querySelectorAll('#tabs button').length === 3), 'trois onglets présents');
    check(await page.evaluate(() => !!document.querySelector('meta[http-equiv="Content-Security-Policy"]')), 'règle de contenu (CSP) présente dans la version construite');
    for (const tab of ['mixer', 'live', 'editor']) {
      const n = errors.length;
      await page.evaluate(() => document.querySelector('dialog[open]')?.close());
      await page.click(`#tabs button[data-tab=${tab}]`);
      await sleep(300);
      const shown = await page.evaluate(t => document.querySelector(`#tabs button[data-tab=${t}]`)?.getAttribute('aria-selected') === 'true' && document.getElementById('panel').children.length > 0, tab);
      check(shown && errors.length === n, `onglet « ${tab} » affiché sans erreur`);
    }
    await desk.close();

    // 3 : téléphone
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'fr-FR', serviceWorkers: 'block' });
    const mob = await open(phone);
    check(mob.errors.length === 0, `téléphone : chargement sans erreur${mob.errors.length ? ' : ' + mob.errors.slice(0, 3).join(' | ') : ''}`);
    await phone.close();

    // 4 : sauvegarde abîmée (projet courant illisible, sans version de secours)
    const bad = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR', serviceWorkers: 'block' });
    const first = await open(bad);
    await first.page.evaluate(() => new Promise((res, rej) => {
      const r = indexedDB.open('khmusicpro', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => {
        const tx = r.result.transaction('kv', 'readwrite'), kv = tx.objectStore('kv');
        kv.put('abime', 'current'); kv.put('{"name": "Projet abîmé", "tracks": [', 'proj:abime'); kv.put([{ id: 'abime', name: 'Projet abîmé', updated: Date.now() }], 'lib');
        tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error);
      };
      r.onerror = () => rej(r.error);
    }));
    await first.page.close();
    const again = await open(bad);
    const ok = await again.page.evaluate(() => window.kh.S.project.tracks.length > 0);
    const uncaught = again.errors.filter(e => !/Failed to load resource/.test(e));
    check(ok && uncaught.length === 0, `sauvegarde abîmée : l'application démarre quand même${uncaught.length ? ' (erreurs : ' + uncaught.slice(0, 3).join(' | ') + ')' : ''}`);
    await bad.close();
  } catch (e) {
    console.error(e); failed++;
  } finally {
    await browser?.close();
    server.kill();
  }
  console.log(failed ? `\n${failed} vérification(s) en échec` : '\nTest de fumée réussi');
  process.exit(failed ? 1 : 0);
})();
