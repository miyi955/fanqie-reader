#!/usr/bin/env node
/**
 * 一键安装 / 自检。
 *
 * 目标：把「装好这套东西」压缩成一条命令，中间不需要人判断、不需要 AI 猜。
 * 失败时给出明确原因和下一步动作，退出码非 0。
 *
 * 用法：
 *   node install.mjs            完整安装（依赖 → 自检 → 清测试数据 → 桌面图标）
 *   node install.mjs --check    只自检，不动环境
 *   node install.mjs --keep-fixture   保留测试数据（想先看界面效果时用）
 *
 * 幂等：重复执行不会坏，已装好的步骤会跳过。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from 'node:net';

import { HERE, NODE, findBrowser, cleanEnv } from './test-env.mjs';

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const KEEP_FIXTURE = args.includes('--keep-fixture');

const WINDOWS = process.platform === 'win32';

/* ================= 输出 ================= */
const C = { r: '\x1b[0m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m' };
const log = s => console.log(s);
const step = s => log(`\n${C.b}▶ ${s}${C.r}`);
const ok = s => log(`  ${C.g}✔${C.r} ${s}`);
const warn = s => log(`  ${C.y}!${C.r} ${s}`);
const fail = s => log(`  ${C.r}✘ ${s}`);

/** 运行子进程，返回 {code, out} */
function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, {
    cwd: HERE, encoding: 'utf8', env: cleanEnv(),
    shell: WINDOWS && /\.cmd$/i.test(cmd), ...opts,
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/* ================= 1. 环境 ================= */
function checkNode() {
  step('检查 Node 版本');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    fail(`当前 Node v${process.versions.node}，需要 18 及以上`);
    log('  装个新版本：https://nodejs.org （选 LTS）');
    return false;
  }
  ok(`Node v${process.versions.node}`);
  return true;
}

function checkBrowser() {
  step('检查浏览器（截图功能用，缺了不影响阅读）');
  const b = findBrowser();
  if (b) ok(b.replace(HERE, '.'));
  else warn('没找到 Edge/Chrome，截图脚本会跳过。阅读功能不受影响');
  return true;
}

/* ================= 2. 依赖 ================= */
const REQUIRED = ['sharp', 'openfanqie', 'libheif-js'];
const OPTIONAL = ['jsdom', 'playwright-core'];

function depsPresent() {
  const nm = join(HERE, 'node_modules');
  if (!existsSync(nm)) return { ok: false, missing: REQUIRED, missingOpt: OPTIONAL };
  const have = new Set(readdirSync(nm));
  const missing = REQUIRED.filter(p => !have.has(p));
  const missingOpt = OPTIONAL.filter(p => !have.has(p));
  return { ok: missing.length === 0 && missingOpt.length === 0, missing, missingOpt };
}

/** 端口是否有人监听（用来猜代理端口） */
function portOpen(port, host = '127.0.0.1') {
  return new Promise(res => {
    const s = connect({ port, host });
    const done = v => { s.destroy(); res(v); };
    s.setTimeout(600);
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.once('timeout', () => done(false));
  });
}

async function detectProxy() {
  // 常见本地代理端口，按流行度排序
  for (const p of [7897, 7890, 10809, 10808, 1080, 8080, 2080]) {
    if (await portOpen(p)) return `http://127.0.0.1:${p}`;
  }
  return null;
}

function npm(args, extra = {}) {
  const npmCmd = WINDOWS ? 'npm.cmd' : 'npm';
  return run(npmCmd, args, extra);
}

async function installDeps() {
  step('安装依赖');

  const st = depsPresent();
  if (st.ok) { ok('依赖已齐，跳过'); return true; }

  const base = ['install', '--no-audit', '--no-fund'];

  // 尝试顺序：直连 → 国内镜像 → 自动探测代理 → 提示手工处理
  const attempts = [];

  log('  ' + C.d + '尝试 1/3：直连' + C.r);
  let r = npm(base);
  if (r.code === 0) { ok('安装完成（直连）'); return true; }
  attempts.push('直连失败');

  log('  ' + C.d + '尝试 2/3：国内镜像' + C.r);
  r = npm([...base, '--registry', 'https://registry.npmmirror.com']);
  if (r.code === 0) { ok('安装完成（npmmirror 镜像）'); return true; }
  attempts.push('镜像失败');

  const proxy = await detectProxy();
  if (proxy) {
    log('  ' + C.d + `尝试 3/3：通过本地代理 ${proxy}` + C.r);
    r = npm([...base, '--proxy', proxy, '--https-proxy', proxy]);
    if (r.code === 0) { ok(`安装完成（代理 ${proxy}）`); return true; }
    attempts.push(`代理 ${proxy} 失败`);
  } else {
    attempts.push('未探测到本地代理');
  }

  fail('依赖装不上：' + attempts.join(' / '));
  log('');
  log('  手动处理二选一：');
  log('    1. 打开代理软件，确认端口后执行：');
  log('       npm install --proxy http://127.0.0.1:<端口> --https-proxy http://127.0.0.1:<端口>');
  log('    2. 换手机热点/其他网络后重跑：node install.mjs');
  log('');
  log('  最后 20 行 npm 输出供排查：');
  log('  ' + (r.out.trim().split('\n').slice(-20).join('\n  ') || '(无输出)'));
  return false;
}

