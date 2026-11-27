/**
 * 番茄小说 · 桌面版本地服务
 *
 * 直接复用 core.mjs（与命令行同一套下载逻辑），对外提供：
 *   - 静态界面        GET  /                → template/app.html
 *   - 阅读器          GET  /reader/<id>     → books/<id>.html
 *   - 封面            GET  /cover/<id>      → covers/<id>.jpg
 *   - 书架            GET  /api/shelf
 *   - 搜索            GET  /api/search?q=
 *   - 加书            POST /api/add         {input}
 *   - 追更            POST /api/update      {bookIds?}
 *   - 自动追更开关    POST /api/toggle      {bookId, autoUpdate}
 *   - 移出书架        POST /api/remove      {bookId}
 *   - 导出 TXT        POST /api/txt         {bookId}
 *   - 进度推送        GET  /api/events      (SSE)
 *
 * 只监听 127.0.0.1，端口随机，仅本机可访问。
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, unlink, appendFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import {
  HERE, CACHE, BOOKS, COVERS,
  scanBooks, downloadBook, updateAll, updateOne,
  setAutoUpdate, removeBook, exportTxt, searchBooks, createPool,
  loadStore, fromInput, readerPath, fmtWords,
} from './core.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i > -1 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const PORT = Number(opt('port', 0)) || 0;
const OPEN = !argv.includes('--no-open');
const SINGLE = !argv.includes('--multi');
const DETACHED = argv.includes('--detached');

// 空闲多久后自动退出（毫秒）。有任务在跑或仍有连接时不计时。
const IDLE_MS = Number(opt('idle', 15 * 60 * 1000));

// 实例记录文件名可按环境变量覆盖：并发跑两套自检时各用各的，避免互相覆盖。
// 正常运行（双击图标）不设该变量，仍是 instance.json。
const INSTANCE = join(CACHE, process.env.FANQIE_INSTANCE || 'instance.json');
const LAUNCH_LOG = join(HERE, 'logs', 'app.log');

// 用来区分"这是我们的服务"和"端口上恰好有个别的 HTTP 服务"。
// 单实例探活必须校验它，否则重启后陈旧记录里记的端口若被别人占用，
// 会误判成"已在运行"，窗口指到一个完全无关的页面。
const APP_ID = 'fanqie-reader';

async function logLaunch(msg) {
  try {
    await mkdir(join(HERE, 'logs'), { recursive: true });
    await appendFile(LAUNCH_LOG, `[${new Date().toISOString()}] pid=${process.pid} ${msg}\n`);
  } catch {}
}

function readInstance() {
  try { return JSON.parse(readFileSync(INSTANCE, 'utf8')); } catch { return null; }
}

/** 探活：只有对方明确回了 app 标识才算"我们的实例" */
async function probe(port, timeout = 1200) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/ping`, {
      signal: AbortSignal.timeout(timeout),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.app === APP_ID ? d : null;
  } catch { return null; }
}

/* ================= 脱离控制台 =================
 * 快捷方式启动时会带一个控制台窗口（最小化），但父进程不该长期占着。
 * 做法：父进程再拉一个隐藏窗口的子进程，确认子进程真的起来了，再退出。
 * 不再盲等 900ms —— 那样子进程要是崩了，用户双击后什么都看不到，也查不到原因。
 * 子进程起不来就回退到当前进程直接跑，宁可留个最小化的控制台，也不能点了没反应。
 * 调试/测试用 --foreground 跳过整个机制。
 */
if (!DETACHED && !argv.includes('--foreground')) {
  await logLaunch('launcher start');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--detached', ...argv], {
    cwd: HERE,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env },
  });
  child.unref();

  let ready = false;
  for (let i = 0; i < 40; i++) {          // 最多等 ~8 秒
    await new Promise(r => setTimeout(r, 200));
    const info = readInstance();
    if (info && info.port && await probe(info.port, 600)) { ready = true; break; }
    if (child.exitCode !== null || child.signalCode) break;   // 子进程已退，不用再等
  }

  if (ready) {
    await logLaunch('detached child ready, parent exit');
    process.exit(0);
  }

  await logLaunch('detached child FAILED, falling back to in-process');
}

/* ================= 单实例 ================= */
/** 已有实例就复用：把浏览器指过去，本进程直接退出 */
async function reuseIfRunning() {
  if (!SINGLE) return false;
  const info = readInstance();
  if (!info || !info.port || info.pid === process.pid) return false;
  const d = await probe(info.port);
  if (!d) return false;                      // 端口上不是我们（或已死），不复用
  if (OPEN) openWindow(`http://127.0.0.1:${info.port}/`);
  console.log(`  已在运行，复用端口 ${info.port}`);
  return true;
}

async function writeInstance(port) {
  try {
    await mkdir(CACHE, { recursive: true });
    await writeFile(INSTANCE, JSON.stringify({
      app: APP_ID, port, pid: process.pid, startedAt: Date.now(),
    }));
  } catch {}
}

