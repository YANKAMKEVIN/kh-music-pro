/* Fichiers de projet dans la version bureau (V17) : vraies fenêtres Ouvrir / Enregistrer sous (réponses simulées dans le
 * processus principal, aucune fenêtre à cliquer), vrai disque, fichiers récents, ouverture depuis le Finder, et sécurité du pont.
 * Vérifié avec et sans le module natif (les deux préchargements). Prérequis : npm run build (et npm run native sur Mac).
 * Usage : node qa/desktop-files.cjs */
const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ok = true;
const check = (c, m) => { console.log((c ? '  ok   ' : '  ÉCHEC ') + m); if (!c) ok = false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(native) {
  console.log(`\nVersion bureau ${native ? 'avec' : 'sans'} module natif`);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-files-')), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-disk-'));
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.cjs'), '--user-data-dir=' + prof], env: { ...process.env, KH_NATIVE: native ? '1' : '0' } });
  try {
    const win = await app.firstWindow();
    const errors = []; win.on('pageerror', e => errors.push(e.message));
    await win.waitForSelector('.clip', { timeout: 30000 });
    if (await win.$eval('#help', d => d.open)) await win.click('#help form button.accent');
    const env = await win.evaluate(() => ({ files: typeof window.khFiles?.saveAs, req: typeof window.require, proc: typeof window.process, native: !!window.khNative }));
    check(env.files === 'function' && env.req === 'undefined' && env.proc === 'undefined', `pont des fichiers présent, page toujours isolée (${JSON.stringify(env)})`);
    // Fenêtres du système : on remplace leurs réponses dans le processus principal et on compte les appels.
    const target = path.join(dir, 'Ma chanson.khm');
    await app.evaluate(({ dialog }, p) => { global.khCalls = { save: 0, open: 0 }; dialog.showSaveDialog = async () => { global.khCalls.save++; return { canceled: false, filePath: p }; }; }, target.replace(/\.khm$/, ''));
    // 1. Enregistrer sous, depuis le menu, à la souris.
    await win.click('#menu summary'); await win.click('#bSaveAs'); await sleep(600);
    const saved = fs.existsSync(target) && JSON.parse(fs.readFileSync(target, 'utf8'));
    check(saved && saved.format === 'kh-music-pro' && saved.project.tracks.length === 5, `« Enregistrer sous » écrit ${path.basename(target)} (extension ajoutée) dans le dossier choisi`);
    check((await win.title()).startsWith('Ma chanson'), `titre de la fenêtre : ${await win.title()}`);
    // 2. Modifier au clavier, puis Cmd+S : même fichier, sans fenêtre.
    await win.click('#pname', { clickCount: 3 }); await win.keyboard.type('Version 2'); await win.keyboard.press('Tab');
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s'); await sleep(600);
    const calls = await app.evaluate(() => global.khCalls);
    check(JSON.parse(fs.readFileSync(target, 'utf8')).project.name === 'Version 2' && calls.save === 1, `Cmd+S réécrit le fichier sans redemander (${calls.save} fenêtre « Enregistrer sous »)`);
    check(!fs.readdirSync(dir).some(f => f.endsWith('.tmp')), 'écriture sûre : aucun fichier temporaire laissé à côté');
    // 3. Ouvrir un autre fichier du disque.
    const other = path.join(dir, 'Autre.khm'), o = JSON.parse(fs.readFileSync(target, 'utf8')); o.project.name = 'Un autre morceau'; o.project.tracks = o.project.tracks.slice(0, 2);
    fs.writeFileSync(other, JSON.stringify(o));
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => { global.khCalls.open++; return { canceled: false, filePaths: [p] }; }; }, other);
    await win.click('#menu summary'); await win.click('#bOpen'); await sleep(800);
    check(await win.evaluate(() => window.kh.S.project.name === 'Un autre morceau' && window.kh.S.project.tracks.length === 2), '« Ouvrir » charge le fichier choisi');
    // 4. Fichiers récents : les deux, le plus récent d'abord ; un clic rouvre le premier.
    await win.click('#menu summary'); await win.waitForSelector('#recent .rfile');
    const rec = await win.$$eval('#recent .rfile', l => l.map(e => e.textContent.replace('🎵 ', '')));
    check(rec.join() === 'Autre,Ma chanson', `fichiers récents : ${rec.join(', ')}`);
    await win.click('#recent .rfile >> nth=1'); await sleep(800);
    check(await win.evaluate(() => window.kh.S.project.name === 'Version 2'), 'un fichier récent se rouvre d’un clic');
    // 5. Sécurité : la page ne peut ni écrire ni lire un fichier qu'on ne lui a pas confié.
    const sec = await win.evaluate(async p => {
      const tryIt = async f => { try { await f(); return 'accepté'; } catch { return 'refusé'; } };
      return { otherKhm: await tryIt(() => window.khFiles.save(p + '/intrus.khm', 'x')), hosts: await tryIt(() => window.khFiles.save('/etc/hosts', 'x')), read: await tryIt(() => window.khFiles.openRecent('/etc/passwd')) };
    }, dir);
    check(sec.otherKhm === 'refusé' && sec.hosts === 'refusé' && sec.read === 'refusé' && !fs.existsSync(path.join(dir, 'intrus.khm')), `écriture ou lecture hors des fichiers choisis refusée (${JSON.stringify(sec)})`);
    // 6. Fichier récent supprimé du disque : message, et il sort de la liste.
    fs.unlinkSync(other);
    await win.evaluate(() => window.khFiles.recent = window.khFiles.recent); // (le pont relit le disque à chaque fois)
    await win.click('#menu summary'); await win.waitForSelector('#recent .rfile');
    const rec2 = await win.$$eval('#recent .rfile', l => l.map(e => e.textContent.replace('🎵 ', '')));
    check(rec2.join() === 'Ma chanson', `un fichier disparu n'est plus proposé (${rec2.join(', ')})`);
    await win.keyboard.press('Escape'); await win.evaluate(() => { document.getElementById('menu').open = false; });
    // 7. Double-clic dans le Finder (événement open-file du Mac).
    const fin = path.join(dir, 'Finder.khm'); o.project.name = 'Ouvert du Finder'; fs.writeFileSync(fin, JSON.stringify(o));
    await app.evaluate(({ app }, p) => app.emit('open-file', { preventDefault() { } }, p), fin); await sleep(800);
    check(await win.evaluate(() => window.kh.S.project.name === 'Ouvert du Finder' && window.kh.S.file.name === 'Finder'), 'un .khm ouvert depuis le Finder s’ouvre et devient le fichier du projet');
    // 8. Le fichier lié est retenu au redémarrage : Cmd+S réécrit encore le même fichier.
    await app.close();
    const app2 = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.cjs'), '--user-data-dir=' + prof], env: { ...process.env, KH_NATIVE: native ? '1' : '0' } });
    const w2 = await app2.firstWindow(); await w2.waitForSelector('.clip', { timeout: 30000 });
    await w2.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await app2.evaluate(({ dialog }) => { global.khSaves = 0; dialog.showSaveDialog = async () => { global.khSaves++; return { canceled: true }; }; });
    await w2.click('#pname', { clickCount: 3 }); await w2.keyboard.type('Après redémarrage'); await w2.keyboard.press('Tab');
    await w2.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s'); await sleep(600);
    check(JSON.parse(fs.readFileSync(fin, 'utf8')).project.name === 'Après redémarrage' && await app2.evaluate(() => global.khSaves) === 0, 'après redémarrage, Cmd+S réécrit le fichier du projet sans redemander');
    await app2.close();
    check(!errors.length, 'aucune erreur dans la page' + (errors.length ? ' : ' + errors[0] : ''));
  } catch (e) { console.error(e); ok = false; await app.close().catch(() => { }); }
}

(async () => {
  await run(false);
  if (process.platform === 'darwin' && fs.existsSync(path.join(__dirname, '..', 'native', 'kh-au-bridge', 'build', 'Release', 'kh_au_bridge.node'))) await run(true);
  console.log(ok ? '\nFichiers de la version bureau : OK' : '\nFichiers de la version bureau : ÉCHEC');
  process.exit(ok ? 0 : 1);
})();
