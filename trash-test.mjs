// 验证「移出书架」不再直接删除文件，而是移到 .trash
import { removeBook, scanBooks } from './core.mjs';
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE, readerPath, bookCachePath } from './core.mjs';

let pass = 0, fail = 0;
const ok = (c, n, extra = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); }
  else { fail++; console.log('  ✘ ' + n + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 移出书架安全性 ===\n');

// 造一本假书，只测删除行为，不碰真实数据
// id 带 pid 后缀：两套自检并发跑时各用各的，不会互相删掉对方的假书
const FAKE = '99999999999999' + String(process.pid).slice(-5);
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
// 注意：不要用 fs.rm(dir,{recursive:true})。沙箱的 safe-delete shim 会把递归删除转成回收站操作，
// 在某些执行环境下会直接抛错。这里只删自己刚造的那两个文件，再尝试摘掉空目录。
if (r.bin) {
  for (const f of [FAKE + '.json', FAKE + '.html']) {
    try { rmSync(join(r.bin, f), { force: true }); } catch {}
  }
  try { rmdirSync(r.bin); } catch {}   // 目录非空就留着，不影响结果
}

console.log(`\n通过 ${pass}  失败 ${fail}`);
console.log(fail === 0 ? 'ALL_PASS' : 'HAS_FAIL');
process.exit(fail === 0 ? 0 : 1);