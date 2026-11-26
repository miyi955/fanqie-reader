#!/usr/bin/env node
/**
 * 番茄小说 · 个人书架 —— 独立书架页生成器（兼容旧入口）
 *
 * 用法：node shelf.mjs        （读取 .cache 下所有已下载的书，生成 书架.html）
 *
 * 桌面版（server.mjs）不复用这个页面，但保留它方便离线/分享单文件书架。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HERE, CACHE, COVERS, scanBooks } from './core.mjs';

const SHELF_JSON = join(CACHE, 'shelf.json');

/* ================= 书单快照 ================= */
export function loadShelf() {
  try { return JSON.parse(readFileSync(SHELF_JSON, 'utf8')); } catch { return { books: [] }; }
}

export function saveShelf(shelf) {
  const tmp = SHELF_JSON + '.tmp';
  writeFileSync(tmp, JSON.stringify(shelf, null, 2));
  renameSync(tmp, SHELF_JSON);
}

export { scanBooks };

/* ================= 生成书架 HTML ================= */
export async function buildShelf() {
  const books = scanBooks();

  // 封面转 data URI 内嵌，生成单文件书架，脱离目录也能打开
  const entries = [];
  for (const b of books) {
    let coverData = '';
    const cp = join(COVERS, b.bookId + '.jpg');
    if (existsSync(cp)) {
      try {
        const buf = readFileSync(cp);
        if (buf.length) coverData = 'data:image/jpeg;base64,' + buf.toString('base64');
      } catch {}
    }
    entries.push({ ...b, coverData });
  }

  entries.sort((a, b) => (b.updatedAt || b.addedAt) - (a.updatedAt || a.addedAt));

  const payload = JSON.stringify(entries.map(e => ({
    i: e.bookId, t: e.title, a: e.author,
    w: e.words, c: e.chapters, d: e.downloaded,
    f: e.finished, g: e.category,
    u: e.updatedAt, n: e.lastTitle,
    v: e.coverData,
  }))).replace(/</g, '\\u003c');

  let html = await readFile(join(HERE, 'template', 'shelf.html'), 'utf8');
  html = html.replace('/*__SHELF_DATA__*/[]', payload);
  const file = join(HERE, '书架.html');
  await writeFile(file, html, 'utf8');
  return { file, count: entries.length };
}

/* ================= CLI ================= */
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { file, count } = await buildShelf();
  console.log(`\x1b[32m✔ 书架已生成\x1b[0m  共 ${count} 本`);
  console.log(`  ${file}`);
}