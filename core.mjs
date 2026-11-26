/**
 * 番茄小说 · 核心逻辑
 * CLI（fanqie.mjs）与桌面 App（server.mjs）共用这一份实现。
 *
 * 内容来源：番茄 App 客户端接口（非官方开放平台），仅供个人阅读学习使用。
 */
import { FanqieClient } from 'openfanqie';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(HERE, '.cache');
export const BOOKS = join(HERE, 'books');
export const COVERS = join(HERE, 'covers');
export const POOL_DIR = join(CACHE, 'devices');
export const POOL_STATE = join(CACHE, 'pool.json');

const req = createRequire(import.meta.url);

/* ================= 小工具 ================= */
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled';
}

export function fromInput(s) {
  if (!s) return '';
  const str = String(s).trim();
  // 支持：纯 id、page/xxx、reader/xxx、books/xxx、带 ?bookId= 的链接
  const m = /(?:page|reader|books|book)\/(\d{10,})/.exec(str)
    || /[?&](?:book_?id|bookId)=(\d{10,})/i.exec(str)
    || /^(\d{10,})$/.exec(str);
  return m ? m[1] : str;
}

export function fmtWords(w) {
  if (!w) return '';
  return w >= 10000 ? (w / 10000).toFixed(1) + '万字' : w + '字';
}

/* ================= 设备池 =================
 * 番茄对单个匿名设备号有累计配额，用尽后返回 HTTP 200 + 空 body。
 * 策略：每台用满 limit 次主动换新；遇到空响应立即退役并重试。
 */
export class DevicePool {
  #state = { devices: [] };
  #creating = null;
  #seq = 0;
  limit = 70;

  constructor(limit = 70) { this.limit = limit; }

