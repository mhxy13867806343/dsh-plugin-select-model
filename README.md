# dsh-plugin-select-model

<p align="center"><img src="icon.svg" width="72" height="72" alt="dsh-plugin-select-model 图标"></p>

给 DSH（DeepSeek Harness）Web GUI 的模型菜单加一个出口：**在菜单底部多一行「添加模型」**，点开后弹出服务商选择与 API Key 填写框，方便接入官方列表之外的第三方模型。

> **当前状态：v0.5.0。** 除了添加 / 编辑 / 删除第三方模型，管理弹窗的每一行现在多一个**「选择」**按钮：点它会把**当前对话**切到这个模型（`remote.session.selectModel`），并且当前正在用的那一行会在列表里**高亮并标「使用中」**。高亮读的是会话自己的 `modelSelection` 投影，所以关掉重开、切回对话、刷新页面之后依旧对得上——「下次打开带高亮」不是本地缓存，而是真实状态。

## 功能

- **模型菜单底部新增一行「添加模型」**：位置在推理等级等原生行之后，带分隔线；样式克隆自原生菜单行（同样的类名与右侧 chevron），所以深浅色主题、hover、键盘走查都与相邻行一致。
- **点击后打开「添加模型」弹窗**：遮罩层里一个居中面板，包含
  - 第三方服务商网格：OpenAI、Anthropic、Google Gemini、DeepSeek、阿里云百炼、智谱、Moonshot、硅基流动、OpenRouter，以及「自定义（OpenAI 兼容）」；
  - 字段：API Key、Base URL、**模型名称（点击输入框或箭头展开下拉，可搜索、也可以直接手输）**；
  - 底部按钮：取消 / 添加模型。
- **模型列表按平台实时获取**：切换服务商会清空上一个平台的模型选择，并按该平台协议请求 `/models`：
  OpenAI 兼容（Bearer）、Anthropic（`x-api-key` + `anthropic-version`）、Google Gemini（`?key=`，并过滤掉不支持 `generateContent` 的模型）、OpenRouter（公开列表）。平台没返回、没填 Key 或网络失败时，退回该服务商内置的常用型号，仍可手动输入。
- **三条数据通道（按可信度降级）**：
  1. 填了平台 Key → **平台自己的 `/models`**（浏览器直连优先；CORS 受限时走 Host 代理），状态显示「平台实时 · N 个模型」；
  2. 没填 Key → **OpenRouter 公共目录**按厂商前缀过滤（OpenAI / Anthropic / Google / DeepSeek / Qwen / GLM / Kimi 各自的现役型号），状态显示「公共目录 · N 个模型」——它不是平台私有清单，但比内置静态列表实时；
  3. 都拿不到 → 内置常用型号；任何情况下都可以手动输入模型 ID。
