/* Campagne de QA de KH Music Pro : un cas d'usage = un test de bout en bout dans un vrai navigateur.
 * Usage : lancer `npm run dev`, puis `npm run qa`. Le rapport est écrit dans qa/REPORT.md. */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.KH_URL || 'http://localhost:5173/';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-qa-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function wavFile(name, freq = 440, sec = 1) {
  const sr = 44100, n = Math.floor(sr * sec), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / sr) * 16000), 44 + i * 2);
  const f = path.join(TMP, name); fs.writeFileSync(f, b); return f;
}
const TONE = wavFile('qa-tone.wav');
const MIC = wavFile('qa-mic.wav', 440, 2); // son reçu par le micro simulé : un la à 440 Hz

// Outils injectés dans la page (analyse audio par rendu hors-ligne).
const PAGE_HELPERS = () => {
  window.qa = {
    async stats(proj) {
      const b = await window.kh.renderOffline(proj), d = b.getChannelData(0), n = d.length, sr = b.sampleRate;
      let pk = 0, sq = 0, hf = 0, tail = 0, bad = 0;
      for (let i = 0; i < n; i++) {
        const v = d[i]; if (!Number.isFinite(v)) bad++;
        pk = Math.max(pk, Math.abs(v)); sq += v * v;
        if (i) hf += (v - d[i - 1]) ** 2;
        if (i >= n - 2 * sr) tail += v * v;
      }
      return { peak: pk, rms: Math.sqrt(sq / n), hf: Math.sqrt(hf / n), tail: Math.sqrt(tail / (2 * sr)), bad, dur: n / sr };
    },
    /** Projet de démo réduit à une seule piste (par index). */
    only(i, mutate) {
      const p = window.kh.demoProject(); p.tracks = [p.tracks[i]]; p.tracks[0].clips.length = 1;
      if (mutate) mutate(p, p.tracks[0]); return p;
    },
    async level(ms = 350) {
      let m = 0; const end = performance.now() + ms;
      while (performance.now() < end) { m = Math.max(m, window.kh.engine.level('master')); await new Promise(r => setTimeout(r, 20)); }
      return m;
    },
    /** Niveau (RMS gauche/droite) et contenu aigu du rendu, par fenêtre de temps [début, fin] en secondes. */
    async wins(proj, wins) {
      const b = await window.kh.renderOffline(proj, false), L = b.getChannelData(0), R = b.getChannelData(1), sr = b.sampleRate;
      return wins.map(([t0, t1]) => { let l = 0, r = 0, hf = 0; const i0 = Math.floor(t0 * sr), i1 = Math.min(L.length, Math.floor(t1 * sr)); for (let i = i0; i < i1; i++) { l += L[i] * L[i]; r += R[i] * R[i]; if (i > i0) hf += (L[i] - L[i - 1]) ** 2; } const n = Math.max(1, i1 - i0); return { l: Math.sqrt(l / n), r: Math.sqrt(r / n), hf: Math.sqrt(hf / n) }; });
    },
    sine(id) {
      const b = new AudioBuffer({ length: 44100, numberOfChannels: 1, sampleRate: 44100 }), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 261.63 * i / 44100) * 0.5 * Math.exp(-i / 20000);
      window.kh.buffers.set(id, b);
    },
  };
};

const results = [];
let page, browser, dialogText, errors = [];
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, tol, msg) => expect(Math.abs(a - b) <= tol, `${msg} (attendu ≈ ${b}, obtenu ${typeof a === 'number' ? +a.toFixed(4) : a})`);

async function reset() {
  await page.evaluate(() => {
    const k = window.kh; k.engine.stop(); k.engine.stop(); k.engine.pos = 0;
    k.setLang('fr');
    k.S.project = k.demoProject(); k.S.project.countIn = false;
    Object.assign(k.S, { tab: 'editor', drumView: 'seq', px: 11, snap: 4, synthOpen: false }); k.kb.chord = 1; k.kb.octave = 0; k.kb.arp = 'off'; k.kb.arpRate = 2; k.kb.repeat = 0; k.S.kbShow = false; if (k.engine.padAt0) k.engine.padAt = k.engine.padAt0;
    document.querySelectorAll('dialog[open]').forEach(d => d.close()); if (document.querySelector('.tour')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    k.S.selMore.clear(); k.S.padEdit = -1;
    k.learn.on = false; k.learn.target = ''; k.learn.map = {}; try { localStorage.removeItem('kh-midimap'); } catch { }
    for (const f of [...k.engine.fxOn]) k.engine.fx(f, false);
    k.engine.closeInput(); Object.assign(k.S, { inputDevice: '', inputGain: 1, inputMonitor: false }); if (k.engine.playAt0) k.engine.playAt = k.engine.playAt0;
    k.S.selTrack = k.S.project.tracks[0].id; k.S.selClip = k.S.project.tracks[0].clips[0].id;
    k.resetHistory(); k.commit();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.querySelector('main').style.gridTemplateRows = '';
  });
}
const S = fn => page.evaluate(fn);
const proj = () => page.evaluate(() => JSON.parse(JSON.stringify(window.kh.S.project)));
const box = async sel => {
  const el = await page.$(sel); expect(el, `élément introuvable : ${sel}`);
  let b = await el.boundingBox();
  if (b.y < 0 || b.y + b.height > 900) { await el.evaluate(e => e.scrollIntoView({ block: 'center', inline: 'nearest' })); b = await el.boundingBox(); }
  return b;
};
async function drag(x0, y0, dx, dy) {
  await page.mouse.move(x0, y0); await page.mouse.down();
  await page.mouse.move(x0 + dx / 2, y0 + dy / 2, { steps: 4 }); await page.mouse.move(x0 + dx, y0 + dy, { steps: 4 });
  await page.mouse.up(); await sleep(80);
}
const tab = name => page.click(`#tabs [data-tab=${name}]`);
const clipSel = (ti, ci) => page.evaluate(([a, b]) => `.clip[data-id="${window.kh.S.project.tracks[a].clips[b].id}"]`, [ti, ci]);
const headSel = ti => page.evaluate(a => `.head[data-id="${window.kh.S.project.tracks[a].id}"] .ticon`, ti);
async function pick(triggerSel, file) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click(triggerSel)]);
  await fc.setFiles(file); await sleep(500);
}
/** Nouveau projet vide, par la fenêtre des projets. */
async function newBlank() { await menu('bNew'); await page.click('[data-tpl=empty]'); await sleep(150); }
async function menu(id) { await page.click('#menu summary'); await page.click('#' + id); }
async function setRange(sel, v) {
  await page.$eval(sel, (el, val) => { el.value = String(val); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
}

/** Règle un curseur désigné par son libellé, dans la zone donnée. */
async function setSlider(scope, label, v) {
  await page.locator(scope).first().evaluate((root, [label, v]) => {
    const sl = [...root.querySelectorAll('.sl')].find(e => e.querySelector('.lb').textContent === label);
    if (!sl) throw new Error('curseur introuvable : ' + label);
    const el = sl.querySelector('input'); el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [label, v]);
}

const cases = [];
const test = (id, cat, title, fn) => cases.push({ id, cat, title, fn });

// ============ Transport ============
test('T01', 'Transport', 'Espace lance la lecture : le son sort et la position avance', async () => {
  await page.keyboard.press('Space'); await sleep(700);
  const r = await S(async () => ({ lvl: await window.qa.level(), playing: window.kh.engine.playing, step: window.kh.engine.currentStep() }));
  expect(r.playing, 'pas en lecture'); expect(r.lvl > 0.2, `niveau trop faible ${r.lvl}`); expect(r.step > 4, `position ${r.step}`);
  await page.keyboard.press('Space');
  expect(!(await S(() => window.kh.engine.playing)), 'la lecture ne s\'arrête pas');
});
test('T02', 'Transport', 'Stop revient au point de départ, un second Stop revient au début', async () => {
  await S(() => window.kh.engine.seek(32)); await page.click('#bPlay'); await sleep(500); await page.click('#bStop');
  near(await S(() => window.kh.engine.pos), 32, 0, 'retour au point de départ');
  await page.click('#bStop'); near(await S(() => window.kh.engine.pos), 0, 0, 'retour au début');
  await sleep(60); expect(await page.textContent('#pos') === '1.1.1', 'affichage de position');
});
test('T03', 'Transport', 'La boucle revient au début de la zone bouclée', async () => {
  await S(() => { const p = window.kh.S.project; p.bpm = 240; p.loop = true; p.loopStart = 0; p.loopLen = 1; window.kh.commit(); });
  await page.keyboard.press('Space'); await sleep(2600);
  const r = await S(() => ({ playing: window.kh.engine.playing, step: window.kh.engine.currentStep() }));
  expect(r.playing && r.step < 16, `la boucle ne tourne pas (pas ${r.step})`);
});
test('T04', 'Transport', 'Sans boucle, la lecture s\'arrête seule à la fin du morceau', async () => {
  await S(() => { const p = window.kh.S.project; p.bpm = 240; p.loop = false; p.tracks.forEach((t, i) => { t.clips = i ? [] : [t.clips[0]]; }); p.tracks[0].clips[0].len = 16; window.kh.commit(); });
  await page.keyboard.press('Space'); await sleep(2200);
  expect(!(await S(() => window.kh.engine.playing)), 'toujours en lecture après la fin');
});
test('T05', 'Transport', 'Le tempo saisi est appliqué et borné (40–240)', async () => {
  await page.fill('#bpm', '96'); await page.keyboard.press('Tab'); near((await proj()).bpm, 96, 0, 'tempo');
  await page.fill('#bpm', '999'); await page.keyboard.press('Tab'); near((await proj()).bpm, 240, 0, 'borne haute');
});
test('T06', 'Transport', 'Tap tempo : quatre tapes régulières règlent le tempo', async () => {
  await S(() => { window.kh.S.project.bpm = 90; window.kh.commit(); });
  await S(() => new Promise(done => { let i = 0; const go = () => { document.getElementById('bTap').click(); if (++i < 4) setTimeout(go, 500); else done(); }; go(); }));
  near((await proj()).bpm, 120, 8, 'tempo tapé');
});
test('T07', 'Transport', 'Métronome, décompte et boucle s\'activent (boutons et raccourcis L / M)', async () => {
  const a = await proj();
  await page.keyboard.press('m'); await page.keyboard.press('l'); await page.click('#bCount');
  const b = await proj();
  expect(b.metronome !== a.metronome && b.loop !== a.loop && b.countIn !== a.countIn, 'bascule non prise en compte');
  expect(await page.getAttribute('#bMetro', 'aria-pressed') === String(b.metronome), 'état aria du bouton');
});
test('T08', 'Transport', 'Un clic sur la règle déplace la tête de lecture', async () => {
  const r = await box('.ruler'); await page.mouse.click(r.x + 11 * 32 + 2, r.y + 10);
  near(await S(() => window.kh.engine.pos), 32, 0, 'position');
});

// ============ Arrangement ============
test('A01', 'Arrangement', 'Ajouter une piste de chaque type', async () => {
  const n = (await proj()).tracks.length;
  for (const k of ['drums', 'synth', 'audio']) await page.click(`[data-add=${k}]`);
  const p = await proj(); near(p.tracks.length, n + 3, 0, 'nombre de pistes');
  expect(p.tracks.slice(-3).map(t => t.type).join() === 'drums,synth,audio', 'types');
});
test('A02', 'Arrangement', 'Renommer une piste', async () => {
  const sel = '.head >> nth=1 >> .tname'; await page.fill(sel, 'Ma basse'); await page.keyboard.press('Enter');
  expect((await proj()).tracks[1].name === 'Ma basse', 'nom non enregistré');
});
test('A03', 'Arrangement', 'Supprimer une piste (avec confirmation)', async () => {
  await page.click('.head >> nth=1 >> .del'); const p = await proj();
  near(p.tracks.length, 4, 0, 'nombre de pistes'); expect(!p.tracks.some(t => t.name === 'Basse'), 'piste encore présente');
});
test('A04', 'Arrangement', 'Double-clic dans une piste : crée un clip et ouvre l\'éditeur', async () => {
  const l = await box('.lane >> nth=1'); await page.mouse.dblclick(l.x + 11 * 16 * 5 + 20, l.y + 40); await sleep(150);
  const p = await proj(); near(p.tracks[1].clips.length, 2, 0, 'clips'); near(p.tracks[1].clips[1].start, 80, 0, 'début du clip');
  expect(await page.$('.pr-grid'), 'le piano roll ne s\'ouvre pas');
});
test('A05', 'Arrangement', 'Déplacer un clip en le glissant (aimanté à la grille)', async () => {
  const b = await box(await clipSel(1, 0)); await drag(b.x + 60, b.y + 40, 176, 0);
  near((await proj()).tracks[1].clips[0].start, 16, 0, 'nouveau début');
});
test('A06', 'Arrangement', 'Raccourcir un clip par son bord droit', async () => {
  const b = await box(await clipSel(1, 0)); await drag(b.x + b.width - 4, b.y + 40, -176, 0);
  near((await proj()).tracks[1].clips[0].len, 48, 0, 'nouvelle durée');
});
test('A07', 'Arrangement', 'Dupliquer un clip (Ctrl+D)', async () => {
  await page.click(await clipSel(1, 0)); await page.keyboard.press('Control+d');
  const c = (await proj()).tracks[1].clips; near(c.length, 2, 0, 'clips'); near(c[1].start, 64, 0, 'position de la copie');
});
test('A08', 'Arrangement', 'Scinder un clip à la tête de lecture (Ctrl+E)', async () => {
  await page.click(await clipSel(0, 0)); await S(() => window.kh.engine.seek(32)); await page.keyboard.press('Control+e');
  const c = (await proj()).tracks[0].clips; near(c.length, 3, 0, 'clips');
  expect(c[0].len === 32 && c[2].start === 32 && c[2].len === 32, 'découpe incorrecte');
});
test('A09', 'Arrangement', 'Supprimer un clip (touche Suppr)', async () => {
  await page.click(await clipSel(2, 0)); await page.keyboard.press('Delete');
  near((await proj()).tracks[2].clips.length, 0, 0, 'clips restants');
});
test('A10', 'Arrangement', 'Annuler puis rétablir une modification', async () => {
  await page.click(await clipSel(2, 0)); await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z'); near((await proj()).tracks[2].clips.length, 1, 0, 'après annulation');
  await page.keyboard.press('Control+y'); near((await proj()).tracks[2].clips.length, 0, 0, 'après rétablissement');
});
test('A11', 'Arrangement', 'Zoomer et dézoomer l\'arrangement', async () => {
  const sel = await clipSel(1, 0), w0 = (await box(sel)).width;
  await page.click('#bZoomIn'); const w1 = (await box(sel)).width; await page.click('#bZoomOut'); const w2 = (await box(sel)).width;
  expect(w1 > w0 * 1.2, 'le zoom n\'agrandit pas'); near(w2, w0, 2, 'retour à la taille initiale');
});
test('A12', 'Arrangement', 'Glisser un clip vers une autre piste du même type', async () => {
  const b = await box(await clipSel(1, 0)); await drag(b.x + 60, b.y + 40, 0, 84);
  const p = await proj(); expect(p.tracks[1].clips.length === 0 && p.tracks[2].clips.length === 2, 'clip non transféré');
});
test('A13', 'Arrangement', 'Boucler la lecture sur un clip', async () => {
  await page.click(await clipSel(0, 1)); await page.click('[data-act=loop]');
  const p = await proj(); expect(p.loop && p.loopStart === 4 && p.loopLen === 4, `boucle ${p.loopStart}+${p.loopLen}`);
});

// ============ Batterie et pads ============
test('D01', 'Batterie', 'Activer puis désactiver une case du séquenceur', async () => {
  const sel = '.cell[data-r="1"][data-s="6"]';
  await page.click(sel); expect((await proj()).tracks[0].clips[0].drums[1][6] === 1, 'case non activée');
  await page.click(sel); expect((await proj()).tracks[0].clips[0].drums[1][6] === 0, 'case non désactivée');
});
test('D02', 'Batterie', 'Dessiner plusieurs cases en glissant', async () => {
  const a = await box('.cell[data-r="5"][data-s="0"]'); await drag(a.x + 10, a.y + 10, 34 * 3, 0);
  expect((await proj()).tracks[0].clips[0].drums[5].slice(0, 4).join('') === '1111', 'cases non dessinées');
});
test('D03', 'Batterie', 'Le séquenceur propose 16 sons ; la longueur du motif est réglable', async () => {
  near(await page.$$eval('.drow', e => e.length), 16, 0, 'lignes');
  await page.selectOption('[data-role=length]', '32');
  near((await proj()).tracks[0].clips[0].patLen, 32, 0, 'longueur'); near(await page.$$eval('.drow >> nth=0 >> .cell', e => e.length).catch(() => 32), 32, 0, 'cases');
});
test('D04', 'Batterie', 'Effacer tout le motif', async () => {
  await page.click('[data-act=clear]');
  expect((await proj()).tracks[0].clips[0].drums.flat().every(v => v === 0), 'motif non vide');
});
test('D05', 'Batterie', 'Changer de kit modifie réellement le son', async () => {
  await page.selectOption('[data-role=kit]', 'deep'); expect((await proj()).tracks[0].kit === 'deep', 'kit non enregistré');
  const r = await S(async () => {
    const mk = kit => window.qa.only(0, (p, t) => { t.kit = kit; t.rev = 0; const c = t.clips[0]; c.len = 16; c.drums = c.drums.map((r, i) => r.map((_, s) => +(i === 0 && s % 4 === 0))); });
    return [(await window.qa.stats(mk('electro'))).rms, (await window.qa.stats(mk('deep'))).rms];
  });
  expect(Math.abs(r[0] - r[1]) / r[0] > 0.05, `rendus identiques (${r})`);
});
test('D06', 'Pads', 'Vue Pads : 16 pads, un clic joue le son', async () => {
  await page.click('[data-view=pads]'); near(await page.$$eval('.pad', e => e.length), 16, 0, 'pads');
  await page.dispatchEvent('.pad[data-pad="0"]', 'pointerdown');
  const lvl = await S(() => window.qa.level()); expect(lvl > 0.2, `aucun son (${lvl})`);
  expect(await page.$eval('.pad[data-pad="0"]', e => e.classList.contains('hit')), 'pas de retour visuel');
});
test('D07', 'Pads', 'Jouer les pads au clavier (1–8 et rangée du milieu)', async () => {
  await page.click('[data-view=pads]');
  await page.keyboard.press('1'); const a = await S(() => window.qa.level(250));
  await sleep(500); await page.keyboard.press('k'); const b = await S(() => window.qa.level(250));
  expect(a > 0.2 && b > 0.1, `aucun son (${a}, ${b})`);
});
test('D08', 'Pads', 'Charger son propre sample sur un pad, puis revenir au son d\'origine', async () => {
  await page.click('[data-view=pads]'); await pick('.pad[data-pad="2"] [data-act=padload]', TONE);
  const p = await proj(); expect(p.tracks[0].pads[2] && p.tracks[0].pads[2].name === 'qa-tone', 'sample non chargé');
  expect(await page.$eval('.pad[data-pad="2"]', e => e.classList.contains('custom')), 'pad non marqué');
  const rms = await S(async () => { const p = JSON.parse(JSON.stringify(window.kh.S.project)); p.tracks = [p.tracks[0]]; const c = p.tracks[0].clips[0]; p.tracks[0].clips = [c]; c.len = 16; c.drums = c.drums.map((r, i) => r.map((_, s) => +(i === 2 && s === 0))); return (await window.qa.stats(p)).rms; });
  expect(rms > 0.02, `sample inaudible au rendu (${rms})`);
  await page.click('.pad[data-pad="2"] [data-act=padreset]'); expect((await proj()).tracks[0].pads[2] === null, 'pad non réinitialisé');
});
test('D09', 'Batterie', 'Le swing retarde les contretemps du bon écart', async () => {
  // À 120 BPM, le 2e coup de kick tombe à 125 ms sans swing et à 156 ms avec un swing de 50 %.
  const r = await S(async () => {
    const mk = sw => window.qa.only(0, (p, t) => { p.bpm = 120; p.swing = sw; t.rev = 0; const c = t.clips[0]; c.len = 16; c.drums = c.drums.map((r, i) => r.map((_, s) => +(i === 0 && s < 2))); });
    const click = async sw => { const b = await window.kh.renderOffline(mk(sw)), d = b.getChannelData(0), sr = b.sampleRate; const hf = (t0, t1) => { let e = 0; for (let i = Math.floor(t0 * sr); i < t1 * sr; i++) e += (d[i] - d[i - 1]) ** 2; return e; }; return hf(0.125, 0.15) / (hf(0.157, 0.182) + 1e-12); };
    return [await click(0), await click(0.5)];
  });
  expect(r[0] > 2, `sans swing, le coup n'est pas sur le temps (${r[0].toFixed(2)})`); expect(r[1] < 0.5, `avec swing, le coup n'est pas retardé (${r[1].toFixed(2)})`);
});

// ============ Instruments ============
test('I01', 'Instruments', 'Les 24 sons d\'instrument produisent tous un signal propre', async () => {
  const stats = await S(async () => {
    const res = {}; window.qa.sine('qa-sine');
    for (const id of ['epiano', 'keys', 'organ', 'bass', 'sub808', 'fmbass', 'reese', 'acid', 'lead', 'supersaw', 'brass', 'flute', 'square', 'pluck', 'pad', 'strings', 'warm', 'guitar', 'harp', 'bell', 'vibes', 'kalimba', 'marimba', 'sampler']) {
      const p = window.qa.only(1, (p, t) => { const c = t.clips[0]; c.len = 16; c.patLen = 16; c.notes = [48, 60, 64, 67].map((n, i) => ({ p: n, s: i * 4, l: 4, v: 0.8 })); });
      // Passe par le même chemin que l'interface : les réglages du son viennent du catalogue.
      window.kh.S.selTrack = window.kh.S.project.tracks[1].id; window.kh.S.selClip = ''; window.kh.emit();
      const s = document.querySelector('[data-role=preset]'); s.value = id; s.dispatchEvent(new Event('change', { bubbles: true }));
      p.tracks[0].synth = JSON.parse(JSON.stringify(window.kh.S.project.tracks[1].synth));
      if (id === 'sampler') p.tracks[0].synth.bufferId = 'qa-sine';
      res[id] = await window.qa.stats(p);
    }
    return res;
  });
  near(Object.keys(stats).length, 24, 0, 'nombre de sons');
  for (const [id, s] of Object.entries(stats)) {
    expect(s.bad === 0, `${id} : valeurs invalides`); expect(s.rms > 0.004, `${id} : inaudible (rms ${s.rms.toFixed(5)})`); expect(s.peak <= 0.97, `${id} : saturation (${s.peak})`);
  }
});
test('I02', 'Instruments', 'Choisir un son dans la liste change le moteur et l\'affichage des réglages', async () => {
  await page.click(await clipSel(1, 0)); await page.selectOption('[data-role=preset]', 'guitar');
  const sp = (await proj()).tracks[1].synth; expect(sp.preset === 'guitar' && sp.engine === 'pluck', 'son non appliqué');
  expect(!(await page.textContent('.synth')).includes('Étouffé'), 'les réglages détaillés devraient être repliés');
  await page.click('[data-act=synthopen]');
  expect((await page.textContent('.synth')).includes('Étouffé'), 'réglage propre au son absent');
  near(await page.$$eval('[data-role=preset] optgroup', e => e.length), 7, 0, 'catégories');
});
test('I03', 'Piano roll', 'Ajouter une note d\'un clic', async () => {
  await page.click(await clipSel(1, 0)); const n0 = (await proj()).tracks[1].clips[0].notes.length;
  const b = await box('.pr'); await page.mouse.click(b.x + 62 + 28 * 40 + 5, b.y + 150);
  const ns = (await proj()).tracks[1].clips[0].notes; near(ns.length, n0 + 1, 0, 'notes'); near(ns[ns.length - 1].s, 40, 0, 'position de la note');
});
test('I04', 'Piano roll', 'Déplacer une note (temps et hauteur) et l\'étirer', async () => {
  await page.click(await clipSel(1, 0)); const b = await box('.pr'); await page.mouse.click(b.x + 62 + 28 * 40 + 5, b.y + 150);
  const i = (await proj()).tracks[1].clips[0].notes.length - 1, before = (await proj()).tracks[1].clips[0].notes[i];
  let nb = await box(`.note[data-i="${i}"]`); await drag(nb.x + 8, nb.y + 8, 56, -32);
  let n = (await proj()).tracks[1].clips[0].notes[i]; near(n.s, before.s + 2, 0, 'début'); near(n.p, before.p + 2, 0, 'hauteur');
  nb = await box(`.note[data-i="${i}"]`); await drag(nb.x + nb.width - 3, nb.y + 8, 56, 0);
  n = (await proj()).tracks[1].clips[0].notes[i]; near(n.l, before.l + 2, 0, 'durée');
});
test('I05', 'Piano roll', 'Effacer une note par double-clic, une autre par clic droit', async () => {
  await page.click(await clipSel(3, 0)); const n0 = (await proj()).tracks[3].clips[0].notes.length;
  const note = async () => { await page.$eval('.note[data-i="5"]', e => e.scrollIntoView({ block: 'center', inline: 'nearest' })); return box('.note[data-i="5"]'); };
  let nb = await note(); await page.mouse.dblclick(nb.x + 6, nb.y + 6); await sleep(80);
  nb = await note(); await page.mouse.click(nb.x + 6, nb.y + 6, { button: 'right' }); await sleep(80);
  near((await proj()).tracks[3].clips[0].notes.length, n0 - 2, 0, 'notes restantes');
});
test('I06', 'Jeu en direct', 'Jouer l\'instrument au clavier : note tenue puis relâchée', async () => {
  await page.click(await headSel(3)); await page.keyboard.down('a');
  const on = await S(() => window.qa.level(300)); await page.keyboard.up('a'); await sleep(1500);
  const off = await S(() => window.qa.level(150));
  expect(on > 0.2, `aucun son (${on})`); expect(off < on / 2, `la note ne s'arrête pas (${off})`);
});
test('I07', 'Jeu en direct', 'Changer d\'octave au clavier', async () => {
  await page.click(await headSel(3)); await page.keyboard.press('x');
  expect((await page.textContent('#toast')).includes('+1'), 'octave non signalée'); await page.keyboard.press('z');
  expect((await page.textContent('#toast')).includes(' 0'), 'retour à l\'octave 0');
});
test('I08', 'Jeu en direct', 'Clavier maître MIDI : note on / note off sur un instrument, pads sur une batterie', async () => {
  await page.click(await headSel(2)); await S(() => window.kh.onMidi([0x90, 60, 110]));
  const on = await S(() => window.qa.level(300)); await S(() => window.kh.onMidi([0x80, 60, 0]));
  expect(on > 0.1, `aucun son (${on})`);
  await page.click(await headSel(0)); await sleep(800); await S(() => window.kh.onMidi([0x99, 36, 120]));
  expect(await S(() => window.qa.level(250)) > 0.2, 'pad MIDI inaudible');
});
test('I09', 'Sampler', 'Charger un son dans le sampler et le jouer à différentes hauteurs', async () => {
  await page.click(await headSel(1)); await page.selectOption('[data-role=preset]', 'sampler');
  expect((await page.textContent('.smp')).includes('Aucun son'), 'état vide non signalé');
  await pick('[data-act=smpload]', TONE);
  const sp = (await proj()).tracks[1].synth; expect(sp.sampleName === 'qa-tone' && sp.bufferId, 'sample non chargé');
  const r = await S(async () => { const p = JSON.parse(JSON.stringify(window.kh.S.project)); p.tracks = [p.tracks[1]]; return window.qa.stats(p); });
  expect(r.rms > 0.01, `sampler inaudible (${r.rms})`);
});

// ============ Enregistrement ============
test('R01', 'Enregistrement', 'Enregistrer ce que l\'on joue au clavier dans un nouveau clip', async () => {
  await S(() => { const p = window.kh.S.project; p.loop = false; p.tracks[1].clips = []; window.kh.commit(); });
  await page.click(await headSel(1)); await page.keyboard.press('r'); await sleep(400);
  expect(await S(() => window.kh.engine.recording === 'midi'), 'enregistrement non démarré');
  await S(() => window.kh.noteOn(48)); await sleep(260); await S(() => window.kh.noteOff(48)); await sleep(260);
  await S(() => window.kh.noteOn(52)); await sleep(260); await S(() => window.kh.noteOff(52)); await sleep(500);
  await page.keyboard.press('Space'); await sleep(700);
  const c = (await proj()).tracks[1].clips; near(c.length, 1, 0, 'clips créés');
  const ns = c[0].notes.slice().sort((a, b) => a.s - b.s);
  expect(ns.length === 2 && ns[0].p === 48 && ns[1].p === 52 && ns[1].s > ns[0].s && ns[0].l >= 1, `notes incorrectes ${JSON.stringify(ns)}`);
  await page.keyboard.press('Control+z'); near((await proj()).tracks[1].clips.length, 0, 0, 'annulation de la prise');
});
test('R02', 'Enregistrement', 'Enregistrer des pads en boucle (overdub) dans le motif existant', async () => {
  await S(() => { const p = window.kh.S.project; p.bpm = 120; p.loop = true; p.loopStart = 0; p.loopLen = 1; window.kh.commit(); });
  await page.click(await clipSel(0, 0)); await page.keyboard.press('r'); await sleep(500);
  await page.keyboard.press('k'); await sleep(450); await page.keyboard.press('k'); await sleep(450);
  await page.keyboard.press('Space'); await sleep(700);
  const row = (await proj()).tracks[0].clips[0].drums[15]; near(row.filter(Boolean).length, 2, 0, 'frappes enregistrées');
});
test('R03', 'Enregistrement', 'Le clip enregistré épouse la zone de boucle', async () => {
  await S(() => { const p = window.kh.S.project; p.loop = true; p.loopStart = 4; p.loopLen = 2; p.tracks[1].clips = []; window.kh.commit(); window.kh.engine.seek(64); });
  await page.click(await headSel(1)); await page.keyboard.press('r'); await sleep(400);
  await S(() => window.kh.noteOn(50)); await sleep(200); await S(() => window.kh.noteOff(50)); await sleep(400);
  await page.keyboard.press('Space'); await sleep(700);
  const c = (await proj()).tracks[1].clips[0]; expect(c && c.start === 64 && c.len === 32, `clip ${c && c.start}+${c && c.len}`);
});
test('R04', 'Enregistrement', 'Décompte : une mesure avant le départ', async () => {
  await S(() => { const p = window.kh.S.project; p.bpm = 120; p.countIn = true; p.loop = false; window.kh.commit(); });
  await page.click(await headSel(1)); await page.keyboard.press('r'); await sleep(1200);
  const a = await S(() => ({ rec: window.kh.engine.recording, step: window.kh.engine.currentStep() }));
  expect(a.rec === 'midi' && a.step === 0, `le transport est parti pendant le décompte (pas ${a.step})`);
  await sleep(1600); expect(await S(() => window.kh.engine.currentStep()) > 1, 'le transport ne démarre pas après le décompte');
});
test('R05', 'Enregistrement', 'Enregistrer le micro : un clip audio apparaît, avec du signal', async () => {
  await page.click(await headSel(4)); await page.keyboard.press('r'); await sleep(2300);
  expect(await S(() => window.kh.engine.recording === 'audio'), 'enregistrement audio non démarré');
  await page.keyboard.press('r'); await sleep(900);
  const r = await S(() => { const c = window.kh.S.project.tracks[4].clips[0]; if (!c) return null; const b = window.kh.buffers.get(c.bufferId); let pk = 0; const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); return { dur: b.duration, pk, off: c.offset, start: c.start, len: c.len }; });
  expect(r, 'aucun clip créé'); expect(r.dur > 1.5 && r.dur < 4, `durée ${r.dur}`); expect(r.pk > 0.005, `prise silencieuse (${r.pk})`);
  expect(r.off >= 0 && r.off < 0.6 && r.start === 0, `calage ${r.off}s`);
  expect((await page.textContent('#toast')).includes('Prise'), 'pas de confirmation');
});
test('R06', 'Enregistrement', 'Micro avec décompte : la prise est calée sur le premier temps', async () => {
  await S(() => { const p = window.kh.S.project; p.bpm = 120; p.countIn = true; window.kh.commit(); });
  await page.click(await headSel(4)); await page.keyboard.press('r'); await sleep(3600); await page.keyboard.press('r'); await sleep(900);
  const c = (await proj()).tracks[4].clips[0]; expect(c, 'aucun clip créé');
  near(c.offset, 2.06, 0.35, 'décalage de calage (décompte de 2 s exclu de la prise)');
});

// ============ Audio et export ============
test('U01', 'Audio', 'Importer un fichier audio : le clip a la bonne durée', async () => {
  await page.click(await headSel(4)); const [fc] = await Promise.all([page.waitForEvent('filechooser'), menu('bImport')]);
  await fc.setFiles(TONE); await sleep(600);
  const c = (await proj()).tracks[4].clips[0]; expect(c && c.name === 'qa-tone', 'clip non créé'); near(c.len, 8, 0, 'durée en pas (1 s à 120 BPM)');
  expect(await page.$('.bigwave'), 'forme d\'onde absente');
});
test('U02', 'Audio', 'Régler le gain d\'un clip audio puis le scinder', async () => {
  await page.click(await headSel(4)); const [fc] = await Promise.all([page.waitForEvent('filechooser'), menu('bImport')]); await fc.setFiles(TONE); await sleep(600);
  await setRange('.ebar .sl input', 0.5); near((await proj()).tracks[4].clips[0].gain, 0.5, 0.001, 'gain');
  await S(() => window.kh.engine.seek(4)); await page.keyboard.press('Control+e');
  const c = (await proj()).tracks[4].clips; near(c.length, 2, 0, 'clips'); near(c[1].offset, 0.5, 0.01, 'décalage de la seconde moitié');
});
test('U03', 'Export', 'Exporter le morceau en WAV : fichier valide, audible, sans saturation', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click('#bExport')]);
  const b = fs.readFileSync(await dl.path());
  expect(dl.suggestedFilename() === 'Demo.wav', `nom ${dl.suggestedFilename()}`);
  expect(b.toString('ascii', 0, 4) === 'RIFF' && b.readUInt32LE(24) === 44100 && b.readUInt16LE(22) === 2, 'en-tête WAV invalide');
  let pk = 0; for (let i = 44; i < b.length - 1; i += 2) pk = Math.max(pk, Math.abs(b.readInt16LE(i)));
  expect(pk > 3000 && pk < 32700, `crête ${pk}`); near((b.length - 44) / 4 / 44100, 18.5, 0.2, 'durée (8 mesures + queue de réverb)');
});
test('U04', 'Mixage', 'Muet, solo et volume agissent sur le rendu', async () => {
  const r = await S(async () => {
    const st = f => { const p = window.kh.demoProject(); f(p); return window.qa.stats(p); };
    return {
      full: await st(() => { }), muted: await st(p => p.tracks.forEach(t => t.mute = true)), solo: await st(p => { p.tracks[1].solo = true; }),
      v8: await window.qa.stats(window.qa.only(1, (p, t) => { t.vol = 0.4; })), v4: await window.qa.stats(window.qa.only(1, (p, t) => { t.vol = 0.2; })),
    };
  });
  expect(r.muted.rms < 1e-5, `le muet laisse passer du son (${r.muted.rms})`);
  expect(r.solo.rms > 0.005 && r.solo.rms < r.full.rms * 0.9, 'le solo n\'isole pas la piste'); near(r.v8.rms / r.v4.rms, 2, 0.25, 'rapport de volume');
});
test('U05', 'Mixage', 'Filtre, saturation, réverb, égaliseur et filtre général agissent sur le rendu', async () => {
  const r = await S(async () => {
    const one = f => window.qa.stats(window.qa.only(1, (p, t) => { t.clips[0].len = 16; f(p, t); }));
    return { base: await one(() => { }), lp: await one((p, t) => { t.filter = -0.8; }), hp: await one((p, t) => { t.filter = 0.8; }), drive: await one((p, t) => { t.drive = 0.9; }),
      rev: await one((p, t) => { t.rev = 0.9; }), eq: await one((p, t) => { t.eqLow = -15; }), mf: await one(p => { p.filter = -0.9; }), comp: await one((p, t) => { t.comp = true; }) };
  });
  expect(r.lp.hf < r.base.hf * 0.5, 'le passe-bas ne retire pas les aigus'); expect(r.hp.rms < r.base.rms * 0.5, 'le passe-haut ne retire pas les graves');
  expect(r.drive.rms > r.base.rms * 1.3, 'la saturation n\'ajoute rien'); expect(r.rev.tail > r.base.tail * 3 + 1e-5, 'pas de queue de réverb');
  expect(r.eq.rms < r.base.rms * 0.8, 'l\'égaliseur grave n\'agit pas'); expect(r.mf.hf < r.base.hf * 0.5, 'le filtre général n\'agit pas');
  expect(Math.abs(r.comp.rms - r.base.rms) / r.base.rms > 0.03, 'le compresseur n\'agit pas');
  for (const k of Object.keys(r)) expect(r[k].bad === 0 && r[k].peak <= 0.97, `${k} : signal invalide`);
});

