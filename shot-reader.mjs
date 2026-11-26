// 阅读器新功能截图（Playwright + 本机 Edge）
// 自己起服务、跑完收掉：沙箱会在工具会话结束时回收子进程，提前起好的服务活不到这里。
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const req = createRequire('C:/Users/yangl/.workbuddy/binaries/node/workspace/');
const { chromium } = req('playwright-core');

const PORT = 48112;
const BASE = `http://127.0.0.1:${PORT}`;
const ID = process.env.BOOK || '7143038691944959011';
const OUT = 'screenshots';

const env = { ...process.env };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) delete env[k];

const srv = spawn(process.execPath, ['server.mjs', '--foreground', '--no-open', '--port', String(PORT)], {
  cwd: process.cwd(), env, stdio: 'ignore', windowsHide: true,
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ready = false;
for (let i = 0; i < 30; i++) {
  await sleep(300);
  try {
    const d = await (await fetch(BASE + '/api/ping', { signal: AbortSignal.timeout(1000) })).json();
    if (d && d.app === 'fanqie-reader') { ready = true; break; }
  } catch {}
}
if (!ready) { console.log('SERVER_FAILED'); srv.kill(); process.exit(1); }

const exe = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(`${BASE}/reader/${ID}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// 1. 默认界面（正序目录）
await page.screenshot({ path: `${OUT}/reader-v2-default.png` });

// 2. 打开行间距弹层
await page.click('#btnLh');
await page.waitForTimeout(300);
const lhVisible = await page.isVisible('#lhPop');
await page.screenshot({ path: `${OUT}/reader-v2-linespacing.png` });

// 选「宽松」
await page.click('#lhPop button[data-lh="2.6"]');
await page.waitForTimeout(400);
const lhValue = await page.evaluate(() => document.documentElement.style.getPropertyValue('--lh'));

// 3. 切倒序
await page.click('#btnOrder');
await page.waitForTimeout(500);
const orderText = await page.textContent('#btnOrder');
const firstItemIdx = await page.getAttribute('#nav a:first-child', 'data-i');
const navCount = await page.evaluate(() => document.querySelectorAll('#nav a').length);
await page.screenshot({ path: `${OUT}/reader-v2-desc.png` });

// 4. 回到正序，确认恢复
await page.click('#btnOrder');
await page.waitForTimeout(400);
const firstItemIdx2 = await page.getAttribute('#nav a:first-child', 'data-i');
const orderText2 = await page.textContent('#btnOrder');

// 5. 返回按钮存在且可见
const backVisible = await page.isVisible('#btnBack');

// 6. 点返回，应回到书架
await page.click('#btnBack');
await page.waitForTimeout(900);
const urlAfterBack = page.url();
const isShelf = await page.evaluate(() => !!document.querySelector('#grid'));

await browser.close();
srv.kill();

console.log(JSON.stringify({
  lhVisible,
  lhValue,
  orderText,
  firstItemIdx,
  navCount,
  firstItemIdx2,
  orderText2,
  backVisible,
  urlAfterBack,
  isShelf,
  errors,
}, null, 2));

const bad = [];
if (!lhVisible) bad.push('行间距弹层未显示');
if (lhValue !== '2.6') bad.push('行间距未生效: ' + lhValue);
if (!orderText.includes('倒序')) bad.push('倒序按钮文案未变: ' + orderText);
if (firstItemIdx !== String(navCount - 1)) bad.push('倒序首项不是最后一章: ' + firstItemIdx);
if (firstItemIdx2 !== '0') bad.push('切回正序失败: ' + firstItemIdx2);
if (!backVisible) bad.push('返回按钮不可见');
if (!isShelf) bad.push('点返回未到书架: ' + urlAfterBack);
if (errors.length) bad.push('JS 错误 ' + errors.length + ' 条');

console.log('');
console.log(bad.length ? 'FAIL: ' + bad.join(' | ') : 'UI_OK');
process.exit(bad.length ? 1 : 0);