- **添加会真正落库**：点「添加模型」→ 写入 `llm-pi-ai` 的 `providers.<route>`（`api` / `baseURL` / 模型列表）+ 把 Key 存进 DSH 凭据库（`credentials.set`），然后重新打开模型菜单就能看到该服务商分组。Gemini 会自动改用官方的 OpenAI 兼容端点；Anthropic 走 `anthropic-messages` 协议。
- **「管理已添加模型」入口**：模型菜单在「添加模型」下面还有一行「管理已添加模型 N 个」；点击弹出管理弹窗，里面有搜索、已添加列表，每行可**选择**（把当前对话切到这个模型）、**编辑**（改显示名 / 模型 ID / 地址，Key 留空保持不变）或**删除**（弹窗二次确认，同时移除配置与凭据）。数据来自 `remote.settings.describe()`，写入走 `remote.settings.mutate()` / `remote.credentials`，不需要额外 Host 路由。
- **「选择」真正切换当前会话的模型**：点击后调 `remote.session.selectModel({ sessionId, provider: route, model })`；成功后当前对话下一轮就用这个模型（DSH 同时会把它存成默认选择），失败按错误码给出人话：`session/writer-held`（正在生成，等这一轮结束）、`session/model-unavailable`（目录里还没有这个模型，重开模型菜单刷新）。
- **当前模型高亮**：管理弹窗里正在用的那一行加主题色描边 + 「使用中」标签，按钮变成禁用的「已选择」。高亮来自会话的 `modelSelection` 投影（`sessions.binding(sessionId).session.projections.faceOf('modelSelection')`），所以不是一次性的视觉标记：关掉重开、切换会话、刷新页面都会按实际在用的模型显示。会话 id 由一个注册在 `conversation.input.left`（会话作用域）里的「只渲染 null」探针同步进插件。
- **自定义服务商**只提供手动输入，不请求平台（便于接私有/自建网关）。
- **自动跟随原生菜单**：用 `MutationObserver` 监听菜单的挂载，只在模型根菜单打开时注入那一行；菜单卸载时这一行随菜单 DOM 一起消失，插件卸载时再兜底清理一次，不残留 DOM。
- **文案中英双语**：通过 `ctx.locale.register` 注册，跟随 DSH 当前语言切换（`locale/zh.json` / `locale/en.json` 同时提供插件管理器里显示的标题与描述）。
- **配色只用主题令牌**：客户端样式只用 `--dsw-alias-*` 变量并带兜底色，不写死深浅色。

## 当前状态

| 能力 | 状态 |
| --- | --- |
| 模型菜单底部「添加模型」一行（注入 / 清理） | ✅ 已完成 |
| 点击关闭原生菜单并打开弹窗 | ✅ 已完成 |
| 服务商网格 + API Key / Base URL / 模型名称字段 + 按钮 | ✅ 已完成 |
| 切换服务商 → 该平台自己的模型清单（下拉 / 搜索 / 手输） | ✅ 已完成 |
| 按平台协议实时拉取模型列表（Host 代理，Key 不落盘） | ✅ 已完成 |
| 中英文案、深浅色可读性 | ✅ 已完成 |
| 保存非敏感草稿（服务商 / 地址 / 模型名） | ✅ 已完成（`localStorage`） |
| 把填写内容写进 DSH 模型服务配置（`llm-pi-ai`） | ✅ 已完成 |
| API Key 存储 | ✅ 已存入 DSH 凭据库（不再只存内存） |
| 新增服务商在模型菜单中出现 | ✅ 已完成（重开模型菜单刷新目录） |
| 模型菜单里的「管理已添加模型」入口（按钮 → 弹窗） | ✅ 已完成 |
| 管理弹窗：搜索 / 列表 | ✅ 已完成 |
| 管理弹窗每行「选择」→ 切换当前会话模型 | ✅ 已完成（`remote.session.selectModel`） |
| 当前模型在管理弹窗里高亮（关掉重开仍在） | ✅ 已完成（读 `modelSelection` 投影） |
| 编辑 / 删除已添加项（删除有二次确认） | ✅ 已完成 |
| 连通性测试 | ⛔ 未实现 |
| Host 侧路由 / 服务 | ✅ 已完成（`/api/select-model/*`） |

## 安装

前置条件：DSH Desktop 或 `dsh web`（带 Web GUI 的 profile）；本仓库**必须同时包含 `index.js` 与 `client.js`** —— `index.js` 是 Host 入口，`client.js` 才是 UI 本体，缺任何一个 bundle 都装载不起来。插件没有 npm 依赖，不需要 `npm install`。

### 方式一：从本机目录安装（推荐）

在 DSH 里让 agent 用插件管理器安装，`target` 填本仓库的绝对路径：

```text
plugin_manager({ action: "install_bundle", target: "/绝对路径/dsh-plugin-select-model" })
```

装完后通常无需手动刷新：本地目录安装是软链，客户端 bundle 的改动会走 HMR；若菜单里没出现新增行，再刷新一次 Web GUI 页面。**不要**改本仓库里的 `package.json` 或往 `~/.dsh/profiles/<profile>/node_modules/` 里手动拷文件，那会绕过插件管理器的依赖记账，卸载时会留下残渣。

