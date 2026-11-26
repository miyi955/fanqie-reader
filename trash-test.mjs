// 验证「移出书架」不再直接删除文件，而是移到 .trash
import { removeBook, scanBooks } from './core.mjs';
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE, readerPath, bookCachePath } from './core.mjs';

let pass = 0, fail = 0;
const ok = (c, n, extra = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); }
  else { fail++; console.log('  ✘ ' + n + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 移出书架安全性 ===\n');

// 造一本假书，只测删除行为，不碰真实数据
const FAKE = '9999999999999999999';
mkdirSync(CACHE, { recursive: true });
writeFileSync(bookCachePath(FAKE), JSON.stringify({
  bookId: FAKE, title: '测试用假书', author: 'test',
  chapters: [{ itemId: '1', t: '第一章', c: ['内容'] }],
  finished: true, addedAt: Date.now(), updatedAt: Date.now(),
}));
writeFileSync(readerPath(FAKE), '<html>fake reader</html>');

const before = existsSync(bookCachePath(FAKE));
ok(before, '假书缓存已创建');

const r = await removeBook(FAKE);
console.log('  返回:', JSON.stringify(r));

ok(r.moved === 2, '移动了 2 个文件（缓存 + 阅读器）', 'moved=' + r.moved);
ok(!existsSync(bookCachePath(FAKE)), '原位置缓存已不存在');
ok(!existsSync(readerPath(FAKE)), '原位置阅读器已不存在');
ok(r.bin && existsSync(r.bin), '回收目录存在', r.bin);

const trashed = r.bin ? readdirSync(r.bin) : [];
ok(trashed.includes(FAKE + '.json'), '缓存进了回收目录', trashed.join(','));
ok(trashed.includes(FAKE + '.html'), '阅读器进了回收目录');

// 回收目录里的内容应该可读（可恢复）
if (r.bin) {
  const files = readdirSync(r.bin);
  const jsonFile = files.find(f => f.endsWith('.json'));
  let restorable = null;
  if (jsonFile) {
    try { restorable = JSON.parse(readFileSync(join(r.bin, jsonFile), 'utf8')); } catch {}
  }
  ok(restorable && restorable.title === '测试用假书', '回收目录里的缓存可正常读取（可恢复）');
}

// 假书不应出现在书架
const inShelf = scanBooks().some(b => b.bookId === FAKE);
ok(!inShelf, '移出后不在书架列表');

// 清理测试产物
const fs = await import('node:fs/promises');
if (r.bin) await fs.rm(r.bin, { recursive: true, force: true });

console.log(`\n通过 ${pass}  失败 ${fail}`);
console.log(fail === 0 ? 'ALL_PASS' : 'HAS_FAIL');
process.exit(fail === 0 ? 0 : 1);