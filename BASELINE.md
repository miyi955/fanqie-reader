# 功能基线 v2.1.2

> **这份文档是后续迭代的验收标准。**
> 任何改动完成后，必须逐条核对本清单，确认原有功能没被破坏。
> 新增功能要同步补进本文档，并标注版本号。

初版锁定于 2026-11-26（v2.0.0）。当前基线 v2.1.2。

---

## 核对流程（每次改动后执行）

1. `node run-all.mjs` —— 自动化套件必须全绿（6 个套件，末位含 `baseline-guard` 守卫）
2. 逐条对照下面「功能清单」的每个 `[ ]`，人工确认未回归
3. 涉及 UI 的改动，跑 `node shot-app.mjs` 截图，确认 JS 错误为 0
4. 新增/修改功能 → 更新本文档对应条目，在小节末尾注明版本

**判定标准：只要有一条原有功能失效，就不算完成，不允许提交。**

---

## 一、书架管理

| 能力 | 实现位置 | 断言 |
|---|---|---|
| 空缓存时正常显示空状态，不报错 | `core.mjs scanBooks` / `app.html` | `[ ]` |
| 列表按加入时间倒序 | `app.html render` | `[ ]` |
| 显示书名、作者、字数、章数、状态 | `app.html card` | `[ ]` |
| 封面等比完整显示，不裁切 | `app.html .cover` | `[ ]` |
| 封面缺失时有占位，不显示破图 | `app.html` | `[ ]` |
| 顶栏显示书籍总数 | `#count` | `[ ]` |

## 二、加书

| 能力 | 实现位置 | 断言 |
|---|---|---|
| 粘贴 `fanqienovel.com/page/<id>` 链接 | `core.mjs fromInput` | `[ ]` |
| 粘贴 `/reader/` `/books/` `/book/` 链接 | `fromInput` 正则 | `[ ]` |
| 粘贴 `?bookId=` / `?book_id=` 链接 | `fromInput` 正则 | `[ ]` |
| 直接输入纯数字 id（≥10 位） | `fromInput` 正则 | `[ ]` |
| 非法输入给出明确提示，不静默失败 | `POST /api/add` | `[ ]` |
| 按书名搜索 | `GET /api/search` | `[ ]` |
| 按作者搜索 | 同上 | `[ ]` |
| 搜索结果可一键加入书架 | `#btnAddGo` | `[ ]` |
| 下载过程实时推进度（SSE） | `GET /api/events` | `[ ]` |
| 下载中可中止 | `POST /api/abort` | `[ ]` |
| 加书后自动抓封面 + 生成阅读器 | `ensureCover` / `buildReaderFile` | `[ ]` |
| 重复加同一本书不产生重复条目 | `downloadBook` 合并逻辑 | `[ ]` |

## 三、追更（核心需求）

| 能力 | 实现位置 | 断言 |
|---|---|---|
| 每本书有独立追更开关 | `app.html switch` / `POST /api/toggle` | `[ ]` |
| 开关状态落盘，重启后保持 | `.cache/<id>.json` 的 `autoUpdate` | `[ ]` |
| 老缓存无 `autoUpdate` 字段时默认开启 | `scanBooks`：`s.autoUpdate !== false` | `[ ]` |
| 已完结 **且** 已下完 → 永久跳过 | `needsUpdate` | `[ ]` |
| 已完结但缺章 → **仍然补齐** | `needsUpdate` | `[ ]` |
| 连载中 → 按开关决定 | `needsUpdate` | `[ ]` |
| 用户关了开关 → 尊重，不抓 | `updateAll` 先判开关 | `[ ]` |
| 完结且完整时开关锁定（不可开启） | `app.html locked` | `[ ]` |
| 增量下载：只补缺失章节，不整本重下 | `updateOne` 按 itemId 比对 | `[ ]` |
| 顶栏「⟳ 追更」批量触发 | `#btnUpdateAll` | `[ ]` |
| 单本右键「追更」 | 右键菜单 | `[ ]` |
| 追更结束汇报：新增 / 跳过 / 失败 | `updateAll` report | `[ ]` |

**这条最容易回归**：`needsUpdate` 若被改回 `!finished`，「已完结但缺章」的书永远补不上缺口。

## 四、阅读器

