// 一次性跑完所有回归：自己起服务（spawn 管理），跑完收掉。
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, NODE, cleanEnv } from './test-env.mjs';

const M = NODE;
const PORT = 47888;
const BASE = `http://127.0.0.1:${PORT}`;

const env = cleanEnv();

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ping() {
  try {
    const d = await (await fetch(BASE + '/api/ping', { signal: AbortSignal.timeout(1200) })).json();
    return d && d.app === 'fanqie-reader' ? d : null;
  } catch { return null; }
}

function runTest(file, args = []) {
  return new Promise(res => {
    const c = spawn(M, [file, ...args], { cwd: HERE, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', d => out += d);
    c.stderr.on('data', d => out += d);
    c.on('exit', code => res({ code, out }));
  });
}

// 新克隆的仓库里 .cache / books / covers 是空的（运行时产物不进版本库）。
// 没有书时整套行为测试无从跑起，先造离线测试数据。
function hasBooks() {
  const dir = join(HERE, '.cache');
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some(f => /^\d{10,}\.json$/.test(f));
}

if (!hasBooks()) {
  console.log('没有书籍数据，生成离线测试数据…');
  const seed = await runTest('seed-fixture.mjs');
  if (!seed.out.includes('SEED_OK')) {
    console.log('SEED_FAILED\n' + seed.out);
    process.exit(1);
  }
  console.log('');
}

const srv = spawn(M, ['server.mjs', '--foreground', '--no-open', '--port', String(PORT)], {
  cwd: HERE, env, stdio: 'ignore', windowsHide: true,
});

let ok = false;
for (let i = 0; i < 30; i++) {
  await sleep(300);
  if (await ping()) { ok = true; break; }
}
if (!ok) { console.log('SERVER_FAILED_TO_START'); srv.kill(); process.exit(1); }
console.log('service ready on ' + PORT + '\n');

// 先按当前缓存重新生成书架页，避免测试读到过期的 书架.html
const gen = await runTest('fanqie.mjs', ['shelf']);
if (!gen.out.includes('书架已生成')) {
  console.log('SHELF_REGEN_FAILED\n' + gen.out);
  srv.kill();
  process.exit(1);
}

const suite = [
  ['server-smoke.mjs', [BASE], '服务端接口', 'ALL_PASS'],
  ['logic-test.mjs', [], '追更规则', 'ALL_PASS'],
  ['trash-test.mjs', [], '删除保护', 'ALL_PASS'],
  ['shelf-smoke.mjs', [], '书架页', 'ALL_PASS'],
  ['reader-test.mjs', [], '阅读器功能', 'ALL_PASS'],
  // 功能完整性守卫放最后：先确认行为正确，再确认功能没被删
  ['baseline-guard.mjs', [], '功能完整性', 'BASELINE_INTACT'],
];

let failed = 0;
for (const [file, args, label, token] of suite) {
  const r = await runTest(file, args);
  const tail = r.out.trim().split('\n').slice(-4).join('\n');
  console.log(`=== ${label} (${file}) exit=${r.code} ===`);
  console.log(tail);
  if (!r.out.includes(token)) failed++;
  console.log('');
}

srv.kill();
await sleep(500);
console.log(failed === 0 ? 'ALL_SUITES_PASS' : `FAILED_SUITES=${failed}`);
process.exit(failed === 0 ? 0 : 1);