> **注意（只影响开发升级）**：客户端 `client.js` 改动会热更新；使用**浏览器直连**的平台（OpenAI / DeepSeek / Moonshot / SiliconFlow / OpenRouter / Gemini）改完即生效。但 Host 半边 `index.js` 的改动**必须重启一次 DSH** 才会加载新的 JS 模块（Node 的 ESM 缓存不会因为改文件而失效），所以依赖 Host 代理的 **Anthropic / CORS 受限平台**在升级后需要重启一次才会实时拉取。全新安装不存在这个问题。

### 方式二：本机目录软链 / 复制

仅用于开发调试：把本仓库放到 profile 的 `node_modules/dsh-plugin-select-model`（或用 `ln -s`），再让 plugin_manager 识别它。日常使用请走方式一。

### 验证

1. 插件管理器列表里能看到 **「模型菜单 · 添加模型」** 标题、描述和本仓库的图标（读自 `locale/*.json` 与 `icon.svg`）；
2. 打开任意对话的模型菜单，底部出现「添加模型」一行；
3. 点它：原生菜单关闭，弹窗出现，服务商网格与三个输入框完整，深浅色都清楚可读；
4. 在服务商之间来回切换，模型下拉里的清单会跟着换（OpenAI 与 Anthropic 的型号不同），切换后已选模型会被清空；
5. 填好 API Key（或选 OpenRouter 这种列表公开的服务商）后，模型下拉会自动拉取平台真实清单，并在输入框下方显示「来自平台 · 共 N 个模型」；把「自定义」选中则只保留手动输入。
6. 打开「管理已添加模型」：每行有 **选择 / 编辑 / 删除** 三个按钮；点「选择」后当前对话改用该模型（右下角 Toast），该行变成主题色高亮 + 「使用中」，按钮变为禁用的「已选择」；关掉弹窗再打开、切到别的对话再切回来，高亮依旧跟着实际在用的模型。会话正在生成回复时点「选择」会提示等这一轮结束。

开发时还可以用内置自检（Client Inspect provider `SelectModel`；除 `highlightProbe` 只改界面高亮外均只读）：

| 方法 | 作用 |
| --- | --- |
| `status` | 注入行数量、菜单/弹窗是否打开、文案样例 |
| `selfTest` | 自动开菜单 → 检查新增行 → 开弹窗 → 读取布局尺寸/服务商/字段/按钮 → 收尾恢复现场 |
| `menu` | 只把模型菜单打开并保持，方便截图 |
| `preview` | 打开弹窗并保持；可传 `{ providerId, openModels }` 切到指定服务商、展开模型下拉并回报清单状态 |
| `manage` | 打开管理弹窗并读取每行（含「是否当前 / 使用中标签 / 三个按钮」）；可传 `action=edit/delete` 试开对应弹窗 |
| `manageState` | 只读：读取「已经被打开」的管理弹窗，不打开也不关闭，用来复查高亮 |
| `selectionProbe` | 只读：当前会话 id、`modelSelection` 投影、`remote.session` 是否可用、模型目录里各 provider 的 id（核对 route 与目录 id 是否一致） |
| `highlightProbe` | 调试：只改界面高亮（不动 DSH 配置），模拟某一行「使用中」以检查样式；`{ clear: true }` 恢复真实选择 |
| `modelProbe` | 直接调用 Host 的模型列表代理（默认 OpenRouter 公开列表，无需 Key），验证路由与归一化结果 |
| `close` | 收起弹窗与残留菜单，恢复现场 |

## 目录结构

```text
dsh-plugin-select-model/
├── package.json          # bundle 清单：exports / files / dsh.bundle.patch / dsh.client
├── cordis.patch.yml      # 安装时插入一行 Host 插件（id: select-model）
├── index.js              # Host 半边：注册 /api/select-model/* 代理路由
├── client.js             # 客户端 UI 本体（window.__ModuleLoader__.load 格式）
├── locale/
│   ├── zh.json           # 插件管理器中显示的中文标题与描述
│   └── en.json           # 英文标题与描述（同时也是 locale 回退入口）
├── icon.svg              # 64×64 原创图标（纯 SVG，无外部引用）
├── README.md
├── LICENSE               # MIT
└── .gitignore
```