async function clearInstance() {
  const info = readInstance();
  if (info && info.pid === process.pid) {
    try { await unlink(INSTANCE); } catch {}
  }
}

/* ================= SSE 总线 ================= */
const clients = new Set();
let job = null;   // { kind, abort, startedAt, last }

function broadcast(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch {}
  }
}

function jobState() {
  if (!job) return { running: false };
  return { running: true, kind: job.kind, startedAt: job.startedAt, last: job.last, abort: job.abort.aborted };
}

/* ================= 任务执行 ================= */
function onProgress(ev) {
  if (job) job.last = ev;
  broadcast('progress', { ...ev, job: job ? job.kind : null });
}

async function runJob(kind, fn) {
  if (job) throw new Error('已有任务在跑，请等它结束');
  const abort = new AbortController();
  job = { kind, abort, startedAt: Date.now(), last: null };
  broadcast('job', jobState());
  try {
    const result = await fn(abort.signal);
    broadcast('job-done', { kind, result });
    return result;
  } catch (e) {
    broadcast('job-error', { kind, message: String(e.message) });
    throw e;
  } finally {
    job = null;
    broadcast('job', jobState());
  }
}

/* ================= HTTP 工具 ================= */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => {
      buf += c;
      if (buf.length > 1e6) { reject(new Error('请求体过大')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

async function serveFile(res, path, mime) {
  try {
    const buf = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}

/* ================= 路由 ================= */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = decodeURIComponent(url.pathname);
  const method = req.method;

  // ---- 静态 ----
  if (method === 'GET' && (p === '/' || p === '/index.html')) {
    return serveFile(res, join(HERE, 'template', 'app.html'), MIME['.html']);
  }

  if (method === 'GET' && p.startsWith('/reader/')) {
    const id = p.slice('/reader/'.length).replace(/\.html$/, '');
    if (!/^\d{10,}$/.test(id)) { res.writeHead(400); return res.end('bad id'); }
    return serveFile(res, readerPath(id), MIME['.html']);
  }

  if (method === 'GET' && p.startsWith('/cover/')) {
    const id = p.slice('/cover/'.length).replace(/\.jpg$/, '');
    if (!/^\d{10,}$/.test(id)) { res.writeHead(400); return res.end('bad id'); }
    return serveFile(res, join(COVERS, id + '.jpg'), MIME['.jpg']);
  }

  // ---- SSE ----
  if (method === 'GET' && p === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ job: jobState() })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  // ---- API ----
  if (p.startsWith('/api/')) {
    try {
      if (method === 'GET' && p === '/api/shelf') {
        const books = scanBooks().sort((a, b) => (b.updatedAt || b.addedAt) - (a.updatedAt || a.addedAt));
        return json(res, 200, {
          books: books.map(b => ({
            ...b,
            wordsText: fmtWords(b.words),
            coverUrl: b.cover || existsSync(join(COVERS, b.bookId + '.jpg')) ? `/cover/${b.bookId}?v=${b.updatedAt}` : '',
          })),
          job: jobState(),
        });
      }

      if (method === 'GET' && p === '/api/search') {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) return json(res, 400, { error: '缺少搜索词' });
        const pool = await createPool(70);
        const r = await searchBooks(pool, q, { count: 15 });
        if (!r) return json(res, 502, { error: '搜索被限流，稍后再试' });
        const mine = new Set(scanBooks().map(b => b.bookId));
        return json(res, 200, {
          books: (r.books || []).map(b => ({
            bookId: b.bookId, title: b.title, author: b.author,
            finished: !!b.isFinished, words: b.wordCount || 0,
            wordsText: fmtWords(b.wordCount), category: b.category || '',
            inShelf: mine.has(b.bookId),
          })),
        });
      }

      if (method === 'GET' && p === '/api/book') {
        const id = fromInput(url.searchParams.get('id') || '');
        const s = loadStore(id);
        if (!s) return json(res, 404, { error: '本地没有这本书' });
        return json(res, 200, {
          bookId: s.bookId, title: s.title, author: s.author, words: s.words,
          finished: !!s.finished, autoUpdate: s.autoUpdate !== false,
          chapters: s.chapters.map(c => ({ t: c.t, n: c.n || 0, has: Array.isArray(c.c) && c.c.length > 0 })),
        });
      }

      if (method === 'POST' && p === '/api/add') {
        const body = await readBody(req);
        const id = fromInput(body.input || '');
        if (!/^\d{10,}$/.test(id)) return json(res, 400, { error: '请输入书籍链接或数字 id' });
        if (job) return json(res, 409, { error: '已有任务在跑，请等它结束' });

        // 后台跑，立即返回；进度走 SSE
        runJob('add', signal => downloadBook(id, {
          workers: 3, onProgress, signal, debug: true,
        })).catch(() => {});
        return json(res, 200, { ok: true, bookId: id });
      }

      if (method === 'POST' && p === '/api/update') {
        const body = await readBody(req);
        if (job) return json(res, 409, { error: '已有任务在跑，请等它结束' });
        const ids = Array.isArray(body.bookIds) && body.bookIds.length ? body.bookIds : null;

        runJob('update', signal => ids && ids.length === 1
          ? updateOne(ids[0], { onProgress, signal, workers: 3 })
          : updateAll({ onProgress, signal, workers: 3, only: ids })
        ).catch(() => {});
        return json(res, 200, { ok: true });
      }

      if (method === 'POST' && p === '/api/toggle') {
        const body = await readBody(req);
        const ok = setAutoUpdate(body.bookId, !!body.autoUpdate);
        return json(res, ok ? 200 : 404, { ok });
      }

      if (method === 'POST' && p === '/api/remove') {
        const body = await readBody(req);
        const r = await removeBook(body.bookId);
        return json(res, 200, { ok: true, moved: r?.moved ?? 0, bin: r?.bin ?? null });
      }

      if (method === 'POST' && p === '/api/txt') {
        const body = await readBody(req);
        const r = await exportTxt(body.bookId);
        return json(res, 200, { ok: true, ...r });
      }

      if (method === 'POST' && p === '/api/abort') {
        if (job) job.abort.abort();
        return json(res, 200, { ok: true });
      }

      if (method === 'GET' && p === '/api/ping') {
        return json(res, 200, { ok: true, app: APP_ID, pid: process.pid, job: jobState() });
      }

      if (method === 'GET' && p === '/api/open-dir') {
        const dir = url.searchParams.get('dir') === 'books' ? BOOKS : HERE;
        spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
        return json(res, 200, { ok: true, dir });
      }

      return json(res, 404, { error: 'no such api' });
    } catch (e) {
      return json(res, 500, { error: String(e.message) });
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404');
});

/* ================= 空闲退出 =================
 * 浏览器窗口关掉后 SSE 连接断开，等 IDLE_MS 仍无连接且无任务就自己退。
 * 这样不会在后台留下一个看不见的 node 进程。
 * 注意：定时器必须等真正开始监听后再建。否则复用实例的那个进程
 * （只是开个窗口、什么都不做）会被这个 interval 一直挂住，永远退不出去。
 */
let lastSeen = Date.now();
let tickIdle = null;

function startIdleTimer() {
  if (tickIdle) return;
  tickIdle = setInterval(async () => {
    if (job) { lastSeen = Date.now(); return; }
    if (clients.size > 0) { lastSeen = Date.now(); return; }
    if (Date.now() - lastSeen < IDLE_MS) return;

    clearInterval(tickIdle);
    console.log('  空闲超时，退出。');
    await clearInstance();
    server.close();
    setTimeout(() => process.exit(0), 300);
  }, 60 * 1000);
}

/* ================= 启动 ================= */
function openWindow(url) {
  // Edge / Chrome 的 --app 模式：无地址栏、无标签页，看起来就是个桌面应用
  const exe = findBrowser();
  if (exe) {
    spawn(exe, [
      `--app=${url}`,
      '--window-size=1280,860',
      '--user-data-dir=' + join(CACHE, 'browser-profile'),
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
      // 断电/强制重启后 profile 会被标记为异常退出，默认会弹"恢复页面"气泡。
      // 这是个无状态的应用窗口，没有需要恢复的东西，直接关掉这些提示。
      '--hide-crash-restore-bubble',
      '--disable-session-crashed-bubble',
      '--noerrdialogs',
    ], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  // 没有 Edge/Chrome：退回默认浏览器。窗口带地址栏，但至少能打开。
  spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  return false;
}

function findBrowser() {
  const cands = [
    process.env.LOCALAPPDATA + '/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const c of cands) if (c && existsSync(c)) return c;
  return null;
}

(async () => {
  if (await reuseIfRunning()) return;

  server.listen(PORT, '127.0.0.1', async () => {
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/`;
    await writeInstance(port);

    console.log('');
    console.log('  番茄小说 · 桌面版');
    console.log(`  ${url}`);
    console.log('');

    const appWindow = OPEN ? openWindow(url) : 'skipped';
    await logLaunch(`listening ${url} appWindow=${appWindow} open=${OPEN}`);
    lastSeen = Date.now();
    startIdleTimer();
  });
})();

server.on('error', async e => {
  if (e.code === 'EADDRINUSE') {
    console.error('  端口被占用，换一个：--port 46000');
    await logLaunch('EADDRINUSE ' + PORT);
  } else {
    console.error('  服务异常：' + e.message);
    await logLaunch('server error: ' + e.message);
  }
  process.exit(1);
});

// 兜底：任何未捕获异常都记下来。双击启动看不到控制台，日志是唯一线索。
process.on('uncaughtException', async e => {
  await logLaunch('UNCAUGHT ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
process.on('unhandledRejection', async e => {
  await logLaunch('UNHANDLED ' + (e && e.stack ? e.stack : e));
});

process.on('SIGINT', async () => { await clearInstance(); process.exit(0); });
process.on('SIGTERM', async () => { await clearInstance(); process.exit(0); });