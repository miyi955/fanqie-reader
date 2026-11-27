# 安装流程 · 给 AI 助手执行

> **这份文档是写给 AI 助手读的，不是给人读的教程。**
> 用户把这份文档交给你，意思是：按下面步骤把番茄小说书架装到他本机，直到能打开书架为止。
>
> 执行原则：
> - 每一步都有**期望输出**。输出对得上就往下走，对不上就查该步的「不符怎么办」。
> - 不要跳步，不要"看起来装好了"就宣布完成——第 4 步的自检必须全绿。
> - 所有命令都在项目根目录执行。项目根目录 = 本文件所在目录。
> - 全程不需要联网访问番茄，只有第 3 步装 npm 依赖需要公网。

---

## 0. 先确认你在哪台机器、什么环境

执行：

```bash
node -v
```

| 结果 | 判断 |
|---|---|
| `v18.x` 及以上 | 通过，继续 |
| 版本号低于 18 | 停止，让用户装 Node 18+（推荐 20 或 22 LTS） |
| `command not found` / 不是内部或外部命令 | 停止，让用户装 Node 18+ |

再确认浏览器（只有截图脚本要用，`npm test` 不需要）：

```bash
ls "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" 2>/dev/null \
  || ls "/c/Program Files/Google/Chrome/Application/chrome.exe" 2>/dev/null
```

**有输出** → 截图功能可用。**没输出** → 不阻塞，只是 `node shot-app.mjs` 会提示 `NO_BROWSER` 并跳过。

> 平台说明：核心功能只支持 Windows。`开始.bat`、`make-shortcut.ps1`、`--app` 开窗都是 Windows 专用。macOS/Linux 只能跑命令行和本地服务，不要承诺桌面图标。

---

## 1. 拿到代码

### 情况 A：用户能访问仓库

```bash
git clone <仓库地址> fanqie-reader
cd fanqie-reader
```

**期望**：目录里有 `core.mjs`、`server.mjs`、`fanqie.mjs`、`package.json`。

### 情况 B：仓库是私有的，用户拿不到权限

让用户把项目文件夹打包发过来，解压后 `cd` 进去即可。两种情况最终目录结构一样。

### 检查点

```bash
ls core.mjs server.mjs fanqie.mjs package.json BASELINE.md
```

**期望**：5 个文件名全部列出，没有 `No such file`。

**不符怎么办**：目录不对，或者拿到的是旧版本。`BASELINE.md` 缺失说明版本早于 v2.0.0，让用户重新取。

---

## 2. 认清哪些目录本来就不该有

新克隆下来，下面这些**必须是不存在的**，这是正常的，不要以为是缺文件：

```
books/        阅读器 HTML，每本书一个
covers/       封面 JPEG
.cache/       章节缓存 + 设备池 + 回收站
书架.html      单文件书架页
logs/         日志
```

它们都在 `.gitignore` 里，因为含书籍正文和个人书单。**第 4 步的自检会自动生成测试数据填进去。**

---

## 3. 装依赖

```bash
npm install
```

**期望**：末行出现 `added N packages` 或 `up to date`，且没有 `npm error`。

### 如果卡住或报 ETIMEDOUT

这台机器可能挂着代理，而 npm 默认不走代理。**注意：不要用 `npm config set proxy` 改全局配置**，那会污染用户环境。用一次性参数：

```bash
# Windows 上用 Clash 类工具，通常是 7897 端口
npm install --proxy http://127.0.0.1:7897 --https-proxy http://127.0.0.1:7897
```

端口不对的话问用户代理软件listen的端口，或让他临时关掉代理再装。

如果用户机器在国内且没装代理工具，换镜像源（一次性的，不改全局）：

```bash
npm install --registry https://registry.npmmirror.com
```

### 检查点

```bash
ls node_modules | grep -E "^(sharp|jsdom|playwright-core|openfanqie)$"
```

**期望**：4 个包都列出来。

- 缺 `sharp` → 封面转换会失败，必须装上。它是原生模块，装不上通常是 Node 版本或平台不匹配。
- 缺 `jsdom` → 测试跑不了，但应用能跑。
- 缺 `playwright-core` → 截图跑不了，但应用能跑。

