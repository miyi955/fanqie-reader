// 测量书架卡片实际布局尺寸
import { createRequire } from 'node:module';
const req = createRequire('C:/Users/yangl/.workbuddy/binaries/node/workspace/');
const { chromium } = req('playwright-core');

const BASE = process.argv[2] || 'http://127.0.0.1:45999';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const browser = await chromium.launch({ headless: true, executablePath: EDGE });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

const data = await page.evaluate(() =>
  [...document.querySelectorAll('.book')].map(el => {
    const cw = el.querySelector('.coverwrap').getBoundingClientRect();
    const cv = el.querySelector('.cover').getBoundingClientRect();
    const fg = el.querySelector('.fg');
    const fgr = fg ? fg.getBoundingClientRect() : null;
    return {
      title: el.querySelector('.title').textContent,
      coverwrap: [Math.round(cw.width), Math.round(cw.height)],
      cover: [Math.round(cv.width), Math.round(cv.height)],
      fgBox: fgr ? [Math.round(fgr.width), Math.round(fgr.height)] : null,
      imgNatural: fg ? [fg.naturalWidth, fg.naturalHeight] : null,
      imgComplete: fg ? fg.complete : null,
    };
  })
);
console.log(JSON.stringify(data, null, 2));

await browser.close();