## 实现要点

- **清单字段**：`exports` 必须含 `"." → ./index.js`、`"./client" → ./client.js`、`"./locale/*.json"`、`"./icon" → ./icon.svg`、`"./package.json"`；`dsh.bundle.patch` 指向 `./cordis.patch.yml`；`dsh.client` 声明 `platform: "web"`、`immediately: true`，并 `inject` 会话 UI 包，保证菜单那套容器已经就位。
- **展示元数据**：DSH 只从 `<包名>/locale/<语言>.json` 读 `meta.title` / `meta.description`（英文文件是回退入口，文件名必须是语言 id）；图标来自 `exports."./icon"`，SVG / PNG / JPEG / WebP 均可，单文件上限 256 KiB。图标读失败不会影响标题描述，只会退回文字。
- **拉取策略**：`ModelPicker` 先 `fetchModelsDirect()`（浏览器 `fetch` + `AbortSignal.timeout(8s)`），成功就直接渲染；失败才 `POST /api/select-model/models` 交给 Host 代理。两条通道共用同一套归一化规则（`normalizeModelPayload` / `normalizeModels`），客户端和 Host 各留一份实现，避免运行时互相依赖。
- **Host 路由**：`index.js` 通过 `ctx.connection.fetch.register` 注册同源路由（自动带浏览器鉴权）：
  - `GET /api/select-model/health`：路由可达性自检；
  - `POST /api/select-model/models`：入参 `{ providerId, protocol, baseUrl, apiKey }`，按协议请求平台的 `/models` 并归一化为 `{ models: [{ id, label }], count }`；
  - `POST /api/select-model/add`：入参 `{ providerId, protocol, baseUrl, apiKey, modelId, modelLabel?, displayName? }`，写入 `llm-pi-ai` 的 `providers.<sel-…>` 并 `credentials.set`；返回 route / keyRef；
  - `GET /api/select-model/state`：只读列出本插件写入的服务商（不回显 Key）；
  - `POST /api/select-model/remove`：只允许删除 `sel-` 前缀的本插件服务商，同时清掉凭据。
  - 安全边界：只接受 http/https、拒绝带凭据的 URL；10s 超时；模型查询用的 Key 只在内存里转发，不写日志、不回显；添加时才写入 DSH 凭据库；单次最多返回 500 个模型。
- **模型选择器**：下拉用 portal 渲染到 body（逃出弹窗的滚动容器），底部空间不足时自动向上展开；支持搜索、刷新、手动输入；服务商切换会清空列表与已选模型。
- **当前模型选择与高亮**：管理弹窗在 `shell.overlay`（root 作用域）里，拿不到会话 id，所以在会话作用域的 `conversation.input.left` 注册一个只渲染 `null` 的探针（`inject: (sessionId) => ({ sessionId })`）来同步当前会话；点「选择」调 `remote.session.selectModel`，provider 传配置里的 route（`sel-…`），与 `modelCatalog()` 的 group id 一致；高亮读 `sessions.binding(sessionId).session.projections.faceOf('modelSelection')` 的 `next ?? lastUsed`，并订阅投影变化——所以高亮跟着真实状态走，不依赖 localStorage。
- **不碰宿主 DOM 结构以外的状态**：菜单行是克隆原生行得到的，原生菜单改版导致结构对不上时，最多是这个增强失效，不影响模型菜单本身的其它功能。

## 后续计划

1. **连通性测试**：给每个已添加模型做一次最小请求，把 Key / 地址问题在管理弹窗里暴露出来。
2. **可配置**：服务商清单做成配置项，允许用户自定义常用服务商。
3. **管理弹窗增强**：显示每个模型的连通状态 / 最近一次使用时间。

## 许可证

[MIT](./LICENSE) © 2026 mhxy13867806343
