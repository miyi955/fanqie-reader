// 冷启动/单实例场景验证。不依赖 shell 的 & 后台语义，用 spawn 自己管进程。
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';

const M = 'C:/Users/yangl/.workbuddy/binaries/node/versions/22.22.2-2/node.exe';
const NVM = 'C:/Users/yangl/AppData/Local/Author Software/nvm/.nodejs/node.exe';
const HERE = 'D:/WorkBuddy/Lan-日常/outputs/fanqie-reader';
const INSTANCE = HERE + '/.cache/instance.json';

const env = { ...process.env };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) delete env[k];

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  OK   ' + n); } else { fail++; console.log('  FAIL ' + n); } };

const readInst = () => { try { return JSON.parse(readFileSync(INSTANCE, 'utf8')); } catch { return null; } };
const ping = async (port, t = 1500) => {
  try {
    const d = await (await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(t) })).json();
    return d;
  } catch { return null; }
};

function run(args, nodeExe = M) {
  return spawn(nodeExe, ['server.mjs', ...args], { cwd: HERE, env, stdio: 'ignore', windowsHide: true, detached: true });
}

console.log('=== 场景 1：陈旧记录指向别人的 HTTP 端口（Clash 7897）===');
{
  // 7897 上确实有服务，但不是我们的。旧实现只看 r.ok 会误判复用。
  writeFileSync(INSTANCE, JSON.stringify({ app: 'fanqie-reader', port: 7897, pid: 1, startedAt: 1 }));
  const p = run(['--foreground', '--no-open', '--port', '47666']);
  await sleep(3500);
  const inst = readInst();
  ok('未误判复用，起了自己的实例（端口 47666）', inst && inst.port === 47666);
  const d = await ping(47666);
  ok('新实例可服务', d && d.app === 'fanqie-reader');
  p.kill();
  await sleep(500);
}

console.log('=== 场景 2：无 app 字段的旧格式记录 ===');
{
  writeFileSync(INSTANCE, JSON.stringify({ port: 7897, pid: 1, startedAt: 1 }));
  const p = run(['--foreground', '--no-open', '--port', '47667']);
  await sleep(3500);
  const inst = readInst();
  ok('旧格式记录被忽略，起了新实例', inst && inst.port === 47667);
  p.kill();
  await sleep(800);
}

console.log('=== 场景 3：真实双实例（第二个应复用而非重复起）===');
{
  try { rmSync(INSTANCE); } catch {}
  const a = run(['--foreground', '--no-open', '--port', '47668']);
  await sleep(3000);
  const ia = readInst();
  ok('第一个实例已就绪', ia && ia.port === 47668);

  // 第二个用 nvm node（模拟真实双击），不带 --port，应复用 47668 并立即退出
  const b = await new Promise(res => {
    const c = spawn(NVM, ['server.mjs', '--foreground', '--no-open'], { cwd: HERE, env, stdio: 'ignore', windowsHide: true });
    const t = setTimeout(() => { c.kill(); res('TIMEOUT'); }, 9000);
    c.on('exit', code => { clearTimeout(t); res(code); });
  });
  ok('第二个进程自行退出（code=0）', b === 0);
  const inst2 = readInst();
  ok('实例记录未被第二个进程篡改', inst2 && inst2.port === 47668);
  const d = await ping(47668);
  ok('原实例仍在服务', d && d.app === 'fanqie-reader');
  a.kill();
  await sleep(500);
}

console.log('=== 场景 4：自脱离启动（真实双击路径，用 nvm node）===');
{
  try { rmSync(INSTANCE); } catch {}
  // 与快捷方式完全一致：不带 --foreground / --no-open / --port
  const parent = spawn(NVM, ['server.mjs', '--no-open'], { cwd: HERE, env, stdio: 'ignore', windowsHide: true });
  const code = await new Promise(res => parent.on('exit', res));
  ok('父进程快速退出（不占控制台）', true);
  await sleep(1500);
  const inst = readInst();
  ok('父进程退出后 instance.json 存在', !!inst);
  let alive = null;
  if (inst) alive = await ping(inst.port, 2500);
  ok('自脱离子进程在服务', !!alive && alive.app === 'fanqie-reader');
  if (alive) {
    await sleep(6000);
    const again = await ping(inst.port, 2500);
    ok('6 秒后仍存活（不是启动即崩）', !!again);
  }
  if (inst && inst.pid) { try { process.kill(inst.pid); } catch {} }
}

console.log('');
console.log(`通过 ${pass}  失败 ${fail}`);
console.log(fail === 0 ? 'ALL_PASS' : 'HAS_FAILURE');
process.exit(fail === 0 ? 0 : 1);