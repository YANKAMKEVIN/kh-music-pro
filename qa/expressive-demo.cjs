/* Produce a portable .khm demo, WAV previews and a screenshot on a temporary profile.
 * Usage: KH_URL=http://localhost:5173 node qa/expressive-demo.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ensemble = process.argv.includes('--ensemble');
const out = path.join(__dirname, '..', 'livrables', ensemble ? 'v0.17.1' : 'v0.17.0');
fs.mkdirSync(out, { recursive: true });

function wav(data) {
  const raw = Buffer.from(data.pcm, 'base64'), header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + raw.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(data.sr, 24); header.writeUInt32LE(data.sr * 4, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(raw.length, 40);
  return Buffer.concat([header, raw]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.KH_CHROMIUM_PATH || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 920 } });
    await page.goto(process.env.KH_URL || 'http://localhost:5173/'); await page.waitForSelector('.clip');
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    const project = await page.evaluate(ensemble => {
      const k = window.kh; k.setLang('fr'); const p = k.demoProject();
      p.name = 'Piano expressif et batterie Studio'; p.bpm = 96; p.loop = false; p.countIn = false;
      p.notes = 'KH Music Pro 0.17.0 — Piano Salamander : quatre nuances réellement enregistrées. Batterie Studio : frappes acoustiques et variantes. Sons chargés depuis les banques embarquées. Essayer la piste Piano avec un clavier MIDI et la pédale CC64.';
      const piano = p.tracks[1], drums = p.tracks[0]; p.tracks = [piano, drums];
      piano.name = 'Piano · Salamander'; piano.synth = k.makeSynth('r_salamander'); piano.vol = 0.9; piano.rev = 0.08; piano.dly = 0;
      const notes = [];
      // Four dynamics, then a short musical phrase and chords.
      [0.18, 0.42, 0.68, 0.95].forEach((v, i) => notes.push({ p: 60, s: i * 4, l: 3, v }));
      [60,64,67,72,71,67,64,62].forEach((m, i) => notes.push({ p: m, s: 16 + i * 2, l: 1.8, v: 0.45 + (i % 4) * 0.14 }));
      [[57,60,64],[53,57,60],[55,59,62],[60,64,67]].forEach((ch, i) => ch.forEach(m => notes.push({ p: m, s: 32 + i * 8, l: 7, v: [0.55,0.65,0.75,0.85][i] })));
      piano.clips = [{ id: 'demo-ex-piano', name: 'Nuances et accords', start: 0, len: 64, offset: 0, patLen: 64, notes }];
      drums.name = 'Batterie · Studio'; drums.kit = 'studio'; drums.vol = 0.65; drums.rev = 0.05; drums.dly = 0;
      const pattern = Array.from({ length: 16 }, () => Array(32).fill(0));
      for (let s = 0; s < 32; s += 2) pattern[3][s] = s % 4 ? 0.42 : 0.8;
      for (const s of [0,8,16,22,24]) pattern[0][s] = 0.9;
      for (const s of [4,12,20,28]) pattern[1][s] = 0.85;
      for (const s of [11,19,27]) pattern[1][s] = 0.2;
      pattern[4][14] = 0.7; pattern[3][14] = 0; pattern[13][0] = 0.65;
      drums.clips = [{ id: 'demo-ex-drums', name: 'Frappes et ghost notes', start: 32, len: 32, offset: 0, patLen: 32, drums: pattern }];
      if (ensemble) {
        p.name = 'Wurlitzer, basse et percussions';
        p.notes = 'KH Music Pro 0.17.1 — Wurlitzer EP200 par Greg Sullivan, basse Fashionbass par Karoryfer, percussions VCSL par Versilian Studios. Banques embarquées à nuances enregistrées.';
        piano.name = 'Wurlitzer EP200'; piano.synth = k.makeSynth('r_wurli');
        drums.name = 'Percussions VCSL'; drums.kit = 'percussion';
        const rows = Array.from({length:16},()=>Array(32).fill(0));
        for(let t=0;t<32;t+=2) rows[12][t]=t%4?0.45:0.8;
        for(const t of [0,8,16,24]) rows[0][t]=0.85;
        for(const t of [4,12,20,28]) rows[1][t]=0.8;
        for(const t of [6,14,22,30]) rows[5][t]=0.55;
        for(const t of [3,19,27]) rows[2][t]=0.3;
        rows[13][0]=0.65;rows[15][16]=0.6;drums.clips[0].drums=rows;
        const bass=k.demoProject().tracks[1]; bass.name='Basse Fashionbass';bass.synth=k.makeSynth('r_fashionbass');bass.vol=0.75;bass.rev=0;bass.dly=0;
        const line=[];[33,29,36,31].forEach((root,i)=>[0,3,5].forEach((t,j)=>line.push({p:root,s:i*8+t,l:j===0?2.7:1.7,v:j===0?0.85:0.65})));
        bass.clips=[{id:'demo-bass',name:'Basse aux doigts',start:32,len:32,offset:0,patLen:32,notes:line}];
        p.tracks=[piano,bass,drums];
      }
      k.S.project = p; k.S.selTrack = piano.id; k.S.selClip = piano.clips[0].id; k.S.synthOpen = true; k.resetHistory(); k.emit();
      return p;
    }, ensemble);
    fs.writeFileSync(path.join(out, ensemble ? 'Demo-wurlitzer-basse-percussions.khm' : 'Demo-piano-batterie.khm'), JSON.stringify({ format: 'kh-music-pro', version: 1, project, buffers: {} }));
    const previews = ensemble ? [['Wurlitzer-basse-percussions.wav','all'],['Wurlitzer-EP200.wav','piano'],['Basse-Fashionbass.wav','bass'],['Percussions-VCSL.wav','drums']] : [['Piano-et-batterie.wav','all'],['Piano-quatre-nuances.wav','piano'],['Batterie-Studio.wav','drums']];
    for (const [name, mode] of previews) {
      const data = await page.evaluate(async ({mode,ensemble}) => {
        const k = window.kh, p = JSON.parse(JSON.stringify(k.S.project));
        if (mode === 'piano') p.tracks = [p.tracks[0]];
        if (mode === 'bass') { p.tracks = [p.tracks[1]]; p.tracks[0].clips[0].start = 0; }
        if (mode === 'drums') { p.tracks = [p.tracks[ensemble ? 2 : 1]]; p.tracks[0].clips[0].start = 0; }
        const b = await k.renderOffline(p), bytes = new Uint8Array(b.length * 4), view = new DataView(bytes.buffer);
        for (let i = 0; i < b.length; i++) for (let ch = 0; ch < 2; ch++) {
          const x = Math.max(-1, Math.min(1, b.getChannelData(ch)[i])); view.setInt16(i * 4 + ch * 2, Math.round(x * (x < 0 ? 32768 : 32767)), true);
        }
        let bin = ''; for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return { sr: b.sampleRate, pcm: btoa(bin) };
      }, {mode,ensemble});
      fs.writeFileSync(path.join(out, name), wav(data));
    }
    await page.screenshot({ path: path.join(out, ensemble ? 'Wurlitzer-expressif.png' : 'Piano-expressif.png') });
    await page.selectOption('[data-role=preset]', ensemble ? 'r_wurli' : 'r_salamander');
    await page.click('.head >> nth=' + (ensemble ? 2 : 1) + ' >> .ticon'); await page.click('[data-view=pads]');
    await page.screenshot({ path: path.join(out, ensemble ? 'Pads-percussions.png' : 'Pads-Studio.png') });
    console.log('Demo, WAV previews and screenshots: ' + out);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
