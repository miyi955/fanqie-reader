// 阅读器功能测试：返回书架 / 行间距 / 目录倒序
// 用真实生成的 books/*.html（不是模板），确保烤进去的文件本身是对的。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { requireFrom } from './test-env.mjs';

const { JSDOM, VirtualConsole } = requireFrom('jsdom');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
};

// 挑一本已生成的阅读器
const bookFiles = readdirSync('books').filter(f => /^\d{10,}\.html$/.test(f));
if (!bookFiles.length) { console.log('没有已生成的阅读器，先跑 node fanqie.mjs rebuild'); process.exit(1); }
const target = bookFiles[0];
const html = readFileSync('books/' + target, 'utf8');

function boot({ referrer, href = 'http://localhost/reader/x' } = {}) {
  const errors = [];
  const vc = new VirtualConsole()
    .on('jsdomError', e => errors.push(e.message))
    .on('error', (...a) => errors.push(a.join(' ')));
  const opts = {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: href,
    virtualConsole: vc,
  };
  // jsdom 不接受空字符串 referrer，只有需要时才传
  if (referrer) opts.referrer = referrer;
  const dom = new JSDOM(html, opts);
  // BOOK 是脚本里的 const，不是 window 属性，只能通过页面内执行环境取
  const BOOK = dom.window.eval('BOOK');
  return { dom, w: dom.window, d: dom.window.document, errors, BOOK };
}

/* ================= 1. 阅读器文件已包含新功能 ================= */
console.log('=== 1. 生成的阅读器包含新功能 ===');
ok('返回书架按钮 #btnBack', html.includes('id="btnBack"'));
ok('行间距按钮 #btnLh', html.includes('id="btnLh"'));
ok('行间距弹层 #lhPop', html.includes('id="lhPop"'));
ok('目录排序按钮 #btnOrder', html.includes('id="btnOrder"'));
ok('行间距 CSS 变量 --lh', html.includes('--lh'));
ok('backToShelf 函数', html.includes('function backToShelf'));
ok('setOrder 函数', html.includes('function setOrder'));
ok('markNav 按 dataset.i 匹配（倒序不错位）',
  /Number\(links\[k\]\.dataset\.i\)/.test(html),
  '若按 DOM 下标匹配，倒序后会高亮错章');

/* ================= 2. 返回书架 ================= */
console.log('=== 2. 返回书架 ===');
{
  // 直接访问（无 referrer）：应跳到首页，而不是 history.back()
  const { w, d, errors, BOOK } = boot({ referrer: '' });
  ok('无 referrer 时脚本无报错', errors.length === 0, errors.join('; '));
  const btn = d.querySelector('#btnBack');
  ok('#btnBack 存在且可点', !!btn);

  let backCalled = false;
  w.history.back = () => { backCalled = true; };

  // jsdom 不实现导航，会广播 "Not implemented: navigation"。
  // 有这条 = 代码确实尝试导航；配合 backCalled 就能区分走了哪条分支。
  const navAttempted = () => errors.some(e => /Not implemented.*navigation/i.test(e));

  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('无来源时点返回 → 尝试跳转首页（不走 history.back）',
    navAttempted() && !backCalled, `nav=${navAttempted()} back=${backCalled}`);

  // Esc 也应触发返回
  errors.length = 0; backCalled = false;
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('Esc 也能返回', navAttempted() && !backCalled, `nav=${navAttempted()} back=${backCalled}`);
}

{
  // 从书架点进来（有 referrer）：应走 history.back()
  const { w, d, errors, BOOK } = boot({ referrer: 'http://localhost/' });
  let backCalled = false;
  w.history.back = () => { backCalled = true; };
  // jsdom 的 history.length 恒为 1，这里模拟"有上一页"
  try { Object.defineProperty(w.history, 'length', { configurable: true, value: 2 }); } catch {}

  d.querySelector('#btnBack').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const navAttempted = errors.some(e => /Not implemented.*navigation/i.test(e));
  ok('有来源时走 history.back()（保留书架滚动位置）',
    backCalled && !navAttempted, `back=${backCalled} nav=${navAttempted}`);
}

// 静态确认兜底目标就是首页，避免只测出"发生了导航"却指向别处
ok('兜底跳转目标是 /', /location\.href\s*=\s*'\/'/.test(html));

