// 用本机 Edge 截图桌面版界面（本机没有 Playwright 自带 Chromium）
import { join } from 'node:path';
import { HERE, requireFrom, findBrowser } from './test-env.mjs';

const { chromium } = requireFrom('playwright-core');

const BASE = process.argv[2] || 'http://127.0.0.1:45999';
const OUT = join(HERE, 'screenshots');

const EDGE = findBrowser();
if (!EDGE) { console.log('NO_BROWSER: 没找到 Edge/Chrome，设置 EDGE_PATH 环境变量指向浏览器可执行文件'); process.exit(1); }

const browser = await chromium.launch({ headless: true, executablePath: EDGE });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

// 书架主界面
await page.screenshot({ path: join(OUT, 'app-light.png') });

// 加书弹层
await page.click('#btnAdd');
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, 'app-add.png') });
await page.keyboard.press('Escape');
await page.click('#maskAdd', { position: { x: 5, y: 5 } }).catch(() => {});
await page.waitForTimeout(300);

// 暖色主题
await page.click('#btnTheme');
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, 'app-warm.png') });

// 夜间主题
await page.click('#btnTheme');
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, 'app-dark.png') });

// 回到日间
await page.click('#btnTheme');
await page.waitForTimeout(300);

// 状态断言
const stats = await page.evaluate(() => ({
  cards: document.querySelectorAll('.book').length,
  chips: [...document.querySelectorAll('.chip')].map(c => c.textContent.trim()),
  switches: document.querySelectorAll('.switch input').length,
  disabledSwitches: document.querySelectorAll('.switch input:disabled').length,
  count: document.querySelector('#count').textContent,
  covers: document.querySelectorAll('.cover .fg').length,
}));

await browser.close();

console.log('\n=== 界面状态 ===');
console.log(JSON.stringify(stats, null, 2));
console.log('JS 错误:', errs.length);
errs.slice(0, 10).forEach(e => console.log('  ' + e));
console.log(errs.length === 0 ? 'NO_JS_ERROR' : 'HAS_JS_ERROR');