| 能力 | 实现位置 | 断言 |
|---|---|---|
| `books/<id>.html` 单文件，可独立拷走阅读 | `buildReaderFile` | `[ ]` |
| 目录可展开/收起 | `reader.html` | `[ ]` |
| 阅读进度本地记忆 | localStorage | `[ ]` |
| 字号调节 | reader.html | `[ ]` |
| 主题切换 | reader.html | `[ ]` |
| 键盘：← → 翻章、`j`/`k` 滚动、空格翻页、Esc 退出 | reader.html | `[ ]` |
| 长篇（2000 章级）打开不卡死 | 懒渲染 | `[ ]` |
| 返回书架按钮（应用窗口无后退键） | `#btnBack` / `backToShelf()` | `[ ]` |
| 直接访问阅读器时 Esc 回首页，不退出应用 | `document.referrer` 同源判断 + `location.href='/'` 兜底 | `[ ]` |
| 行间距 5 档可调并持久化 | `#btnLh` / `#lhPop` / CSS 变量 `--lh` | `[ ]` |
| 目录可倒序，切换后当前章不错位 | `#btnOrder` / `setOrder()` / 按 `dataset.i` 匹配 | `[ ]` |
| 改模板后可批量重建已有阅读器 | `core.mjs rebuildReaders` / `rebuild` | `[ ]` |

**v2.1.0 新增**。倒序渲染只反转 DOM 顺序、`data-i` 始终存原章节下标——若按 DOM 下标匹配，倒序下高亮和点击都会错位。返回书架不能无条件 `history.back()`：从外部直接打开 `/reader/<id>` 时 referrer 为空，`back()` 会退出应用。

## 五、移出书架（数据安全）

| 能力 | 实现位置 | 断言 |
|---|---|---|
| 移出时**不物理删除**，移到 `.cache/.trash/<时间戳>/` | `removeBook` | `[ ]` |
| 回收目录内文件可读回 | `trash-test.mjs` | `[ ]` |
| 移出后不在书架列表 | `scanBooks` 正则不匹配 `.trash` | `[ ]` |
| 确认弹层明确告知「可找回」 | `app.html confirm` | `[ ]` |
| 非法 bookId 被拒绝 | `removeBook` 正则校验 | `[ ]` |

**这条是踩坑换来的**：早期用 `unlink` 直接删，误删过两本书的缓存。

## 六、桌面应用形态

| 能力 | 实现位置 | 断言 |
|---|---|---|
| 桌面 + 开始菜单快捷方式 | `make-shortcut.ps1` | `[ ]` |
| 快捷方式指向用户自己的 node，非 WorkBuddy 托管路径 | 候选顺序 | `[ ]` |
| 双击无控制台黑框（自脱离） | `server.mjs` spawn 自身 | `[ ]` |
| 启动器确认服务真的能响应才退出 | 轮询 `probe()` | `[ ]` |
| 子进程起不来时回退到前台跑，不静默失败 | 同上 | `[ ]` |
| 单实例：重复双击复用，不起第二个 | `reuseIfRunning` | `[ ]` |
| 探活校验 `app: 'fanqie-reader'` 标识 | `probe()` | `[ ]` |
| 陈旧 instance.json 不导致误连他方服务 | `probe()` 校验 | `[ ]` |
| 复用实例的进程会自行退出，不残留 | `startIdleTimer` 延后到 listen 后 | `[ ]` |
| 关窗后空闲 15 分钟自动退出 | `IDLE_MS` | `[ ]` |
| 断电重启后不弹「恢复页面」气泡 | 浏览器启动参数 | `[ ]` |
| 启动异常记入 `logs/app.log` | `logLaunch` | `[ ]` |

## 七、命令行

| 命令 | 断言 |
|---|---|
| `app` / `gui` 启动桌面版 | `[ ]` |
| `shelf` 生成单文件书架页 | `[ ]` |
| `list` / `ls` 列出书目 | `[ ]` |
| `search <关键词>` | `[ ]` |
| `info <id\|链接>` | `[ ]` |
| `add` / `read` 下载 | `[ ]` |
| `update` / `up` 追更 | `[ ]` |
| `auto <id> on\|off` 开关 | `[ ]` |
| `rm` / `remove` 移出书架 | `[ ]` |
| `txt <id>` 导出纯文本 | `[ ]` |
| `rebuild [id]` 按当前模板重建阅读器 | `[ ]` |
| `node seed-fixture.mjs [--clean]` 造/清离线测试数据 | `[ ]` |

## 七之二、分发与安装（v2.1.2）