/* ================= 3. 行间距 ================= */
console.log('=== 3. 行间距 ===');
{
  const { w, d, errors, BOOK } = boot();
  ok('行间距脚本无报错', errors.length === 0, errors.join('; '));
  const root = d.documentElement;
  const lh0 = root.style.getPropertyValue('--lh');
  ok('初始有行间距值', !!lh0, '取到 "' + lh0 + '"');

  const pop = d.querySelector('#lhPop');
  ok('弹层默认隐藏', !pop.classList.contains('show'));

  d.querySelector('#btnLh').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('点按钮后弹层展开', pop.classList.contains('show'));

  const buttons = pop.querySelectorAll('button[data-lh]');
  ok('提供 5 档行间距', buttons.length === 5, '实际 ' + buttons.length);

  // 选「宽松」2.6
  const wide = pop.querySelector('button[data-lh="2.6"]');
  wide.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('选 2.6 后 --lh 变为 2.6', root.style.getPropertyValue('--lh') === '2.6',
    '实际 ' + root.style.getPropertyValue('--lh'));
  ok('选中项高亮', wide.classList.contains('on'));
  ok('选择后弹层收起', !pop.classList.contains('show'));

  // 持久化
  const saved = JSON.parse(w.localStorage.getItem('fanqie-reader:' + BOOK.id) || '{}');
  ok('行间距写入 localStorage', Math.abs(saved.lh - 2.6) < 0.01, JSON.stringify(saved));

  // 紧凑
  pop.querySelector('button[data-lh="1.6"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('选 1.6 生效', root.style.getPropertyValue('--lh') === '1.6');
}

/* ================= 4. 目录倒序 ================= */
console.log('=== 4. 目录倒序 ===');
{
  const { w, d, errors, BOOK } = boot();
  const nav = d.querySelector('#nav');
  const n = BOOK.chapters.length;
  ok('目录渲染章数正确', nav.children.length === n, `${nav.children.length} vs ${n}`);

  const btn = d.querySelector('#btnOrder');
  ok('默认正序', btn.textContent.includes('正序'));
  ok('正序首项 = 第 1 章', nav.children[0].dataset.i === '0');
  ok('正序末项 = 最后一章', nav.children[n - 1].dataset.i === String(n - 1));

  // 切倒序
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('按钮文案变为倒序', btn.textContent.includes('倒序'), '实际 ' + btn.textContent);
  ok('倒序后章数不变', nav.children.length === n, '实际 ' + nav.children.length);
  ok('倒序首项 = 最后一章', nav.children[0].dataset.i === String(n - 1),
    '实际 ' + nav.children[0].dataset.i);
  ok('倒序末项 = 第 1 章', nav.children[n - 1].dataset.i === '0',
    '实际 ' + nav.children[n - 1].dataset.i);

  // 关键：倒序下点最后一项，应跳到第 1 章，而不是"最后一项的位置下标"
  const lastItem = nav.children[n - 1];
  lastItem.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('倒序下点末项 → 跳到第 1 章（不错位）', w.document.querySelector('#chTitle').textContent ===
    (BOOK.chapters[0].t || '第 1 章'),
    '实际 ' + w.document.querySelector('#chTitle').textContent);

  // 当前章高亮应按 dataset.i，不是 DOM 下标
  const cur = [...nav.children].filter(a => a.classList.contains('cur'));
  ok('倒序下当前章只有 1 个高亮', cur.length === 1, '实际 ' + cur.length);
  ok('高亮的正是当前阅读章', cur[0] && cur[0].dataset.i === '0',
    '实际 ' + (cur[0] && cur[0].dataset.i));

  // 顺序持久化
  const saved = JSON.parse(w.localStorage.getItem('fanqie-reader:' + BOOK.id) || '{}');
  ok('倒序状态写入 localStorage', saved.order === 'desc', JSON.stringify(saved));

  // 重开应保持倒序。
  // 注意：jsdom 每个实例的 localStorage 互相独立，新建实例读不到上面的状态。
  // 所以模拟"重新加载"要在同一实例内清空 DOM、用已存的 state 重跑启动逻辑。
  w.eval(`
    document.querySelector('#nav').innerHTML = '';
    Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}'));
    buildNav(); applyUI(); markNav();
  `);
  ok('重新加载后仍为倒序',
    nav.children[0].dataset.i === String(BOOK.chapters.length - 1),
    '实际 ' + nav.children[0].dataset.i);
}

/* ================= 5. 组合场景 ================= */
console.log('=== 5. 倒序 + 阅读进度组合 ===');
{
  const { w, d, BOOK } = boot();
  const nav = d.querySelector('#nav');
  const n = BOOK.chapters.length;

  // 读到第 5 章
  nav.children[4].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('跳到第 5 章', w.document.querySelector('#chMeta').textContent.includes('第 5 /'));

  // 切倒序，当前章不变
  d.querySelector('#btnOrder').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('切倒序后仍在第 5 章', w.document.querySelector('#chMeta').textContent.includes('第 5 /'));
  const cur = [...nav.children].filter(a => a.classList.contains('cur'));
  ok('切倒序后高亮仍是第 5 章', cur.length === 1 && cur[0].dataset.i === '4',
    '实际 ' + (cur[0] && cur[0].dataset.i));

  // 倒序下点"下一章"按钮
  d.querySelector('#btnNext').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('倒序下「下一章」仍走到第 6 章（不因排序倒转）',
    w.document.querySelector('#chMeta').textContent.includes('第 6 /'),
    '实际 ' + w.document.querySelector('#chMeta').textContent);
}

/* ================= 6. 章节正文未被破坏 ================= */
console.log('=== 6. 正文完整性 ===');
{
  const { w, d, BOOK } = boot();
  const ch = BOOK.chapters[0];
  const paras = d.querySelectorAll('#body p');
  ok('首章段落数正确', paras.length === ch.c.length, `${paras.length} vs ${ch.c.length}`);
  ok('首段文字未被转义破坏', paras[0].textContent === ch.c[0]);
}

console.log('');
console.log(`通过 ${pass}  失败 ${fail}`);
console.log(fail === 0 ? 'ALL_PASS' : 'HAS_FAILURE');
process.exit(fail === 0 ? 0 : 1);