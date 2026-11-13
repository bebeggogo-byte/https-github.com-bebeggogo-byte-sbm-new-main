// 12월 의료기사 캠페인 카드 다시 만들기
// 실행: node tools/campaign-dec/render.js   (저장소 루트에서)
// 원본: tools/campaign-dec/cards.html  →  결과: og/campaign-dec/*.png (1080x1350)
const path = require('path');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const SRC = path.join(__dirname, 'cards.html');
const OUT = path.join(__dirname, '..', '..', 'og', 'campaign-dec');

const CARDS = [
  ['c01', '01.png'], ['c02', '02.png'], ['c03', '03.png'],
  ['c04', '04.png'], ['c05', '05.png'], ['c06', '06.png'],
  ['cover-jageopchiryosa', 'cover-jageopchiryosa.png'],
  ['cover-mullichiryosa', 'cover-mullichiryosa.png'],
  ['cover-imsangbyeongnisa', 'cover-imsangbyeongnisa.png'],
  ['cover-chigwawisaengsa', 'cover-chigwawisaengsa.png'],
  ['cover-bangsaseonsa', 'cover-bangsaseonsa.png'],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1500 }, deviceScaleFactor: 1 });
  await page.goto('file://' + SRC);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);

  // 서체가 내려받아졌는지 확인합니다. 실패하면 기본 서체로 찍히므로 중단합니다.
  const fontOk = await page.evaluate(() => document.fonts.check("900 40px 'Noto Sans KR'", '가'));
  if (!fontOk) { console.error('Noto Sans KR 서체를 불러오지 못했습니다.'); await browser.close(); process.exit(1); }

  // 카드 밖으로 넘친 요소가 있는지 확인합니다.
  const over = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('.card').forEach(card => {
      const c = card.getBoundingClientRect();
      card.querySelectorAll('*').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > c.right - 79 || r.left < c.left + 79 || r.bottom > c.bottom))
          bad.push(card.id + ': ' + el.className + ' ' + (el.textContent || '').slice(0, 20));
      });
    });
    return bad;
  });
  if (over.length) console.warn('여백을 넘은 요소:\n' + over.join('\n'));

  for (const [id, file] of CARDS) {
    const el = await page.$('#' + id);
    if (!el) { console.error('카드를 찾지 못했습니다: ' + id); process.exitCode = 1; continue; }
    await el.screenshot({ path: path.join(OUT, file) });
    console.log('저장: og/campaign-dec/' + file);
  }
  await browser.close();
})();