---

## 4. 自检（这一步不能跳）

```bash
npm test
```

等价于 `node run-all.mjs`。它会：造离线测试数据 → 自己起服务 → 跑 6 个套件 → 收掉服务。

**期望输出最后一行是 `ALL_SUITES_PASS`**，中间的套件应该是：

| 套件 | 期望 |
|---|---|
| 服务端接口 | `通过 25  失败 0` |
| 追更规则 | `通过 11  失败 0` |
| 删除保护 | `通过 9  失败 0` |
| 书架页 | `断言失败: 0` |
| 阅读器功能 | `通过 43  失败 0` |
| 功能完整性 | `通过 108  失败 0` + `BASELINE_INTACT` |

### 常见失败与处理

**`SERVER_FAILED_TO_START`**
端口 47888 被占了。查占用：

```bash
netstat -ano | findstr :47888
```

有输出就说明被占。让用户关掉占用进程，或临时改 `run-all.mjs` 里的 `PORT`（改完记得改回）。

**`SEED_FAILED`**
造数据失败。多半是 `sharp` 没装好。看输出里的具体错误。

**多个套件同时失败，报 `Cannot find module 'jsdom'`**
依赖没装全，回第 3 步。

**`NO_BROWSER`**
没找到 Edge/Chrome。不影响核心功能，可以继续。要截图就给用户设置环境变量：

```bash
set EDGE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

**测试跑完但书架还是空的**
正常。测试数据是假的，第 6 步加真书才进书架。

### 不要做的两件事

1. **不要把起服务和跑测试分成两个命令**。测试脚本自己会 spawn 服务；如果你在沙箱环境里先起一个后台服务再跑测试，服务会在两次工具调用之间被回收，直接报 `ERR_CONNECTION_REFUSED`。一条 `npm test` 就够。
2. **不要用 `nohup ... &` 之类的方式后台起服务然后立即返回**。当前这轮流式会话结束时子进程会被回收。

---

## 5. 清掉测试数据（可选，但建议）

自检生成的 3 本假书标题带「测试书」字样，id 固定 `900000000000000000x`。真实使用前建议清掉：

```bash
node seed-fixture.mjs --clean
```

**期望**：`已清理 N 个测试文件（真实书籍未动）`。

这个命令只匹配 `900000000000000000\d` 开头的文件，**不会碰任何真实书籍**。

---

## 6. 装桌面图标

```bash
powershell -ExecutionPolicy Bypass -File make-shortcut.ps1
```

**期望**：输出 `done`，同目录生成 `shortcut-result.txt`，内容形如：

```
NODE C:\...\node.exe
OK   C:\Users\<用户>\Desktop\番茄小说.lnk
OK   C:\Users\<用户>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\番茄小说.lnk
```

看到两个 `OK` 就是桌面 + 开始菜单都装好了。

### 不符怎么办

**`node.exe not found. Install Node.js 18+ first.`**
`node` 不在常见的安装路径，也不在 PATH 里。让用户确认 `node -v` 能跑；能跑就把 node 路径告诉脚本作者（或直接手工建快捷方式，目标填 `node.exe` 全路径，参数填 `"<项目路径>\server.mjs"`）。

**`ExecutionPolicy` 相关报错**
确认 `-ExecutionPolicy Bypass` 带了。还不行用：

```bash
powershell -Command "& { Set-ExecutionPolicy -Scope Process Bypass; . ./make-shortcut.ps1 }"
```

**权限不足**
只影响开始菜单那一条。桌面图标建上就能用，不必强求。

---

## 7. 加第一本书

**先验证应用能起来**（不要直接双击，先看有没有报错）：

```bash
node fanqie.mjs app
```

**期望**：窗口自动打开，显示「我的书架」。终端不退出（服务在前台跑）。

关掉窗口，终端里 Ctrl+C 结束，然后正式用桌面图标。

### 加书

三选一：

```bash
# 1. 知道 id
node fanqie.mjs add 7686168223049337880

# 2. 知道链接（网页/App 的分享链接都行）
node fanqie.mjs add https://fanqienovel.com/page/7686168223049337880

