#!/usr/bin/env node
/**
 * 番茄小说 · 个人书架 & 全文下载器（命令行）
 *
 * 命令：
 *   node fanqie.mjs add    <id|链接>         加书（下载全文）
 *   node fanqie.mjs shelf                    生成/刷新书架页面
 *   node fanqie.mjs list                     在终端列出书架
 *   node fanqie.mjs search "书名"            搜索
 *   node fanqie.mjs info   <id|链接>         看目录
 *   node fanqie.mjs read   <id|链接>         下载全文 + 生成阅读器（同 add）
 *   node fanqie.mjs update [id|链接]         追更（不带参数=全部可追的）
 *   node fanqie.mjs auto   <id|链接> on|off  开关「自动追更」标记
 *   node fanqie.mjs rm     <id|链接>         从书架移除
 *   node fanqie.mjs txt    <id|链接>         导出 TXT
 *   node fanqie.mjs app                      启动桌面版
 *
 * 选项：
 *   --from N --to M     指定章节区间
 *   --workers N         并发数（默认 3）
 *   --fresh             忽略缓存重下
 *   --debug             打印错误堆栈
 *
 * 内容来源：番茄 App 客户端接口（非官方开放平台），仅供个人阅读学习使用。
 */
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import {
  HERE, CACHE,
  scanBooks, downloadBook, updateAll, updateOne,
  setAutoUpdate, removeBook, exportTxt, searchBooks, createPool,
  loadStore, fromInput, fetchCatalog, fmtWords, bookCachePath,
} from './core.mjs';
import { buildShelf } from './shelf.mjs';

/* ================= 参数 ================= */
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i > -1 && argv[i + 1] !== undefined ? argv[i + 1] : def;
};
const flag = name => argv.includes('--' + name);

const args = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { i++; continue; }
  args.push(argv[i]);
}

const WORKERS = Math.max(1, Math.min(8, Number(opt('workers', 3))));
const DEVICE_LIMIT = Number(opt('device-limit', 70)); // 实测单设备 ~100–180 次后被限

/* ================= 输出 ================= */
const C = {
  d: '\x1b[2m', r: '\x1b[0m', b: '\x1b[1m', g: '\x1b[32m',
  y: '\x1b[33m', c: '\x1b[36m', red: '\x1b[31m', w: '\x1b[37m',
};
const log = (...a) => console.log(...a);
const die = m => { console.error(C.red + m + C.r); process.exit(1); };

function bar(cur, total, w = 26) {
  const p = total ? cur / total : 0;
  const n = Math.round(p * w);
  return '[' + '█'.repeat(n) + '░'.repeat(w - n) + '] ' + (p * 100).toFixed(1).padStart(5) + '%';
}

/* ================= 终端进度渲染 ================= */
let lastLine = 0;
function renderProgress(ev) {
  if (ev.phase === 'catalog') { process.stdout.write(`${C.d}获取目录…${C.r}\n`); return; }
  if (ev.phase === 'begin') {
    log(`${C.b}《${ev.title}》${C.r}`);
    if (ev.cached) log(`${C.d}缓存 ${ev.cached} 章 / 共 ${ev.chapters} 章，待下载 ${ev.total} 章${C.r}`);
    else log(`${C.d}共 ${ev.chapters} 章，待下载 ${ev.total} 章${C.r}`);
    if (!ev.total) log(`${C.g}全部已下载，直接生成文件。${C.r}`);
    log();
    return;
  }
  if (ev.phase === 'download') {
    process.stdout.write(
      `\r${bar(ev.done, ev.total)}  ${ev.done}/${ev.total}  ${C.d}${ev.rate}章/秒 剩${ev.eta}s · 设备${ev.devices}${C.r}   `
    );
    return;
  }
  if (ev.phase === 'cover') { process.stdout.write(`${C.d}处理封面…${C.r}\r`); return; }
  if (ev.phase === 'done') {
    if (ev.total ?? true) process.stdout.write('\n');
    log(`${C.g}✔ ${ev.full}/${ev.chapters} 章${C.r}` +
      (ev.failed.length ? `  ${C.y}${ev.failed.length} 章失败${C.r}` : '') +
      `  ${C.d}（设备 ${ev.devices} 台）${C.r}`);
    if (ev.failed.length) {
      ev.failed.slice(0, 8).forEach(f => log(`  ${C.y}${f.t}${C.r} — ${f.m}`));
      log(C.d + '  再跑一次相同命令会自动补下缺的章节。' + C.r);
    }
  }
}

