// 功能完整性守卫：对照 BASELINE.md 检查关键能力是否还在。
//
// 这不是业务测试（那是各 *-test.mjs 的事），而是防"删功能"的静态+动态检查。
// 重点盯：接口路由、CLI 命令、核心语义函数、数据字段、危险实现（unlink 复辟）。
//
// 用法：node baseline-guard.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(HERE, f), 'utf8');

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, hint = '') => {
  if (cond) { pass++; results.push(['ok', name]); }
  else { fail++; results.push(['fail', name, hint]); }
};

const server = read('server.mjs');
const core = read('core.mjs');
const cli = read('fanqie.mjs');
const app = read('template/app.html');
const reader = read('template/reader.html');

/* ---------- 1. 服务端路由完整性 ---------- */
const routes = [
  ['GET', '/api/shelf'], ['GET', '/api/search'], ['GET', '/api/book'],
  ['GET', '/api/ping'], ['GET', '/api/open-dir'],
  ['POST', '/api/add'], ['POST', '/api/update'], ['POST', '/api/toggle'],
  ['POST', '/api/remove'], ['POST', '/api/txt'], ['POST', '/api/abort'],
];
for (const [m, p] of routes) {
  check(`路由 ${m} ${p}`, server.includes(`'${p}'`));
}
check('SSE 路由 /api/events', server.includes("'/api/events'"));
check('阅读器路由 /reader/', server.includes("p.startsWith('/reader/')"));
check('封面路由 /cover/', server.includes("p.startsWith('/cover/')"));

/* ---------- 2. CLI 命令完整性 ---------- */
const cmds = ['app', 'shelf', 'list', 'search', 'info', 'add', 'txt', 'update', 'auto', 'rm'];
for (const c of cmds) {
  check(`CLI 命令 ${c}`, new RegExp(`case '${c}'`).test(cli));
}

/* ---------- 3. core 导出完整性 ---------- */
const exportsNeeded = [
  'scanBooks', 'needsUpdate', 'setAutoUpdate', 'removeBook', 'downloadBook',
  'updateOne', 'updateAll', 'buildReaderFile', 'exportTxt', 'fromInput',
  'searchBooks', 'ensureCover', 'createPool', 'isDeviceBlocked',
  'loadStore', 'saveStore', 'fmtWords', 'safeName',
];
for (const e of exportsNeeded) {
  check(`core 导出 ${e}`, new RegExp(`export (async function|function|const) ${e}\\b`).test(core));
}

/* ---------- 4. 追更核心语义（最易回归） ---------- */
check('needsUpdate 包含「缺章仍要补」的判断',
  /downloaded\s*<\s*(?:b\.)?chapters/.test(core),
  '若改回 !finished 会导致完结书缺口永远补不上');
check('needsUpdate 尊重用户开关',
  /autoUpdate\s*!==\s*false/.test(core));
check('updateAll 先判开关再判完结',
  core.indexOf('autoUpdate === false') > -1 &&
  core.indexOf('autoUpdate === false') < core.indexOf('b.finished && b.downloaded >= b.chapters'),
  '顺序错了会让关闭开关的书仍被抓');

