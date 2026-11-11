// Capture d'écran d'un état donné : node qa/shot.cjs <nom> "<code JS exécuté dans la page>" [clic CSS]
// Variables : KH_URL, DPR (densité), PHONE=1 (écran de téléphone tactile).
const { chromium } = require('playwright');
(async () => {
  const [name, code, click] = process.argv.slice(2), phone = !!process.env.PHONE;
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const page = await (await b.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1500, height: 900 }, hasTouch: phone, isMobile: phone, deviceScaleFactor: +(process.env.DPR || 1), locale: 'fr-FR' })).newPage();
  page.on('pageerror', e => console.log('PAGE', e.message));
  await page.goto(process.env.KH_URL); await page.waitForSelector('.clip');
  if (await page.$eval('#help', d => d.open)) await page.click('#help button.accent');
  if (code) console.log(JSON.stringify(await page.evaluate(code)));
  if (click) await page.click(click);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `qa/shots/${name}.png` });
  await b.close();
})();
