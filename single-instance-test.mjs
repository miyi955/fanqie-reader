// 验证单实例：连续启动两次，第二次应复用已有实例而不是抢占新端口
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, cleanEnv } from './test-env.mjs';

const INST = join(HERE, '.cache', 'instance.json');

function runServer() {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(HERE, 'server.mjs'), '--no-open'], {
      cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanEnv(),
    });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    setTimeout(() => { try { p.kill(); } catch {} resolve(out); }, 5000);
  });
}

const before = existsSync(INST) ? JSON.parse(readFileSync(INST, 'utf8')) : null;
console.log('启动前实例:', before ? `port=${before.port} pid=${before.pid}` : '无');

const out = await runServer();
console.log('第二次启动输出:');
console.log('  ' + out.trim().split('\n').join('\n  '));

const after = existsSync(INST) ? JSON.parse(readFileSync(INST, 'utf8')) : null;
console.log('启动后实例:', after ? `port=${after.port} pid=${after.pid}` : '无');

const reused = before && after && before.port === after.port;
console.log(reused ? '\nREUSE_OK  第二次启动复用了已有实例' : '\nREUSE_FAIL 出现了第二个实例');