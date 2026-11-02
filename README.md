# dsh-plugin-select-model

<p align="center"><img src="icon.svg" width="72" height="72" alt="dsh-plugin-select-model 图标"></p>

给 DSH（DeepSeek Harness）Web GUI 的模型菜单加一个出口：**在菜单底部多一行「添加模型」**，点开后弹出服务商选择与 API Key 填写框，方便接入官方列表之外的第三方模型。

> **当前状态：v0.2.0 是「选择 + 拉取」版本。** 菜单入口、弹窗和**按平台获取模型列表**已经可用：切换服务商会得到该平台自己的模型清单（实时从平台 `/models` 拉取，失败时退回内置常用型号），支持下拉选择、搜索和手动输入；点「添加模型」仍只保存草稿（不含 API Key），**还没有把结果写进 DSH 的模型配置**，这一步属于后续计划。

## 功能

- **模型菜单底部新增一行「添加模型」**：位置在推理等级等原生行之后，带分隔线；样式克隆自原生菜单行（同样的类名与右侧 chevron），所以深浅色主题、hover、键盘走查都与相邻行一致。
- **点击后打开「添加模型」弹窗**：遮罩层里一个居中面板，包含
  - 第三方服务商网格：OpenAI、Anthropic、Google Gemini、DeepSeek、阿里云百炼、智谱、Moonshot、硅基流动、OpenRouter，以及「自定义（OpenAI 兼容）」；
  - 字段：API Key、Base URL、**模型名称（下拉选择 / 搜索 / 手动输入）**；
  - 底部按钮：取消 / 添加模型。
- **模型列表按平台实时获取**：切换服务商会清空上一个平台的模型选择，并按该平台协议请求 `/models`：
  OpenAI 兼容（Bearer）、Anthropic（`x-api-key` + `anthropic-version`）、Google Gemini（`?key=`，并过滤掉不支持 `generateContent` 的模型）、OpenRouter（公开列表）。平台没返回、没填 Key 或网络失败时，退回该服务商内置的常用型号，仍可手动输入。
- **两条拉取通道**：优先**浏览器直连**（实测 OpenAI / DeepSeek / Moonshot / SiliconFlow / OpenRouter / Gemini 的 `/models` 都放行 CORS，含 `Authorization` 预检）；直连失败（CORS 拦截、Anthropic 的来源校验、自建网关）再自动走 Host 代理。OpenRouter 公开列表不填 Key 也能出 452 个模型。
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
| 保存草稿（服务商 / 地址，不含 API Key） | ✅ 已完成（仅 `localStorage`） |
| 把填写内容写进 DSH 模型配置 | ⛔ 未实现（下一步） |
| API Key 安全存储、连通性测试 | ⛔ 未实现 |
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

开发时还可以用内置的只读自检（Client Inspect provider `SelectModel`）：

| 方法 | 作用 |
| --- | --- |
| `status` | 注入行数量、菜单/弹窗是否打开、文案样例 |
| `selfTest` | 自动开菜单 → 检查新增行 → 开弹窗 → 读取布局尺寸/服务商/字段/按钮 → 收尾恢复现场 |
| `menu` | 只把模型菜单打开并保持，方便截图 |
| `preview` | 打开弹窗并保持；可传 `{ providerId, openModels }` 切到指定服务商、展开模型下拉并回报清单状态 |
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
- **Host 代理路由**：`index.js` 通过 `ctx.connection.fetch.register` 注册两条同源路由（自动带浏览器鉴权）：
  - `GET /api/select-model/health`：路由可达性自检；
  - `POST /api/select-model/models`：入参 `{ providerId, protocol, baseUrl, apiKey }`，按协议请求平台的 `/models` 并归一化为 `{ models: [{ id, label }], count }`。
  - 安全边界：只接受 http/https、拒绝带凭据的 URL；10s 超时；API Key 只在这一次请求的内存里使用，不落盘、不写日志、不回显；单次最多返回 500 个模型。没有浏览器 CORS 问题（请求由本机 Host 发出）。
- **模型选择器**：下拉用 portal 渲染到 body（逃出弹窗的滚动容器），底部空间不足时自动向上展开；支持搜索、刷新、手动输入；服务商切换会清空列表与已选模型。
- **不碰宿主 DOM 结构以外的状态**：菜单行是克隆原生行得到的，原生菜单改版导致结构对不上时，最多是这个增强失效，不影响模型菜单本身的其它功能。

## 后续计划

1. **真正接入服务商**：把弹窗里填写的服务商 / Base URL / 模型名写进 DSH 的模型配置，并支持选中后立刻出现在模型菜单里。
2. **API Key 处理**：Key 不明文落盘，只保存引用；输入后提供「校验 / 连通性测试」按钮。
3. **完善交互**：必填校验、错误提示、保存中的 loading 态、编辑已添加的第三方模型、删除入口。
4. **可配置**：服务商清单做成配置项，允许用户自定义常用服务商。
5. **写入配置**：把选定的服务商 / 模型 / Key 引用写进 DSH 的 provider 配置，让自定义模型真正出现在原生模型菜单里（当前只做选择与拉取，不落库）。

## 许可证

[MIT](./LICENSE) © 2026 mhxy13867806343