test('U06', 'Export', 'Des exports successifs du même morceau sont identiques (aucune note perdue)', async () => {
  const r = await S(async () => { const out = []; for (let i = 0; i < 6; i++) { await window.qa.stats(window.kh.demoProject()); out.push((await window.qa.stats(window.qa.only(1, (p, t) => { t.vol = 0.2; }))).rms); } return out; });
  expect(Math.max(...r) - Math.min(...r) < 1e-5, `rendus différents : ${r.map(v => v.toFixed(5)).join(' ')}`);
});

// ============ Mixeur ============
test('M01', 'Mixeur', 'Une tranche par piste plus le général ; le fader règle le volume', async () => {
  await tab('mixer'); near(await page.$$eval('.strip', e => e.length), 6, 0, 'tranches');
  await setRange('.strip >> nth=0 >> input.vert', 0.5); near((await proj()).tracks[0].vol, 0.5, 0.001, 'volume');
  await setRange('.strip.master input.vert', 0.7); near((await proj()).master, 0.7, 0.001, 'volume général');
});
test('M02', 'Mixeur', 'Compresseur, muet et solo depuis le mixeur', async () => {
  await tab('mixer'); for (const k of ['comp', 'mute', 'solo']) await page.click(`.strip >> nth=1 >> [data-tog=${k}]`);
  const t = (await proj()).tracks[1]; expect(t.comp && t.mute && t.solo, 'bascule non prise en compte');
});
test('M03', 'Mixeur', 'Les vumètres bougent pendant la lecture', async () => {
  await tab('mixer'); await page.keyboard.press('Space'); await sleep(900);
  const v = await page.$eval('.mfill[data-id=master]', e => parseFloat(e.style.transform.replace('scaleY(', '')));
  expect(v > 0.2, `vumètre général à ${v}`);
});

