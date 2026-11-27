import { readFileSync, readdirSync } from 'node:fs';
import { requireFrom } from './test-env.mjs';

const { JSDOM, VirtualConsole } = requireFrom('jsdom');

// 从缓存得出期望书目，避免测试写死数量
const caches = readdirSync('.cache').filter(f => /^\d{10,}\.json$/.test(f))
  .map(f => JSON.parse(readFileSync('.cache/' + f, 'utf8')));
const TOTAL = caches.length;
const DONE = caches.filter(c => c.finished).length;
const ONGOING = TOTAL - DONE;

const html = readFileSync('书架.html', 'utf8');
const errors = [];
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

const vc = new VirtualConsole()
  .on('jsdomError', e => errors.push('jsdomError: ' + e.message))
  .on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://localhost/shelf.html', virtualConsole: vc,
});
const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);
const norm = s => (s || '').replace(/\s+/g, '');
const tick = (ms = 140) => new Promise(r => setTimeout(r, ms));

await tick();

// 1. 启动
ok(!errors.length, '启动无 JS 错误: ' + errors.join(';'));
ok(doc.querySelectorAll('.book').length === TOTAL, `显示 ${TOTAL} 本，实际=${doc.querySelectorAll('.book').length}`);
ok(norm($('#count').textContent).includes(String(TOTAL)), '计数正确');
ok(doc.querySelectorAll('.cover .fg').length === TOTAL, '每本一个完整封面');
ok(doc.querySelectorAll('.cover .bg').length === TOTAL, '每本一个模糊底图');

const srcs = [...doc.querySelectorAll('.cover .fg')].map(i => i.getAttribute('src'));
ok(srcs.every(s => s && s.startsWith('data:image/jpeg;base64,') && s.length > 2000),
  '封面已内嵌为 data URI（长度 ' + srcs.map(s => s?.length).join(',') + '）');

const links = [...doc.querySelectorAll('.book')].map(a => a.getAttribute('href'));
ok(links.every(h => /^books\/\d{10,}\.html$/.test(h)), '链接格式正确: ' + links.join(','));

// 2. 筛选
const clickChip = label => {
  const c = [...doc.querySelectorAll('.chip')].find(x => x.textContent.includes(label));
  ok(!!c, '存在筛选项「' + label + '」');
  if (c) c.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
};

clickChip('已完结');
await tick();
ok(doc.querySelectorAll('.book').length === DONE, `「已完结」→${DONE} 本，实际=${doc.querySelectorAll('.book').length}`);

clickChip('连载中');
await tick();
ok(doc.querySelectorAll('.book').length === ONGOING, `「连载中」→${ONGOING} 本，实际=${doc.querySelectorAll('.book').length}`);

clickChip('全部');
await tick();
ok(doc.querySelectorAll('.book').length === TOTAL, `「全部」→${TOTAL} 本`);

// 3. 搜索（书名 / 作者 / 无结果）
const sample = caches[0];
const q = $('#q');
const typeSearch = async v => {
  q.value = v;
  q.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(280);
};

await typeSearch(sample.title.slice(0, 3));
ok(doc.querySelectorAll('.book').length >= 1, '按书名搜索有结果，关键字=' + sample.title.slice(0, 3));
ok(norm(doc.body.textContent).includes(sample.title.slice(0, 3)), '搜索结果含目标书');

if (sample.author) {
  await typeSearch(sample.author);
  ok(doc.querySelectorAll('.book').length >= 1, '按作者搜索有结果: ' + sample.author);
}

await typeSearch('zzz不存在zzz');
ok(doc.querySelectorAll('.book').length === 0, '无结果时 0 本');
ok(norm(doc.body.textContent).includes('没有符合条件'), '无结果有提示');

await typeSearch('');
ok(doc.querySelectorAll('.book').length === TOTAL, '清空搜索恢复全部');

// 4. 主题循环
const t0 = doc.documentElement.dataset.theme;
$('#btnTheme').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
$('#btnTheme').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const t2 = doc.documentElement.dataset.theme;
ok(t0 === 'light' && t2 === 'dark', '主题循环 light→warm→dark，实际=' + t0 + '→' + t2);

// 5. 持久化
const saved = JSON.parse(window.localStorage.getItem('fanqie-shelf-ui') || '{}');
ok(saved.theme, '主题已持久化');
ok(typeof saved.filter === 'string', '筛选已持久化');

// 6. 每本书的阅读器文件完整性
for (const c of caches) {
  const f = 'books/' + c.bookId + '.html';
  let h;
  try { h = readFileSync(f, 'utf8'); } catch { fails.push(f + ' 不存在'); continue; }
  ok(h.includes('chapters:[') && !h.includes('/*__BOOK_DATA__*/null'), c.title + ' 数据注入完整');
  ok(!/[\uE000-\uF8FF]/.test(h), c.title + ' 无 PUA 乱码');
  ok(!/__TITLE__|__AUTHOR__/.test(h), c.title + ' 无模板占位残留');
  const n = (h.match(/\{t:"/g) || []).length;
  const withC = c.chapters.filter(x => Array.isArray(x.c) && x.c.length).length;
  ok(n === withC, `${c.title} 章节数一致 (${n}/${withC})`);
}

console.log('\n=== 书架测试 ===');
console.log(`书目 ${TOTAL} 本（完结 ${DONE} / 连载 ${ONGOING}）`);
console.log('JS 错误:', errors.length);
errors.slice(0, 5).forEach(e => console.log('  !', e));
console.log('断言失败:', fails.length);
fails.forEach(f => console.log('  ✗', f));
console.log(fails.length === 0 && errors.length === 0 ? '\nALL_PASS' : '\nHAS_FAILURES');