  async init() {
    await mkdir(POOL_DIR, { recursive: true });
    try {
      this.#state = JSON.parse(readFileSync(POOL_STATE, 'utf8'));
      if (!Array.isArray(this.#state.devices)) this.#state.devices = [];
    } catch { this.#state.devices = []; }
    this.#seq = this.#state.devices.length;
  }

  #save() {
    try {
      writeFileSync(POOL_STATE, JSON.stringify({
        devices: this.#state.devices.map(d => ({ file: d.file, used: d.used, dead: d.dead })),
      }));
    } catch {}
  }

  async acquire() {
    const ok = this.#state.devices.find(d => !d.dead && d.used < this.limit);
    if (ok) { ok.client ||= this.#makeClient(ok.file); return { slot: ok }; }
    if (!this.#creating) {
      this.#creating = (async () => {
        const file = `dev-${Date.now().toString(36)}-${(++this.#seq).toString(36)}.json`;
        const client = this.#makeClient(file);
        await client.ensureGuest();
        const slot = { file, used: 0, dead: false, client };
        this.#state.devices.push(slot);
        this.#save();
        return { slot };
      })().finally(() => { this.#creating = null; });
    }
    return this.#creating;
  }

  #makeClient(file) {
    return new FanqieClient({ profilePath: join(POOL_DIR, file) });
  }

  hit(slot) { slot.used++; if (slot.used >= this.limit) slot.dead = true; this.#save(); }
  retire(slot) { slot.dead = true; this.#save(); }
  get total() { return this.#state.devices.length; }
  get alive() { return this.#state.devices.filter(d => !d.dead).length; }
}

export async function createPool(limit = 70) {
  const p = new DevicePool(limit);
  await p.init();
  return p;
}

/** 单设备配额耗尽的特征：HTTP 200 但 body 为空（静默拒绝，不是 4xx） */
export function isDeviceBlocked(e) {
  if (!e || e.status !== 200) return false;
  const body = e.body == null ? '' : String(e.body);
  return e.code === -1 && body.length === 0;
}

/** 带设备轮换的目录请求 */
export async function fetchCatalog(pool, bookId) {
  for (let a = 0; a < 8; a++) {
    const { slot } = await pool.acquire();
    try {
      const cat = await slot.client.catalog(bookId);
      pool.hit(slot);
      return cat;
    } catch (e) {
      if (isDeviceBlocked(e)) { pool.retire(slot); continue; }
      throw e;
    }
  }
  return null;
}

/** 带设备轮换的搜索（第一版漏了轮换，单次撞配额就失败） */
export async function searchBooks(pool, kw, { count = 15 } = {}) {
  for (let a = 0; a < 8; a++) {
    const { slot } = await pool.acquire();
    try {
      const res = await slot.client.search(kw, { tab: 'book', count });
      pool.hit(slot);
      return res;
    } catch (e) {
      if (isDeviceBlocked(e)) { pool.retire(slot); continue; }
      throw e;
    }
  }
  return null;
}

/* ================= 封面 =================
 * 番茄封面固定 HEIC + 签名 URL（只能原样 GET，改扩展名 403）。
 * 用 libheif-js(WASM) 解码 → sharp 等比缩放为 JPEG。
 */
let _heif = null, _sharp = null;

async function heicToJpeg(buf, w, h) {
  if (!_heif) _heif = req('libheif-js/wasm-bundle');
  if (!_sharp) _sharp = req('sharp');

  const decoder = new _heif.HeifDecoder();
  const images = decoder.decode(buf);
  if (!images.length) throw new Error('封面解码为空');

  const img = images[0];
  const iw = img.get_width(), ih = img.get_height();
  const out = new Uint8ClampedArray(iw * ih * 4);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('封面解码超时')), 10000);
    try {
      img.display({ data: out, width: iw, height: ih }, () => { clearTimeout(t); resolve(); });
    } catch (e) { clearTimeout(t); reject(e); }
  });

  return _sharp(Buffer.from(out.buffer), { raw: { width: iw, height: ih, channels: 4 } })
    .resize(w, h, { fit: 'inside', withoutEnlargement: true })   // 等比缩放，绝不裁切
    .jpeg({ quality: 86, progressive: true })
    .toBuffer();
}

export async function ensureCover(bookId, book, { force = false, debug = false } = {}) {
  const dest = join(COVERS, bookId + '.jpg');
  if (!force && existsSync(dest)) return true;
  const url = book.coverUrlHd || book.coverUrl;
  if (!url) return false;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const jpg = await heicToJpeg(buf, 360, 510);
    await mkdir(COVERS, { recursive: true });
    await writeFile(dest, jpg);
    return true;
  } catch (e) {
    if (debug) console.error('  封面失败: ' + e.message);
    return false;
  }
}

/* ================= 缓存读写 ================= */
export const bookCachePath = id => join(CACHE, id + '.json');
export const readerPath = id => join(BOOKS, id + '.html');

export function loadStore(id) {
  try { return JSON.parse(readFileSync(bookCachePath(id), 'utf8')); } catch { return null; }
}

export async function saveStore(store) {
  await mkdir(CACHE, { recursive: true });
  await writeFile(bookCachePath(store.bookId), JSON.stringify(store));
}

/* ================= 书架扫描 =================
 * 直接扫 .cache 下的书，不依赖额外的索引文件，删缓存即从书架消失。
 */
export function scanBooks() {
  if (!existsSync(CACHE)) return [];
  const out = [];
  for (const f of readdirSync(CACHE)) {
    const m = /^(\d{10,})\.json$/.exec(f);
    if (!m) continue;
    try {
      const s = JSON.parse(readFileSync(join(CACHE, f), 'utf8'));
      const done = s.chapters.filter(c => Array.isArray(c.c) && c.c.length).length;
      out.push({
        bookId: m[1],
        title: s.title || '(未命名)',
        author: s.author || '',
        words: s.words || 0,
        chapters: s.chapters.length,
        downloaded: done,
        finished: !!s.finished,
        category: s.category || '',
        cover: s.cover || '',
        addedAt: s.addedAt || 0,
        updatedAt: s.updatedAt || 0,
        lastCheckedAt: s.lastCheckedAt || 0,
        autoUpdate: s.autoUpdate !== false,        // 老缓存没有该字段 → 默认开
        lastTitle: s.chapters.length ? s.chapters[s.chapters.length - 1].t : '',
        hasReader: existsSync(readerPath(m[1])),
      });
    } catch {}
  }
  return out;
}

/** 书架是否需要自动追更
 *  - 已完结且已下完 → 跳过（这是「完结后不再抓取」的准确定义）
 *  - 已完结但缺章   → 仍要补齐（否则缺口永远补不上）
 *  - 用户手动关了开关 → 尊重用户
 */
export const needsUpdate = b =>
  b.autoUpdate !== false && (b.downloaded < b.chapters || !b.finished);

export function setAutoUpdate(bookId, on) {
  const s = loadStore(bookId);
  if (!s) return false;
  s.autoUpdate = !!on;
  writeFileSync(bookCachePath(bookId), JSON.stringify(s));
  return true;
}

/**
 * 从书架移除。
 * 不直接删：先移到 .trash/<时间戳>/，误删可手动找回。
 * 缓存 5–12MB 一本，留着比丢了好。
 */
export async function removeBook(bookId) {
  if (!/^\d{10,}$/.test(bookId)) throw new Error('书籍 id 无效');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bin = join(CACHE, '.trash', stamp);
  await mkdir(bin, { recursive: true });

  const files = [
    bookCachePath(bookId),
    readerPath(bookId),
    join(COVERS, bookId + '.jpg'),
  ];
  let moved = 0;
  for (const f of files) {
    if (!existsSync(f)) continue;
    try {
      await rename(f, join(bin, basename(f)));
      moved++;
    } catch {}
  }
  return { moved, bin: moved ? bin : null };
}

/* ================= 下载 ================= */
/**
 * 下载/补齐一本书。
 * 已有缓存时按 itemId 逐章合并，只下缺的（断点续传 / 增量追更）。
 */
export async function downloadBook(bookId, opts = {}) {
  const {
    from = 1, to = null, workers = 3, fresh = false, debug = false,
    onProgress = () => {}, signal = null, deviceLimit = 70,
  } = opts;

  if (!bookId || !/^\d{10,}$/.test(bookId)) throw new Error('书籍 id 无效');

  const pool = await createPool(deviceLimit);
  onProgress({ phase: 'catalog' });

  const cat = await fetchCatalog(pool, bookId);
  if (!cat) throw new Error('取不到目录（id 是否正确 / 网络是否正常）');

  const chapters = cat.chapters;
  const book = cat.book || {};
  if (!chapters.length) throw new Error('这本没有章节数据');

  const lo = Math.max(1, Number(from) || 1);
  const hi = Math.min(chapters.length, Number(to) || chapters.length);
  const title = book.title || 'book_' + bookId;

  const prev = (!fresh && existsSync(bookCachePath(bookId))) ? loadStore(bookId) : null;

  const store = {
    bookId, title,
    author: book.author || (prev?.author ?? ''),
    words: book.wordCount || prev?.words || 0,
    finished: !!book.isFinished,
    category: book.category || prev?.category || '',
    addedAt: prev?.addedAt || Date.now(),
    updatedAt: Date.now(),
    autoUpdate: prev?.autoUpdate !== false,
    lastCheckedAt: Date.now(),
    chapters: chapters.map(c => ({ itemId: c.itemId, t: c.title, n: c.wordNumber || 0 })),
  };
  const byId = new Map(store.chapters.map(c => [c.itemId, c]));

  let had = 0;
  if (prev) {
    for (const o of prev.chapters || []) {
      const target = byId.get(o.itemId);
      if (!target) continue;
      if (Array.isArray(o.c) && o.c.length) {
        target.c = o.c;
        target.t = o.t || target.t;
        target.n = o.n || target.n;
      }
    }
    had = store.chapters.filter(c => Array.isArray(c.c) && c.c.length).length;
  }

  const list = store.chapters.slice(lo - 1, hi);
  const todo = list.filter(ch => !Array.isArray(ch.c) || !ch.c.length);
  const total = todo.length;

  onProgress({
    phase: 'begin', bookId, title, total,
    cached: had, chapters: chapters.length,
  });

  let cursor = 0, doneN = 0;
  const failed = [];
  const t0 = Date.now();
  let lastEmit = 0;

  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 220) return;
    lastEmit = now;
    const sp = (now - t0) / 1000;
    const rate = sp > 0 ? doneN / sp : 0;
    onProgress({
      phase: 'download', bookId, title, done: doneN, total,
      rate: Number(rate.toFixed(1)),
      eta: rate > 0 ? Math.round((total - doneN) / rate) : 0,
      devices: pool.total,
      failed: failed.length,
    });
  };

  const aborted = () => signal?.aborted === true;

  async function worker() {
    while (cursor < total) {
      if (aborted()) break;
      const ch = todo[cursor++];
      const target = byId.get(ch.itemId);
      let tries = 0;
      while (true) {
        if (aborted()) return;
        const { slot } = await pool.acquire();
        try {
          const r = await slot.client.chapter(bookId, ch.itemId);
          pool.hit(slot);
          target.c = r.paragraphs.filter(s => s && s.trim());
          target.t = r.title || target.t;
          target.n = r.text.length;
          break;
        } catch (e) {
          if (isDeviceBlocked(e)) {
            pool.retire(slot);
            if (++tries > 10) { failed.push({ t: ch.t, m: '连续换设备仍被拒' }); break; }
            continue;
          }
          if (++tries > 3) { failed.push({ t: ch.t, m: String(e.message).slice(0, 70) }); break; }
          await sleep(400 * tries);
        }
      }
      doneN++;
      emit();
      if (doneN % 20 === 0) await saveStore(store);
    }
  }

  await Promise.all(Array.from({ length: Math.min(workers, Math.max(1, total)) }, worker));
  if (total) emit(true);

  // 封面（已有则跳过）
  onProgress({ phase: 'cover' });
  const gotCover = await ensureCover(bookId, book, { debug });
  store.cover = gotCover ? bookId + '.jpg' : (prev?.cover || '');
  await saveStore(store);

  const full = store.chapters.filter(c => Array.isArray(c.c) && c.c.length).length;

  onProgress({ phase: 'reader' });
  const file = await buildReaderFile(store);

  const result = {
    bookId, title, file,
    full, chapters: chapters.length, failed: failed.slice(0, 20),
    aborted: aborted(), devices: pool.total,
  };
  onProgress({ phase: 'done', ...result });
  return result;
}