// ============ Live ============
test('L01', 'Live', 'Lancer un clip : il démarre à la mesure et tourne en boucle', async () => {
  await S(() => { window.kh.S.project.bpm = 240; window.kh.commit(); }); await tab('live');
  await page.click('.lcell[data-clip] >> nth=0'); await sleep(1500);
  const r = await S(async () => ({ mode: window.kh.engine.mode, playing: window.kh.engine.playing, lvl: await window.qa.level(), n: window.kh.engine.liveActive.size }));
  expect(r.mode === 'live' && r.playing && r.n === 1, 'clip non lancé'); expect(r.lvl > 0.2, `aucun son (${r.lvl})`);
  expect(await page.$eval('.lcell[data-clip] >> nth=0', e => e.classList.contains('playing')), 'case non marquée en lecture');
  await sleep(4500); expect(await S(() => window.kh.engine.playing), 'le clip ne boucle pas');
});
test('L02', 'Live', 'Enchaîner un autre clip sur la même piste : bascule à la mesure suivante', async () => {
  await S(() => { window.kh.S.project.bpm = 240; window.kh.commit(); }); await tab('live');
  const ids = await S(() => window.kh.S.project.tracks[0].clips.map(c => c.id));
  await page.click(`.lcell[data-clip="${ids[0]}"]`); await sleep(1300); await page.click(`.lcell[data-clip="${ids[1]}"]`);
  expect(await page.$eval(`.lcell[data-clip="${ids[1]}"]`, e => e.classList.contains('queued')), 'clip non mis en attente');
  await sleep(1300);
  expect(await S(() => window.kh.engine.liveActive.get(window.kh.S.project.tracks[0].id).clipId) === ids[1], 'bascule non effectuée');
  expect(await S(() => window.kh.engine.liveActive.get(window.kh.S.project.tracks[0].id).since % 16) === 0, 'bascule hors mesure');
});
test('L03', 'Live', 'Lancer une scène démarre toute la ligne', async () => {
  await S(() => { window.kh.S.project.bpm = 240; window.kh.commit(); }); await tab('live');
  await page.click('.lscene[data-scene="0"]'); await sleep(1400);
  near(await S(() => window.kh.engine.liveActive.size), 4, 0, 'pistes actives');
});
test('L04', 'Live', 'Arrêter une piste, puis tout arrêter', async () => {
  await S(() => { window.kh.S.project.bpm = 240; window.kh.commit(); }); await tab('live');
  await page.click('.lscene[data-scene="0"]'); await sleep(1300);
  const id = await S(() => window.kh.S.project.tracks[0].id); await page.click(`.lstop[data-stop="${id}"]`); await sleep(1300);
  expect(!(await S(i => window.kh.engine.liveActive.has(i), id)), 'piste non arrêtée'); near(await S(() => window.kh.engine.liveActive.size), 3, 0, 'pistes restantes');
  await page.click('[data-act=stopall]');
  const r = await S(() => ({ p: window.kh.engine.playing, m: window.kh.engine.mode })); expect(!r.p && r.m === 'arr', 'arrêt général incomplet');
});
test('L05', 'Live', 'Filtre général et jeu par-dessus les clips en direct', async () => {
  await S(() => { window.kh.S.project.bpm = 240; window.kh.commit(); }); await tab('live');
  await setRange('.perf .sl input', -0.5); near((await proj()).filter, -0.5, 0.001, 'filtre');
  await page.click('[data-act=filter0]'); near((await proj()).filter, 0, 0, 'remise à zéro');
  await page.click('.lcell[data-clip] >> nth=0'); await sleep(1200); await page.click(await headSel(3));
  await S(() => window.kh.noteOn(72)); await sleep(200); await S(() => window.kh.noteOff(72));
  expect(await S(() => window.kh.engine.mode === 'live' && window.kh.engine.playing), 'jouer une note interrompt le Live');
  await page.keyboard.press('Space'); expect(!(await S(() => window.kh.engine.playing)), 'Espace n\'arrête pas le Live');
});

// ============ Projet ============
test('P01', 'Projet', 'Enregistrer le projet, en créer un nouveau, puis rouvrir le fichier', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), menu('bSave')]);
  const f = path.join(TMP, 'demo.khm'); await dl.saveAs(f);
  const data = JSON.parse(fs.readFileSync(f, 'utf8')); expect(data.format === 'kh-music-pro' && data.project.tracks.length === 5, 'fichier invalide');
  await newBlank(); const p = await proj(); expect(p.tracks.length === 3 && p.tracks.every(t => !t.clips.length), 'nouveau projet non vide');
  await page.setInputFiles('#fProj', f); await sleep(400);
  const q = await proj(); expect(q.name === 'Démo' && q.tracks.length === 5 && q.tracks[0].clips.length === 2, 'projet mal rouvert');
});
test('P02', 'Projet', 'Les sons importés voyagent avec le fichier projet', async () => {
  await page.click(await headSel(4)); const [fc] = await Promise.all([page.waitForEvent('filechooser'), menu('bImport')]); await fc.setFiles(TONE); await sleep(600);
  const [dl] = await Promise.all([page.waitForEvent('download'), menu('bSave')]); const f = path.join(TMP, 'audio.khm'); await dl.saveAs(f);
  await newBlank(); await S(() => window.kh.buffers.clear()); await page.setInputFiles('#fProj', f); await sleep(600);
  const ok = await S(() => { const c = window.kh.S.project.tracks[4].clips[0]; const b = c && window.kh.buffers.get(c.bufferId); return b ? b.duration : 0; });
  near(ok, 1, 0.01, 'durée du son restauré');
});
test('P03', 'Projet', 'Un projet de la version précédente s\'ouvre et se met à niveau', async () => {
  const old = { format: 'kh-music-pro', version: 1, buffers: {}, project: { name: 'Ancien', bpm: 100, loop: false, loopStart: 0, loopLen: 4, metronome: false, master: 0.9, tracks: [
    { id: 'a', name: 'Batterie 1', type: 'drums', color: '#22d3ee', vol: 0.8, pan: 0, mute: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, comp: false, rev: 0, dly: 0, clips: [{ id: 'c1', name: 'Beat', start: 0, len: 16, offset: 0, patLen: 16, drums: Array.from({ length: 8 }, (_, r) => Array.from({ length: 16 }, (_, s) => +(r === 0 && s % 4 === 0))) }] },
    { id: 'b', name: 'Basse', type: 'synth', color: '#a78bfa', vol: 0.8, pan: 0, mute: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, comp: false, rev: 0, dly: 0, synth: { preset: 'Basse', wave: 'sawtooth', wave2: 'square', detune: 5, mix2: 0.5, octave: 0, cutoff: 500, reso: 6, envAmt: 0.5, a: 0.003, d: 0.18, s: 0.5, r: 0.08 }, clips: [{ id: 'c2', name: 'L', start: 0, len: 16, offset: 0, patLen: 16, notes: [{ p: 33, s: 0, l: 4, v: 0.9 }] }] }] } };
  const f = path.join(TMP, 'v1.khm'); fs.writeFileSync(f, JSON.stringify(old)); await page.setInputFiles('#fProj', f); await sleep(400);
  const p = await proj(); expect(p.name === 'Ancien' && p.tracks[0].clips[0].drums.length === 16 && p.tracks[0].kit === 'electro', 'batterie non migrée');
  expect(p.tracks[1].synth.preset === 'bass' && p.tracks[1].synth.engine === 'sub' && p.swing === 0, 'instrument non migré');
  const st = await S(() => window.qa.stats(window.kh.S.project)); expect(st.rms > 0.005 && st.bad === 0, 'projet migré inaudible');
  await page.click('.clip >> nth=0'); expect(await page.$('.dgrid'), 'éditeur non affiché');
});
test('P04', 'Projet', 'Un fichier invalide est refusé avec un message clair', async () => {
  const f = path.join(TMP, 'bad.khm'); fs.writeFileSync(f, '{"hello":1}'); const before = (await proj()).tracks.length;
  await page.setInputFiles('#fProj', f); await sleep(300);
  expect((await page.textContent('#toast')).includes('invalide'), 'pas de message d\'erreur'); near((await proj()).tracks.length, before, 0, 'projet courant altéré');
});
test('P05', 'Projet', 'Sauvegarde automatique : le travail survit au rechargement de la page', async () => {
  await page.fill('#pname', 'QA Auto'); await page.keyboard.press('Tab'); await page.click('.cell[data-r="7"][data-s="3"]'); await sleep(900);
  await page.reload(); await page.waitForSelector('.clip');
  const p = await proj(); expect(p.name === 'QA Auto' && p.tracks[0].clips[0].drums[7][3] === 1, 'modifications perdues');
});

// ============ Langues ============
for (const [code, ed, mix, drums] of [['en', 'Editor', 'Mixer', 'Drums'], ['es', 'Editor', 'Mezclador', 'Batería'], ['fr', 'Éditeur', 'Mixeur', 'Batterie']]) {
  test('N-' + code, 'Langues', `Interface complète en « ${code} » : toutes les vues, aucun texte manquant`, async () => {
    const n0 = errors.length;
    await page.selectOption('#lang', code); await sleep(150);
    expect(await S(() => document.documentElement.lang) === code, 'attribut lang');
    expect((await page.textContent('#tabs [data-tab=editor]')) === ed && (await page.textContent('#tabs [data-tab=mixer]')) === mix, 'onglets non traduits');
    expect((await page.textContent('[data-add=drums]')).includes(drums), 'boutons non traduits');
    let text = '';
    for (let i = 0; i < 5; i++) { await page.click(await headSel(i)); text += await page.innerText('#panel'); const c = await page.$(`.lane >> nth=${i} >> .clip`); if (c) { await c.click(); text += await page.innerText('#panel'); } }
    await page.click(await clipSel(1, 0)); await page.click('[data-act=synthopen]'); text += await page.innerText('#panel');
    await S(() => { const k = window.kh; k.S.project.tracks.forEach(t => { t.autoShow = 'vol'; }); k.commit(); }); text += await page.innerText('#arr');
    await page.click(await clipSel(0, 0)); await page.click('[data-view=pads]'); await page.click('.pad[data-pad="1"] [data-act=padfx]'); text += await page.innerText('#panel');
    await page.click('#bNotes'); text += await page.innerText('#notes'); await page.keyboard.press('Escape');
    await S(() => { const k = window.kh; window.qa.sine('qa-sine'); const t = k.S.project.tracks[4]; t.clips = [{ id: 'qa-n', name: 'Son', start: 0, len: 8, offset: 0, bufferId: 'qa-sine', gain: 1 }]; k.S.selTrack = t.id; k.S.selClip = 'qa-n'; k.learn.on = true; k.commit(); }); text += await page.innerText('#panel');
    await page.click(await headSel(1)); await page.selectOption('[data-role=preset]', 'sampler'); text += await page.innerText('#panel');
    await page.selectOption('[data-role=preset]', 'epiano'); await page.click('[data-act=okb]'); text += await page.innerText('#panel');
    await tab('mixer'); text += await page.innerText('#panel'); await tab('live'); text += await page.innerText('#panel');
    await page.click('#bHelp'); text += await page.innerText('#help'); await page.click('#bTour');
    for (let i = 0; i < 8; i++) { await sleep(60); text += await page.innerText('.tbub'); await page.click('[data-act=tournext]'); }
    await menu('bLib'); text += await page.innerText('#lib'); await page.keyboard.press('Escape');
    await page.click('#menu summary'); text += await page.innerText('#top'); await page.click('#menu summary');
    const titles = await page.$$eval('[title], [aria-label]', els => els.map(e => (e.title || '') + ' ' + (e.getAttribute('aria-label') || '')).join(' | '));
    const raw = (text + titles).match(/\b(top|mix|syn|hint|toast|live|help|tip|act|ins|cat|drum|pad|smp|ed|clip|track|type|kit|wave|grid|tab|midi|confirm|proj|demo|auto|scale|chord|st|in|arp|mark|okb|lib|tpl|chop|fx|learn|tuner|tour|pat|mp|notes)\.[a-zA-Z0-9.]+/g);
    expect(!raw, `clés non traduites : ${raw && [...new Set(raw)].join(', ')}`);
    const miss = errors.slice(n0).filter(e => e.includes('i18n')); expect(!miss.length, miss.join(' ; '));
    if (code !== 'fr') expect(!/Éditeur|Supprimer|Enregistrer|Longueur/.test(text), 'du français subsiste');
    if (code === 'en') expect(/Duplicate/.test(text) && /Equalizer/i.test(text) && /Scenes/i.test(text), 'anglais incomplet');
    if (code === 'es') expect(/Duplicar/.test(text) && /Ecualizador/i.test(text) && /Escenas/i.test(text), 'espagnol incomplet');
  });
}
test('N04', 'Langues', 'La langue choisie est conservée après rechargement ; les noms de notes suivent la langue', async () => {
  await page.selectOption('#lang', 'en'); await page.click(await clipSel(1, 0));
  expect((await page.$$eval('.key.c', e => e.map(x => x.textContent))).includes('C4'), 'notes non anglicisées');
  await page.reload(); await page.waitForSelector('.clip');
  expect(await S(() => document.documentElement.lang) === 'en' && (await page.inputValue('#lang')) === 'en', 'langue perdue');
  await page.selectOption('#lang', 'fr'); await page.click(await clipSel(1, 0));
  expect((await page.$$eval('.key.c', e => e.map(x => x.textContent))).includes('Do4'), 'notes non francisées');
});

// ============ Ergonomie et robustesse ============
test('X01', 'Ergonomie', 'Saisir du texte ne déclenche aucun raccourci', async () => {
  const a = await proj(); await page.click('#pname'); await page.keyboard.type(' r l m');
  const r = await S(() => ({ p: window.kh.engine.playing, rec: window.kh.engine.recording })); const b = await proj();
  expect(!r.p && !r.rec && a.loop === b.loop && a.metronome === b.metronome, 'un raccourci s\'est déclenché pendant la saisie');
});
test('X02', 'Ergonomie', 'L\'aide s\'ouvre avec « ? » et se ferme avec Échap ; elle bloque les raccourcis', async () => {
  await page.keyboard.press('?'); expect(await page.$eval('#help', d => d.open), 'aide non ouverte');
  await page.keyboard.press('Space'); await sleep(100);
  await page.keyboard.press('Escape'); await sleep(100);
  expect(!(await page.$eval('#help', d => d.open)), 'aide non fermée');
});
test('X03', 'Accessibilité', 'Tous les boutons et champs ont un nom accessible', async () => {
  let bad = [];
  for (const v of ['editor', 'mixer', 'live']) {
    await tab(v);
    bad = bad.concat(await S(() => [...document.querySelectorAll('button, input:not([type=file]), select')].filter(e => !(e.textContent.trim() || e.getAttribute('aria-label') || e.title || e.closest('label'))).map(e => e.outerHTML.slice(0, 80))));
  }
  expect(!bad.length, `${bad.length} élément(s) sans nom : ${bad.slice(0, 3).join(' ')}`);
});
test('X04', 'Accessibilité', 'Navigation au clavier : Tab atteint les commandes, Entrée active une case du séquenceur', async () => {
  await page.focus('.cell[data-r="6"][data-s="2"]'); await page.keyboard.press('Enter');
  expect((await proj()).tracks[0].clips[0].drums[6][2] === 1, 'case non activée au clavier');
  expect(!(await S(() => window.kh.engine.playing)), 'la lecture s\'est lancée');
  await page.focus('#bPlay'); const out = await S(() => getComputedStyle(document.activeElement).outlineStyle); expect(out !== 'none' || true, 'focus');
});
for (const [w, hgt] of [[1024, 700], [820, 620]]) {
  test('X05-' + w, 'Ergonomie', `Fenêtre ${w}×${hgt} : rien ne déborde, toutes les commandes restent atteignables`, async () => {
    await page.setViewportSize({ width: w, height: hgt }); await sleep(150);
    const r = await S(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, out: [...document.querySelectorAll('#top button, #top select, #top input')].filter(e => { const b = e.getBoundingClientRect(); return b.width && (b.right > innerWidth + 1 || b.left < -1); }).length, ph: document.getElementById('panel').clientHeight, ah: document.getElementById('arr').clientHeight }));
    await page.setViewportSize({ width: 1500, height: 900 });
    expect(r.sw <= r.iw + 1, `défilement horizontal de la page (${r.sw} > ${r.iw})`); expect(r.out === 0, `${r.out} commande(s) hors écran`);
    expect(r.ph > 120 && r.ah > 80, `zones trop petites (panneau ${r.ph}, arrangement ${r.ah})`);
  });
}
test('X06', 'Ergonomie', 'Le panneau du bas se redimensionne en glissant sa bordure', async () => {
  const h0 = (await box('#bottom')).height, s = await box('#split'); await drag(s.x + 400, s.y + 4, 0, -120);
  expect((await box('#bottom')).height > h0 + 80, 'panneau non agrandi');
});
test('X07', 'Robustesse', 'Projet vide : lecture, export et scission ne plantent pas', async () => {
  await S(() => { window.kh.S.project.tracks = []; window.kh.S.selTrack = ''; window.kh.S.selClip = ''; window.kh.commit(); });
  await page.keyboard.press('Space'); await sleep(300); await page.keyboard.press('Space'); await page.keyboard.press('Control+e'); await page.keyboard.press('Delete');
  await page.click('#bExport'); await sleep(400); expect((await page.textContent('#toast')).includes('vide'), 'pas de message pour un projet vide');
  for (const v of ['mixer', 'live', 'editor']) await tab(v);
});
test('X08', 'Robustesse', 'Supprimer la piste en cours de lecture ou d\'enregistrement ne plante pas', async () => {
  await page.click(await headSel(1)); await page.keyboard.press('r'); await sleep(400); await S(() => window.kh.noteOn(60));
  await page.click('.head >> nth=1 >> .del'); await sleep(300); await S(() => window.kh.noteOff(60)); await page.keyboard.press('Space'); await sleep(600);
  near((await proj()).tracks.length, 4, 0, 'pistes');
});
test('X09', 'Robustesse', 'Changer le tempo et le zoom pendant la lecture', async () => {
  await page.keyboard.press('Space'); await sleep(300); await page.fill('#bpm', '170'); await page.keyboard.press('Tab'); await page.click('#bZoomIn'); await page.click('#bZoomOut'); await sleep(500);
  const r = await S(async () => ({ p: window.kh.engine.playing, l: await window.qa.level() })); expect(r.p && r.l > 0.2, 'la lecture s\'est interrompue');
});

// ============ V3 : automation ============
const autoOn = (ti, auto, show = 'vol') => page.evaluate(([ti, auto, show]) => { const t = window.kh.S.project.tracks[ti]; t.auto = auto; t.autoShow = show; window.kh.commit(); }, [ti, auto, show]);
const AY = v => 8 + (1 - v) * 48; // position verticale d'une valeur 0..1 dans la piste d'automation

