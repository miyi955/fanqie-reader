#!/usr/bin/env node
/**
 * 生成离线测试数据（不联网、不用真书）。
 *
 * 为什么需要：整套测试读的是 .cache/<id>.json + books/<id>.html + covers/<id>.jpg，
 * 这些是运行时产物，不进版本库。新克隆的仓库里它们是空的，测试会全红。
 *
 * 策略：
 *   - 仅当 .cache 下一本书都没有时才造数（已有真书就跳过，绝不污染真实书架）
 *   - 假书用固定 id，标题带「测试」字样，一眼能认出来
 *   - 造 3 本：2 本完结已下完、1 本连载中且开着追更，覆盖全部筛选分支
 *   - 封面用 sharp 现生成真 JPEG（服务端会校验文件头，假数据过不了）
 *
 * 用法：node seed-fixture.mjs [--force]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { CACHE, COVERS, bookCachePath, buildReaderFile } from './core.mjs';
import { HERE } from './test-env.mjs';

const force = process.argv.includes('--force');
const clean = process.argv.includes('--clean');

/** 测试书 id 前缀固定为 900000000000000000x，清理时只删这个区间，绝不碰真书 */
const TEST_ID = /^900000000000000000\d$/;

/* ================= 清理 ================= */
// 铁律：只认 TEST_ID 这个精确前缀，绝不用通配符。
// （教训：曾用 find .cache -name "*.json" -delete 清理，把真实书籍缓存一起删了。
//   清理函数里出现任何模糊匹配，就是下一次事故。）
if (clean) {
  const { rmSync } = await import('node:fs');

  // 先算出哪些是真书，清理前打印出来，让人看得见"没被碰"
  const realBooks = existsSync(CACHE)
    ? readdirSync(CACHE).filter(f => /^\d{10,}\.json$/.test(f) && !TEST_ID.test(f.replace('.json', '')))
    : [];

  let removed = 0;
  const targets = [];
  for (const dir of [CACHE, COVERS, join(HERE, 'books')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      // 提取文件名主体，必须完整匹配 TEST_ID 才允许删
      const m = /^(.+)\.(json|jpg|html)$/.exec(f);
      if (!m || !TEST_ID.test(m[1])) continue;
      targets.push(join(dir, f));
    }
  }

  for (const t of targets) {
    try { rmSync(t, { force: true }); removed++; } catch {}
  }

  spawnSync(process.execPath, [join(HERE, 'fanqie.mjs'), 'shelf'], { cwd: HERE, encoding: 'utf8' });

  if (realBooks.length) {
    console.log(`真实书籍 ${realBooks.length} 本，未触碰：${realBooks.map(f => f.replace('.json', '')).join(', ')}`);
  }
  console.log(`已清理 ${removed} 个测试文件（仅匹配 ${TEST_ID}）`);
  process.exit(0);
}

/** 已有一本真书就不再造数 */
function hasRealBooks() {
  if (!existsSync(CACHE)) return false;
  return readdirSync(CACHE).some(f => /^\d{10,}\.json$/.test(f) && !TEST_ID.test(f.replace('.json', '')));
}

if (hasRealBooks() && !force) {
  console.log('SKIP: .cache 已有书籍，不造测试数据');
  process.exit(0);
}

/* ================= 造封面 ================= */
// 服务端只校验 JPEG 文件头，但书架页要求 >2000 字节，所以生成一张真图。
async function makeCover(file, rgb, label) {
  let sharp;
  try { ({ default: sharp } = await import('sharp')); }
  catch { return false; }
  await mkdir(COVERS, { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400">
    <rect width="300" height="400" fill="${rgb}"/>
    <text x="150" y="210" font-size="34" fill="#fff" text-anchor="middle">${label}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toFile(file);
  return true;
}

/* ================= 造三本书 ================= */
const BOOKS = [
  {
    bookId: '9000000000000000001',
    title: '测试书甲·完结已全',
    author: '测试作者一',
    words: 120000,
    finished: true,
    autoUpdate: true,
    chapterCount: 60,
    paragraphs: 4,
    color: '#8e44ad',
  },
  {
    bookId: '9000000000000000002',
    title: '测试书乙·完结已全',
    author: '测试作者二',
    words: 88000,
    finished: true,
    autoUpdate: false,
    chapterCount: 45,
    paragraphs: 3,
    color: '#2980b9',
  },
  {
    bookId: '9000000000000000003',
    title: '测试书丙·连载中',
    author: '测试作者三',
    words: 56000,
    finished: false,
    autoUpdate: true,
    chapterCount: 30,
    paragraphs: 5,
    color: '#c0392b',
  },
];

const now = Date.now();
let made = 0;

for (let b = 0; b < BOOKS.length; b++) {
  const def = BOOKS[b];
  const chapters = [];
  for (let i = 0; i < def.chapterCount; i++) {
    const paras = [];
    for (let p = 0; p < def.paragraphs; p++) {
      paras.push(`第 ${i + 1} 章第 ${p + 1} 段测试正文。用于验证排版、目录、进度与翻章是否正常。`);
    }
    chapters.push({ itemId: String(1000 + i), t: `第 ${i + 1} 章 测试章节`, n: 900 + i, c: paras });
  }

  const store = {
    bookId: def.bookId,
    title: def.title,
    author: def.author,
    words: def.words,
    finished: def.finished,
    autoUpdate: def.autoUpdate,
    category: '测试',
    cover: '',
    addedAt: now - b * 86400000,
    updatedAt: now - b * 3600000,
    lastCheckedAt: now,
    chapters,
  };

  await mkdir(CACHE, { recursive: true });
  await writeFile(bookCachePath(def.bookId), JSON.stringify(store));

  const okCover = await makeCover(join(COVERS, def.bookId + '.jpg'), def.color, 'TEST ' + (b + 1));
  if (!okCover) {
    // 没有 sharp 就手搓一张最小 JPEG：够服务端校验，但书架页的 >2000 字节断言可能不过
    const minJpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
      'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
      'base64',
    );
    await mkdir(COVERS, { recursive: true });
    writeFileSync(join(COVERS, def.bookId + '.jpg'), minJpeg);
  }

  await buildReaderFile(store);
  made++;
}

/* ================= 生成书架页 ================= */
const r = spawnSync(process.execPath, [join(HERE, 'fanqie.mjs'), 'shelf'], {
  cwd: HERE, encoding: 'utf8',
});
if (r.status !== 0) console.log('书架页生成失败：' + (r.stderr || r.stdout));

console.log(`已生成 ${made} 本测试书（.cache / covers / books / 书架.html）`);
console.log('这些是假数据，确认不需要后可执行：node seed-fixture.mjs --clean');
console.log('SEED_OK');