# 3. 只知道书名
node fanqie.mjs search "十日终焉"
```

**期望**：`add` 会打印下载进度，最后显示章节数和设备数。一本 1500 章的书大约 1–2 分钟。

加完刷新书架（或重启应用）就能看到。也可以命令行确认：

```bash
node fanqie.mjs list
```

### 加书失败怎么查

**进度卡住不动**
单台虚拟设备约 100–180 次请求后被静默限流（HTTP 200 + 空 body）。程序会自动退役换新设备，正常情况下不用管。卡超过 5 分钟：

```bash
node fanqie.mjs add <id> --debug
```

看具体报错。

**`签名失败` / `401` / 返回空**
番茄客户端接口变了，`openfanqie` 需要跟进更新。这不是配置问题，让用户等上游修复，或去仓库提 issue。

**下载了部分章节就停**
缓存不会丢，重新跑 `add` 同一个 id 会接着下（断点续传，只补缺的章节）。

---

## 8. 日常使用

| 想做什么 | 怎么做 |
|---|---|
| 打开书架 | 双击桌面「番茄小说」图标 |
| 追更所有书 | 应用里点 `⟳ 追更`；或 `node fanqie.mjs update` |
| 单本追更 | 卡片右下角 `⋯` → 追更 |
| 关某本书的自动追更 | 封面上方的开关 |
| 导出成 TXT | `⋯` → 导出 TXT；或 `node fanqie.mjs txt <id>` |
| 移出书架 | `⋯` → 移出（文件进 `.cache/.trash/`，可找回） |

**重启电脑后不需要做任何事**，双击图标即可。服务是按需启动的。

---

## 9. 改代码之后（如果用户要维护）

这是维护规则，用户明确要求过的：

1. 改完必须跑 `npm test`，必须 `ALL_SUITES_PASS`
2. 新增功能同步更新 `BASELINE.md`，标注版本
3. **改了 `template/reader.html` 后必须跑 `node fanqie.mjs rebuild`**——阅读器是模板+数据烤成的单文件，已下载的书不会自动跟随模板更新，不 rebuild 用户看到的还是旧界面
4. 提交时 `.git/hooks/pre-commit` 会自动跑功能完整性守卫，不通过会拒绝提交

守卫拦的是"不知不觉删掉功能"，不是"不许改"。确实要删功能，先改 `BASELINE.md` 和 `baseline-guard.mjs` 的检查项，再提交。

---

## 10. 一页速查：故障 → 动作

| 现象 | 最可能原因 | 动作 |
|---|---|---|
| 双击图标没反应 | 服务起不来 | 看 `logs/app.log` |
| 窗口白了 / 书架空白 | 一本书都没有 | 正常，先加书 |
| 阅读器打不开 | 没生成阅读器文件 | `node fanqie.mjs rebuild` |
| 改了阅读器模板没生效 | 忘记 rebuild | `node fanqie.mjs rebuild` |
| 封面是裂图 | `sharp` 没装 | 重装依赖，`npm run update` 重新抓封面 |
| 报错含 `proxy` / `ETIMEDOUT` | 代理挡住了 | 浏览器访问番茄不受影响；npm 装包要带 `--proxy` |
| 报错含 `ERR_CONNECTION_REFUSED` | 服务没起来 | 一条命令内起服务并跑测试，别分两步 |
| `npm test` 全绿但功能不对 | 数据是测试数据 | `node seed-fixture.mjs --clean` 后加真书 |

---

## 完成判据

全部满足才算装好：

- [ ] `node -v` ≥ 18
- [ ] `ls node_modules` 里有 `sharp`
- [ ] `npm test` 输出 `ALL_SUITES_PASS`
- [ ] `shortcut-result.txt` 里至少一条 `OK`
- [ ] 双击桌面图标能打开书架界面
- [ ] `node fanqie.mjs list` 能列出书（加过书之后）

**未满足的项要如实告诉用户哪一条没过、卡在哪一步、看到什么报错。不要用"应该可以了"糊过去。**

---

## 免责

仅供个人阅读学习。不要用于商业用途、批量分发或任何侵犯著作权的场景。