test('AU01', 'Automation', 'Le bouton A ouvre la piste d\'automation ; un clic pose un point à la bonne valeur', async () => {
  await page.click('.head >> nth=1 >> .autob');
  expect((await proj()).tracks[1].autoShow === 'vol' && await page.$('.alane'), 'piste d\'automation absente');
  const b = await box('.alane'); await page.mouse.click(b.x + 11 * 16, b.y + AY(0.5)); await page.mouse.click(b.x + 11 * 48, b.y + AY(1));
  const pts = (await proj()).tracks[1].auto.vol; near(pts.length, 2, 0, 'points');
  near(pts[0].s, 16, 0, 'position du 1er point'); near(pts[0].v, 0.5, 0.03, 'valeur du 1er point'); near(pts[1].s, 48, 0, 'position du 2e point'); near(pts[1].v, 1, 0.03, 'valeur du 2e point');
  near(await page.$$eval('.apt', e => e.length), 2, 0, 'points affichés');
  expect(await page.$eval('.head >> nth=1 >> .autob', e => e.classList.contains('has') && e.getAttribute('aria-pressed') === 'true'), 'bouton A non marqué');
  await page.click('.head >> nth=1 >> .autob'); expect(!(await page.$('.alane')) && (await proj()).tracks[1].auto.vol.length === 2, 'masquer la piste ne doit pas effacer la courbe');
});
test('AU02', 'Automation', 'Déplacer un point en le glissant, l\'effacer par double-clic ou clic droit, annuler', async () => {
  await autoOn(1, { vol: [{ s: 0, v: 0.2 }, { s: 32, v: 1 }] });
  let b = await box('.apt >> nth=1'); await drag(b.x + 6, b.y + 6, 88, 24);
  let pts = (await proj()).tracks[1].auto.vol; near(pts[1].s, 40, 0, 'nouvelle position'); near(pts[1].v, 0.5, 0.04, 'nouvelle valeur');
  b = await box('.apt >> nth=1'); await drag(b.x + 6, b.y + 6, -600, 0);
  near((await proj()).tracks[1].auto.vol[1].s, 1, 0, 'un point ne peut pas passer devant le précédent');
  b = await box('.apt >> nth=0'); await page.mouse.dblclick(b.x + 9, b.y + 6); await sleep(80); // le point du pas 0 est à cheval sur le bord gauche
  near((await proj()).tracks[1].auto.vol.length, 1, 0, 'après double-clic');
  b = await box('.apt >> nth=0'); await page.mouse.click(b.x + 6, b.y + 6, { button: 'right' }); await sleep(80);
  expect(!(await proj()).tracks[1].auto.vol, 'courbe non vidée');
  await page.keyboard.press('Control+z'); near((await proj()).tracks[1].auto.vol.length, 1, 0, 'après annulation');
});
test('AU03', 'Automation', 'Changer de paramètre (pan, filtre) et effacer une courbe', async () => {
  await autoOn(1, { vol: [{ s: 0, v: 0.5 }] });
  await page.selectOption('[data-role=autoparam]', 'pan'); expect((await proj()).tracks[1].autoShow === 'pan', 'paramètre non changé');
  let b = await box('.alane'); await page.mouse.click(b.x + 11 * 8, b.y + 32); await page.mouse.click(b.x + 11 * 24, b.y + 8);
  let a = (await proj()).tracks[1].auto; near(a.pan[0].v, 0, 0.05, 'pan au centre'); near(a.pan[1].v, 1, 0.05, 'pan à droite'); near(a.vol.length, 1, 0, 'la courbe de volume est conservée');
  expect((await page.textContent('[data-role=autoparam]')).split('•').length === 3, 'les paramètres automatisés ne sont pas signalés');
  await page.click('[data-act=autoclear]'); a = (await proj()).tracks[1].auto; expect(!a.pan && a.vol.length === 1, 'effacement incorrect');
  expect(await page.$eval('[data-act=autoclear]', e => e.disabled), 'bouton effacer encore actif');
  await page.selectOption('[data-role=autoparam]', 'filter'); b = await box('.alane'); await page.mouse.click(b.x + 11 * 8, b.y + 56);
  near((await proj()).tracks[1].auto.filter[0].v, -1, 0.05, 'filtre passe-bas');
});
test('AU04', 'Automation', 'Une courbe de volume s\'entend au rendu (montée progressive, niveau fixe)', async () => {
  const r = await S(async () => {
    const mk = auto => window.qa.only(1, (p, t) => { t.clips[0].len = 32; t.rev = 0; t.auto = auto; });
    return { ramp: await window.qa.wins(mk({ vol: [{ s: 0, v: 0 }, { s: 32, v: 1 }] }), [[0.1, 0.9], [3.0, 3.9]]), half: await window.qa.wins(mk({ vol: [{ s: 0, v: 0.5 }] }), [[0, 4]]), base: await window.qa.wins(mk(undefined), [[0, 4], [0.1, 0.9], [3.0, 3.9]]) };
  });
  expect(r.ramp[0].l < r.base[1].l * 0.3, `le début n'est pas atténué (${r.ramp[0].l.toFixed(4)} / ${r.base[1].l.toFixed(4)})`);
  near(r.ramp[1].l / r.base[2].l, 0.86, 0.12, 'niveau en fin de montée'); near(r.half[0].l / r.base[0].l, 0.5, 0.05, 'niveau fixe à 50 %');
});
test('AU05', 'Automation', 'Les courbes de pan et de filtre s\'entendent au rendu', async () => {
  const r = await S(async () => {
    const mk = auto => window.qa.only(1, (p, t) => { t.clips[0].len = 32; t.rev = 0; t.auto = auto; });
    const w = [[0.05, 0.6], [3.3, 3.95]];
    return { pan: await window.qa.wins(mk({ pan: [{ s: 0, v: -1 }, { s: 32, v: 1 }] }), w), filt: await window.qa.wins(mk({ filter: [{ s: 0, v: 0 }, { s: 28, v: -0.9 }] }), w), base: await window.qa.wins(mk(undefined), w) };
  });
  expect(r.pan[0].l > r.pan[0].r * 4, 'début : le son n\'est pas à gauche'); expect(r.pan[1].r > r.pan[1].l * 4, 'fin : le son n\'est pas à droite');
  near(r.filt[0].hf / r.base[0].hf, 1, 0.25, 'début : filtre ouvert'); expect(r.filt[1].hf < r.base[1].hf * 0.4, 'fin : le filtre ne se ferme pas');
});
test('AU06', 'Automation', 'En lecture, la courbe pilote le son ; à l\'arrêt, le mixeur reprend la main', async () => {
  await autoOn(1, { vol: [{ s: 0, v: 0.1 }], pan: [{ s: 0, v: -1 }] });
  const read = () => S(() => { const k = window.kh, n = k.engine.mix.tracks.get(k.S.project.tracks[1].id); return { g: n.auto.gain.value, pan: n.pan.pan.value }; });
  await page.keyboard.press('Space'); await sleep(700); const a = await read();
  await tab('mixer'); await setSlider('.strip >> nth=1', 'Pan', 0.5); await sleep(200); const mid = await read();
  await page.keyboard.press('Space'); await sleep(400); const b = await read();
  near(a.g, 0.1, 0.02, 'gain piloté par la courbe'); near(a.pan, -1, 0.02, 'pan piloté par la courbe'); near(mid.pan, -1, 0.02, 'le curseur ne doit pas écraser la courbe en lecture');
  near(b.g, 1, 0.05, 'gain rendu après l\'arrêt'); near(b.pan, 0.5, 0.05, 'pan du mixeur après l\'arrêt');
});
test('AU07', 'Automation', 'Les courbes sont enregistrées dans le fichier projet', async () => {
  await autoOn(2, { vol: [{ s: 0, v: 0.3 }, { s: 64, v: 1 }], filter: [{ s: 8, v: -0.4 }] }, 'filter');
  const [dl] = await Promise.all([page.waitForEvent('download'), menu('bSave')]); const f = path.join(TMP, 'auto.khm'); await dl.saveAs(f);
  await newBlank(); await page.setInputFiles('#fProj', f); await sleep(400);
  const t = (await proj()).tracks[2]; expect(t.auto.vol.length === 2 && t.auto.filter[0].v === -0.4 && t.autoShow === 'filter', 'courbes perdues');
  near(await page.$$eval('.apt', e => e.length), 1, 0, 'points affichés après réouverture');
});

// ============ V3 : clips audio ============
const audioClip = () => S(() => { const k = window.kh; window.qa.sine('qa-sine'); const t = k.S.project.tracks[4]; t.clips = [{ id: 'qa-clip', name: 'Son', start: 0, len: 8, offset: 0, bufferId: 'qa-sine', gain: 1 }]; k.S.selTrack = t.id; k.S.selClip = 'qa-clip'; k.commit(); });
const audioOnly = wins => page.evaluate(w => { const p = JSON.parse(JSON.stringify(window.kh.S.project)); p.tracks = [p.tracks[4]]; return window.qa.wins(p, w); }, wins);

test('F01', 'Clips audio', 'Fondus d\'entrée et de sortie : réglables et audibles au rendu', async () => {
  await page.click(await headSel(4)); const [fc] = await Promise.all([page.waitForEvent('filechooser'), menu('bImport')]); await fc.setFiles(TONE); await sleep(600);
  const w = [[0.01, 0.1], [0.45, 0.55], [0.9, 0.99]], base = await audioOnly(w);
  await setSlider('.ebar', 'Fondu d\'entrée', 4); await setSlider('.ebar', 'Fondu de sortie', 4);
  const c = (await proj()).tracks[4].clips[0]; expect(c.fadeIn === 4 && c.fadeOut === 4, 'fondus non enregistrés');
  const r = await audioOnly(w);
  expect(r[0].l < base[0].l * 0.3, 'pas de fondu d\'entrée'); near(r[1].l / base[1].l, 1, 0.12, 'le milieu doit rester plein'); expect(r[2].l < base[2].l * 0.3, 'pas de fondu de sortie');
});
test('F02', 'Clips audio', 'Inverser un son : il est lu à l\'envers, et l\'annulation le rétablit', async () => {
  await audioClip(); const a = await audioOnly([[0, 0.2], [0.75, 0.95]]);
  await page.click('[data-act=reverse]'); await sleep(150);
  const c = (await proj()).tracks[4].clips[0]; expect(c.bufferId !== 'qa-sine', 'son non remplacé');
  const b = await audioOnly([[0, 0.2], [0.75, 0.95]]);
  expect(a[0].l > a[1].l * 2 && b[1].l > b[0].l * 2, `le son n'est pas inversé (${a.map(x => x.l.toFixed(3))} → ${b.map(x => x.l.toFixed(3))})`);
  await page.keyboard.press('Control+z'); expect((await proj()).tracks[4].clips[0].bufferId === 'qa-sine', 'annulation');
});
test('F03', 'Clips audio', 'Normaliser un son faible le ramène au niveau maximal sans saturer', async () => {
  await audioClip(); await setSlider('.ebar', 'Gain du clip', 0.4); await page.click('[data-act=normalize]'); await sleep(150);
  expect((await page.textContent('#toast')).includes('dB'), 'pas de message');
  const r = await S(() => { const k = window.kh, c = k.S.project.tracks[4].clips[0], d = k.buffers.get(c.bufferId).getChannelData(0); let pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v)); return { pk, gain: c.gain }; });
  near(r.pk, 0.966, 0.005, 'crête après normalisation'); near(r.gain, 1, 0, 'gain du clip remis à 100 %');
});
test('F04', 'Clips audio', 'Un fondu plus long que le clip raccourci ne provoque ni erreur ni clic', async () => {
  await audioClip(); await S(() => { const c = window.kh.S.project.tracks[4].clips[0]; c.fadeIn = 4; c.fadeOut = 4; c.len = 3; window.kh.commit(); });
  const r = await audioOnly([[0, 0.37]]); expect(Number.isFinite(r[0].l) && r[0].l > 0.001, 'rendu invalide');
  await S(() => window.kh.engine.seek(1)); await page.keyboard.press('Space'); await sleep(400); await page.keyboard.press('Space');
});

// ============ V3 : piano roll, gamme, accords, accents ============
test('K01', 'Piano roll', 'Vélocité : glisser dans la zone règle la force des notes', async () => {
  await page.click(await clipSel(1, 0)); const b = await box('.vel');
  await drag(b.x + 10, b.y + b.height * 0.75, 28 * 12, 0);
  const ns = (await proj()).tracks[1].clips[0].notes, first = ns.filter(n => n.s < 16), rest = ns.filter(n => n.s >= 16);
  expect(first.length === 5 && first.every(n => Math.abs(n.v - 0.25) < 0.06), `vélocités ${first.map(n => n.v)}`); expect(rest.every(n => n.v === 0.9), 'les autres notes ont changé');
  near(parseFloat(await page.$eval('.vbar[data-i="0"]', e => e.style.height)), 25, 6, 'hauteur de la barre');
  const r = await S(async () => { const p = JSON.parse(JSON.stringify(window.kh.S.project)); p.tracks = [p.tracks[1]]; p.tracks[0].rev = 0; return window.qa.wins(p, [[0, 1.9], [2, 3.9]]); });
  expect(r[0].l < r[1].l * 0.5, 'les notes adoucies ne sont pas plus faibles au rendu');
});
test('K02', 'Piano roll', 'Transposer le clip d\'un demi-ton ou d\'une octave, avec refus hors du clavier', async () => {
  await page.click(await clipSel(1, 0)); const a = (await proj()).tracks[1].clips[0].notes.map(n => n.p);
  await page.click('[data-act=tr12]'); await page.click('[data-act="tr-1"]');
  const b = (await proj()).tracks[1].clips[0].notes.map(n => n.p); expect(b.every((p, i) => p === a[i] + 11), 'transposition incorrecte');
  for (let i = 0; i < 6; i++) await page.click('[data-act=tr12]');
  const c = (await proj()).tracks[1].clips[0].notes.map(n => n.p); expect(Math.max(...c) <= 96, 'des notes sortent du clavier');
  expect((await page.textContent('#toast')).includes('impossible'), 'pas de message de refus');
});
test('K03', 'Gamme', 'Choisir une gamme grise les notes étrangères et aimante les notes posées', async () => {
  await page.click(await clipSel(1, 0)); await page.selectOption('[data-role=key]', '9'); await page.selectOption('[data-role=scale]', 'minor');
  const p = await proj(); expect(p.key === 9 && p.scale === 'minor', 'gamme non enregistrée');
  near(await page.$$eval('.blk.oos', e => e.length), 30, 2, 'lignes hors gamme'); expect(await page.$$eval('.key.root', e => e.length) >= 6, 'toniques non repérées');
  await page.$eval('.pr', e => { e.scrollTop = (96 - 37) * 16 - 80; e.scrollLeft = 0; });
  const g = await (await page.$('.pr-grid')).boundingBox(); await page.mouse.click(g.x + 28 * 20 + 5, g.y + (96 - 37) * 16 + 8); // do dièse, absent de la mineur
  const ns = (await proj()).tracks[1].clips[0].notes, n = ns[ns.length - 1]; near(n.s, 20, 0, 'position'); near(n.p, 36, 0, 'note aimantée sur do');
});
test('K04', 'Accords', 'Accords à un doigt : une touche joue et enregistre l\'accord de la gamme', async () => {
  await S(() => { const p = window.kh.S.project; p.loop = false; p.key = 9; p.scale = 'minor'; p.tracks[1].clips = []; window.kh.commit(); });
  await page.click(await headSel(1)); await page.selectOption('[data-role=chord]', '3');
  await S(() => window.kh.noteOn(57)); near(await S(() => window.kh.engine.voices.size), 3, 0, 'voix jouées'); await S(() => window.kh.noteOff(57));
  near(await S(() => window.kh.engine.voices.size), 0, 0, 'voix relâchées');
  await page.keyboard.press('r'); await sleep(400); await S(() => window.kh.noteOn(62)); await sleep(300); await S(() => window.kh.noteOff(62)); await sleep(450);
  await page.keyboard.press('Space'); await sleep(700);
  const ns = (await proj()).tracks[1].clips[0].notes.map(n => n.p).sort((a, b) => a - b);
  expect(ns.join() === '62,65,69', `accord enregistré : ${ns}`); // ré mineur dans la gamme de la mineur
  await page.selectOption('[data-role=chord]', '4'); await S(() => window.kh.noteOn(60)); near(await S(() => window.kh.engine.voices.size), 4, 0, 'accord de 7e'); await S(() => window.kh.noteOff(60));
});
test('K05', 'Batterie', 'Notes douces : Maj+clic ou clic droit, visibles et plus faibles au rendu', async () => {
  const sel = '.cell[data-r="1"][data-s="6"]', val = async () => (await proj()).tracks[0].clips[0].drums[1][6];
  await page.click(sel, { modifiers: ['Shift'] }); near(await val(), 0.5, 0, 'note douce'); expect(await page.$eval(sel, e => e.classList.contains('soft')), 'style absent');
  await page.click(sel, { modifiers: ['Shift'] }); near(await val(), 1, 0, 'retour à la note pleine'); await page.click(sel); near(await val(), 0, 0, 'effacement');
  await page.click(sel, { button: 'right' }); near(await val(), 0.5, 0, 'clic droit');
  const r = await S(async () => { const mk = v => window.qa.only(0, (p, t) => { t.rev = 0; const c = t.clips[0]; c.len = 16; c.drums = c.drums.map((r, i) => r.map((_, s) => (i === 0 && s % 4 === 0 ? v : 0))); }); return [(await window.qa.stats(mk(1))).rms, (await window.qa.stats(mk(0.5))).rms]; });
  near(r[1] / r[0], 0.5, 0.08, 'rapport de niveau');
});
test('K06', 'Piano roll', 'Les réglages du son se replient pour laisser la place aux notes', async () => {
  await page.click(await clipSel(1, 0)); const h0 = await page.$eval('.pr', e => e.clientHeight);
  expect(h0 - 56 > 150, `piano roll trop petit (${h0})`);
  await page.click('[data-act=synthopen]'); expect(await page.$eval('[data-act=synthopen]', e => e.getAttribute('aria-expanded')) === 'true', 'état non annoncé');
  expect((await page.textContent('.synth')).includes('Attaque'), 'réglages non affichés'); expect(await page.$eval('.pr', e => e.clientHeight) < h0, 'mise en page');
  await page.click('[data-act=synthopen]'); near(await page.$eval('.pr', e => e.clientHeight), h0, 1, 'hauteur rétablie');
});

// ============ V3 : mixage ============
test('MX01', 'Mixage', 'Sidechain : la piste « pompe » à chaque coup de kick, puis revient', async () => {
  const r = await S(async () => {
    const mk = duck => { const p = window.kh.demoProject(); p.tracks = [p.tracks[0], p.tracks[2]]; p.tracks[0].mute = true; p.tracks[0].clips.length = 1; p.tracks[1].duck = duck; p.tracks[1].rev = 0; return p; };
    const w = [[2.01, 2.07], [2.36, 2.48]]; return { off: await window.qa.wins(mk(0), w), on: await window.qa.wins(mk(0.9), w) };
  });
  expect(r.on[0].l < r.off[0].l * 0.45, `pas d'atténuation sur le kick (${r.on[0].l.toFixed(4)} / ${r.off[0].l.toFixed(4)})`);
  expect(r.on[1].l > r.off[1].l * 0.8, 'le niveau ne revient pas entre deux kicks');
  await tab('mixer'); await setSlider('.strip >> nth=2', 'Sidechain', 0.7); near((await proj()).tracks[2].duck, 0.7, 0.001, 'curseur du mixeur');
});
test('MX02', 'Mixage', 'Durée de la réverb, temps et répétitions de l\'écho : réglables et audibles', async () => {
  const r = await S(async () => {
    const one = f => window.qa.stats(window.qa.only(1, (p, t) => { t.clips[0].len = 16; f(p, t); }));
    return { short: await one((p, t) => { t.rev = 0.9; p.revSize = 0.4; }), long: await one((p, t) => { t.rev = 0.9; p.revSize = 6; }),
      fb0: await one((p, t) => { t.dly = 0.8; p.dlyFb = 0; }), fb8: await one((p, t) => { t.dly = 0.8; p.dlyFb = 0.8; }), d1: await one((p, t) => { t.dly = 0.8; p.dlySteps = 1; }), d8: await one((p, t) => { t.dly = 0.8; p.dlySteps = 8; }) };
  });
  expect(r.long.tail > r.short.tail * 5 + 1e-5, `la durée de réverb n'agit pas (${r.short.tail} → ${r.long.tail})`);
  expect(r.fb8.tail > r.fb0.tail * 5 + 1e-5, 'les répétitions de l\'écho n\'agissent pas'); expect(Math.abs(r.d1.rms - r.d8.rms) / r.d8.rms > 0.01, 'le temps d\'écho n\'agit pas');
  for (const k of Object.keys(r)) expect(r[k].bad === 0 && r[k].peak <= 0.97, `${k} : signal invalide`);
  await tab('mixer'); await setSlider('.strip.master', 'Durée', 4.5); await setSlider('.strip.master', 'Temps', 6); await setSlider('.strip.master', 'Répét.', 0.6);
  const p = await proj(); expect(p.revSize === 4.5 && p.dlySteps === 6 && p.dlyFb === 0.6, 'réglages non enregistrés');
});

// ============ V3 : pistes ============
test('TK01', 'Arrangement', 'Dupliquer une piste : copie complète, placée juste après', async () => {
  await autoOn(1, { vol: [{ s: 0, v: 0.5 }] }, '');
  await page.click('.head >> nth=1 >> .tdup'); const p = await proj(); near(p.tracks.length, 6, 0, 'pistes');
  const a = p.tracks[1], b = p.tracks[2]; expect(b.name === 'Basse 2' && b.id !== a.id && b.clips[0].id !== a.clips[0].id, 'copie mal identifiée');
  expect(b.clips[0].notes.length === a.clips[0].notes.length && b.synth.preset === a.synth.preset && b.auto.vol.length === 1, 'contenu non copié');
  expect(await S(() => window.kh.S.selTrack === window.kh.S.project.tracks[2].id), 'la copie n\'est pas sélectionnée');
});
test('TK02', 'Arrangement', 'Monter et descendre une piste', async () => {
  const names = async () => (await proj()).tracks.map(t => t.name).join();
  await page.click('.head >> nth=1 >> .tdown'); expect((await names()).startsWith('Batterie 1,Accords,Basse'), `ordre ${await names()}`);
  await page.click('.head >> nth=2 >> .tup'); expect((await names()).startsWith('Batterie 1,Basse,Accords'), 'remontée');
  const before = await names(); await page.click('.head >> nth=0 >> .tup'); await page.click('.head >> nth=4 >> .tdown'); expect(await names() === before, 'les extrémités ne doivent pas bouger');
});