/* ================= 搜索 ================= */
async function doSearch(kw) {
  if (!kw) die('用法: node fanqie.mjs search "书名或作者"');
  const pool = await createPool(DEVICE_LIMIT);
  const res = await searchBooks(pool, kw, { count: 15 });
  if (!res) die('搜索失败：请求被限流，稍后再试。');

  const books = res.books || [];
  if (!books.length) return log('没搜到，换个关键词，或从 App 里复制书籍链接。');

  const shelfIds = new Set(scanBooks().map(b => b.bookId));

  log(`\n${C.b}搜索「${kw}」${C.r}  ${C.d}${books.length} 条${C.r}\n`);
  books.forEach((b, i) => {
    const st = b.isFinished ? '完结' : '连载';
    const mine = shelfIds.has(b.bookId) ? `  ${C.g}[书架]${C.r}` : '';
    log(`${C.c}${String(i + 1).padStart(2)}${C.r} ${C.b}${b.title}${C.r}  ${C.d}${b.author}${C.r}${mine}`);
    log(`   ${C.d}${st} · ${fmtWords(b.wordCount)} · ${b.category || '-'} · id=${b.bookId}${C.r}`);
  });
  log(`\n${C.d}加书 →  node fanqie.mjs add <id>${C.r}\n`);
}

/* ================= 信息 ================= */
async function doInfo(bookId) {
  if (!bookId) die('用法: node fanqie.mjs info <id|链接>');
  const pool = await createPool(DEVICE_LIMIT);
  const cat = await fetchCatalog(pool, bookId);
  if (!cat) die('取不到目录。');
  const b = cat.book || {};
  log(`\n${C.b}${b.title || bookId}${C.r}  ${C.d}${b.author || ''}${C.r}`);
  log(`  ${b.isFinished ? '已完结' : '连载中'} · ${fmtWords(b.wordCount)} · ${b.category || '-'}`);
  log(`  章节 ${C.b}${cat.chapters.length}${C.r} 章 · 最新「${b.lastChapterTitle || '-'}」`);
  if (b.abstract) log(`\n${C.d}${b.abstract.slice(0, 300)}${C.r}`);
  log(`\n${C.d}加书 →  node fanqie.mjs add ${bookId}${C.r}\n`);
}

/* ================= 下载 ================= */
async function doDownload(input) {
  const bookId = fromInput(input);
  if (!bookId || !/^\d{10,}$/.test(bookId)) die('用法: node fanqie.mjs add <书籍id 或 链接>');

  const r = await downloadBook(bookId, {
    from: Math.max(1, Number(opt('from', 1)) || 1),
    to: Number(opt('to', 0)) || null,
    workers: WORKERS,
    fresh: flag('fresh'),
    debug: flag('debug'),
    deviceLimit: DEVICE_LIMIT,
    onProgress: renderProgress,
  });

  const sh = await buildShelf();
  log(`\n${C.g}${C.b}✔ 阅读器已生成${C.r}  ${C.d}${r.file}${C.r}`);
  log(`${C.g}${C.b}✔ 书架已更新${C.r}    ${C.d}共 ${sh.count} 本 → ${sh.file}${C.r}\n`);
  return r.file;
}

/* ================= TXT ================= */
async function doTxt(input) {
  const bookId = fromInput(input);
  if (!bookId) die('用法: node fanqie.mjs txt <id|链接>');
  const r = await exportTxt(bookId);
  log(`${C.g}✔ TXT 已生成${C.r}  ${r.file}  ${C.d}(${r.chapters} 章)${C.r}`);
  return r.file;
}

/* ================= 追更 ================= */
async function doUpdate(input) {
  const bookId = fromInput(input);

  if (!bookId) {
    const books = scanBooks();
    if (!books.length) die('书架是空的，先加一本书。');
    log(`${C.b}追更检查${C.r}  ${C.d}共 ${books.length} 本${C.r}\n`);

    const rep = await updateAll({
      workers: WORKERS,
      deviceLimit: DEVICE_LIMIT,
      onProgress: ev => {
        if (ev.phase === 'check') process.stdout.write(`${C.d}检查《${ev.title}》…${C.r}\r`);
        else if (ev.phase === 'skip') log(`${C.d}《${ev.title}》跳过 — ${ev.reason}${C.r}`);
        else if (ev.phase === 'error') log(`${C.y}《${ev.title}》失败：${ev.message}${C.r}`);
        else renderProgress(ev);
      },
    });

    log('');
    if (rep.failed.length) log(`${C.y}${rep.failed.length} 本失败${C.r}`);
    if (!rep.changed) log(`${C.g}全部是最新的。${C.r}`);
    else {
      const sh = await buildShelf();
      log(`${C.g}✔ ${rep.changed} 本有更新，书架已刷新（共 ${sh.count} 本）${C.r}`);
    }
    return;
  }

  if (!existsSync(bookCachePath(bookId))) die('还没下载过这本书，先跑：node fanqie.mjs add ' + bookId);
  const r = await updateOne(bookId, {
    workers: WORKERS, deviceLimit: DEVICE_LIMIT, onProgress: renderProgress,
  });
  const sh = await buildShelf();
  if (!r.changed) log(`${C.g}已是最新${C.r}`);
  log(`\n${C.g}✔ 书架已刷新（共 ${sh.count} 本）${C.r}`);
}