/* ================= 追更 ================= */
/** 检查单本并下载新增章节。返回 { changed, added, missing } */
export async function updateOne(bookId, opts = {}) {
  const old = loadStore(bookId);
  if (!old) throw new Error('还没下载过这本书');

  const pool = await createPool(opts.deviceLimit || 70);
  const cat = await fetchCatalog(pool, bookId);
  if (!cat) throw new Error('取不到目录');

  const latest = cat.chapters;
  const oldIds = new Set(old.chapters.map(c => c.itemId));
  const added = latest.filter(c => !oldIds.has(c.itemId)).length;
  const missing = old.chapters.filter(c => !Array.isArray(c.c) || !c.c.length).length;
  const finishedNow = !!cat.book?.isFinished;

  if (!added && !missing) {
    old.lastCheckedAt = Date.now();
    old.finished = finishedNow;
    await saveStore(old);
    return { changed: false, added: 0, missing: 0, finished: finishedNow };
  }

  // 复用 downloadBook：它会按 itemId 合并，只下缺的章节
  await downloadBook(bookId, { ...opts, fresh: false });
  const now = loadStore(bookId);
  if (now) { now.lastCheckedAt = Date.now(); await saveStore(now); }
  return { changed: true, added, missing, finished: finishedNow };
}

/**
 * 批量追更。
 * 规则：
 *  - 用户关掉「自动追更」的不抓
 *  - 已完结且已下完的不抓（完结后不再抓取）
 *  - 已完结但仍缺章的要补齐，否则缺口永远补不上
 */