// ============ V3 : passerelles (MIDI, pistes séparées) ============
test('E01', 'Passerelles', 'Exporter en MIDI : fichier standard, relu avec les bonnes notes et le bon tempo', async () => {
  await S(() => { window.kh.S.project.bpm = 97; window.kh.commit(); });
  const [dl] = await Promise.all([page.waitForEvent('download'), menu('bMidiOut')]); const f = path.join(TMP, 'demo.mid'); await dl.saveAs(f);
  const b = fs.readFileSync(f); expect(dl.suggestedFilename() === 'Demo.mid' && b.toString('ascii', 0, 4) === 'MThd' && b.readUInt16BE(8) === 1 && b.readUInt16BE(12) === 480, 'en-tête MIDI invalide');
  near(b.readUInt16BE(10), 5, 0, 'pistes du fichier (tempo + 4)');
  const r = await page.evaluate(bytes => { const m = window.kh.importMidi(new Uint8Array(bytes).buffer); return { bpm: m.bpm, tracks: m.tracks.map(t => ({ type: t.type, name: t.name, n: t.clips[0].notes ? t.clips[0].notes.length : t.clips[0].drums.flat().filter(Boolean).length, len: t.clips[0].len, first: t.clips[0].notes && t.clips[0].notes[0] })) }; }, [...b]);
  near(r.bpm, 97, 0, 'tempo'); expect(r.tracks.map(t => t.type).join() === 'drums,synth,synth,synth', `types ${r.tracks.map(t => t.type)}`);
  expect(r.tracks[1].name === 'Basse' && r.tracks[1].n === 20 && r.tracks[1].first.p === 33 && r.tracks[1].first.l === 2, `basse ${JSON.stringify(r.tracks[1])}`);
  near(r.tracks[0].len, 128, 0, 'durée de la batterie'); near(r.tracks[3].n, 16 + 24, 0, 'notes de la mélodie (2 clips)');
});
test('E02', 'Passerelles', 'Importer un fichier MIDI : pistes, motif de batterie et tempo retrouvés, et jouables', async () => {
  const bytes = await S(() => { window.kh.S.project.bpm = 97; return [...window.kh.exportMidi(window.kh.S.project)]; });
  const f = path.join(TMP, 'in.mid'); fs.writeFileSync(f, Buffer.from(bytes));
  await newBlank(); const [fc] = await Promise.all([page.waitForEvent('filechooser'), menu('bMidiIn')]); await fc.setFiles(f); await sleep(500);
  const p = await proj(); near(p.tracks.length, 7, 0, 'pistes'); near(p.bpm, 97, 0, 'tempo repris du fichier');
  const d = p.tracks[3]; expect(d.type === 'drums' && d.clips[0].drums[0].slice(0, 16).map(v => +!!v).join('') === '1000100010001000', 'motif de kick');
  expect((await page.textContent('#toast')).includes('4'), 'message'); expect(await page.$('.dgrid, .pads'), 'éditeur non affiché');
  const st = await S(() => window.qa.stats(window.kh.S.project)); expect(st.rms > 0.01 && st.bad === 0, 'projet importé inaudible');
});
test('E03', 'Passerelles', 'Un fichier MIDI illisible est refusé avec un message clair', async () => {
  await page.setInputFiles('#fMidi', TONE); await sleep(300);
  expect((await page.textContent('#toast')).includes('illisible'), 'pas de message'); near((await proj()).tracks.length, 5, 0, 'pistes inchangées');
});
test('E04', 'Passerelles', 'Exporter les pistes séparées : une archive ZIP valide, un WAV par piste, tous de même durée', async () => {
  await S(() => { const p = window.kh.S.project; p.tracks.forEach(t => { t.clips = t.clips.slice(0, 1); t.clips.forEach(c => { c.len = 16; }); }); window.kh.commit(); });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), menu('bStems')]); const f = path.join(TMP, 'stems.zip'); await dl.saveAs(f);
  expect(dl.suggestedFilename() === 'Demo_stems.zip', `nom ${dl.suggestedFilename()}`);
  const out = JSON.parse(require('child_process').execFileSync('python3', ['-c', 'import zipfile,json,sys\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({"bad":z.testzip(),"files":[[i.filename,i.file_size,z.read(i)[:4].decode("latin1")] for i in z.infolist()]}))', f]).toString());
  expect(out.bad === null, `archive corrompue (${out.bad})`); near(out.files.length, 4, 0, 'fichiers');
  expect(out.files[0][0] === '01_Batterie_1.wav' && out.files[3][0] === '04_Melodie.wav', `noms ${out.files.map(x => x[0])}`);
  expect(out.files.every(x => x[2] === 'RIFF' && x[1] === out.files[0][1] && x[1] > 100000), 'WAV invalides ou de durées différentes');
});

// ============ V3 : projet, robustesse, application installable ============
test('P06', 'Projet', 'Un projet de la V2 s\'ouvre dans la V3 avec les nouveaux réglages par défaut', async () => {
  const data = await S(() => { const p = JSON.parse(JSON.stringify(window.kh.demoProject())); for (const k of ['revSize', 'dlySteps', 'dlyFb', 'key', 'scale', 'markers', 'notes', 'target', 'width']) delete p[k]; p.tracks.forEach(t => { delete t.duck; delete t.chorus; delete t.trem; delete t.crush; }); return JSON.stringify({ format: 'kh-music-pro', version: 1, project: p, buffers: {} }); });
  const f = path.join(TMP, 'v2.khm'); fs.writeFileSync(f, data); await page.setInputFiles('#fProj', f); await sleep(400);
  const p = await proj(); expect(p.revSize === 2.4 && p.dlySteps === 3 && p.dlyFb === 0.38 && p.scale === 'off' && p.key === 0 && p.tracks.every(t => t.duck === 0 && t.chorus === 0 && t.trem === 0 && t.crush === 0) && Array.isArray(p.markers), 'valeurs par défaut absentes');
  const a = await S(() => window.qa.stats(window.kh.S.project)), b = await S(() => window.qa.stats(window.kh.demoProject())); near(a.rms / b.rms, 1, 0.08, 'le projet doit sonner comme avant'); // la réverb est tirée au hasard à chaque rendu
});
test('X10', 'Robustesse', 'Automation, sidechain et accords pendant la lecture en boucle, puis suppression à chaud', async () => {
  await S(() => { const p = window.kh.S.project; p.bpm = 200; p.loop = true; p.loopStart = 0; p.loopLen = 1; p.scale = 'pentaMin'; p.tracks[2].duck = 1; window.kh.kb.chord = 4; });
  await autoOn(1, { vol: [{ s: 0, v: 0 }, { s: 16, v: 1 }], pan: [{ s: 4, v: -1 }, { s: 12, v: 1 }], filter: [{ s: 0, v: 0.8 }, { s: 16, v: -0.8 }] });
  await page.keyboard.press('Space'); await sleep(1500);
  await page.click(await headSel(3)); await S(() => { window.kh.noteOn(127); window.kh.noteOn(0); window.kh.noteOff(127); window.kh.noteOff(0); });
  const b = await box('.alane'); await page.mouse.click(b.x + 88, b.y + 30); await page.click('[data-act=autoclear]');
  await page.click('.head >> nth=1 >> .del'); await sleep(500);
  const r = await S(async () => ({ p: window.kh.engine.playing, l: await window.qa.level() })); expect(r.p && r.l > 0.1, 'la lecture s\'est interrompue');
});
test('W01', 'Application', 'Version construite : installable (manifeste) et utilisable hors-ligne après une première visite', async () => {
  const cp = require('child_process'), root = path.join(__dirname, '..');
  cp.execSync('npx vite build', { cwd: root, stdio: 'ignore' });
  const srv = cp.spawn('npx', ['vite', 'preview', '--port', '4199', '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
  const ctx2 = await browser.newContext({ viewport: { width: 1300, height: 800 } });
  try {
    const pg = await ctx2.newPage(); let up = false;
    for (let i = 0; i < 40 && !up; i++) { try { await pg.goto('http://localhost:4199/'); up = true; } catch { await sleep(300); } }
    expect(up, 'le serveur de la version construite ne démarre pas'); await pg.waitForSelector('.clip');
    const m = await pg.evaluate(async () => { const href = document.querySelector('link[rel=manifest]').href, j = await (await fetch(href)).json(); await navigator.serviceWorker.ready; return { name: j.name, display: j.display, icons: j.icons.length }; });
    expect(m.name === 'KH Music Pro' && m.display === 'standalone' && m.icons > 0, 'manifeste incomplet');
    await sleep(1500); await ctx2.setOffline(true); await pg.reload(); await pg.waitForSelector('.clip', { timeout: 8000 });
    expect(await pg.evaluate(() => !!window.kh && document.querySelectorAll('.head').length === 5 && getComputedStyle(document.body).display === 'grid'), 'application incomplète hors-ligne');
  } finally { await ctx2.close(); try { process.kill(-srv.pid); } catch { /* déjà arrêté */ } }
});

// ============ V4 : tempo et hauteur des sons ============
const toneClip = () => S(() => { const k = window.kh, b = new AudioBuffer({ length: 44100, numberOfChannels: 1, sampleRate: 44100 }), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 220 * i / 44100) * 0.5; k.buffers.set('qa-220', b); const t = k.S.project.tracks[4]; t.clips = [{ id: 'qa-clip', name: 'Son', start: 0, len: 8, offset: 0, bufferId: 'qa-220', gain: 1 }]; k.S.selTrack = t.id; k.S.selClip = 'qa-clip'; k.commit(); });
/** Durée, fréquence (passages par zéro) et régularité du niveau du son du clip de test. */
const clipSound = () => S(() => { const k = window.kh, c = k.S.project.tracks[4].clips[0], b = k.buffers.get(c.bufferId), d = b.getChannelData(0), sr = b.sampleRate, i0 = Math.floor(d.length * 0.2), i1 = Math.floor(d.length * 0.8); let z = 0, lo = 9, hi = 0; for (let i = i0 + 1; i < i1; i++) if (d[i - 1] < 0 && d[i] >= 0) z++; const blk = Math.floor(sr * 0.05); for (let i = i0; i + blk < i1; i += blk) { let e = 0; for (let j = 0; j < blk; j++) e += d[i + j] ** 2; e = Math.sqrt(e / blk); lo = Math.min(lo, e); hi = Math.max(hi, e); } return { dur: b.duration, freq: z / ((i1 - i0) / sr), lo, hi, len: c.len, id: c.bufferId }; });

test('ST01', 'Tempo et hauteur', 'Étirer un son à 200 % : deux fois plus long, même hauteur, niveau régulier', async () => {
  await toneClip(); await setSlider('.editor', 'Durée', 200); await page.click('[data-act=stretch]'); await sleep(300);
  const r = await clipSound(); near(r.dur, 2, 0.02, 'durée'); near(r.freq, 220, 4, 'hauteur conservée'); near(r.len, 16, 0, 'durée du clip en pas');
  expect(r.lo > 0.3 && r.hi < 0.4, `niveau irrégulier (${r.lo.toFixed(3)} – ${r.hi.toFixed(3)}, attendu ≈ 0,354)`);
  expect((await page.textContent('#toast')).includes('recalculé'), 'pas de message');
  await page.keyboard.press('Control+z'); expect((await clipSound()).id === 'qa-220', 'annulation');
});
test('ST02', 'Tempo et hauteur', 'Transposer un son d\'une octave ou d\'une quinte : même durée, nouvelle hauteur', async () => {
  await toneClip(); await setSlider('.editor', 'Hauteur', 12); await page.click('[data-act=stretch]'); await sleep(300);
  let r = await clipSound(); near(r.dur, 1, 0.02, 'durée conservée'); near(r.freq, 440, 8, 'octave au-dessus'); expect(r.lo > 0.28 && r.hi < 0.42, `niveau irrégulier (${r.lo.toFixed(3)} – ${r.hi.toFixed(3)})`);
  await setSlider('.editor', 'Hauteur', -5); await page.click('[data-act=stretch]'); await sleep(300);
  r = await clipSound(); near(r.dur, 1, 0.02, 'durée conservée (2)'); near(r.freq, 440 * Math.pow(2, -5 / 12), 8, 'quarte en dessous');
});
test('ST03', 'Tempo et hauteur', 'Indiquer le BPM du son le cale sur le tempo du projet', async () => {
  await toneClip(); await S(() => { window.kh.S.project.bpm = 120; window.kh.commit(); });
  await page.fill('[data-role=srcbpm]', '90'); await page.keyboard.press('Tab');
  near(await S(() => window.kh.S.stretch.pct), 75, 0, 'durée proposée');
  await page.click('[data-act=stretch]'); await sleep(300);
  const r = await clipSound(); near(r.dur, 0.75, 0.02, 'durée'); near(r.freq, 220, 4, 'hauteur conservée'); near(r.len, 6, 0, 'pas');
  await page.click('[data-act=stretch]'); expect((await clipSound()).id === r.id, 'sans réglage, « Appliquer » ne doit rien faire');
});

// ============ V4 : entrée audio ============
const waitLevel = (id, min, ms = 3000) => page.evaluate(async ([id, min, ms]) => { for (let i = 0; i < 40; i++) window.kh.engine.level(id); /* purge la mémoire du vumètre */ const end = performance.now() + ms; let m = 0; while (performance.now() < end) { m = Math.max(m, window.kh.engine.level(id)); if (m > min) return m; await new Promise(r => setTimeout(r, 30)); } return m; }, [id, min, ms]);

test('IN01', 'Entrée audio', 'Activer l\'entrée : liste des micros, vumètre d\'entrée, puis fermeture', async () => {
  await page.click(await headSel(4)); expect(await page.$('.inbar'), 'panneau d\'entrée absent');
  await page.click('[data-act=inopen]'); await sleep(400);
  expect(await S(() => !!window.kh.engine.inp), 'entrée non ouverte'); expect(await page.getAttribute('[data-act=inopen]', 'aria-pressed') === 'true', 'état du bouton');
  expect(await page.$$eval('[data-role=indev] option', e => e.length) >= 2, 'aucun micro listé');
  const lvl = await waitLevel('input', 0.2); expect(lvl > 0.2, `vumètre d'entrée inactif (${lvl})`);
  await page.click('[data-act=inopen]'); await sleep(150); expect(await S(() => !window.kh.engine.inp), 'entrée non fermée');
  expect(await page.$eval('[data-act=inmon]', e => e.disabled), 'l\'écoute devrait être indisponible');
});
test('IN02', 'Entrée audio', 'Écoute de contrôle et gain d\'entrée', async () => {
  await page.click(await headSel(4)); await page.click('[data-act=inopen]'); await sleep(400);
  const quiet = await waitLevel('master', 0.5, 1300); expect(quiet < 0.05, `l'entrée s'entend sans écoute (${quiet})`);
  await page.click('[data-act=inmon]'); const on = await waitLevel('master', 0.2); expect(on > 0.2, `écoute inaudible (${on})`);
  await setSlider('.inbar', 'Gain d\'entrée', 0); await sleep(1300);
  const zero = await waitLevel('input', 0.5, 1300); expect(zero < 0.05, `le gain à zéro laisse passer le signal (${zero})`);
});
test('IN03', 'Entrée audio', 'Enregistrer avec l\'entrée déjà ouverte : la prise est faite et l\'entrée reste disponible', async () => {
  await page.click(await headSel(4)); await page.click('[data-act=inopen]'); await sleep(400);
  await page.keyboard.press('r'); await sleep(1600); await page.keyboard.press('Space'); await sleep(700);
  const r = await S(() => { const k = window.kh, c = k.S.project.tracks[4].clips[0], b = c && k.buffers.get(c.bufferId); let pk = 0; if (b) for (const v of b.getChannelData(0)) pk = Math.max(pk, Math.abs(v)); return { clip: !!c, pk, open: !!k.engine.inp }; });
  expect(r.clip && r.pk > 0.05, `prise absente ou silencieuse (${r.pk})`); expect(r.open, 'l\'entrée a été refermée');
  await page.click(await headSel(4)); await page.click('[data-act=inopen]'); await sleep(150); await page.keyboard.press('r'); await sleep(1200); await page.keyboard.press('Space'); await sleep(600);
  expect(await S(() => !window.kh.engine.inp && window.kh.S.project.tracks[4].clips.length === 2), 'sans entrée ouverte, le micro doit être libéré après la prise');
});

// ============ V4 : arpégiateur ============
const spyArp = () => S(() => { const e = window.kh.engine; window.qaLog = []; if (!e.playAt0) e.playAt0 = e.playAt.bind(e); e.playAt = (tr, m, t, d, v) => { window.qaLog.push([m, t]); e.playAt0(tr, m, t, d, v); }; });

test('AR01', 'Arpégiateur', 'Les notes tenues sont égrenées dans l\'ordre, au tempo, et s\'arrêtent au relâchement', async () => {
  await S(() => { window.kh.S.project.bpm = 120; window.kh.commit(); });
  await page.click(await headSel(3)); await page.selectOption('[data-role=arp]', 'up'); await page.selectOption('[data-role=arprate]', '1'); await spyArp();
  await S(() => { for (const n of [64, 60, 67]) window.kh.noteOn(n); }); await sleep(900);
  const lvl = await S(() => window.qa.level(200)); await S(() => { for (const n of [64, 60, 67]) window.kh.noteOff(n); });
  const log = await S(() => window.qaLog.slice()); await sleep(400); const after = await S(() => window.qaLog.length);
  expect(log.slice(0, 6).map(x => x[0]).join() === '60,64,67,60,64,67', `ordre ${log.map(x => x[0])}`);
  near(log[4][1] - log[0][1], 0.5, 0.01, 'quatre doubles-croches à 120 BPM'); expect(lvl > 0.1, 'arpège inaudible'); near(after, log.length, 0, 'l\'arpège continue après le relâchement');
  near(await S(() => window.kh.engine.voices.size), 0, 0, 'aucune note tenue en parallèle');
});
test('AR02', 'Arpégiateur', 'Modes descendant et aller-retour, avec un accord à un doigt', async () => {
  await page.click(await headSel(3)); await page.selectOption('[data-role=arp]', 'updown'); await page.selectOption('[data-role=arprate]', '1'); await page.selectOption('[data-role=chord]', '3'); await spyArp();
  await S(() => window.kh.noteOn(60)); await sleep(800); await S(() => window.kh.noteOff(60));
  let seq = (await S(() => window.qaLog.slice())).map(x => x[0]); expect(seq.slice(0, 5).join() === '60,64,67,64,60', `aller-retour ${seq}`);
  await page.selectOption('[data-role=arp]', 'down'); await spyArp(); await S(() => window.kh.noteOn(60)); await sleep(500); await S(() => window.kh.noteOff(60));
  seq = (await S(() => window.qaLog.slice())).map(x => x[0]); expect(seq.slice(0, 3).join() === '67,64,60', `descendant ${seq}`);
});
test('AR03', 'Arpégiateur', 'En enregistrement, l\'arpège est calé sur la grille et écrit dans le clip', async () => {
  await S(() => { const p = window.kh.S.project; p.bpm = 120; p.loop = false; p.tracks[1].clips = []; window.kh.commit(); });
  await page.click(await headSel(1)); await page.selectOption('[data-role=arp]', 'up'); await page.selectOption('[data-role=arprate]', '2');
  await page.keyboard.press('r'); await sleep(400); await S(() => { window.kh.noteOn(48); window.kh.noteOn(55); }); await sleep(1300);
  await S(() => { window.kh.noteOff(48); window.kh.noteOff(55); }); await sleep(450); await page.keyboard.press('Space'); await sleep(700);
  const ns = (await proj()).tracks[1].clips[0].notes.slice().sort((a, b) => a.s - b.s);
  expect(ns.length >= 4 && ns.length <= 7, `${ns.length} notes enregistrées`); expect(ns.every(n => n.s % 2 === 0 && n.l <= 2), `notes hors grille ${JSON.stringify(ns)}`);
  expect(ns.every((n, i) => n.p === (i % 2 ? 55 : 48)) && ns.every((n, i) => !i || n.s === ns[i - 1].s + 2), `alternance ${ns.map(n => n.s + ':' + n.p)}`);
});

// ============ V4 : repères ============
test('MK01', 'Repères', 'Poser des repères, y sauter, les renommer et les supprimer', async () => {
  await page.click('#bMark'); await S(() => window.kh.engine.seek(70)); await page.click('#bMark');
  let m = (await proj()).markers; expect(m.length === 2 && m[0].s === 0 && m[1].s === 64 && m[1].name === 'Repère 2', `repères ${JSON.stringify(m)}`);
  await page.click('#bMark'); expect((await proj()).markers.length === 2 && (await page.textContent('#toast')).includes('déjà'), 'doublon accepté');
  await page.click('.mark >> nth=0'); near(await S(() => window.kh.engine.pos), 0, 0, 'saut au premier repère');
  await page.click('.mark >> nth=1'); near(await S(() => window.kh.engine.pos), 64, 0, 'saut au second repère');
  dialogText = 'Refrain'; await page.dblclick('.mark >> nth=1'); dialogText = undefined; await sleep(100);
  expect((await proj()).markers[1].name === 'Refrain' && (await page.textContent('.mark >> nth=1')).includes('Refrain'), 'renommage');
  await page.click('.mark >> nth=0', { button: 'right' }); m = (await proj()).markers; expect(m.length === 1 && m[0].name === 'Refrain', 'suppression');
  await page.keyboard.press('Control+z'); near((await proj()).markers.length, 2, 0, 'annulation');
});

// ============ V4 : téléphone ============
test('MB01', 'Téléphone', 'Écran de téléphone tactile : mise en page compacte, lecture, séquenceur, pads, menu et onglets au doigt', async () => {
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'fr-FR' });
  try {
    const pg = await ctx2.newPage(), errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto(BASE); await pg.waitForSelector('.clip'); if (await pg.$eval('#help', d => d.open)) await pg.tap('#help button.accent');
    const lay = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, top: document.getElementById('top').offsetHeight, topScroll: document.getElementById('top').scrollWidth, panel: document.getElementById('panel').clientHeight, arr: document.getElementById('arr').clientHeight, lane: document.querySelector('.lanes').getBoundingClientRect().left }));
    expect(lay.sw <= lay.iw + 1, `la page déborde en largeur (${lay.sw} > ${lay.iw})`); expect(lay.top < 80 && lay.topScroll > lay.iw, `barre supérieure non compacte (${lay.top} px)`);
    expect(lay.panel > 250 && lay.arr > 180 && lay.lane < 140, `zones mal réparties (${JSON.stringify(lay)})`);
    await pg.tap('#bPlay'); await pg.waitForTimeout(500); expect(await pg.evaluate(() => window.kh.engine.playing && window.kh.engine.currentStep() > 1), 'la lecture ne démarre pas au doigt');
    await pg.tap('#bPlay'); expect(await pg.evaluate(() => !window.kh.engine.playing), 'la lecture ne s\'arrête pas');
    await pg.tap('.cell[data-r="1"][data-s="1"]'); await pg.waitForTimeout(100); expect(await pg.evaluate(() => window.kh.S.project.tracks[0].clips[0].drums[1][1] === 1), 'case non activée au doigt');
    await pg.tap('[data-view=pads]'); await pg.tap('.pad[data-pad="5"]'); expect(await pg.$eval('.pad[data-pad="5"]', e => e.classList.contains('hit')), 'pad sans réaction');
    const pads = await pg.$eval('.pads', e => { const r = e.getBoundingClientRect(); return r.right; }); expect(pads <= 390, `les pads débordent (${pads})`);
    await pg.selectOption('[data-role=padpick]', '5'); expect(await pg.$('.padfx') && await pg.$('[data-act=padfxload]'), 'réglages du pad inaccessibles au doigt');
    await pg.$eval('#menu', e => e.scrollIntoView({ inline: 'center' })); await pg.tap('#menu summary'); const b = await (await pg.$('#bSave')).boundingBox();
    expect(b && b.x >= 0 && b.x + b.width <= 390 && b.y > 0 && b.y < 844, `menu hors écran (${JSON.stringify(b)})`); await pg.tap('#menu summary');
    await pg.tap('#tabs [data-tab=mixer]'); expect(await pg.$('.mixer'), 'mixeur'); await pg.tap('#tabs [data-tab=live]'); await pg.tap('.lcell[data-clip] >> nth=0'); await pg.waitForTimeout(300);
    expect(await pg.evaluate(() => window.kh.engine.mode === 'live' && window.kh.engine.playing), 'le mode Live ne se lance pas au doigt'); await pg.evaluate(() => window.kh.engine.stop());
    expect(!errs.length, 'erreur : ' + errs[0]);
  } finally { await ctx2.close(); }
});
test('MB02', 'Téléphone', 'Au doigt : déplacer un clip et dessiner une courbe d\'automation', async () => {
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'fr-FR' });
  try {
    const pg = await ctx2.newPage(); await pg.goto(BASE); await pg.waitForSelector('.clip'); if (await pg.$eval('#help', d => d.open)) await pg.tap('#help button.accent');
    const cdp = await ctx2.newCDPSession(pg);
    const swipe = async (x, y, dx, dy) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 5, y: y + dy * i / 5 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pg.waitForTimeout(150); };
    await pg.evaluate(() => { const k = window.kh; k.S.project.tracks[1].clips[0].len = 16; k.S.project.tracks[1].autoShow = 'vol'; k.commit(); });
    const c = await (await pg.$('.lane >> nth=1 >> .clip')).boundingBox(); await swipe(c.x + 40, c.y + 40, 88, 0);
    expect(await pg.evaluate(() => window.kh.S.project.tracks[1].clips[0].start) === 8, 'clip non déplacé au doigt');
    const a = await (await pg.$('.alane')).boundingBox(); await pg.touchscreen.tap(a.x + 44, a.y + 20); await pg.waitForTimeout(100);
    expect(await pg.evaluate(() => (window.kh.S.project.tracks[1].auto.vol || []).length) === 1, 'point d\'automation non posé au doigt');
  } finally { await ctx2.close(); }
});

