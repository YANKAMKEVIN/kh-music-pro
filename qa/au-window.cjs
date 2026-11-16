/* Fenêtre graphique des plugins du Mac (V17), avec le vrai module natif : le bouton de la chaîne d'effets ouvre la vue Cocoa
 * du plugin dans une vraie fenêtre du Mac (vérifiée dans la liste des fenêtres du système), un réglage changé dans le plugin
 * revient dans le projet, et retirer l'effet ferme la fenêtre.
 * Prérequis : macOS, npm run build ; npm run native. Usage : node qa/au-window.cjs */
const { _electron: electron } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Fenêtres visibles à l'écran (titre et application), lues par Core Graphics.
const SWIFT = `import CoreGraphics
let l = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
for w in l { print("\\(w["kCGWindowOwnerName"] ?? "")|\\(w["kCGWindowName"] ?? "")|\\((w["kCGWindowBounds"] as? [String: Any])?["Width"] ?? 0)") }`;
// Compilé une fois (swiftc) : l'interpréteur « swift -e » est trop lent sur une machine chargée.
const BIN = path.join(os.tmpdir(), 'kh-list-windows');
function screenWindows() {
  try {
    if (!fs.existsSync(BIN)) { const src = BIN + '.swift'; fs.writeFileSync(src, SWIFT); execFileSync('swiftc', ['-O', '-o', BIN, src], { timeout: 300000 }); }
    return execFileSync(BIN, { encoding: 'utf8', timeout: 20000 }).split('\n').filter(Boolean);
  } catch (e) { return ['erreur ' + e.message.split('\n')[0]]; }
}

let ok = true;
const check = (c, m) => { console.log((c ? '  ok   ' : '  ÉCHEC ') + m); if (!c) ok = false; };
(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-auwin-'));
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.cjs'), '--user-data-dir=' + prof], env: { ...process.env, KH_NATIVE: '1' } });
  try {
    const win = await app.firstWindow(); const errors = []; win.on('pageerror', e => errors.push(e.message));
    await win.waitForSelector('.clip', { timeout: 30000 });
    if (await win.$eval('#help', d => d.open)) await win.click('#help form button.accent');
    check(await win.evaluate(() => typeof window.khNative?.uiOpen === 'function'), 'le module natif sait ouvrir la fenêtre d’un plugin');
    await win.click('#tabs [data-tab=mixer]'); await win.click('.strip >> nth=1 >> [data-act=rack]');
    await win.selectOption('[data-role=fxadd]', 'au:aufx:dcmp:appl');
    await win.waitForSelector('#fx [data-act=auwindow]', { timeout: 15000 });
    await win.click('#fx [data-act=auwindow]'); await sleep(1500);
    const st = await win.evaluate(() => { const k = window.kh, tr = k.S.project.tracks[1], inst = [...k.liveWams.values()].find(w => w.auId); return { id: inst?.auId, open: inst && window.khNative.uiIsOpen(inst.auId) }; });
    check(st.open, 'la fenêtre du plugin est ouverte');
    const wins = screenWindows(), mine = wins.filter(w => /DynamicsProcessor/.test(w));
    check(mine.length === 1 && +mine[0].split('|')[2] > 200, `fenêtre visible à l'écran : ${mine.join(' ; ') || wins.slice(0, 5).join(' ; ')}`);
    // Un réglage changé dans le plugin (comme le ferait sa fenêtre) revient dans le projet.
    const addr = await win.evaluate(id => { const p = window.khNative.params(id)[0]; window.khNative.setParam(id, p.address, p.min + (p.max - p.min) * 0.25); return p.address; }, st.id);
    await sleep(1200);
    const v = await win.evaluate(a => window.kh.S.project.tracks[1].inserts[0].p[String(a)], addr);
    check(typeof v === 'number', `réglage du plugin recopié dans le projet (adresse ${addr} = ${v})`);
    // Retirer l'effet ferme sa fenêtre.
    await win.click('#fx [data-act=fxdel]'); await sleep(800);
    const after = screenWindows().filter(w => /DynamicsProcessor/.test(w));
    check(!after.length, 'retirer l’effet ferme sa fenêtre' + (after.length ? ' : ' + after.join(' ; ') : ''));
    check(!errors.length, 'aucune erreur dans la page' + (errors.length ? ' : ' + errors[0] : ''));
  } catch (e) { console.error(e); ok = false; }
  finally { await app.close().catch(() => { }); }
  console.log(ok ? '\nFenêtre des plugins du Mac : OK' : '\nFenêtre des plugins du Mac : ÉCHEC');
  process.exit(ok ? 0 : 1);
})();