| 能力 | 实现位置 | 断言 |
|---|---|---|
| **一条命令完成安装** | `node install.mjs` | `[ ]` |
| 安装过程无需人工判断（自动降级、明确成功信号） | `install.mjs` 三通道 + `INSTALL_OK` | `[ ]` |
| 依赖安装自动降级：直连 → 国内镜像 → 探测本地代理 | `install.mjs installDeps` | `[ ]` |
| 安装幂等，重复执行不坏 | `install.mjs` 各步先检查后执行 | `[ ]` |
| 非 Windows 跳过图标而非报错 | `install.mjs makeShortcut` | `[ ]` |
| 失败时给出原因与下一步动作，不静默 | `install.mjs` 各分支 | `[ ]` |
| 给 AI 执行的安装指令 | `SETUP.md` | `[ ]` |
| 教用户怎么跟朋友开口 / 怎么应对报错 | `SHARE.md` | `[ ]` |
| 新克隆的仓库无书籍数据也能跑通全部测试 | `seed-fixture.mjs` + `run-all.mjs` 自动造数 | `[ ]` |
| 测试脚本不写死本机用户名/盘符 | `test-env.mjs` 统一解析 | `[ ]` |
| 造数是幂等的，不污染真书（有真书则跳过） | `seed-fixture.mjs` 的 id 段限定 | `[ ]` |
| 测试依赖已声明，`npm install` 一次装全 | `package.json` devDependencies | `[ ]` |

## 八、服务端接口

| 路由 | 断言 |
|---|---|
| `GET /` 应用界面 | `[ ]` |
| `GET /reader/<id>` 阅读器 | `[ ]` |
| `GET /cover/<id>` 封面 JPEG（校验文件头） | `[ ]` |
| `GET /api/shelf` | `[ ]` |
| `GET /api/search?q=` | `[ ]` |
| `GET /api/book?id=` | `[ ]` |
| `GET /api/ping` 返回 `app` 标识 | `[ ]` |
| `GET /api/events` SSE，首帧 hello | `[ ]` |
| `GET /api/open-dir` | `[ ]` |
| `POST /api/add` | `[ ]` |
| `POST /api/update` | `[ ]` |
| `POST /api/toggle` | `[ ]` |
| `POST /api/remove` | `[ ]` |
| `POST /api/txt` | `[ ]` |
| `POST /api/abort` | `[ ]` |
| 未知路由 404 | `[ ]` |
| 非法 bookId 返回 400 | `[ ]` |
| 只监听 127.0.0.1，不对局域网暴露 | `[ ]` |

## 九、技术约束（不能破）

| 约束 | 原因 |
|---|---|
| `core.mjs` 是唯一业务实现，CLI 与 GUI 不得各写一套 | 双份逻辑必然漂移 |
| 单设备约 100–180 请求后被静默限流（HTTP 200 + 空 body） | 必须设备池轮换，不能靠状态码判断 |
| 封面 HEIC 只能原样 GET，改扩展名 403 | 换 URL 就抓不到图 |
| `.bat` 必须 CRLF + 纯 ASCII | LF 换行双击报错；中文在 cmd 代码页下被截断 |
| Git 仓库不提交 `books/` `covers/` `.cache/` `书架.html` | 含书籍正文与个人书单 |
| 访问番茄需剥掉 WorkBuddy 注入的代理 | 内部代理不通公网 |
| 改建 `template/reader.html` 后必须跑 `node fanqie.mjs rebuild` | 阅读器是模板+数据烤合的单文件，已下载的书不会自动跟随模板更新 |

## 十、测试套件

| 脚本 | 覆盖 | 当前 |
|---|---|---|
| `run-all.mjs` | 一键全跑 | 全绿 |
| `server-smoke.mjs` | 服务端 25 条 | 25/25 |
| `logic-test.mjs` | 追更规则 6 条固定用例 + 按实际书目逐本验证 | 全绿 |
| `trash-test.mjs` | 删除保护 9 条 | 9/9 |
| `shelf-smoke.mjs` | 书架页 22 条 | 22/22 |
| `reader-test.mjs` | 阅读器功能 43 条 | 43/43 |
| `baseline-guard.mjs` | 功能完整性静态守卫 113 条 | 113/113 |
| `coldstart-test.mjs` | 冷启动 11 条 | 11/11 |
| `shot-app.mjs` | 界面截图 + JS 错误数 | 0 错误 |

---

## 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v2.0.0 | 2026-11-26 | 初版基线：桌面应用 + 加书 + 按书追更 + 完结跳过 |
| v2.1.0 | 2026-11-26 | 阅读器返回书架 / 行间距 5 档 / 目录倒序；新增 `rebuild` 命令 |
| v2.1.1 | 2026-11-27 | 可分发性：SETUP.md 安装流程、seed-fixture 离线造数、测试路径自解析 |
| v2.1.2 | 2026-11-27 | 一键安装 install.mjs（自动降级 + 明确成功信号）；SHARE.md 分享引导 |