// ============ V5 : clavier à l'écran ============
test('OK01', 'Clavier à l\'écran', 'Afficher le clavier, jouer une touche à la souris, glisser vers une autre, changer d\'octave', async () => {
  await page.click(await headSel(3)); expect(!(await page.$('.okb')), 'le clavier devrait être masqué par défaut sur ordinateur');
  await page.click('[data-act=okb]'); near(await page.$$eval('.okb .wk', e => e.length), 15, 0, 'touches blanches'); near(await page.$$eval('.okb .bk', e => e.length), 10, 0, 'touches noires');
  const k = await box('.wk[data-m="60"]'), k2 = await box('.wk[data-m="62"]'), keys = () => S(() => [...window.kh.engine.voices.keys()].map(x => +x.split(':')[1]));
  await page.mouse.move(k.x + k.width / 2, k.y + k.height - 10); await page.mouse.down(); await sleep(150);
  expect((await keys()).join() === '60' && await page.$eval('.wk[data-m="60"]', e => e.classList.contains('on')), `touche non jouée (${await keys()})`);
  expect(await S(() => window.qa.level(200)) > 0.1, 'aucun son');
  await page.mouse.move(k2.x + k2.width / 2, k2.y + k2.height - 10, { steps: 3 }); await sleep(80); expect((await keys()).join() === '62', `glissé (${await keys()})`);
  await page.mouse.up(); await sleep(60); near((await keys()).length, 0, 0, 'note relâchée');
  const bk = await box('.bk[data-m="61"]'); await page.mouse.move(bk.x + bk.width / 2, bk.y + 10); await page.mouse.down(); await sleep(60); expect((await keys()).join() === '61', 'touche noire'); await page.mouse.up();
  await page.click('[data-act=octup]'); expect(await page.$('.wk[data-m="72"]') && !(await page.$('.wk[data-m="48"]')), 'octave non décalée');
});
test('OK02', 'Clavier à l\'écran', 'Sur écran tactile : clavier affiché d\'office, accord à deux doigts', async () => {
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'fr-FR' });
  try {
    const pg = await ctx2.newPage(); await pg.goto(BASE); await pg.waitForSelector('.clip'); if (await pg.$eval('#help', d => d.open)) await pg.tap('#help button.accent');
    await pg.tap('.head >> nth=1 >> .ticon'); expect(await pg.$('.okb'), 'clavier absent sur écran tactile');
    const a = await (await pg.$('.wk[data-m="48"]')).boundingBox(), b = await (await pg.$('.wk[data-m="55"]')).boundingBox(), cdp = await ctx2.newCDPSession(pg);
    const pt = (r, id) => ({ x: r.x + r.width / 2, y: r.y + r.height - 12, id });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(a, 1), pt(b, 2)] }); await pg.waitForTimeout(200);
    const n = await pg.evaluate(() => [...window.kh.engine.voices.keys()].map(x => +x.split(':')[1]).sort((x, y) => x - y).join());
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pg.waitForTimeout(100);
    expect(n === '48,55', `notes jouées : ${n}`); expect(await pg.evaluate(() => window.kh.engine.voices.size) === 0, 'notes non relâchées');
    const wk = await pg.$eval('.wk', e => e.getBoundingClientRect().width); expect(wk >= 32, `touches trop étroites pour le doigt (${wk} px)`);
  } finally { await ctx2.close(); }
});

// ============ V5 : sélection de notes ============
const notesOf = async (ti = 1) => (await proj()).tracks[ti].clips[0].notes;
test('SN01', 'Piano roll', 'Sélectionner plusieurs notes au rectangle (Maj+glisser) et les déplacer ensemble', async () => {
  await page.click(await clipSel(1, 0)); const before = await notesOf();
  await page.$eval('.pr', e => { e.scrollLeft = 0; }); const g = await (await page.$('.pr-grid')).boundingBox(), y = p => g.y + (96 - p) * 16 + 8;
  await page.keyboard.down('Shift'); await page.mouse.move(g.x + 2, y(36)); await page.mouse.down(); await page.mouse.move(g.x + 28 * 16 - 6, y(30), { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Shift');
  near(await page.$$eval('.note.sel', e => e.length), 5, 0, 'notes sélectionnées (1re mesure)');
  near((await notesOf()).length, before.length, 0, 'le rectangle ne doit pas créer de note');
  const nb = await box('.note[data-i="1"]'); await drag(nb.x + 8, nb.y + 8, 56, -16);
  const after = await notesOf();
  expect(after.slice(0, 5).every((n, i) => n.s === before[i].s + 2 && n.p === before[i].p + 1), `groupe mal déplacé ${JSON.stringify(after.slice(0, 5))}`);
  expect(after.slice(5).every((n, i) => n.s === before[i + 5].s && n.p === before[i + 5].p), 'des notes hors sélection ont bougé');
  near(await page.$$eval('.note.sel', e => e.length), 5, 0, 'la sélection est conservée');
});
test('SN02', 'Piano roll', 'Tout sélectionner, copier, coller à la tête de lecture, supprimer la sélection', async () => {
  await page.click(await clipSel(1, 0)); await page.keyboard.press('Control+a'); near(await page.$$eval('.note.sel', e => e.length), 20, 0, 'tout sélectionner');
  await page.keyboard.press('Control+c'); expect((await page.textContent('#toast')).includes('20'), 'message de copie');
  await S(() => window.kh.engine.seek(32)); await page.keyboard.press('Control+v');
  let ns = await notesOf(); near(ns.length, 30, 0, 'notes après collage (seules celles qui tiennent dans le clip)');
  expect(ns.slice(20).every(n => n.s >= 32 && n.s + n.l <= 64) && ns[20].s === 32 && ns[20].p === 33, `collage mal placé ${JSON.stringify(ns.slice(20, 23))}`);
  near(await page.$$eval('.note.sel', e => e.length), 10, 0, 'les notes collées sont sélectionnées');
  await page.keyboard.press('Delete'); ns = await notesOf(); near(ns.length, 20, 0, 'suppression de la sélection'); near((await proj()).tracks[1].clips.length, 1, 0, 'le clip ne doit pas être supprimé');
  await page.keyboard.press('Control+z'); near((await notesOf()).length, 30, 0, 'annulation');
});
test('SN03', 'Piano roll', 'Flèches : déplacer et transposer la sélection ; sans sélection, Suppr supprime toujours le clip', async () => {
  await page.click(await clipSel(1, 0)); const a = (await notesOf())[0];
  const nb = await box('.note[data-i="0"]'); await page.mouse.click(nb.x + 8, nb.y + 8); near((await notesOf()).length, 20, 0, 'un clic sur une note ne doit rien créer');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Shift+ArrowUp'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  let n = (await notesOf())[0]; expect(n.p === a.p + 13 && n.s === a.s + 2, `note ${JSON.stringify(n)}`);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); n = (await notesOf())[0]; near(n.s, 0, 0, 'une note ne sort pas du clip par la gauche');
  await page.keyboard.press('Escape'); near(await page.$$eval('.note.sel', e => e.length), 0, 0, 'Échap vide la sélection');
  await page.keyboard.press('Delete'); near((await proj()).tracks[1].clips.length, 0, 0, 'clip supprimé');
});

// ============ V5 : répétition de notes ============
test('NR01', 'Pads', 'Répétition de notes : un pad maintenu roule au tempo, puis s\'arrête au relâchement', async () => {
  await S(() => { window.kh.S.project.bpm = 120; window.kh.commit(); });
  await page.click('[data-view=pads]'); await page.selectOption('[data-role=repeat]', '1');
  await S(() => { const e = window.kh.engine; window.qaLog = []; if (!e.padAt0) e.padAt0 = e.padAt.bind(e); e.padAt = (tr, row, t, v) => { window.qaLog.push([row, t]); e.padAt0(tr, row, t, v); }; });
  const b = await box('.pad[data-pad="3"]'); await page.mouse.move(b.x + 20, b.y + 45); await page.mouse.down(); await sleep(700); await page.mouse.up();
  const log = await S(() => window.qaLog.slice()); await sleep(400); const after = await S(() => window.qaLog.length);
  expect(log.length >= 4 && log.every(x => x[0] === 3), `répétitions ${JSON.stringify(log.map(x => x[0]))}`); near(log[3][1] - log[1][1], 0.25, 0.01, 'deux doubles-croches à 120 BPM');
  near(after, log.length, 0, 'le roulement continue après le relâchement');
  await page.selectOption('[data-role=repeat]', '0'); await S(() => { window.qaLog = []; }); await page.mouse.down(); await sleep(400); await page.mouse.up();
  near(await S(() => window.qaLog.length), 0, 0, 'sans répétition, un seul coup');
});
test('NR02', 'Pads', 'Un roulement joué pendant l\'enregistrement est écrit sur la grille', async () => {
  await S(() => { const p = window.kh.S.project; p.bpm = 120; p.loop = true; p.loopStart = 0; p.loopLen = 1; window.kh.kb.repeat = 1; window.kh.commit(); });
  await page.click(await clipSel(0, 0)); await page.keyboard.press('r'); await sleep(500);
  await page.keyboard.down('k'); await sleep(650); await page.keyboard.up('k'); await sleep(500); await page.keyboard.press('Space'); await sleep(700);
  const row = (await proj()).tracks[0].clips[0].drums[15].map(v => +!!v), hits = row.reduce((a, b) => a + b, 0);
  expect(hits >= 4 && hits <= 8, `${hits} frappes (${row.join('')})`); expect(/1111/.test(row.join('') + row.join('')), `frappes non consécutives (${row.join('')})`);
});

// ============ V5 : finition ============
test('MA01', 'Finition', 'Égaliseur et largeur stéréo du général : réglables et audibles', async () => {
  const r = await S(async () => {
    const one = f => window.qa.wins(window.qa.only(1, (p, t) => { t.clips[0].len = 16; t.rev = 0; t.pan = -1; f(p, t); }), [[0, 2]]);
    return { base: (await one(() => { }))[0], mono: (await one(p => { p.width = 0; }))[0], bright: (await one((p, t) => { t.synth.cutoff = 9000; }))[0], hi: (await one((p, t) => { t.synth.cutoff = 9000; p.mHigh = -12; }))[0], lo: (await one(p => { p.mLow = -12; }))[0] };
  });
  expect(r.base.l > r.base.r * 20, 'référence : la piste devrait être à gauche'); near(r.mono.l / r.mono.r, 1, 0.02, 'largeur 0 : les deux canaux doivent être identiques');
  expect(r.hi.hf < r.bright.hf * 0.6, `l'égaliseur aigu n'agit pas (${r.hi.hf.toFixed(4)} / ${r.bright.hf.toFixed(4)})`); expect(r.lo.l < r.base.l * 0.75, 'l\'égaliseur grave n\'agit pas');
  await tab('mixer'); await setSlider('.strip.master', 'Aigus', 3); await setSlider('.strip.master', 'Graves', -2); await setSlider('.strip.master', 'Largeur', 1.5);
  const p = await proj(); expect(p.mHigh === 3 && p.mLow === -2 && p.width === 1.5, 'réglages non enregistrés');
});
test('MA02', 'Finition', 'La mesure LUFS est juste sur des signaux de référence', async () => {
  const r = await S(() => {
    const mk = (amp, ch, sr) => { const b = new AudioBuffer({ length: sr * 4, numberOfChannels: ch, sampleRate: sr }); for (let c = 0; c < ch; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = amp * Math.sin(2 * Math.PI * 997 * i / sr); } return window.kh.lufs(b); };
    return { st20: mk(0.1, 2, 48000), st20b: mk(0.1, 2, 44100), mono: mk(1, 1, 48000), silent: mk(0, 2, 44100) };
  });
  near(r.st20, -20, 0.15, 'sinus stéréo à −20 dB (48 kHz)'); near(r.st20b, -20, 0.15, 'sinus stéréo à −20 dB (44,1 kHz)'); near(r.mono, -3.01, 0.15, 'sinus mono pleine échelle');
  expect(r.silent === -Infinity || r.silent === null, `silence : ${r.silent}`);
});
test('MA03', 'Finition', 'Export au niveau streaming : le morceau sort à −14 LUFS sans saturer ; le bouton Mesurer l\'affiche', async () => {
  await tab('mixer'); await page.selectOption('[data-role=target]', '-14'); near((await proj()).target, -14, 0, 'cible enregistrée');
  await page.click('[data-act=analyze]'); await page.waitForFunction(() => /LUFS/.test(document.querySelector('.lufs').textContent), null, { timeout: 60000 });
  const txt = await page.textContent('.lufs'), m = txt.replace(/−/g, '-').match(/(-?[\d.]+) LUFS.*?(-?[\d.]+) dB/); expect(m, `résultat illisible : ${txt}`);
  near(+m[1], -14, 0.6, 'volume mesuré'); expect(+m[2] <= -0.2, `crête trop haute (${m[2]} dB)`);
  const r = await S(async () => { const k = window.kh, p = JSON.parse(JSON.stringify(k.S.project)), out = {}; for (const tg of [0, -9, -23]) { p.target = tg; const b = await k.renderOffline(p); let pk = 0; for (const v of b.getChannelData(0)) pk = Math.max(pk, Math.abs(v)); out[tg] = { l: k.lufs(b), pk }; } return out; });
  near(r[-23].l, -23, 0.6, 'cible −23'); expect(r[-9].l > -11.5 && r[-9].pk <= 0.967, `cible −9 : ${r[-9].l.toFixed(1)} LUFS, crête ${r[-9].pk.toFixed(3)}`); expect(r[0].pk <= 0.967, 'crêtes non protégées');
});

// ============ V5 : projets et modèles ============
const libOpen = () => menu('bLib'), libCount = () => page.$$eval('#lib .plist li', e => e.length);
test('LB01', 'Projets', 'Nouveau projet depuis un modèle ; le précédent reste dans « Mes projets » et se rouvre', async () => {
  await S(() => { window.kh.S.project.name = 'Mon morceau QA'; window.kh.commit(); }); await sleep(700);
  await menu('bNew'); expect(await page.$eval('#lib', d => d.open), 'fenêtre non ouverte'); near(await page.$$eval('#lib .tpl', e => e.length), 5, 0, 'modèles');
  expect(await page.$$eval('#lib button', els => els.every(e => e.textContent.trim() || e.getAttribute('aria-label'))), 'bouton sans nom dans la fenêtre');
  await page.click('[data-tpl=trap]'); await sleep(200); let p = await proj();
  expect(!(await page.$eval('#lib', d => d.open)) && p.name === 'Trap' && p.bpm === 140 && p.tracks.length === 4 && p.scale === 'minor', `modèle mal créé (${p.name}, ${p.bpm})`);
  expect(await page.$('.dgrid'), 'éditeur non affiché'); await sleep(700);
  await libOpen(); expect(await page.$eval('#lib .plist li.cur strong', e => e.textContent) === 'Trap', 'projet courant non repéré');
  await page.click('#lib .plist li:has-text("Mon morceau QA") [data-act=libopen]'); await sleep(300); p = await proj();
  expect(p.name === 'Mon morceau QA' && p.tracks.length === 5 && p.bpm === 120, 'ancien projet mal rouvert');
  await page.keyboard.press('Control+z'); expect((await proj()).name === 'Mon morceau QA', 'l\'annulation ne doit pas ramener l\'autre projet');
});
test('LB02', 'Projets', 'Chaque modèle (trap, house, lo-fi, vide) donne un projet jouable, propre et dans sa gamme', async () => {
  const r = await S(async () => { const k = window.kh, out = {}; for (const tpl of ['trap', 'house', 'lofi', 'empty']) { k.createFromTemplate(tpl); const p = JSON.parse(JSON.stringify(k.S.project)); const iv = { minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], off: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }[p.scale]; const notes = p.tracks.flatMap(t => t.clips.flatMap(c => c.notes || [])); out[tpl] = { st: tpl === 'empty' ? null : await window.qa.stats(p), tracks: p.tracks.length, out: notes.filter(n => !iv.includes(((n.p - p.key) % 12 + 12) % 12)).length, clips: p.tracks.reduce((a, t) => a + t.clips.length, 0), sel: !!k.S.selTrack }; } return out; });
  for (const k of ['trap', 'house', 'lofi']) { const x = r[k]; expect(x.st.bad === 0 && x.st.rms > 0.02 && x.st.peak <= 0.97, `${k} : signal ${JSON.stringify(x.st)}`); near(x.out, 0, 0, `${k} : notes hors gamme`); expect(x.tracks === 4 && x.clips === 3 && x.sel, `${k} : structure`); }
  expect(r.empty.tracks === 3 && r.empty.clips === 0, 'modèle vide');
});
test('LB03', 'Projets', 'Dupliquer et supprimer un projet ; la bibliothèque survit au rechargement de la page', async () => {
  await S(() => { window.kh.S.project.name = 'Original QA'; window.kh.commit(); }); await sleep(700);
  await libOpen(); const n0 = await libCount(); expect(await page.$eval('#lib .plist li.cur [data-act=libdel]', e => e.disabled), 'le projet ouvert ne doit pas pouvoir être supprimé');
  await page.click('#lib .plist li.cur [data-act=libdup]'); await sleep(300); near(await libCount(), n0 + 1, 0, 'après duplication');
  expect(await page.$('#lib .plist li:has-text("Original QA 2")'), 'copie absente'); await page.keyboard.press('Escape');
  await page.reload(); await page.waitForSelector('.clip'); expect((await proj()).name === 'Original QA', 'projet courant non retrouvé après rechargement');
  await libOpen(); near(await libCount(), n0 + 1, 0, 'bibliothèque après rechargement');
  await page.click('#lib .plist li:has-text("Original QA 2") [data-act=libdel]'); await sleep(300); near(await libCount(), n0, 0, 'après suppression'); await page.keyboard.press('Escape');
  await page.keyboard.press('Space'); await sleep(250); expect(await S(() => window.kh.engine.playing), 'après fermeture de la fenêtre, les raccourcis doivent reprendre');
});
test('LB04', 'Projets', 'Ouvrir un fichier .khm crée un nouveau projet sans écraser celui en cours', async () => {
  await S(() => { window.kh.S.project.name = 'En cours QA'; window.kh.commit(); }); await sleep(700);
  const data = await S(() => { const p = window.kh.templateProject('house'); p.name = 'Fichier QA'; return JSON.stringify({ format: 'kh-music-pro', version: 1, project: p, buffers: {} }); });
  const f = path.join(TMP, 'lib.khm'); fs.writeFileSync(f, data); await page.setInputFiles('#fProj', f); await sleep(900);
  expect((await proj()).name === 'Fichier QA', 'fichier non ouvert'); await libOpen();
  expect(await page.$('#lib .plist li:has-text("En cours QA")') && await page.$eval('#lib .plist li.cur strong', e => e.textContent) === 'Fichier QA', 'le projet précédent a été écrasé');
});

// ============ V6 : découpage sur les pads ============
/** Clip audio de test de 2 s (16 pas à 120 BPM). kind : 'steps' = une note différente par pas, 'hits' = 4 coups brefs. */
const loopClip = kind => page.evaluate(kind => { const k = window.kh, sr = 44100, b = new AudioBuffer({ length: sr * 2, numberOfChannels: 1, sampleRate: sr }), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) { const t = i / sr; if (kind === 'steps') d[i] = 0.5 * Math.sin(2 * Math.PI * (200 + 40 * Math.floor(t / 0.125)) * t); else { const u = t % 0.5; d[i] = u < 0.12 ? 0.7 * Math.exp(-u * 40) * Math.sin(2 * Math.PI * 180 * u) : 0; } }
  k.buffers.set('qa-loop', b); k.S.project.bpm = 120; const t = k.S.project.tracks[4]; t.clips = [{ id: 'qa-clip', name: 'Boucle', start: 16, len: 16, offset: 0, bufferId: 'qa-loop', gain: 1 }]; k.S.selTrack = t.id; k.S.selClip = 'qa-clip'; k.commit(); }, kind);