/* ---------- 5. 数据安全：不得复用物理删除 ---------- */
check('removeBook 走回收目录而非 unlink',
  /\.trash/.test(core) && /rename\(/.test(core),
  '早期 unlink 直接删，误删过两本书');
const removeBookBody = core.slice(core.indexOf('export async function removeBook'));
const removeFn = removeBookBody.slice(0, removeBookBody.indexOf('\n}\n') + 3);
check('removeBook 函数体内无 unlink', !/unlink\(/.test(removeFn));

/* ---------- 6. 单实例探活必须校验标识 ---------- */
check('ping 返回 app 标识', /app:\s*APP_ID/.test(server) || /app:\s*'fanqie-reader'/.test(server));
check('probe() 校验 app 标识', /d\.app === APP_ID/.test(server) || /app === 'fanqie-reader'/.test(server));
check('instance.json 写入 app 字段', /app:\s*APP_ID/.test(server));

/* ---------- 7. 自脱离启动必须确认子进程存活 ---------- */
check('启动器轮询探活而非盲等', /for \(let i = 0; i < \d+; i\+\+\)/.test(server));
check('子进程失败时回退前台', /falling back to in-process/.test(server));
check('启动异常写日志', /logLaunch/.test(server) && /app\.log/.test(server));

/* ---------- 8. 空闲定时器必须延后到 listen ---------- */
check('idle 定时器不在模块顶层创建', !/^const tickIdle = setInterval/m.test(server),
  '顶层创建会让复用实例的进程永不退出');
check('idle 定时器由 startIdleTimer 启动', /function startIdleTimer/.test(server));
check('startIdleTimer 在 listen 之后才调用',
  server.indexOf('startIdleTimer();') > server.indexOf('server.listen'),
  'listen 之前调用会让复用实例的进程永不退出');

/* ---------- 9. 数据字段完整性 ---------- */
const fields = ['bookId', 'title', 'author', 'words', 'chapters', 'downloaded',
  'finished', 'autoUpdate', 'lastCheckedAt', 'hasReader', 'lastTitle'];
for (const f of fields) {
  check(`scanBooks 返回 ${f}`, new RegExp(`${f}:`).test(core.slice(core.indexOf('export function scanBooks'))));
}

/* ---------- 10. UI 关键元素 ---------- */
const uiIds = ['grid', 'count', 'btnAdd', 'btnUpdateAll', 'maskAdd', 'toast', 'dock', 'btnTheme', 'searchInput'];
for (const id of uiIds) {
  check(`界面元素 #${id}`, app.includes(`id="${id}"`));
}
check('追更开关渲染', /data-toggle/.test(app));
check('完结且完整时锁死开关', /locked/.test(app));
check('右键菜单', /ctx/.test(app));
check('SSE 连接', /new EventSource/.test(app));
check('快捷键 / 聚焦搜索', /e\.key === '\/'/.test(app));
check('快捷键 Ctrl+N 加书', /ctrlKey/.test(app));

/* ---------- 11. 阅读器能力 ---------- */
check('阅读器章节导航（侧栏 nav）', /<nav[^>]*>/.test(reader) && /nav a\.cur/.test(reader));
check('阅读器进度记忆', /localStorage/.test(reader));
check('阅读器字号调节', /fontSize|font-size/i.test(reader));
check('阅读器键盘翻章', /ArrowLeft/.test(reader) && /ArrowRight/.test(reader));

// v2.1.0 新增
check('阅读器返回书架按钮', /id="btnBack"/.test(reader));
check('返回逻辑兼容直接访问（无 referrer 兜底跳首页）',
  /function backToShelf/.test(reader) && /document\.referrer/.test(reader) && /location\.href\s*=\s*'\/'/.test(reader),
  '应用窗口无地址栏，缺这个用户进阅读器就出不来');
check('Esc 键返回书架', /case 'Escape'/.test(reader) && /backToShelf\(\)/.test(reader));
check('阅读器行间距可调', /id="btnLh"/.test(reader) && /id="lhPop"/.test(reader) && /--lh/.test(reader));
check('行间距多档可选', /data-lh=/.test(reader));
check('行间距持久化', /state\.lh/.test(reader) && /JSON\.stringify\(state\)/.test(reader));
check('目录可倒序', /id="btnOrder"/.test(reader) && /function setOrder/.test(reader));
check('倒序按 dataset.i 匹配而非 DOM 顺序',
  /Number\(links\[k\]\.dataset\.i\)/.test(reader),
  '按 DOM 下标匹配会让倒序下高亮和点击错位');
check('目录顺序持久化', /state\.order/.test(reader));
check('阅读器模板改动可批量重建', /export async function rebuildReaders/.test(core) && /case 'rebuild'/.test(cli));

/* ---------- 12. 技术约束 ---------- */
check('只监听 127.0.0.1', /listen\([^)]*'127\.0\.0\.1'/.test(server));
check('设备池轮换存在', /class DevicePool|createPool/.test(core));
check('遇空响应换设备', /isDeviceBlocked/.test(core));
check('.gitignore 排除书籍数据',
  ['books/', 'covers/', '.cache/', '书架.html'].every(p => read('.gitignore').includes(p)));
check('.gitattributes 固定 bat 为 CRLF', /\*\.bat\s+text\s+eol=crlf/.test(read('.gitattributes')));
check('BASELINE.md 存在', existsSync(join(HERE, 'BASELINE.md')));

/* ---------- 13. 可分发性（交给别人能装起来） ---------- */
// 这些不是业务能力，但坏了一样等于别人装不上，所以一并守住。
check('安装流程文档存在', existsSync(join(HERE, 'SETUP.md')),
  '新用户/新机器没有它就无从下手');
check('离线测试数据生成器存在', existsSync(join(HERE, 'seed-fixture.mjs')),
  '新克隆的仓库 .cache 为空，没有造数脚本测试跑不起来');
check('测试脚本不写死本机路径',
  !/C:\/Users\/[a-z]/i.test(read('test-env.mjs')) && /export const HERE/.test(read('test-env.mjs')),
  '写死用户名/盘符换台机器就崩');
check('测试环境解析集中在一处', /export function cleanEnv/.test(read('test-env.mjs')) && /export function findBrowser/.test(read('test-env.mjs')));
check('测试依赖已声明', /"jsdom"/.test(read('package.json')),
  '缺 jsdom 时 jsdom 类测试无法运行');
check('run-all 缺数据时自动造数', /seed-fixture/.test(read('run-all.mjs')));

/* ---------- 输出 ---------- */
console.log('\n=== 功能完整性守卫 ===\n');
for (const [st, name, hint] of results) {
  if (st === 'ok') console.log('  ✔ ' + name);
  else console.log('  ✘ ' + name + (hint ? '\n      → ' + hint : ''));
}
console.log('');
console.log(`通过 ${pass}  失败 ${fail}`);
if (fail > 0) {
  console.log('\n原有功能被破坏。对照 BASELINE.md 修复后再提交。\n');
}
console.log(fail === 0 ? 'BASELINE_INTACT' : 'BASELINE_BROKEN');
process.exit(fail === 0 ? 0 : 1);