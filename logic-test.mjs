// 追更规则测试（不联网，纯逻辑）
import { scanBooks, needsUpdate } from './core.mjs';

let pass = 0, fail = 0;
const ok = (c, n, extra = '') => {
  if (c) { pass++; console.log('  ✔ ' + n); }
  else { fail++; console.log('  ✘ ' + n + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 追更规则 ===\n');

// ---- 四种组合 ----
ok(needsUpdate({ finished: false, downloaded: 100, chapters: 100, autoUpdate: true }) === true,
  '连载中 + 已下完 + 开关开 → 追（等新章）');

ok(needsUpdate({ finished: false, downloaded: 100, chapters: 100, autoUpdate: false }) === false,
  '连载中 + 开关关 → 不追');

ok(needsUpdate({ finished: true, downloaded: 100, chapters: 100, autoUpdate: true }) === false,
  '已完结 + 已下完 → 不追（完结后不再抓取）');

ok(needsUpdate({ finished: true, downloaded: 60, chapters: 100, autoUpdate: true }) === true,
  '已完结 + 缺 40 章 → 仍然追（补齐缺口）★修复点');

ok(needsUpdate({ finished: true, downloaded: 60, chapters: 100, autoUpdate: false }) === false,
  '已完结 + 缺章 + 开关关 → 不追（尊重用户）');

ok(needsUpdate({ finished: false, downloaded: 50, chapters: 100 }) === true,
  '老缓存无 autoUpdate 字段 → 默认追');

// ---- 真实书架 ----
const books = scanBooks();
console.log('\n  书架实况：');
for (const b of books) {
  console.log(`    ${b.title}  完结=${b.finished}  ${b.downloaded}/${b.chapters}  开关=${b.autoUpdate}  →  追=${needsUpdate(b)}`);
}

for (const b of books) {
  if (b.finished && b.downloaded >= b.chapters) {
    ok(needsUpdate(b) === false, `《${b.title}》完结且完整 → 不追`);
  }
  if (!b.finished) {
    ok(needsUpdate(b) === true || b.autoUpdate === false,
      `《${b.title}》连载中 → 按开关决定`);
  }
}

console.log(`\n通过 ${pass}  失败 ${fail}`);
console.log(fail === 0 ? 'ALL_PASS' : 'HAS_FAIL');
process.exit(fail === 0 ? 0 : 1);