/* ================= 自动追更开关 ================= */
function doAuto(input, v) {
  const bookId = fromInput(input);
  if (!bookId || !['on', 'off'].includes(v)) die('用法: node fanqie.mjs auto <id|链接> on|off');
  if (!setAutoUpdate(bookId, v === 'on')) die('书架里没有这本书');
  const s = loadStore(bookId);
  log(`${C.g}✔${C.r} 《${s.title}》自动追更 = ${v === 'on' ? '开' : '关'}` +
    (s.finished ? `  ${C.d}（已完结，追更时会跳过）${C.r}` : ''));
}

/* ================= 移除 ================= */
async function doRm(input) {
  const bookId = fromInput(input);
  if (!bookId) die('用法: node fanqie.mjs rm <id|链接>');
  const s = loadStore(bookId);
  if (!s) die('书架里没有这本书');
  const r = await removeBook(bookId);
  await buildShelf();
  log(`${C.g}✔${C.r} 已从书架移除《${s.title}》` +
    (r.bin ? `  ${C.d}文件已移到 ${r.bin}${C.r}` : ''));
}

/* ================= 书架视图 ================= */
async function doShelf() {
  const sh = await buildShelf();
  log(`${C.g}✔ 书架已生成${C.r}  共 ${sh.count} 本`);
  log(`  ${sh.file}\n`);
}

function doList() {
  const books = scanBooks();
  if (!books.length) return log('书架是空的。用 node fanqie.mjs add <id> 加第一本。');

  books.sort((a, b) => (b.updatedAt || b.addedAt) - (a.updatedAt || a.addedAt));

  const W = 30;
  log(`\n${C.b}我的书架${C.r}  ${C.d}共 ${books.length} 本${C.r}\n`);
  log(`${C.d}${'书名'.padEnd(W)} ${'作者'.padEnd(10)} 进度        状态${C.r}`);
  log(`${C.d}${'─'.repeat(76)}${C.r}`);

  for (const b of books) {
    const t = [...b.title].length > W - 2 ? [...b.title].slice(0, W - 3).join('') + '…' : b.title;
    const pad = W - [...t].length;
    const a = [...(b.author || '佚名')].length > 9 ? [...b.author].slice(0, 8).join('') + '…' : (b.author || '佚名');
    const prog = b.downloaded >= b.chapters ? `${b.chapters}章 全` : `${b.downloaded}/${b.chapters}章`;
    let st;
    if (b.downloaded < b.chapters) st = C.y + '未下完' + C.r;
    else if (b.finished) st = C.g + '完结' + C.r;
    else if (b.autoUpdate === false) st = C.d + '连载·不追' + C.r;
    else st = C.c + '连载·追更' + C.r;
    log(`${t}${' '.repeat(pad)} ${a}${' '.repeat(10 - [...a].length)} ${prog.padEnd(11)} ${st}`);
    log(`${C.d}  ${b.bookId}  ${fmtWords(b.words)}${C.r}`);
  }
  log();
}

/* ================= 桌面版 ================= */
function doApp() {
  const p = spawn(process.execPath, [join(HERE, 'server.mjs')], {
    cwd: HERE, stdio: 'inherit', env: process.env,
  });
  p.on('exit', c => process.exit(c ?? 0));
}

/* ================= 入口 ================= */
(async () => {
  try {
    switch (cmd) {
      case 'app': case 'gui': doApp(); break;
      case 'shelf':  await doShelf(); break;
      case 'list': case 'ls': doList(); break;
      case 'search': await doSearch(args.join(' ')); break;
      case 'info':   await doInfo(fromInput(args[0])); break;
      case 'add': case 'read': await doDownload(args[0]); break;
      case 'txt':    await doTxt(args[0]); break;
      case 'update': case 'up': await doUpdate(args[0]); break;
      case 'auto':   doAuto(args[0], args[1]); break;
      case 'rm': case 'remove': await doRm(args[0]); break;
      default:
        log(`
${C.b}番茄小说 · 个人书架${C.r}

  ${C.c}node fanqie.mjs app${C.r}                    启动桌面版（推荐）
  ${C.c}node fanqie.mjs list${C.r}                   终端查看书架
  ${C.c}node fanqie.mjs add  <id|链接>${C.r}         加书（下载全文）
  ${C.c}node fanqie.mjs search "书名"${C.r}          搜索
  ${C.c}node fanqie.mjs info <id|链接>${C.r}         看目录
  ${C.c}node fanqie.mjs update${C.r}                 追更：所有可追的书
  ${C.c}node fanqie.mjs update <id|链接>${C.r}       追更：指定一本
  ${C.c}node fanqie.mjs auto <id|链接> on|off${C.r}  开关自动追更
  ${C.c}node fanqie.mjs rm   <id|链接>${C.r}         移出书架
  ${C.c}node fanqie.mjs txt  <id|链接>${C.r}         导出 TXT
  ${C.c}node fanqie.mjs shelf${C.r}                  刷新书架页面

${C.d}选项
  --from N --to M      只下指定区间（例如 --from 1 --to 100）
  --workers N          并发数，默认 3
  --fresh              忽略本地缓存重新下载${C.r}
`);
    }
  } catch (e) {
    console.error(C.red + '出错: ' + e.message + C.r);
    if (flag('debug')) console.error(e.stack);
    process.exit(1);
  }
})();