/* ================= 3. 自检 ================= */
function selfTest() {
  step('自检（造测试数据 → 起服务 → 跑 6 个套件 → 收服务）');

  const r = run(NODE, ['run-all.mjs']);
  const out = r.out;
  const lines = out.trim().split('\n');

  // 回显套件名，失败时能看出卡在哪一组
  for (const ln of lines) {
    const m = /^=== (.+?) \(/.exec(ln);
    if (m) log(`  ${C.d}${m[1]}${C.r}`);
    if (/✘/.test(ln)) fail(ln.trim());
  }

  if (out.includes('ALL_SUITES_PASS')) {
    ok('全部套件通过（ALL_SUITES_PASS）');
    return true;
  }

  fail('自检未通过');
  log('');
  log('  最后 30 行输出：');
  log('  ' + lines.slice(-30).join('\n  '));
  return false;
}

/* ================= 4. 清测试数据 ================= */
function cleanFixture() {
  if (KEEP_FIXTURE) {
    step('保留测试数据');
    warn('测试书会留在书架里，标题带「测试书」字样');
    return true;
  }
  step('清理测试数据');
  const r = run(NODE, ['seed-fixture.mjs', '--clean']);
  if (r.code === 0) {
    ok((r.out.match(/已清理 \d+ 个测试文件[^\n]*/) || ['已清理'])[0]);
    return true;
  }
  warn('清理失败，不影响使用：' + r.out.trim());
  return true;
}

/* ================= 5. 桌面图标 ================= */
function makeShortcut() {
  if (!WINDOWS) {
    step('桌面图标（仅 Windows）');
    warn('当前系统不是 Windows，跳过。用命令启动：node fanqie.mjs app');
    return null;
  }
  step('创建桌面图标');
  const ps = join(HERE, 'make-shortcut.ps1');
  if (!existsSync(ps)) { warn('make-shortcut.ps1 不存在，跳过'); return null; }

  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps]);

  const res = join(HERE, 'shortcut-result.txt');
  if (!existsSync(res)) { warn('没有生成结果文件，图标可能没建上'); return null; }

  const txt = readFileSync(res, 'utf8');
  const lnks = txt.split('\n').filter(l => l.trim().startsWith('OK'));
  if (!lnks.length) {
    warn('没有建出快捷方式（权限或路径问题）');
    log('  ' + txt.trim().split('\n').join('\n  '));
    return null;
  }
  for (const l of lnks) ok(l.replace(/^\s*OK\s+/, '').trim());
  return lnks.length;
}

/* ================= 主流程 ================= */
(async () => {
  log(`${C.b}番茄小说书架 · ${CHECK_ONLY ? '环境自检' : '一键安装'}${C.r}`);
  log(C.d + HERE + C.r);

  if (!checkNode()) process.exit(1);
  checkBrowser();

  if (!CHECK_ONLY) {
    if (!(await installDeps())) process.exit(1);
  } else {
    step('跳过依赖安装（--check 模式）');
    const st = depsPresent();
    if (st.missing.length) { fail('缺依赖：' + st.missing.join(', ')); process.exit(1); }
    if (st.missingOpt.length) warn('缺测试依赖：' + st.missingOpt.join(', ') + '（自检会受影响）');
    else ok('依赖齐全');
  }

  const tested = selfTest();
  if (!tested) {
    log('');
    fail('安装未完成：自检没过。修好上面的报错后重跑 node install.mjs');
    process.exit(1);
  }

  let lnk = 0;
  if (!CHECK_ONLY) {
    cleanFixture();
    lnk = makeShortcut();
  }

  /* ---------- 总结 ---------- */
  log(`\n${C.b}${'─'.repeat(46)}${C.r}`);
  log(`${C.b}完成${C.r}`);
  log(`${C.b}${'─'.repeat(46)}${C.r}`);
  ok('Node 环境');
  ok('依赖');
  ok('自检全绿');
  if (CHECK_ONLY) log(`  ${C.d}（--check 模式，未改环境）${C.r}`);
  else {
    ok('测试数据已清理');
    log(lnk ? `  ${C.g}✔${C.r} 桌面图标 ${lnk} 个` : `  ${C.y}!${C.r} 桌面图标未建（可用 node fanqie.mjs app 启动）`);
  }

  log('');
  log(`${C.b}下一步${C.r}`);
  if (lnk) log('  双击桌面「番茄小说」图标打开书架');
  else log('  node fanqie.mjs app');
  log('  加书：node fanqie.mjs add <链接或id>');
  log('  搜书：node fanqie.mjs search "书名"');

  log('');
  log(C.g + 'INSTALL_OK' + C.r);
  process.exit(0);
})().catch(e => {
  log('');
  fail('安装脚本自身出错：' + (e && e.stack || e));
  process.exit(1);
});