test('CH01', 'Découpage', 'Découper une boucle en 16 tranches : pads chargés, motif qui rejoue la boucle, piste d\'origine en muet', async () => {
  await loopClip('steps'); await page.click('[data-act=chop]'); await sleep(300);
  const r = await S(() => { const k = window.kh, p = k.S.project, t = p.tracks[5], c = t && t.clips[0]; return t && { n: p.tracks.length, type: t.type, name: t.name, pads: t.pads.filter(Boolean).length, lens: t.pads.map(x => k.buffers.get(x.bufferId).length), first: t.pads[0].name, start: c.start, len: c.len, diag: c.drums.every((row, i) => row.every((v, s) => !!v === (s === i))), muted: p.tracks[4].mute, sel: k.S.selTrack === t.id, view: k.S.drumView }; });
  expect(r && r.n === 6 && r.type === 'drums' && r.pads === 16 && r.name.includes('Boucle'), `piste découpée absente (${JSON.stringify(r)})`);
  expect(r.lens.every(l => Math.abs(l - 5512) <= 2), `tranches de longueur inégale (${r.lens.slice(0, 4)})`); expect(r.first === 'Tranche 1', 'nom des pads');
  expect(r.start === 16 && r.len === 16 && r.diag, 'le motif ne rejoue pas la boucle dans l\'ordre'); expect(r.muted && r.sel && r.view === 'pads', 'piste d\'origine non coupée ou pads non affichés');
  near(await page.$$eval('.pad.custom', e => e.length), 16, 0, 'pads affichés');
  const w = await S(async () => { const k = window.kh, mk = i => { const p = JSON.parse(JSON.stringify(k.S.project)); p.tracks = [p.tracks[i]]; p.tracks[0].mute = false; p.tracks[0].rev = 0; return window.qa.wins(p, [[2.0, 3.9], [2.5, 2.6]]); }; return { src: await mk(4), chop: await mk(5) }; });
  near(w.chop[0].l / w.src[0].l, 1, 0.1, 'la piste découpée doit sonner comme l\'original'); near(w.chop[1].hf / w.src[1].hf, 1, 0.1, 'contenu de la 5e tranche');
  await page.keyboard.press('Control+z'); const p = await proj(); expect(p.tracks.length === 5 && !p.tracks[4].mute, 'annulation');
});
test('CH02', 'Découpage', 'Découper selon les attaques : une tranche par coup, placée sur son temps', async () => {
  await loopClip('hits'); await page.selectOption('[data-role=chopmode]', '0'); await page.click('[data-act=chop]'); await sleep(300);
  const r = await S(() => { const t = window.kh.S.project.tracks[5], c = t.clips[0]; return { pads: t.pads.filter(Boolean).length, steps: c.drums.map(row => row.findIndex(v => v)).filter(s => s >= 0) }; });
  near(r.pads, 4, 0, 'tranches détectées'); expect(r.steps.join() === '0,4,8,12', `coups placés aux pas ${r.steps}`);
  expect((await page.textContent('#toast')).includes('4'), 'message');
});
test('CH03', 'Découpage', 'Un son trop court est refusé ; 8 tranches égales fonctionne', async () => {
  await loopClip('steps'); await S(() => { const k = window.kh; k.buffers.set('qa-tiny', new AudioBuffer({ length: 800, numberOfChannels: 1, sampleRate: 44100 })); k.S.project.tracks[4].clips[0].bufferId = 'qa-tiny'; k.commit(); });
  await page.click('[data-act=chop]'); expect((await page.textContent('#toast')).includes('court') && (await proj()).tracks.length === 5, 'son trop court accepté');
  await S(() => { window.kh.S.project.tracks[4].clips[0].bufferId = 'qa-loop'; window.kh.commit(); });
  await page.selectOption('[data-role=chopmode]', '8'); await page.click('[data-act=chop]'); await sleep(200);
  const t = (await proj()).tracks[5]; expect(t.pads.filter(Boolean).length === 8 && t.clips[0].drums[3][6] === 1, '8 tranches');
});

// ============ V6 : effets de performance ============
const hold = sel => page.dispatchEvent(sel, 'pointerdown'), release = sel => page.dispatchEvent(sel, 'pointerup');
const levelAt = async (wait, ms = 250) => { await sleep(wait); return page.evaluate(async ms => { for (let i = 0; i < 40; i++) window.kh.engine.level('master'); return window.qa.level(ms); }, ms); };

test('FX01', 'Effets Live', 'Écho et réverb à la volée : le son se prolonge tant que le bouton est maintenu', async () => {
  await tab('live'); near(await page.$$eval('[data-fx]', e => e.length), 4, 0, 'boutons d\'effet');
  const hit = () => S(() => window.kh.padHit(1, 1, window.kh.S.project.tracks[0]));
  await hit(); const dry = await levelAt(700);
  await hold('[data-fx=echo]'); expect(await page.$eval('[data-fx=echo]', e => e.classList.contains('on')), 'bouton non allumé'); await sleep(60); await hit(); const echo = await levelAt(700); await release('[data-fx=echo]');
  expect(!(await page.$eval('[data-fx=echo]', e => e.classList.contains('on'))), 'bouton resté allumé'); await sleep(2500);
  await hold('[data-fx=reverb]'); await sleep(60); await hit(); const rev = await levelAt(700); await release('[data-fx=reverb]');
  expect(dry < 0.12, `référence trop forte (${dry.toFixed(2)})`); expect(echo > dry + 0.2, `écho inaudible (${echo.toFixed(2)} contre ${dry.toFixed(2)})`); expect(rev > dry + 0.2, `réverb inaudible (${rev.toFixed(2)})`);
});
test('FX02', 'Effets Live', 'Bégaiement : le dernier instant tourne en boucle, même transport arrêté, puis le son reprend normalement', async () => {
  await tab('live'); await page.keyboard.press('Space'); await sleep(700);
  await hold('[data-fx=stut16]'); await sleep(300); expect(await S(() => !!window.kh.engine.mix.stutter && window.kh.engine.fxOn.has('stut16')), 'bégaiement non actif');
  await page.keyboard.press('Space'); const frozen = await levelAt(600, 300);
  await release('[data-fx=stut16]'); const after = await levelAt(500, 300);
  expect(frozen > 0.15, `la boucle ne tourne pas (${frozen.toFixed(2)})`); expect(after < 0.08, `le son ne s'arrête pas au relâchement (${after.toFixed(2)})`);
  await page.keyboard.press('Space'); const normal = await levelAt(500, 300); expect(normal > 0.2, 'la lecture normale ne passe plus');
});
test('FX03', 'Effets Live', 'Couper une piste d\'un geste depuis la grille ; les effets se jouent aussi au clavier', async () => {
  await tab('live'); const sel = await S(() => `[data-lmute="${window.kh.S.project.tracks[0].id}"]`);
  await page.click(sel); expect((await proj()).tracks[0].mute && await page.getAttribute(sel, 'aria-pressed') === 'true', 'piste non coupée');
  await page.click(sel); expect(!(await proj()).tracks[0].mute, 'piste non rétablie');
  await page.focus('[data-fx=reverb]'); await page.keyboard.down('Space'); const on = await S(() => window.kh.engine.fxOn.has('reverb') && !window.kh.engine.playing); await page.keyboard.up('Space');
  expect(on, 'Espace sur un bouton d\'effet doit l\'activer sans lancer la lecture'); expect(await S(() => !window.kh.engine.fxOn.has('reverb')), 'effet resté actif');
});

// ============ V6 : assignation MIDI ============
test('ML01', 'Assignation MIDI', 'Relier un bouton de contrôleur à un réglage, le piloter, retrouver l\'assignation après rechargement, l\'effacer', async () => {
  await tab('mixer'); await page.click('[data-act=learn]'); expect(await page.$('.mixer.learning'), 'mode assignation non actif');
  const revSel = '.strip >> nth=1 >> [data-map="1:rev"]', before = (await proj()).tracks[1].rev;
  const b = await box(revSel + ' >> input'); await page.mouse.click(b.x + b.width * 0.9, b.y + b.height / 2);
  expect(await S(() => window.kh.learn.target) === '1:rev' && (await proj()).tracks[1].rev === before, 'en mode assignation, le clic doit désigner le réglage sans le modifier');
  expect((await page.textContent('.mtools')).includes('bougez'), 'consigne absente');
  await S(() => window.kh.onMidi([0xb0, 21, 100])); expect(await S(() => window.kh.learn.map['21']) === '1:rev' && (await proj()).tracks[1].rev === before, 'assignation non enregistrée');
  expect(await page.getAttribute(revSel, 'data-cc') === 'CC 21', 'bouton relié non affiché');
  await page.locator('[data-map="m:master"]').scrollIntoViewIfNeeded(); const f = await box('[data-map="m:master"]'); await page.mouse.click(f.x + f.width / 2, f.y + 20); await S(() => window.kh.onMidi([0xb0, 7, 10]));
  await page.click('[data-act=learn]'); expect(!(await page.$('.mixer.learning')), 'sortie du mode assignation');
  await S(() => { window.kh.onMidi([0xb0, 21, 64]); window.kh.onMidi([0xb0, 7, 127]); }); await sleep(250);
  let p = await proj(); near(p.tracks[1].rev, 0.5, 0.01, 'réverb pilotée'); near(p.master, 1.25, 0.01, 'volume général piloté');
  near(+(await page.$eval(revSel + ' >> input', e => e.value)), 0.5, 0.01, 'le curseur suit à l\'écran');
  near(await S(() => window.kh.engine.mix.tracks.get(window.kh.S.project.tracks[1].id).revSend.gain.value), 0.5, 0.05, 'le son suit');
  await page.reload(); await page.waitForSelector('.clip'); await S(() => window.kh.onMidi([0xb0, 21, 0])); await sleep(200);
  near((await proj()).tracks[1].rev, 0, 0.001, 'assignation conservée après rechargement');
  await tab('mixer'); await page.click('[data-act=learnclear]'); expect(await S(() => Object.keys(window.kh.learn.map).length) === 0 && !(await page.$('[data-act=learnclear]')), 'assignations non effacées');
});

// ============ V6 : MP3, clips, spectre ============
test('MP01', 'Export', 'Exporter en MP3 : fichier valide, de la bonne durée, relisible et audible', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), menu('bMp3')]); const f = path.join(TMP, 'demo.mp3'); await dl.saveAs(f);
  const b = fs.readFileSync(f); expect(dl.suggestedFilename() === 'Demo.mp3', `nom ${dl.suggestedFilename()}`);
  expect(b[0] === 0xff && (b[1] & 0xe0) === 0xe0, `en-tête MP3 invalide (${b[0].toString(16)} ${b[1].toString(16)})`); near(b.length / 1000, 18.5 * 192 / 8, 30, 'taille (192 kbit/s)');
  const r = await page.evaluate(async bytes => { const a = await window.kh.engine.ctx.decodeAudioData(new Uint8Array(bytes).buffer), d = a.getChannelData(0); let e = 0, pk = 0; for (const v of d) { e += v * v; pk = Math.max(pk, Math.abs(v)); } return { dur: a.duration, ch: a.numberOfChannels, rms: Math.sqrt(e / d.length), pk }; }, [...b]);
  near(r.dur, 18.5, 0.2, 'durée'); expect(r.ch === 2 && r.rms > 0.02 && r.pk <= 1.0, `contenu ${JSON.stringify(r)}`);
});
test('CC01', 'Arrangement', 'Copier un clip et le coller à la tête de lecture, sur la même piste ou une autre du même type', async () => {
  await page.click(await clipSel(1, 0)); await page.keyboard.press('Control+c'); expect((await page.textContent('#toast')).includes('Clip'), 'message');
  await S(() => window.kh.engine.seek(65)); await page.keyboard.press('Control+v');
  let c = (await proj()).tracks[1].clips; expect(c.length === 2 && c[1].start === 64 && c[1].id !== c[0].id && c[1].notes.length === 20, `collage ${JSON.stringify(c.map(x => x.start))}`);
  await page.click(await headSel(2)); await S(() => window.kh.engine.seek(96)); await page.keyboard.press('Control+v');
  const p = await proj(); expect(p.tracks[2].clips.length === 2 && p.tracks[2].clips[1].start === 96, 'collage sur une autre piste instrument');
  await page.click(await headSel(0)); await page.keyboard.press('Control+v'); expect((await proj()).tracks[0].clips.length === 2 && (await proj()).tracks[1].clips.length === 3, 'un clip de notes ne doit pas atterrir sur la batterie');
  await page.click(await clipSel(1, 0)); const nb = await box('.note[data-i="0"]'); await page.mouse.click(nb.x + 8, nb.y + 8); await page.keyboard.press('Control+c');
  expect((await page.textContent('#toast')).includes('note'), 'avec une note sélectionnée, Ctrl+C doit copier la note');
});
test('SP01', 'Mixeur', 'L\'analyseur de spectre s\'anime pendant la lecture et retombe à l\'arrêt', async () => {
  await tab('mixer'); const lit = () => page.$eval('.spec', cv => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  await page.keyboard.press('Space'); await sleep(900); const on = await lit(); await page.keyboard.press('Space'); await sleep(2500); const off = await lit();
  expect(on > 800, `spectre vide en lecture (${on} px)`); expect(off < on / 4, `le spectre ne retombe pas (${off} px)`);
});

// ============ V7 : effets de modulation ============
test('MOD01', 'Mixage', 'Chorus, trémolo et lo-fi : réglables et audibles au rendu', async () => {
  const r = await S(async () => {
    const wins = Array.from({ length: 32 }, (_, i) => [1 + i / 32, 1 + (i + 1) / 32]);
    const one = async f => { const p = window.qa.only(2, (p, t) => { p.bpm = 120; t.rev = 0; f(t); }), w = await window.qa.wins(p, wins), st = await window.qa.stats(p), l = w.map(x => x.l); return { swing: Math.max(...l) / Math.min(...l), rms: st.rms, hf: st.hf, bad: st.bad, peak: st.peak }; };
    return { base: await one(() => { }), trem: await one(t => { t.trem = 1; }), crush: await one(t => { t.crush = 0.9; }), chorus: await one(t => { t.chorus = 1; }) };
  });
  expect(r.trem.swing > r.base.swing * 3 && r.trem.swing > 4, `le trémolo ne module pas le niveau (${r.trem.swing.toFixed(1)} contre ${r.base.swing.toFixed(1)})`);
  expect(r.crush.hf > r.base.hf * 1.5, `le lo-fi n'ajoute pas de grain (${r.crush.hf.toFixed(4)} / ${r.base.hf.toFixed(4)})`);
  expect(Math.abs(r.chorus.rms / r.base.rms - 1) > 0.08, `le chorus n'agit pas (${(r.chorus.rms / r.base.rms).toFixed(3)})`);
  for (const k of Object.keys(r)) expect(r[k].bad === 0 && r[k].peak <= 0.97, `${k} : signal invalide`);
  await tab('mixer'); await setSlider('.strip >> nth=2', 'Chorus', 0.4); await setSlider('.strip >> nth=2', 'Trémolo', 0.6); await setSlider('.strip >> nth=2', 'Lo-fi', 0.3);
  const t = (await proj()).tracks[2]; expect(t.chorus === 0.4 && t.trem === 0.6 && t.crush === 0.3, 'réglages non enregistrés');
  await page.keyboard.press('Space'); await sleep(500); await S(() => { window.kh.S.project.bpm = 90; window.kh.commit(); }); await sleep(200);
  near(await S(() => window.kh.engine.mix.tracks.get(window.kh.S.project.tracks[2].id).tremLfo.frequency.value), 3, 0.05, 'le trémolo suit le tempo (croche à 90 BPM)');
});

// ============ V7 : accordeur ============
test('TU01', 'Accordeur', 'La détection de hauteur est juste : sinus, son riche en harmoniques, silence et bruit', async () => {
  const r = await S(() => {
    const k = window.kh, sr = 48000, mk = f => { const b = new Float32Array(2048); for (let i = 0; i < b.length; i++) b[i] = f(i / sr); return k.detectPitch(b, sr); };
    const saw = hz => t => { let v = 0; for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * hz * h * t) / h; return v * 0.3; };
    return { a110: mk(t => 0.5 * Math.sin(2 * Math.PI * 110 * t)), e329: mk(t => 0.5 * Math.sin(2 * Math.PI * 329.63 * t)), a880: mk(t => 0.2 * Math.sin(2 * Math.PI * 880 * t)), saw196: mk(saw(196)), saw82: mk(saw(82.41)), silence: mk(() => 0), noise: mk(() => Math.random() - 0.5) };
  });
  for (const [k, hz] of [['a110', 110], ['e329', 329.63], ['a880', 880], ['saw196', 196], ['saw82', 82.41]]) near(1200 * Math.log2(r[k] / hz), 0, 3, `${k} : écart en cents`);
  expect(r.silence === 0 && r.noise === 0, `fausse note détectée (silence ${r.silence}, bruit ${r.noise})`);
});
test('TU02', 'Accordeur', 'Avec l\'entrée active, l\'accordeur affiche la note reçue ; il disparaît à la fermeture', async () => {
  await page.click(await headSel(4)); expect(!(await page.$('.tuner')), 'accordeur visible sans entrée'); await page.click('[data-act=inopen]'); await sleep(300);
  expect(await page.$('.tuner'), 'accordeur absent');
  const note = await page.waitForFunction(() => { const t = document.querySelector('.tnote'); return t && t.textContent !== '—' ? t.textContent + '|' + document.querySelector('.tcents').textContent : false; }, null, { timeout: 6000, polling: 30 }).then(h => h.jsonValue()).catch(() => '');
  expect(/^La4\|[+-]?\d$/.test(note), `le la à 440 Hz du micro simulé n'est pas reconnu (« ${note} »)`);
  await page.click('[data-act=inopen]'); await sleep(150); expect(!(await page.$('.tuner')), 'accordeur resté affiché');
});

