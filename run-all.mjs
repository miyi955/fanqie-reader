// 一次性跑完所有回归：自己起服务（spawn 管理），跑完收掉。
import { spawn } from 'node:child_process';

const M = 'C:/Users/yangl/.workbuddy/binaries/node/versions/22.22.2-2/node.exe';
const HERE = 'D:/WorkBuddy/Lan-日常/outputs/fanqie-reader';
const PORT = 47888;
const BASE = `http://127.0.0.1:${PORT}`;

const env = { ...process.env };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) delete env[k];

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

const suite = [
  ['server-smoke.mjs', [BASE], '服务端接口', 'ALL_PASS'],
  ['logic-test.mjs', [], '追更规则', 'ALL_PASS'],
  ['trash-test.mjs', [], '删除保护', 'ALL_PASS'],
  ['shelf-smoke.mjs', [], '书架页', 'ALL_PASS'],
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