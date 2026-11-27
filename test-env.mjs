// 测试脚本共用的环境解析：不写死任何本机路径，换台机器也能跑。
// - HERE：项目根目录（跟随脚本自身位置，拷到哪都行）
// - NODE：当前跑测试的 node，子进程复用同一个，避免选错版本
// - requireFrom：先找项目内 node_modules，找不到再回退到 WorkBuddy 托管目录
// - EDGE：按常见安装位置探测本机 Chromium 内核浏览器
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const NODE = process.execPath;

// 模拟"用户双击快捷方式时用的是系统 node"。有 nvm 托管的 node 就优先用（更接近真实），
// 没有就退回当前进程的 node —— 单实例逻辑与具体 node 版本无关，两种都能验。
export const ALT_NODE = (() => {
  const cands = [
    process.env.FANQIE_NODE,
    'C:/Users/' + (process.env.USERNAME || '') + '/AppData/Local/Author Software/nvm/.nodejs/node.exe',
    'C:/Program Files/nodejs/node.exe',
    '/usr/local/bin/node',
  ].filter(Boolean);
  return cands.find(p => existsSync(p)) || NODE;
})();

const localReq = createRequire(import.meta.url);

/**
 * 解析依赖。优先项目内 node_modules；项目里没装时回退到 WorkBuddy 托管工作区
 * （那是开发机上的现成安装，别人的机器上通常没有，所以正常路径是 npm install）。
 */
export function requireFrom(pkg) {
  try {
    return localReq(pkg);
  } catch (e1) {
    const managed = [
      join(homedir(), '.workbuddy', 'binaries', 'node', 'workspace'),
      'C:/Users/' + (process.env.USERNAME || '') + '/.workbuddy/binaries/node/workspace',
    ];
    for (const dir of managed) {
      try {
        return createRequire(join(dir, 'noop.js'))(pkg);
      } catch { /* 继续找下一个 */ }
    }
    console.error(`缺少依赖 ${pkg}。在项目目录执行：npm install`);
    throw e1;
  }
}

/** 探测本机可用的 Chromium 内核浏览器（Edge 优先，其次 Chrome）。找不到返回 null。 */
export function findBrowser() {
  const cands = [
    process.env.EDGE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  return cands.find(p => existsSync(p)) || null;
}

/** 剥掉代理：访问番茄和本地服务都不能走 WorkBuddy 注入的内部代理。 */
export function cleanEnv() {
  const env = { ...process.env };
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy',
    'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']) delete env[k];
  return env;
}