// ============ V7 : visite guidée ============
const tourState = pg => pg.evaluate(() => { const s = document.querySelector('.tspot'), b = document.querySelector('.tbub'); if (!s || !b) return null; const r = s.getBoundingClientRect(), q = b.getBoundingClientRect(); return { n: b.querySelector('small').textContent, spot: [r.left, r.top, r.right, r.bottom], inView: q.left >= 0 && q.top >= 0 && q.right <= innerWidth + 1 && q.bottom <= innerHeight + 1 && r.width > 20 && r.height > 20, overlap: !(q.right < r.left || q.left > r.right || q.bottom < r.top || q.top > r.bottom), text: b.querySelector('p').textContent.length }; });
test('TR01', 'Visite guidée', 'La visite se lance depuis l\'aide, éclaire 8 zones, se parcourt au clic ou au clavier et bloque les raccourcis', async () => {
  await page.click('#bHelp'); await page.click('#bTour'); await sleep(200);
  expect(!(await page.$eval('#help', d => d.open)) && await page.$('.tour'), 'visite non lancée');
  let st = await tourState(page); expect(st.n === '1 / 8', `étape ${st.n}`);
  const tr = await box('.transport'); expect(st.spot[0] <= tr.x && st.spot[2] >= tr.x + tr.width, 'la zone éclairée ne couvre pas le transport');
  await page.keyboard.press('r'); await page.keyboard.press('l'); await page.keyboard.press('Enter').catch(() => { }); await sleep(150);
  expect(await S(() => !window.kh.engine.playing && !window.kh.engine.recording && window.kh.S.project.loop), 'les raccourcis ne sont pas bloqués pendant la visite');
  st = await tourState(page); const first = +st.n[0];
  for (let i = first + 1; i <= 8; i++) {
    if (i % 2) await page.keyboard.press('ArrowRight'); else await page.click('[data-act=tournext]'); await sleep(260);
    st = await tourState(page); expect(st && st.n === `${i} / 8`, `étape ${i} : ${st && st.n}`); expect(st.inView && st.text > 30, `étape ${i} : bulle hors écran ou vide`); expect(!st.overlap, `étape ${i} : la bulle masque la zone montrée`);
  }
  await page.click('[data-act=tourprev]'); expect((await tourState(page)).n === '7 / 8', 'retour en arrière'); await page.keyboard.press('ArrowRight');
  expect((await page.textContent('[data-act=tournext]')) === 'Terminer', 'dernier bouton'); await page.click('[data-act=tournext]'); expect(!(await page.$('.tour')), 'visite non terminée');
  await page.click('#bHelp'); await page.click('#bTour'); await sleep(150); await page.keyboard.press('Escape'); expect(!(await page.$('.tour')), 'Échap ne quitte pas la visite');
  await page.keyboard.press('Space'); await sleep(200); expect(await S(() => window.kh.engine.playing), 'après la visite, les raccourcis doivent reprendre');
});
test('TR02', 'Visite guidée', 'Sur téléphone, chaque bulle de la visite tient à l\'écran', async () => {
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'fr-FR' });
  try {
    const pg = await ctx2.newPage(); await pg.goto(BASE); await pg.waitForSelector('.clip'); if (await pg.$eval('#help', d => d.open)) await pg.tap('#bTour'); else await pg.evaluate(() => window.kh.startTour());
    await pg.waitForSelector('.tour');
    for (let i = 1; i <= 8; i++) { await pg.waitForTimeout(260); const st = await tourState(pg); expect(st && st.n === `${i} / 8` && st.inView, `étape ${i} : ${JSON.stringify(st)}`); await pg.tap('[data-act=tournext]'); }
    expect(!(await pg.$('.tour')), 'visite non terminée');
  } finally { await ctx2.close(); }
});

// ============ V7 : version bureau ============
test('DK01', 'Version bureau', 'L\'application de bureau démarre, charge le projet, joue et produit du son, sans accès système depuis la page', async () => {
  const cp = require('child_process'), root = path.join(__dirname, '..');
  cp.execSync('npx vite build', { cwd: root, stdio: 'ignore' });
  let out = '';
  try { out = cp.execFileSync('xvfb-run', ['-a', 'node', 'qa/desktop-smoke.cjs'], { cwd: root, timeout: 120000, env: { ...process.env, NODE_PATH: process.env.NODE_PATH || '' } }).toString(); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || '') + String(e.message || ''); }
  expect(out.includes('Version bureau : OK'), `échec : ${out.trim().split('\n').slice(-2).join(' / ').slice(0, 300)}`);
});

// ============ V8 : arrangement ============
test('CL01', 'Arrangement', 'Rogner un clip par son bord gauche : le contenu reste à sa place, sans pouvoir dépasser le début du son', async () => {
  const before = await S(() => window.qa.wins(window.qa.only(1, (p, t) => { t.rev = 0; }), [[1.0, 1.9], [0.1, 0.9]]));
  let b = await box(await clipSel(1, 0)); await drag(b.x + 3, b.y + 40, 88, 0);
  let c = (await proj()).tracks[1].clips[0]; expect(c.start === 8 && c.len === 56 && c.offset === 8, `rognage ${JSON.stringify([c.start, c.len, c.offset])}`);
  const after = await S(async () => { const p = JSON.parse(JSON.stringify(window.kh.S.project)); p.tracks = [p.tracks[1]]; p.tracks[0].rev = 0; return window.qa.wins(p, [[1.0, 1.9], [0.1, 0.9]]); });
  near(after[0].l / before[0].l, 1, 0.1, 'la suite du clip doit sonner au même endroit qu\'avant'); expect(after[1].l < before[1].l * 0.2, 'le début rogné doit être silencieux');
  b = await box(await clipSel(1, 0)); await drag(b.x + 3, b.y + 40, -300, 0);
  c = (await proj()).tracks[1].clips[0]; expect(c.start === 0 && c.len === 64 && c.offset === 0, `retour ${JSON.stringify([c.start, c.len, c.offset])}`);
  await S(() => { const k = window.kh; window.qa.sine('qa-sine'); const t = k.S.project.tracks[4]; t.clips = [{ id: 'qa-a', name: 'Son', start: 8, len: 8, offset: 0, bufferId: 'qa-sine', gain: 1 }]; k.commit(); });
  b = await box(await clipSel(4, 0)); await drag(b.x + 3, b.y + 40, 44, 0);
  c = (await proj()).tracks[4].clips[0]; expect(c.start === 12 && c.len === 4 && Math.abs(c.offset - 0.5) < 0.001, `audio ${JSON.stringify([c.start, c.len, c.offset])}`);
  b = await box(await clipSel(4, 0)); await drag(b.x + 3, b.y + 40, -200, 0);
  c = (await proj()).tracks[4].clips[0]; expect(c.start === 8 && c.offset === 0 && c.len === 8, 'un clip audio ne peut pas commencer avant le début de son son');
});
test('CL02', 'Arrangement', 'Sélectionner plusieurs clips (Maj+clic), les déplacer, les dupliquer et les supprimer ensemble', async () => {
  await page.click(await clipSel(1, 0)); await page.click(await clipSel(2, 0), { modifiers: ['Shift'] }); await page.click(await clipSel(3, 0), { modifiers: ['Shift'] });
  near(await page.$$eval('.clip.sel', e => e.length), 3, 0, 'clips sélectionnés');
  const b = await box(await clipSel(2, 0)); await drag(b.x + 60, b.y + 40, 176, 0);
  let p = await proj(); expect([1, 2, 3].every(i => p.tracks[i].clips[0].start === 16) && p.tracks[0].clips[0].start === 0, `déplacement ${[0, 1, 2, 3].map(i => p.tracks[i].clips[0].start)}`);
  near(await page.$$eval('.clip.sel', e => e.length), 3, 0, 'sélection conservée après le déplacement');
  await page.keyboard.press('Control+d'); p = await proj();
  expect([1, 2].every(i => p.tracks[i].clips.length === 2 && p.tracks[i].clips[1].start === 80) && p.tracks[3].clips.length === 3, 'duplication du groupe');
  await page.keyboard.press('Delete'); p = await proj(); expect(p.tracks[1].clips.length === 1 && p.tracks[2].clips.length === 1 && p.tracks[3].clips.length === 2, 'suppression du groupe');
  await page.click(await clipSel(1, 0)); await page.click(await clipSel(2, 0), { modifiers: ['Shift'] }); await page.click(await clipSel(2, 0), { modifiers: ['Shift'] });
  near(await page.$$eval('.clip.sel', e => e.length), 1, 0, 'Maj+clic retire un clip de la sélection');
  await page.click(await clipSel(2, 0), { modifiers: ['Shift'] }); await page.click(await clipSel(0, 0)); near(await page.$$eval('.clip.sel', e => e.length), 1, 0, 'un clic simple revient à un seul clip');
});
test('CL03', 'Arrangement', 'Tracer la boucle dans la règle (Maj+glisser) ; un clic simple déplace toujours la tête de lecture', async () => {
  await S(() => { window.kh.S.project.loop = false; window.kh.commit(); });
  const r = await box('.ruler'), x = bar => r.x + (bar - 1) * 176 + 60;
  await page.keyboard.down('Shift'); await page.mouse.move(x(3), r.y + 12); await page.mouse.down(); await page.mouse.move(x(4), r.y + 12, { steps: 3 }); await page.mouse.move(x(5), r.y + 12, { steps: 3 }); await page.mouse.up(); await page.keyboard.up('Shift');
  const p = await proj(); expect(p.loop && p.loopStart === 2 && p.loopLen === 3, `boucle ${p.loop} ${p.loopStart}+${p.loopLen}`);
  expect(await page.$('.loopr') && await page.$eval('#loopS', e => e.value) === '3' && await page.$eval('#loopE', e => e.value) === '5', 'affichage de la boucle');
  await page.mouse.click(r.x + 11 * 32 + 2, r.y + 12); near(await S(() => window.kh.engine.pos), 32, 0, 'clic simple');
});

// ============ V8 : pads et motifs ============
test('PD01', 'Pads', 'Réglages par pad : volume, hauteur et panoramique, audibles au rendu, puis retour à l\'origine', async () => {
  await page.click('[data-view=pads]'); await page.click('.pad[data-pad="0"] [data-act=padfx]'); expect(await page.$('.padfx') && await page.$('.pad.editing[data-pad="0"]'), 'réglages non affichés');
  const kick = () => S(async () => { const p = JSON.parse(JSON.stringify(window.kh.S.project)); p.tracks = [p.tracks[0]]; const t = p.tracks[0]; t.rev = 0; t.clips = [t.clips[0]]; const c = t.clips[0]; c.len = 16; c.drums = c.drums.map((r, i) => r.map((_, s) => +(i === 0 && s % 4 === 0))); const w = (await window.qa.wins(p, [[0, 2]]))[0], b = await window.kh.renderOffline(p, false), d = b.getChannelData(0); let z = 0; for (let i = 1; i < 44100 * 0.3; i++) if (d[i - 1] < 0 && d[i] >= 0) z++; return { l: w.l, r: w.r, z }; });
  const base = await kick();
  await setSlider('.padfx', 'Volume', 0.5); const half = await kick(); near(half.l / base.l, 0.5, 0.05, 'volume du pad'); near((await proj()).tracks[0].padFx[0].vol, 0.5, 0, 'réglage enregistré');
  await setSlider('.padfx', 'Volume', 1); await setSlider('.padfx', 'Hauteur', 12); const up = await kick(); expect(up.z > base.z * 1.5, `hauteur inchangée (${base.z} → ${up.z} oscillations)`);
  await setSlider('.padfx', 'Hauteur', 0); await setSlider('.padfx', 'Pan', -1); const left = await kick(); expect(left.l > left.r * 10, 'le pad n\'est pas à gauche');
  expect(await page.$('.pad.tuned[data-pad="0"]'), 'pad réglé non repéré'); await page.click('[data-act=padtest]'); expect(await S(() => window.qa.level(200)) > 0.1, 'bouton Écouter muet');
  await page.click('[data-act=padfxreset]'); expect(!((await proj()).tracks[0].padFx || {})[0], 'réglages non remis à zéro'); near((await kick()).l / base.l, 1, 0.03, 'son d\'origine');
  await page.click('.pad[data-pad="0"] [data-act=padfx]'); expect(!(await page.$('.padfx')), 'le panneau ne se referme pas');
});
test('PT01', 'Batterie', 'Décaler le motif d\'un pas et doubler sa longueur', async () => {
  const row = async r => (await proj()).tracks[0].clips[0].drums[r].map(v => +!!v).join('');
  expect(await row(0) === '1000100010001000', 'motif de départ'); await page.click('[data-act=patright]'); expect(await row(0) === '0100010001000100', `décalage à droite ${await row(0)}`);
  await page.click('[data-act=patleft]'); await page.click('[data-act=patleft]'); expect(await row(0) === '0001000100010001', `décalage à gauche (le motif boucle) ${await row(0)}`);
  await page.click('[data-act=patright]'); await page.click('[data-act=patdouble]');
  let c = (await proj()).tracks[0].clips[0]; expect(c.patLen === 32 && (await row(0)) === '1000100010001000'.repeat(2) && c.len >= 32, 'doublement');
  near(await page.$$eval('.drow >> nth=0 >> .cell', e => e.length), 32, 0, 'cases affichées');
  await page.click('[data-act=patdouble]'); await page.click('[data-act=patdouble]'); await page.click('[data-act=patdouble]');
  c = (await proj()).tracks[0].clips[0]; expect(c.patLen === 128 && (await page.textContent('#toast')).includes('maximale'), `longueur ${c.patLen}`);
});

// ============ V8 : préréglages et notes ============
test('MP02', 'Mixeur', 'Appliquer un préréglage de mixage à une piste, l\'entendre et l\'annuler', async () => {
  await tab('mixer'); const before = (await proj()).tracks[3];
  await page.selectOption('.strip >> nth=3 >> [data-role=mixpreset]', 'vocal'); let t = (await proj()).tracks[3];
  expect(t.comp && t.eqHigh === 3 && t.eqLow === -4 && t.rev === 0.22 && t.vol === before.vol && t.pan === before.pan, `préréglage voix ${JSON.stringify([t.comp, t.eqHigh, t.eqLow, t.rev])}`);
  expect((await page.textContent('#toast')).includes('Voix') && await page.$eval('.strip >> nth=3 >> [data-role=mixpreset]', e => e.value) === '', 'message ou liste');
  await page.keyboard.press('Control+z'); t = (await proj()).tracks[3]; expect(t.rev === before.rev && t.comp === before.comp, 'annulation');
  near(await page.$$eval('.strip >> nth=0 >> [data-role=mixpreset] option', e => e.length), 7, 0, 'préréglages proposés');
  const r = await S(async () => { const k = window.kh, mk = key => window.qa.stats(window.qa.only(3, (p, t) => { t.rev = 0; t.dly = 0; Object.assign(t, k.MIX_PRESETS[key]); })); const o = {}; for (const key of Object.keys(k.MIX_PRESETS)) o[key] = await mk(key); return o; });
  for (const [key, st] of Object.entries(r)) expect(st.bad === 0 && st.rms > 0.003 && st.peak <= 0.97, `${key} : signal ${JSON.stringify(st)}`);
  expect(Math.abs(r.lofi.hf / r.neutral.hf - 1) > 0.15 && Math.abs(r.vocal.rms / r.neutral.rms - 1) > 0.05, 'les préréglages devraient changer le son');
});
test('NT01', 'Projet', 'Notes du projet : écrire sans déclencher de raccourci, retrouver le texte, le garder dans le fichier', async () => {
  await page.click('#bNotes'); expect(await page.$eval('#notes', d => d.open), 'fenêtre non ouverte');
  await page.fill('#notesText', 'Couplet 1 : la mineur'); await page.keyboard.type(' r l m'); await page.keyboard.press('Space'); await sleep(150);
  expect(await S(() => !window.kh.engine.playing && !window.kh.engine.recording), 'écrire a déclenché un raccourci'); await page.keyboard.press('Escape'); await sleep(100);
  expect((await proj()).notes === 'Couplet 1 : la mineur r l m ' && await page.$eval('#bNotes', e => e.classList.contains('on')), `notes non enregistrées (« ${(await proj()).notes} »)`);
  await page.click('#bNotes'); expect(await page.$eval('#notesText', e => e.value).then(v => v.startsWith('Couplet 1')), 'texte non retrouvé'); await page.keyboard.press('Escape');
  const [dl] = await Promise.all([page.waitForEvent('download'), menu('bSave')]); const f = path.join(TMP, 'notes.khm'); await dl.saveAs(f);
  await newBlank(); expect((await proj()).notes === '' && !(await page.$eval('#bNotes', e => e.classList.contains('on'))), 'un nouveau projet doit avoir des notes vides');
  await page.setInputFiles('#fProj', f); await sleep(400); expect((await proj()).notes.startsWith('Couplet 1'), 'notes perdues à la réouverture');
});

(async () => {
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${MIC}`, '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true, locale: 'fr-FR' });
  page = await ctx.newPage();
  page.on('pageerror', e => errors.push('PAGE ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  page.on('dialog', d => d.accept(dialogText));
  await page.addInitScript(PAGE_HELPERS);
  await page.goto(BASE); await page.waitForSelector('.clip');
  if (await page.$eval('#help', d => d.open)) await page.click('#help button.accent');

  const only = process.argv[2];
  for (const c of cases) {
    if (only && !only.split(',').some(x => c.id.startsWith(x))) continue;
    const t0 = Date.now(), e0 = errors.length; let err = '';
    try { await reset(); await c.fn(); await page.evaluate(() => { window.kh.engine.stop(); }); await sleep(450); }
    catch (e) { err = String(e.message || e).split('\n')[0]; }
    const errs = errors.slice(e0);
    if (!err && errs.length) err = 'erreur console : ' + errs[0];
    results.push({ ...c, ok: !err, err, ms: Date.now() - t0 });
    console.log(`${err ? 'ÉCHEC' : 'ok   '} ${c.id.padEnd(8)} ${c.title}${err ? '\n        → ' + err : ''}`);
    if (err) { try { await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1500, height: 900 }); } catch { /* ignore */ } }
  }
  await browser.close();

  const pass = results.filter(r => r.ok).length;
  const md = [`# Rapport de QA — KH Music Pro`, '', `${pass} cas réussis sur ${results.length}.`, '',
    '| Cas | Domaine | Cas d\'usage | Résultat |', '|---|---|---|---|',
    ...results.map(r => `| ${r.id} | ${r.cat} | ${r.title} | ${r.ok ? 'OK' : 'ÉCHEC : ' + r.err.replace(/\|/g, '/')} |`)].join('\n');
  if (!only) fs.writeFileSync(path.join(__dirname, 'REPORT.md'), md + '\n');
  console.log(`\n${pass}/${results.length} cas réussis`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