export async function updateAll(opts = {}) {
  const { onProgress = () => {}, signal = null, only = null } = opts;
  let books = scanBooks();
  if (only) books = books.filter(b => only.includes(b.bookId));

  const report = { checked: 0, skippedFinished: 0, skippedOff: 0, changed: 0, failed: [], books: [] };

  for (const b of books) {
    if (signal?.aborted) break;

    if (b.autoUpdate === false) {
      report.skippedOff++;
      onProgress({ phase: 'skip', bookId: b.bookId, title: b.title, reason: '已关闭自动追更' });
      continue;
    }
    if (b.finished && b.downloaded >= b.chapters) {
      report.skippedFinished++;
      onProgress({ phase: 'skip', bookId: b.bookId, title: b.title, reason: '已完结' });
      continue;
    }

    report.checked++;
    onProgress({ phase: 'check', bookId: b.bookId, title: b.title, index: report.checked, count: books.length });
    try {
      const r = await updateOne(b.bookId, opts);
      report.books.push({ bookId: b.bookId, title: b.title, ...r });
      if (r.changed) report.changed++;
    } catch (e) {
      report.failed.push({ bookId: b.bookId, title: b.title, message: String(e.message) });
      onProgress({ phase: 'error', bookId: b.bookId, title: b.title, message: String(e.message) });
    }
  }

  onProgress({ phase: 'all-done', ...report });
  return report;
}

/* ================= 生成阅读器 ================= */
function jstr(s) {
  return JSON.stringify(String(s)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function buildReaderFile(store) {
  let html = await readFile(join(HERE, 'template', 'reader.html'), 'utf8');
  const data = store.chapters.filter(c => Array.isArray(c.c) && c.c.length);

  const payload =
    '{id:' + jstr(store.bookId) + ',title:' + jstr(store.title) + ',author:' + jstr(store.author || '') +
    ',words:' + (store.words || 0) + ',chapters:[' +
    data.map(c => '{t:' + jstr(c.t) + ',n:' + (c.n || 0) + ',c:[' + c.c.map(jstr).join(',') + ']}').join(',') +
    ']}';

  html = html.replace('/*__BOOK_DATA__*/null', payload);
  html = html.replace(/__TITLE__/g, esc(store.title)).replace(/__AUTHOR__/g, esc(store.author || ''));

  await mkdir(BOOKS, { recursive: true });
  const file = readerPath(store.bookId);   // 用 bookId 命名：改名不断链，也避开非法字符
  await writeFile(file, html, 'utf8');
  return file;
}

/* ================= TXT ================= */
export async function exportTxt(bookId) {
  const store = loadStore(bookId);
  if (!store) throw new Error('还没下载过这本书');
  const out = [`${store.title}\n${store.author || ''}\n`];
  let n = 0;
  for (const ch of store.chapters) {
    out.push('\n\n' + ch.t + '\n\n');
    if (Array.isArray(ch.c)) { out.push(ch.c.join('\n')); n++; }
  }
  await mkdir(BOOKS, { recursive: true });
  const file = join(BOOKS, safeName(store.title) + '.txt');
  await writeFile(file, out.join(''), 'utf8');
  return { file, chapters: n };
}