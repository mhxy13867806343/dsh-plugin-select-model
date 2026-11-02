/**
 * dsh-plugin-select-model —— Client 半边（手写纯 JS，无构建步骤）。
 * ================================================================
 * 做两件事：
 *   ① 在内置「模型 / 推理等级」根菜单底部补一行「添加模型」；
 *   ② 点它打开「添加模型」弹窗：第三方服务商网格 + API Key / 接口地址 /
 *      模型名称 + 取消 / 添加模型（当前版本只做界面布局，接入逻辑后续实现）。
 *
 * 设计约束（与同机其它纯 JS 插件保持一致）：
 *   · 只 require('react')，不 import 任何 @deepseek-ai/* 客户端包；
 *   · 只用 --dsw-alias-* 主题令牌 + 兜底色，深浅色都不白屏；
 *   · 内置模型菜单没有开放扩展槽位，所以菜单行用 DOM 增强（克隆相邻
 *     cell 行以继承内置样式），其余全部是 React；
 *   · 任何一步都可能读不到 DOM —— 全部软失败，不把异常抛到 slot 外。
 *
 * Bundle 协议：window.__ModuleLoader__.load({ id, factory })，
 * factory 通过 require() 取平台模块。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-select-model',
  factory(require) {
    const React = require('react');
    const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
    const h = React.createElement;
    const Fragment = React.Fragment;
    /** 下拉列表需要逃出弹窗的滚动容器，所以用 portal（react-dom 由页面模块表提供）。 */
    let createPortal = (node) => node;
    try {
      const reactDom = require('react-dom');
      if (typeof reactDom.createPortal === 'function') createPortal = reactDom.createPortal;
    } catch {
      /* 没有 react-dom 时退化成普通渲染：fixed 定位仍然可用 */
    }
    /** 模型列表接口（Host 半边提供，见 index.js）。 */
    const MODELS_ROUTE = '/api/select-model/models';
    /** 新增模型服务接口：写入 llm-pi-ai 配置 + 凭据库。 */
    const ADD_ROUTE = '/api/select-model/add';

    // ─────────────────────────────────────────────────────── 常量

    /** 本插件的 locale 命名空间。 */
    const NS = 'dsh-plugin-select-model';
    /** 注入样式表的唯一标记。 */
    const STYLE_ID = 'dsh-plugin-select-model/styles';
    /** 配置草稿（布局阶段只存本地，不参与真实接入）。 */
    const DRAFT_KEY = 'dsh-select-model:draft';
    /** 菜单注入行的标记属性（同时用于清理与自检）。 */
    const ROW_ATTR = 'data-dsm-add-row';
    /** 菜单分隔线标记属性。 */
    const DIVIDER_ATTR = 'data-dsm-add-divider';
    /** 内置模型根菜单的 aria-label（内置字典只有 zh/en 两种）。 */
    const MODEL_MENU_LABELS = ['模型与推理等级', 'Model and reasoning effort'];
    /** 内置模型选择器触发按钮的 aria-label 前缀。 */
    const MODEL_TRIGGER_LABEL = /^(选择模型|Select model)/;

    // ─────────────────────────────────────────────────────── 文案

    /** 简体中文（键集为准）。 */
    const ZH = {
      'menu.add': '添加模型',
      'menu.addHint': '第三方 / 自定义',

      'dialog.title': '添加模型',
      'dialog.desc': '选择服务商、填写 Key 与模型，添加后即可在模型菜单里使用。',

      'provider.section': '选择服务商',
      'provider.openai': 'GPT 系列',
      'provider.anthropic': 'Claude 系列',
      'provider.google': 'Gemini 系列',
      'provider.deepseek': 'DeepSeek 官方 API',
      'provider.dashscope': '通义千问',
      'provider.zhipu': 'GLM 系列',
      'provider.moonshot': 'Kimi 系列',
      'provider.siliconflow': '开源模型聚合',
      'provider.openrouter': '多模型聚合',
      'provider.custom': 'OpenAI 兼容',

      'config.section': '接入配置',
      'field.apiKey': 'API Key',
      'field.apiKeyPlaceholder': '粘贴 sk-…',
      'field.baseUrl': '接口地址',
      'field.baseUrlPlaceholder': 'https://…/v1',
      'field.model': '模型名称',
      'field.modelPlaceholder': '选择或输入模型 ID',
      'field.modelCustomPlaceholder': '输入模型 ID，例如 my-model',
      'tag.optional': '可选',

      'model.loading': '正在获取…',
      'catalog.loading': '正在读取公共目录…',
      'catalog.live': '公共目录 · {n} 个模型',
      'model.needKey': '请先填写 API Key 再从平台获取',
      'model.live': '平台实时 · {n} 个模型',
      'model.fallback': '内置常用 · 填 Key 后自动获取',
      'model.failed': '自动获取失败（{reason}），以下是常用模型，也可手动输入',
      'model.search': '搜索模型…',
      'model.empty': '没有匹配的模型',
      'model.refresh': '刷新',
      'model.listAria': '模型列表',
      'model.customHint': '自定义服务商：直接输入模型 ID，不做平台校验。',

      'model.err.http_401': 'API Key 无效或没有权限',
      'model.err.http_403': 'API Key 无效或没有权限',
      'model.err.http_404': '接口地址不对，或该平台不提供模型列表接口',
      'model.err.http_429': '请求太频繁，请稍后再试',
      'model.err.network-error': '无法连接，请检查接口地址与网络',
      'model.err.timeout': '请求超时',
      'model.err.empty-list': '平台没有返回模型',
      'model.err.invalid-json': '返回内容不是模型列表',
      'model.err.invalid-base-url': '接口地址格式不对',
      'model.err.request-failed': '请求失败',
      'model.err.unknown': '未知错误',

      'action.cancel': '取消',
      'action.add': '添加模型',
      'action.reveal': '显示',
      'action.hide': '隐藏',
      'action.close': '关闭',

      'hint.localOnly': 'API Key 会存入本机 DSH 凭据库，只用于调用该服务商。',
      'note.preview': '未填 Key 时显示 OpenRouter 公共目录；填 Key 后以平台实时列表为准。',
      'toast.added': '已添加「{model}」，打开模型菜单即可使用',
      'toast.updated': '已更新「{model}」',
      'toast.deleted': '已删除「{model}」',
      'manage.menuRow': '管理已添加模型',
      'manage.count': '{n} 个',
      'manage.loading': '加载中…',
      'manage.confirm': '确定',
      'manage.prev': '上一页',
      'manage.next': '下一页',
      'manage.page': '第 {page} / {total} 页',
      'manage.title': '已添加的第三方模型',
      'manage.search': '搜索已添加…',
      'manage.empty': '还没有添加第三方模型',
      'manage.edit': '编辑',
      'manage.delete': '删除',
      'manage.select': '选择',
      'manage.selecting': '切换中…',
      'manage.selected': '已选择',
      'manage.current': '使用中',
      'select.noSession': '没有打开的对话，无法切换模型；先进入一个对话再试。',
      'select.unavailable': '当前环境不支持切换模型；刷新一下页面再试。',
      'select.writerHeld': '这个对话正被另一个窗口或进程占用，稍后再试；必要时刷新页面。',
      'select.modelUnavailable': '这个模型还没出现在模型目录里；重开一次模型菜单刷新后再试。',
      'select.sessionLost': '这个对话已经不在了，刷新页面后重试。',
      'select.failed': '切换失败：{detail}',
      'toast.selected': '已切换到「{model}」',
      'edit.title': '编辑模型',
      'edit.desc': '修改后会同步更新模型服务配置；API Key 留空表示保持不变。',
      'edit.displayName': '显示名称',
      'edit.model': '模型 ID',
      'edit.baseUrl': '接口地址',
      'edit.apiKey': 'API Key',
      'edit.apiKeyPlaceholder': '留空保持不变',
      'edit.save': '保存',
      'confirm.title': '删除模型',
      'confirm.desc': '确定删除「{name}」（配置 ID：{route}）吗？会同时移除模型服务配置和保存的 Key，且无法撤销。',
      'confirm.delete': '删除',
      'confirm.cancel': '取消',
      'action.save': '保存',
      'action.processing': '处理中…',

      'add.loading': '添加中…',
      'add.err.network': '无法连接本机 Host，请确认 DSH 正在运行。',
      'add.err.restart': 'Host 半边还没加载：请重启一次 DSH 后再添加。',
      'add.err.missing-api-key': '请填写 API Key。',
      'add.err.missing-model': '请选择或输入模型 ID。',
      'add.err.invalid-base-url': '接口地址格式不对。',
      'add.err.settings-failed': '写入模型服务配置失败：{detail}',
      'add.err.generic': '添加失败：{detail}',
    };

    /** English，键集与中文一致。 */
    const EN = {
      'menu.add': 'Add model',
      'menu.addHint': 'Third-party / Custom',

      'dialog.title': 'Add a model',
      'dialog.desc': 'Pick a provider, enter its key and a model; it appears in the model menu once added.',

      'provider.section': 'Provider',
      'provider.openai': 'GPT models',
      'provider.anthropic': 'Claude models',
      'provider.google': 'Gemini models',
      'provider.deepseek': 'Official API',
      'provider.dashscope': 'Qwen models',
      'provider.zhipu': 'GLM models',
      'provider.moonshot': 'Kimi models',
      'provider.siliconflow': 'Open-model gateway',
      'provider.openrouter': 'Multi-provider gateway',
      'provider.custom': 'OpenAI compatible',

      'config.section': 'Connection',
      'field.apiKey': 'API Key',
      'field.apiKeyPlaceholder': 'Paste sk-…',
      'field.baseUrl': 'Base URL',
      'field.baseUrlPlaceholder': 'https://…/v1',
      'field.model': 'Model',
      'field.modelPlaceholder': 'Pick or type a model ID',
      'field.modelCustomPlaceholder': 'Type a model ID, e.g. my-model',
      'tag.optional': 'Optional',

      'model.loading': 'Fetching…',
      'catalog.loading': 'Reading public directory…',
      'catalog.live': 'Public directory · {n} models',
      'model.needKey': 'Enter the API key to fetch the live list',
      'model.live': 'Live · {n} models',
      'model.fallback': 'Built-in list · add a key for live models',
      'model.failed': 'Automatic fetch failed ({reason}); showing common models — you can still type one.',
      'model.search': 'Search models…',
      'model.empty': 'No matching models',
      'model.refresh': 'Refresh',
      'model.listAria': 'Model list',
      'model.customHint': 'Custom provider: type a model ID directly; no platform check.',

      'model.err.http_401': 'invalid API key or no permission',
      'model.err.http_403': 'invalid API key or no permission',
      'model.err.http_404': 'wrong base URL, or the provider has no model list endpoint',
      'model.err.http_429': 'too many requests; try again later',
      'model.err.network-error': 'cannot connect; check the base URL and network',
      'model.err.timeout': 'request timed out',
      'model.err.empty-list': 'the provider returned no models',
      'model.err.invalid-json': 'the response is not a model list',
      'model.err.invalid-base-url': 'the base URL is malformed',
      'model.err.request-failed': 'request failed',
      'model.err.unknown': 'unknown error',

      'action.cancel': 'Cancel',
      'action.add': 'Add model',
      'action.reveal': 'Show',
      'action.hide': 'Hide',
      'action.close': 'Close',

      'hint.localOnly': 'The API key is stored in the local DSH credential store, used only for this provider.',
      'note.preview': 'Without a key this shows the OpenRouter public directory; with a key the provider\'s live list wins.',
      'toast.added': 'Added “{model}” — open the model menu to use it',
      'toast.updated': 'Updated “{model}”',
      'toast.deleted': 'Deleted “{model}”',
      'manage.menuRow': 'Manage added models',
      'manage.count': '{n}',
      'manage.loading': 'Loading…',
      'manage.confirm': 'OK',
      'manage.prev': 'Previous',
      'manage.next': 'Next',
      'manage.page': 'Page {page} of {total}',
      'manage.title': 'Added third-party models',
      'manage.search': 'Search added models…',
      'manage.empty': 'No third-party models added yet',
      'manage.edit': 'Edit',
      'manage.delete': 'Delete',
      'manage.select': 'Select',
      'manage.selecting': 'Switching…',
      'manage.selected': 'Selected',
      'manage.current': 'In use',
      'select.noSession': 'No conversation is open, so there is no model to switch.',
      'select.unavailable': 'Model switching is unavailable here; refresh the page and try again.',
      'select.writerHeld': 'This conversation is held by another window or process; try again shortly, or refresh the page.',
      'select.modelUnavailable': 'This model is not in the catalog yet; reopen the model menu to refresh it.',
      'select.sessionLost': 'This conversation no longer exists; refresh the page and try again.',
      'select.failed': 'Switch failed: {detail}',
      'toast.selected': 'Switched to “{model}”',
      'edit.title': 'Edit model',
      'edit.desc': 'Saving updates the model-service config; leave the API key blank to keep it.',
      'edit.displayName': 'Display name',
      'edit.model': 'Model ID',
      'edit.baseUrl': 'Base URL',
      'edit.apiKey': 'API Key',
      'edit.apiKeyPlaceholder': 'Leave blank to keep the current key',
      'edit.save': 'Save',
      'confirm.title': 'Delete model',
      'confirm.desc': 'Delete “{name}” (config ID: {route})? This removes the model-service config and the stored key; it cannot be undone.',
      'confirm.delete': 'Delete',
      'confirm.cancel': 'Cancel',
      'action.save': 'Save',
      'action.processing': 'Working…',

      'add.loading': 'Adding…',
      'add.err.network': 'Cannot reach the local host; check that DSH is running.',
      'add.err.restart': 'The host half is not loaded yet; restart DSH once, then add again.',
      'add.err.missing-api-key': 'Enter an API key.',
      'add.err.missing-model': 'Pick or type a model ID.',
      'add.err.invalid-base-url': 'The base URL is malformed.',
      'add.err.settings-failed': 'Could not write the model-service config: {detail}',
      'add.err.generic': 'Add failed: {detail}',
    };

    // ─────────────────────────────────────────────────────── 服务商预设

    /**
     * 第三方服务商预设。badge/color 只用于弹窗里的小色块，不复制任何品牌图标。
     * protocol 决定 Host 代理怎么向平台要模型列表；fallbackModels 是拿不到
     * 平台列表时（没填 Key / 网络失败）展示的常用型号，用户仍可手动输入。
     * @type {ReadonlyArray<{id:string,name:string,hintKey:string,baseUrl:string,keyPlaceholder:string,color:string,badge:string,protocol:string,publicModels?:boolean,fallbackModels:ReadonlyArray<{id:string,label?:string}>}>}
     */
    const PROVIDERS = Object.freeze([
      {
        id: 'openai',
        name: 'OpenAI',
        hintKey: 'provider.openai',
        baseUrl: 'https://api.openai.com/v1',
        keyPlaceholder: 'sk-…',
        color: '#10a37f',
        badge: 'O',
        protocol: 'openai',
        fallbackModels: [
          { id: 'gpt-4o' },
          { id: 'gpt-4o-mini' },
          { id: 'gpt-4.1' },
          { id: 'gpt-4.1-mini' },
          { id: 'o3' },
          { id: 'o4-mini' },
        ],
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        hintKey: 'provider.anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        keyPlaceholder: 'sk-ant-…',
        color: '#d97757',
        badge: 'A',
        protocol: 'anthropic',
        fallbackModels: [
          { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
          { id: 'claude-opus-4-1', label: 'Claude Opus 4.1' },
          { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet' },
          { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
        ],
      },
      {
        id: 'google',
        name: 'Google Gemini',
        hintKey: 'provider.google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        keyPlaceholder: 'AIza…',
        color: '#4285f4',
        badge: 'G',
        protocol: 'google',
        fallbackModels: [
          { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
          { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
          { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
          { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
        ],
      },
      {
        id: 'deepseek',
        name: 'DeepSeek',
        hintKey: 'provider.deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        keyPlaceholder: 'sk-…',
        color: '#4d6bfe',
        badge: 'D',
        protocol: 'openai',
        fallbackModels: [
          { id: 'deepseek-chat', label: 'DeepSeek Chat' },
          { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
        ],
      },
      {
        id: 'dashscope',
        name: '阿里云百炼',
        hintKey: 'provider.dashscope',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        keyPlaceholder: 'sk-…',
        color: '#ff6a00',
        badge: '百',
        protocol: 'openai',
        fallbackModels: [
          { id: 'qwen-max', label: 'Qwen Max' },
          { id: 'qwen-plus', label: 'Qwen Plus' },
          { id: 'qwen-turbo', label: 'Qwen Turbo' },
          { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus' },
          { id: 'qwen-vl-max', label: 'Qwen VL Max' },
        ],
      },
      {
        id: 'zhipu',
        name: '智谱 GLM',
        hintKey: 'provider.zhipu',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        keyPlaceholder: '…',
        color: '#3859ff',
        badge: '智',
        protocol: 'openai',
        fallbackModels: [
          { id: 'glm-4.6', label: 'GLM-4.6' },
          { id: 'glm-4.5', label: 'GLM-4.5' },
          { id: 'glm-4.5-air', label: 'GLM-4.5 Air' },
          { id: 'glm-4-plus', label: 'GLM-4 Plus' },
        ],
      },
      {
        id: 'moonshot',
        name: 'Moonshot Kimi',
        hintKey: 'provider.moonshot',
        baseUrl: 'https://api.moonshot.cn/v1',
        keyPlaceholder: 'sk-…',
        color: '#1f1f1f',
        badge: 'K',
        protocol: 'openai',
        fallbackModels: [
          { id: 'kimi-k2-0905-preview', label: 'Kimi K2 0905' },
          { id: 'kimi-k2-turbo-preview', label: 'Kimi K2 Turbo' },
          { id: 'moonshot-v1-32k', label: 'Moonshot v1 32K' },
          { id: 'moonshot-v1-8k', label: 'Moonshot v1 8K' },
        ],
      },
      {
        id: 'siliconflow',
        name: '硅基流动',
        hintKey: 'provider.siliconflow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        keyPlaceholder: 'sk-…',
        color: '#7c4dff',
        badge: '硅',
        protocol: 'openai',
        fallbackModels: [
          { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' },
          { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1' },
          { id: 'Qwen/Qwen3-235B-A22B', label: 'Qwen3 235B' },
          { id: 'moonshotai/Kimi-K2-Instruct', label: 'Kimi K2 Instruct' },
        ],
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        hintKey: 'provider.openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyPlaceholder: 'sk-or-…',
        color: '#6467f2',
        badge: 'R',
        protocol: 'openrouter',
        publicModels: true,
        fallbackModels: [
          { id: 'openai/gpt-4o', label: 'OpenAI GPT-4o' },
          { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
          { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
          { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
          { id: 'qwen/qwen3-235b-a22b', label: 'Qwen3 235B' },
        ],
      },
      {
        id: 'custom',
        name: '自定义',
        hintKey: 'provider.custom',
        baseUrl: '',
        keyPlaceholder: 'sk-…',
        color: '#6b7280',
        badge: '+',
        protocol: 'openai',
        fallbackModels: [],
      },
    ]);

    // ─────────────────────────────────────────────────────── 样式

    /**
     * 全局样式只注入一次，卸载时移除。
     * 弹窗骨架照着内置 Modal 的尺寸/间距写，按钮/输入框照着内置控件写，
     * 全部走主题令牌，深浅色自动适配。
     */
    const CSS = `
.dsm-root{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-frame-overlay-top,24px)) 24px;pointer-events:auto}
.dsm-mask{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.38));backdrop-filter:var(--dsw-mask-blur,blur(2px))}
.dsm-dialog{position:relative;z-index:1;box-sizing:border-box;display:flex;flex-direction:column;gap:20px;width:min(600px,100%);max-height:calc(100dvh - 48px);padding:0 0 24px;overflow:hidden;border-radius:var(--dsw-radius-panel,16px);background:var(--dsw-alias-bg-layer-2,#232323);box-shadow:var(--dsw-elevation-prominent,0 16px 48px rgba(0,0,0,.42));animation:dsmPop .16s var(--ds-ease-in-out,ease-out)}
.dsm-dialog:focus{outline:none}
.dsm-content{display:flex;flex-direction:column;min-width:0;min-height:0;width:100%}
.dsm-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 14px 12px 24px}
.dsm-title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary,#a3a3a3);font-size:18px;line-height:1;cursor:pointer;padding:0 0 2px}
.dsm-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-desc{margin:0;padding:0 24px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-body{display:flex;flex-direction:column;gap:14px;margin-top:20px;padding:0 24px;min-height:0;overflow-y:auto;max-height:min(64vh,540px)}
.dsm-note{display:flex;align-items:flex-start;gap:6px;padding:6px 10px;border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.10));color:var(--dsw-alias-label-secondary,#a3a3a3);font-size:12px;line-height:18px}
.dsm-noteMark{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dsm-submitError{display:flex;align-items:flex-start;gap:6px;padding:6px 10px;border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(248,81,73,.12));color:var(--dsw-alias-state-error-primary,#f85149);font-size:12px;line-height:18px}
.dsm-section{display:flex;flex-direction:column;min-width:0}
.dsm-sectionTitle{margin:0 0 8px;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary,#a3a3a3)}
.dsm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.dsm-provider{position:relative;display:flex;align-items:center;gap:8px;box-sizing:border-box;min-height:50px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;text-align:left;cursor:pointer;transition:background .12s ease,border-color .12s ease}
.dsm-provider:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dsm-provider:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.dsm-provider[data-selected="1"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary,#4d6bfe)}
.dsm-providerBadge{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:8px;color:#fff;font-size:11px;font-weight:600;line-height:1}
.dsm-providerText{display:flex;flex-direction:column;min-width:0}
.dsm-providerName{font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-providerHint{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8a8a8a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-providerCheck{position:absolute;top:5px;right:6px;color:var(--dsw-alias-brand-primary,#4d6bfe);font-size:11px;line-height:1}
.dsm-field{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.dsm-field:first-child{margin-top:0}
.dsm-row2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:10px}
.dsm-row2 .dsm-field{margin-top:0}
.dsm-label{display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#a3a3a3)}
.dsm-labelTag{font-size:10px;line-height:14px;padding:0 5px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.dsm-keyRow{display:flex;align-items:center;gap:8px;min-width:0}
.dsm-input{display:flex;align-items:center;flex:1 1 auto;min-width:0;height:32px;padding:0 8px;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.34));border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06))}
.dsm-input:focus-within{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#4d6bfe))}
.dsm-inputInner{flex:1 1 auto;min-width:0;border:none;outline:none;background:transparent;font-family:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-inputInner::placeholder{color:var(--dsw-alias-label-dimmed,#6b6b6b)}
.dsm-hint{display:flex;align-items:flex-start;gap:6px;margin-top:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.dsm-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 24px}
.dsm-manageFooter{justify-content:space-between;gap:12px}
.dsm-pager{display:flex;align-items:center;gap:6px;min-width:0}
.dsm-pagerLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a8a8a);white-space:nowrap;font-variant-numeric:tabular-nums}
.dsm-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;box-sizing:border-box;border:none;border-radius:var(--dsw-radius-md,10px);cursor:pointer;font-family:inherit;font-size:14px;line-height:22px;padding:0 14px;height:36px;color:var(--dsw-alias-label-primary,#e6e6e6);background:transparent}
.dsm-btn:disabled{cursor:not-allowed;opacity:.4}
.dsm-btn[data-variant="primary"]{background:var(--dsw-alias-button-primary-fill,#3b6ff5);color:var(--dsw-alias-label-primary-foreground,#fff)}
.dsm-btn[data-variant="primary"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#4d7ff7)}
.dsm-btn[data-variant="ghost"]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.dsm-btn[data-variant="ghost"]:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.22))}
.dsm-btn[data-size="sm"]{height:28px;font-size:12px;line-height:18px;padding:0 10px;border-radius:var(--dsw-radius-sm,8px)}
.dsm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.dsm-toast{position:fixed;left:50%;bottom:32px;z-index:1300;display:flex;align-items:center;gap:8px;max-width:min(520px,calc(100vw - 48px));padding:8px 14px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));background:var(--dsw-alias-bg-overlay,#2a2a2a);color:var(--dsw-alias-label-primary,#e6e6e6);box-shadow:var(--dsw-elevation-prominent,0 10px 30px rgba(0,0,0,.35));font-size:12px;line-height:18px;transform:translateX(-50%);pointer-events:none;animation:dsmToastIn .16s ease-out}
.dsm-toastMark{flex:none;color:var(--dsw-alias-state-success-primary,#3fb950);font-size:12px;line-height:18px}
.dsm-modelRow{display:flex;align-items:center;gap:8px;min-width:0}
.dsm-modelBtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary,#a3a3a3);cursor:pointer;font-size:12px;line-height:1;padding:0}
.dsm-modelBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-modelBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.dsm-modelStatus{display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8a8a);min-height:16px}
.dsm-modelStatus[data-tone="error"]{color:var(--dsw-alias-state-error-primary,#f85149)}
.dsm-modelStatus[data-tone="live"]{color:var(--dsw-alias-state-success-primary,#3fb950)}
.dsm-modelStatus[data-tone="info"]{color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dsm-modelMenu{position:fixed;z-index:1400;display:flex;flex-direction:column;max-height:320px;padding:6px;border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-overlay,#2a2a2a);box-shadow:var(--dsw-elevation-prominent,0 12px 32px rgba(0,0,0,.4));color:var(--dsw-alias-label-primary,#e6e6e6);animation:dsmPop .12s ease-out}
.dsm-modelHead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 6px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#a3a3a3)}
.dsm-modelHeadText{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-modelSearch{display:flex;align-items:center;height:28px;margin:0 2px 6px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.34));border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06))}
.dsm-modelSearch input{flex:1;min-width:0;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary,#e6e6e6);font-family:inherit;font-size:12px;line-height:18px}
.dsm-modelSearch input::placeholder{color:var(--dsw-alias-label-dimmed,#6b6b6b)}
.dsm-modelList{overflow-y:auto;min-height:0;display:flex;flex-direction:column;gap:1px}
.dsm-modelItem{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 8px;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dsm-modelItem:hover,.dsm-modelItem[data-active="1"]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.dsm-modelItem:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:-1px}
.dsm-modelItemMain{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}
.dsm-modelItemLabel{font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-modelItemId{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8a8a8a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-modelItemCheck{flex:none;color:var(--dsw-alias-state-success-primary,#3fb950);font-size:12px;line-height:1}
.dsm-modelEmpty{padding:10px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.dsm-modelRefresh{flex:none;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary,#a3a3a3);font-family:inherit;font-size:11px;line-height:16px;padding:2px 6px;cursor:pointer}
.dsm-added[hidden]{display:none}
.dsm-added{padding:4px 4px 2px;display:flex;flex-direction:column;min-width:0;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));margin-top:4px;max-height:230px}
.dsm-addedHead{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:5px 6px 3px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#a3a3a3)}
.dsm-addedCount{color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.dsm-addedSearch{display:flex;align-items:center;height:26px;margin:2px 2px 4px;padding:0 7px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.34));border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06))}
.dsm-addedSearch input{flex:1;min-width:0;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary,#e6e6e6);font-family:inherit;font-size:12px;line-height:18px}
.dsm-addedSearch input::placeholder{color:var(--dsw-alias-label-dimmed,#6b6b6b)}
.dsm-addedList{display:flex;flex-direction:column;gap:1px;overflow-y:auto;min-height:0}
.dsm-addedRow{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:var(--dsw-radius-sm,8px);min-width:0}
.dsm-addedRow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.dsm-addedMain{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}
.dsm-addedName{font-size:12px;line-height:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-addedSub{font-size:10px;line-height:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.dsm-addedActions{display:flex;align-items:center;gap:2px;flex:none}
.dsm-addedBtn{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#a3a3a3);font-family:inherit;font-size:11px;line-height:16px;padding:2px 4px;border-radius:6px;cursor:pointer}
.dsm-addedBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.2));color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-addedBtn[data-danger="1"]:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(248,81,73,.16));color:var(--dsw-alias-state-error-primary,#f85149)}
.dsm-addedEmpty{padding:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.dsm-manageBody{display:flex;flex-direction:column;gap:10px;margin-top:20px;padding:0 24px;min-height:0;overflow-y:auto;max-height:min(60vh,460px)}
.dsm-manageList{display:flex;flex-direction:column;gap:4px}
.dsm-manageRow{display:flex;align-items:center;gap:10px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05))}
.dsm-manageMain{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}
.dsm-manageTitle{display:flex;align-items:center;gap:6px;min-width:0}
.dsm-manageName{font-size:13px;line-height:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-manageSub{font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.dsm-manageRow[data-current="1"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);background:var(--dsw-alias-bg-layer-2,rgba(77,107,254,.10));box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary,#4d6bfe)}
.dsm-manageBadge{flex:none;display:inline-flex;align-items:center;height:16px;padding:0 6px;border:.5px solid var(--dsw-alias-brand-primary,#4d6bfe);border-radius:999px;font-size:10px;line-height:16px;font-weight:500;color:var(--dsw-alias-brand-primary,#4d6bfe);white-space:nowrap}
.dsm-manageActions{display:flex;align-items:center;gap:6px;flex:none}
.dsm-manageEmpty{padding:18px 4px;text-align:center;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.dsm-btn[data-variant="danger"]{background:var(--dsw-alias-state-error-primary,#f85149);color:#fff}
.dsm-btn[data-variant="danger"]:hover:not(:disabled){filter:brightness(1.08)}
.dsm-modelRefresh:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,#e6e6e6)}
@keyframes dsmPop{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:scale(1)}}
@keyframes dsmToastIn{from{opacity:0;transform:translate(-50%,4px)}to{opacity:1;transform:translate(-50%,0)}}
@media (max-width:560px){.dsm-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dsm-dialog{width:100%}}
@media (prefers-reduced-motion:reduce){.dsm-dialog,.dsm-toast{animation:none}}
`;

    /** 注入一次全局样式；返回卸载清理函数。 */
    function ensureStyles() {
      if (typeof document === 'undefined') return () => {};
      if (document.querySelector(`style[data-plugin=${JSON.stringify(STYLE_ID)}]`) !== null) return () => {};
      const style = document.createElement('style');
      style.dataset.plugin = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
      return () => {
        style.remove();
      };
    }

    // ─────────────────────────────────────────────────────── 极小极简 store

    /**
     * 模块内单实例 store：DOM 侧（菜单行点击）与 React 侧（弹窗/Toast）共享。
     * @param {{open:boolean,toast:null|{id:number,text:string}}} initial 初值
     */
    function createStore(initial) {
      let state = initial;
      const listeners = new Set();
      return {
        get: () => state,
        set(patch) {
          const next = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
          if (next === state) return;
          state = next;
          for (const listener of listeners) listener();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
    }

    /** 用 useSyncExternalStore 订阅 store 的派生值。 */
    function useStoreValue(store, selector) {
      const read = useCallback(() => selector(store.get()), [store, selector]);
      return useSyncExternalStore(store.subscribe, read);
    }

    // ─────────────────────────────────────────────────────── 草稿

    /** 读取本地草稿（失败一律返回空对象，不阻断界面）。 */
    function readDraft() {
      try {
        const raw = window.localStorage.getItem(DRAFT_KEY);
        if (typeof raw !== 'string' || raw === '') return {};
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }

    /** 写入本地草稿（布局阶段只做留存，不参与真实接入）。**故意不落 API Key**。 */
    function writeDraft(draft) {
      try {
        const safe = {
          providerId: draft.providerId,
          baseUrl: draft.baseUrl,
          modelName: draft.modelName,
        };
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(safe));
      } catch {
        /* 隐私模式 / 配额满：忽略 */
      }
    }

    // ─────────────────────────────────────────────────────── 菜单 DOM 增强

    /**
     * 在内置模型根菜单底部注入「添加模型」行。
     *
     * 内置菜单没有开放 footer 槽位，因此这里做最小 DOM 增强：克隆它自己的
     * cell 行（继承全部内置样式与深色适配），只换文案与点击行为。
     *
     * @param {ReturnType<typeof createStore>} store 共享 store
     * @param {(key:string, vars?:Record<string,string|number>) => string} t 翻译函数
     * @returns {() => void} 卸载清理
     */
    function installMenuBridge(store, t, options) {
      if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return () => {};

      let disposed = false;
      let scheduled = false;
      let observer = null;
      /** 本实例的标记：清理时只删自己注入的节点，避免 HMR 重载时新旧实例互删。 */
      const owner = Math.random().toString(36).slice(2, 10);
      const loadAdded = typeof options?.loadAdded === 'function' ? options.loadAdded : async () => [];
      const bridge = options?.bridge ?? { refresh: () => {} };
      let inspectedMenu = null;

      /** 找到当前打开的模型根菜单（只认内置 zh/en 两个 aria-label）。 */
      const findModelRootMenu = () => {
        const menus = document.querySelectorAll('[role="menu"]');
        for (const node of menus) {
          if (!(node instanceof HTMLElement)) continue;
          const label = node.getAttribute('aria-label');
          if (label !== null && MODEL_MENU_LABELS.includes(label)) return node;
        }
        return null;
      };

      /** 关闭内置菜单：优先点一次它的触发按钮，失败再派发 Escape。 */
      const closeBuiltInMenu = (menu) => {
        const id = menu.getAttribute('id');
        let trigger = null;
        if (typeof id === 'string' && id !== '') {
          trigger = document.querySelector(`button[aria-controls="${id.replace(/["\\]/g, '\\$&')}"]`);
        }
        if (trigger instanceof HTMLElement) {
          try {
            trigger.click();
            return;
          } catch {
            /* 落到 Escape */
          }
        }
        const fallback = trigger instanceof HTMLElement ? trigger : menu;
        fallback.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      };

      /** 管理行右侧显示「N 个」（异步取一次列表）。 */
      const updateCount = async (menu) => {
        let items = [];
        try {
          items = await loadAdded();
        } catch {
          items = [];
        }
        if (disposed) return;
        const row = menu.querySelector(`[data-dsm-manage-row][data-dsm-owner="${owner}"]`);
        if (!(row instanceof HTMLElement)) return;
        const spans = Array.from(row.children).filter(
          (node) => node instanceof HTMLElement && node.tagName === 'SPAN',
        );
        if (spans[1] !== undefined) spans[1].textContent = t('manage.count', { n: items.length });
      };

      bridge.refresh = () => {
        const menu = findModelRootMenu();
        if (menu !== null) void updateCount(menu);
      };

      /** 给一个刚打开的根菜单补齐：添加模型行 + 管理已添加模型行。 */
      const injectInto = (menu) => {
        if (disposed) return false;
        const rowExists = menu.querySelector(`:scope > [${ROW_ATTR}]`) !== null;
        if (rowExists) {
          if (inspectedMenu !== menu) {
            inspectedMenu = menu;
            void updateCount(menu);
          }
          return true;
        }

        const cells = [];
        for (const node of menu.children) {
          if (node instanceof HTMLElement && node.matches('button[role="menuitem"]')) cells.push(node);
        }
        if (cells.length === 0) return false;

        const template = cells[cells.length - 1];
        const makeRow = (label, value, marker, testId) => {
          const row = template.cloneNode(true);
          if (!(row instanceof HTMLElement)) return null;
          row.removeAttribute('id');
          row.removeAttribute('disabled');
          row.removeAttribute('aria-disabled');
          row.setAttribute(marker, '');
          row.setAttribute('data-dsm-owner', owner);
          row.setAttribute('data-testid', testId);
          const spans = Array.from(row.children).filter(
            (node) => node instanceof HTMLElement && node.tagName === 'SPAN',
          );
          if (spans[0] !== undefined) spans[0].textContent = label;
          if (spans[1] !== undefined) spans[1].textContent = value;
          return row;
        };

        const addRow = makeRow(t('menu.add'), t('menu.addHint'), ROW_ATTR, 'select-model-add-row');
        const manageRow = makeRow(t('manage.menuRow'), t('manage.loading'), 'data-dsm-manage-row', 'select-model-manage-row');
        if (addRow === null || manageRow === null) return false;

        addRow.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          try {
            closeBuiltInMenu(menu);
          } catch {
            /* 关不掉也不影响打开弹窗 */
          }
          store.set({ open: true });
        });
        manageRow.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          try {
            closeBuiltInMenu(menu);
          } catch {
            /* 关不掉也不影响打开弹窗 */
          }
          store.set({ manageOpen: true });
        });

        const divider = document.createElement('div');
        divider.setAttribute(DIVIDER_ATTR, '');
        divider.setAttribute('data-dsm-owner', owner);
        divider.style.cssText =
          'flex:none;height:1px;margin:4px 8px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.28))';

        menu.append(divider, addRow, manageRow);
        inspectedMenu = menu;
        void updateCount(menu);
        return true;
      };

      /** 扫描一次；由 MutationObserver 以微任务合并调度。 */
      const scan = () => {
        if (disposed) return;
        const menu = findModelRootMenu();
        if (menu !== null) injectInto(menu);
      };

      const schedule = () => {
        if (disposed || scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          scan();
        });
      };

      observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
      scan();

      // 兜底轮询：菜单打开但某次 mutation 没赶上（或 HMR 重载换了实例）时自愈。
      const interval = window.setInterval(scan, 1000);

      return () => {
        disposed = true;
        window.clearInterval(interval);
        if (observer !== null) observer.disconnect();
        observer = null;
        document.querySelectorAll(`[${ROW_ATTR}][data-dsm-owner="${owner}"]`).forEach((node) => node.remove());
        document.querySelectorAll(`[data-dsm-manage-row][data-dsm-owner="${owner}"]`).forEach((node) => node.remove());
        document.querySelectorAll(`[${DIVIDER_ATTR}][data-dsm-owner="${owner}"]`).forEach((node) => node.remove());
        document.querySelectorAll(`[data-dsm-added][data-dsm-owner="${owner}"]`).forEach((node) => node.remove());
      };
    }

    // ─────────────────────────────────────────────────────── 小型基础组件

    /** 主题化文本按钮（等价于内置 Button 的 primary/ghost + md/sm）。 */
    function DsmButton({ variant = 'ghost', size = 'md', disabled, onClick, type = 'button', children, ...rest }) {
      return h(
        'button',
        {
          type,
          className: 'dsm-btn',
          'data-variant': variant,
          'data-size': size,
          disabled: disabled === true,
          onClick,
          ...rest,
        },
        children,
      );
    }

    /** 主题化输入框外壳。 */
    function DsmInput({
      value,
      onChange,
      type = 'text',
      placeholder,
      ariaLabel,
      inputRef,
      onKeyDown,
      onFocus,
      onBlur,
      onClick,
      readOnly,
      role,
      ariaExpanded,
      ariaControls,
    }) {
      return h(
        'span',
        { className: 'dsm-input' },
        h('input', {
          ref: inputRef,
          className: 'dsm-inputInner',
          type,
          value,
          placeholder,
          role,
          readOnly: readOnly === true,
          'aria-label': ariaLabel,
          'aria-expanded': ariaExpanded,
          'aria-controls': ariaControls,
          spellCheck: false,
          autoComplete: 'off',
          onKeyDown,
          onFocus,
          onBlur,
          onClick,
          onChange: (event) => {
            if (typeof onChange === 'function') onChange(event.target.value);
          },
        }),
      );
    }

    /** 一行「标签 + 控件」。 */
    function DsmField({ label, tag, children }) {
      return h(
        'div',
        { className: 'dsm-field' },
        h(
          'span',
          { className: 'dsm-label' },
          label,
          tag !== undefined ? h('span', { className: 'dsm-labelTag' }, tag) : null,
        ),
        children,
      );
    }

    // ─────────────────────────────────────────────────────── 模型选择器

    /**
     * 归一化平台 `/models` 响应（与 index.js 的 normalizeModels 保持同构）。
     * 浏览器直连与 Host 代理共用同一份解析规则。
     */
    function normalizeModelPayload(parsed, protocol) {
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.data)
          ? parsed.data
          : Array.isArray(parsed?.models)
            ? parsed.models
            : Array.isArray(parsed?.items)
              ? parsed.items
              : [];
      const seen = new Set();
      const models = [];
      for (const item of list) {
        let id = '';
        let label = '';
        if (typeof item === 'string') {
          id = item;
        } else if (item !== null && typeof item === 'object') {
          if (protocol === 'google') {
            if (
              Array.isArray(item.supportedGenerationMethods) &&
              !item.supportedGenerationMethods.includes('generateContent')
            ) {
              continue;
            }
            id = typeof item.name === 'string' ? item.name : '';
            if (id.startsWith('models/')) id = id.slice('models/'.length);
            label = typeof item.displayName === 'string' ? item.displayName : '';
          } else {
            id = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : '';
            label =
              (typeof item.display_name === 'string' && item.display_name) ||
              (typeof item.displayName === 'string' && item.displayName) ||
              (typeof item.name === 'string' && item.name) ||
              '';
          }
        }
        id = String(id).trim();
        if (id === '' || seen.has(id)) continue;
        seen.add(id);
        models.push({ id, label: String(label || id).trim() });
      }
      models.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
      return models;
    }

    /** 带稳定错误码的 Error（客户端版）。 */
    function modelError(code, detail) {
      const error = new Error(code);
      error.code = code;
      error.detail = detail;
      return error;
    }

    /**
     * 浏览器直连平台 `/models`。
     * 实测 OpenAI / DeepSeek / Moonshot / SiliconFlow / OpenRouter / Gemini 都允许
     * 浏览器跨域（ACAO 回显或 *），所以优先直连，省掉一次 Host 转发；
     * Anthropic 会校验浏览器来源、且需要专用请求头，直接交给 Host 代理。
     * @param {{protocol:string, baseUrl:string, apiKey:string, providerId:string}} options
     */
    async function fetchModelsDirect({ protocol, baseUrl, apiKey, providerId }) {
      const headers = { accept: 'application/json' };
      let url;
      if (protocol === 'google') {
        url = `${baseUrl}/models${apiKey === '' ? '' : `?key=${encodeURIComponent(apiKey)}`}`;
      } else {
        url = `${baseUrl}/models`;
        if (apiKey !== '') headers.authorization = `Bearer ${apiKey}`;
        if (providerId === 'openrouter') {
          headers['http-referer'] = 'https://github.com/mhxy13867806343/dsh-plugin-select-model';
          headers['x-title'] = 'DSH select model';
        }
      }
      let response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers,
          mode: 'cors',
          redirect: 'follow',
          signal: AbortSignal.timeout(8000),
        });
      } catch (error) {
        const aborted = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        throw modelError(aborted ? 'timeout' : 'network-error', String(error?.message ?? error));
      }
      if (!response.ok) throw modelError(`http_${response.status}`, '');
      const parsed = await response.json().catch(() => null);
      if (parsed === null) throw modelError('invalid-json', '');
      const models = normalizeModelPayload(parsed, protocol);
      if (models.length === 0) throw modelError('empty-list', '');
      return { models, count: models.length };
    }

    // ── 公共模型目录：没有平台 Key 时也能看到「当前真实存在」的型号 ──
    // OpenRouter 的 /models 是公开目录（无需 Key、允许 CORS），按厂商前缀过滤后
    // 就能拿到 OpenAI / Anthropic / Google / DeepSeek / Qwen / GLM / Kimi 的现役型号。
    // 它只是「目录参考」：填了平台 Key 后仍以平台自己的 /models 为准。
    const PUBLIC_CATALOG_URL = 'https://openrouter.ai/api/v1/models';
    const CATALOG_TTL_MS = 10 * 60 * 1000;
    const CATALOG_VENDORS = Object.freeze({
      openai: 'openai',
      anthropic: 'anthropic',
      google: 'google',
      deepseek: 'deepseek',
      dashscope: 'qwen',
      zhipu: 'z-ai',
      moonshot: 'moonshotai',
    });
    /** 模块级缓存：一次会话里只拉一次公共目录，10 分钟过期。 */
    let catalogCache = null;
    let catalogAt = 0;
    let catalogPending = null;

    /** 拉取公共目录（带缓存与并发合并）。 */
    function loadPublicCatalog(force = false) {
      const now = Date.now();
      if (!force && catalogCache !== null && now - catalogAt < CATALOG_TTL_MS) {
        return Promise.resolve(catalogCache);
      }
      if (!force && catalogPending !== null) return catalogPending;
      catalogPending = (async () => {
        const response = await fetch(PUBLIC_CATALOG_URL, {
          headers: { accept: 'application/json' },
          mode: 'cors',
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw modelError(`http_${response.status}`, '');
        const parsed = await response.json();
        const list = Array.isArray(parsed?.data) ? parsed.data : [];
        const entries = [];
        for (const item of list) {
          if (item === null || typeof item !== 'object' || typeof item.id !== 'string') continue;
          if (item.id.includes(':')) continue; // 过滤 :batch / :free 这类 OpenRouter 路由变体
          entries.push({
            id: item.id,
            name: typeof item.name === 'string' && item.name !== '' ? item.name : item.id,
          });
        }
        if (entries.length === 0) throw modelError('empty-list', '');
        catalogCache = entries;
        catalogAt = Date.now();
        return entries;
      })().finally(() => {
        catalogPending = null;
      });
      return catalogPending;
    }

    /** 把公共目录条目映射成当前服务商可选的型号（去掉厂商前缀，还原平台 id 风格）。 */
    function catalogModelsFor(provider, catalog) {
      const labelOf = (name) => (name.includes(': ') ? name.slice(name.indexOf(': ') + 2) : name);
      if (provider.id === 'openrouter') {
        return catalog.map((entry) => ({ id: entry.id, label: labelOf(entry.name) }));
      }
      const vendor = CATALOG_VENDORS[provider.id];
      if (vendor === undefined) return null;
      const prefix = `${vendor}/`;
      const models = [];
      for (const entry of catalog) {
        if (!entry.id.startsWith(prefix)) continue;
        const raw = entry.id.slice(prefix.length);
        const id = provider.protocol === 'anthropic' ? raw.replace(/\./g, '-') : raw;
        models.push({ id, label: labelOf(entry.name) });
      }
      return models.length > 0 ? models : null;
    }

    /** 新增模型的错误码 → 文案。 */
    function describeAddError(t, code, detail) {
      const key = `add.err.${code}`;
      const text = t(key, { detail: detail ?? '' });
      return text === key ? t('add.err.generic', { detail: detail || code }) : text;
    }

    /** 把 Host 返回的错误码翻译成用户可读的一句话；未知错误码给出兜底文案。 */
    function describeModelError(t, code) {
      const key = `model.err.${code}`;
      const text = t(key);
      return text === key ? t('model.err.unknown') : text;
    }

    /**
     * 模型选择器。
     * 预设服务商：从平台实时拉取真实模型列表（可下拉选择、可搜索、也可手输），
     * 拉取失败或还没填 Key 时退回该服务商的常用型号；自定义服务商只手输。
     * @param {object} props
     * @param {object} props.provider 当前服务商预设
     * @param {string} props.apiKey 当前输入的 API Key
     * @param {string} props.baseUrl 当前输入的接口地址
     * @param {string} props.value 已选 / 已输入的模型 ID
     * @param {(next:string) => void} props.onChange 模型 ID 变化
     * @param {(key:string, vars?:object) => string} props.t 翻译
     */
    function ModelPicker({ provider, apiKey, baseUrl, value, onChange, t }) {
      const isCustom = provider.id === 'custom';
      const [open, setOpen] = useState(false);
      const [models, setModels] = useState(null);
      const [loading, setLoading] = useState(false);
      const [errorCode, setErrorCode] = useState(null);
      const [query, setQuery] = useState('');
      const [catalogModels, setCatalogModels] = useState(null);
      const [catalogLoading, setCatalogLoading] = useState(false);
      const [hintCode, setHintCode] = useState(null);
      const [menuRect, setMenuRect] = useState(null);
      const anchorRef = useRef(null);
      const menuRef = useRef(null);
      const searchRef = useRef(null);
      const requestSeq = useRef(0);
      const listId = 'dsm-model-list';

      const source = models ?? catalogModels ?? provider.fallbackModels;
      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (needle === '') return source;
        return source.filter((item) => `${item.id} ${item.label ?? ''}`.toLowerCase().includes(needle));
      }, [source, query]);

      /** 拉取平台模型列表：先试浏览器直连，失败再交给 Host 代理（兼容 Anthropic / 自建网关）。 */
      const fetchModels = useCallback(async () => {
        if (provider.id === 'custom') return;
        const trimmedBase = (baseUrl.trim() || provider.baseUrl).trim();
        if (trimmedBase === '') {
          setErrorCode('invalid-base-url');
          return;
        }
        const seq = requestSeq.current + 1;
        requestSeq.current = seq;
        setLoading(true);
        setErrorCode(null);
        const trimmedKey = apiKey.trim();

        // ① 直连。Anthropic 走不了浏览器直连（来源校验 + 专用头），直接跳过。
        if (provider.protocol !== 'anthropic') {
          try {
            const direct = await fetchModelsDirect({
              protocol: provider.protocol,
              baseUrl: trimmedBase,
              apiKey: trimmedKey,
              providerId: provider.id,
            });
            if (requestSeq.current !== seq) return;
            setModels(direct.models);
            setErrorCode(null);
            setLoading(false);
            return;
          } catch (directError) {
            if (requestSeq.current !== seq) return;
            // 直连失败（典型是 CORS / 平台不允许浏览器访问）→ 继续试 Host 代理
          }
        }

        // ② Host 代理兜底。
        try {
          const response = await fetch(MODELS_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              providerId: provider.id,
              protocol: provider.protocol,
              baseUrl: trimmedBase,
              apiKey: trimmedKey,
            }),
          });
          const data = await response.json().catch(() => null);
          if (requestSeq.current !== seq) return;
          if (response.status === 404) {
            // Host 半边的路由还没随重启加载：先安静地用常用型号列表。
            setModels(null);
            setErrorCode('route-missing');
            return;
          }
          if (data !== null && data.ok === true && Array.isArray(data.models) && data.models.length > 0) {
            setModels(
              data.models.map((item) => ({
                id: String(item.id),
                label:
                  typeof item.label === 'string' && item.label !== '' ? item.label : String(item.id),
              })),
            );
            setErrorCode(null);
          } else {
            setModels(null);
            setErrorCode(data !== null && typeof data.error === 'string' ? data.error : 'request-failed');
          }
        } catch {
          if (requestSeq.current === seq) {
            setModels(null);
            setErrorCode('network-error');
          }
        } finally {
          if (requestSeq.current === seq) setLoading(false);
        }
      }, [provider.id, provider.baseUrl, provider.protocol, baseUrl, apiKey]);

      const canFetch = provider.publicModels === true || apiKey.trim() !== '';

      // 公共目录：没有平台 Key 时也先给出「现役型号」参考（OpenRouter 公开目录，按厂商过滤）。
      useEffect(() => {
        let cancelled = false;
        const supportsCatalog = provider.id === 'openrouter' || CATALOG_VENDORS[provider.id] !== undefined;
        if (!supportsCatalog) {
          setCatalogModels(null);
          setCatalogLoading(false);
          return undefined;
        }
        setCatalogLoading(true);
        loadPublicCatalog()
          .then((catalog) => {
            if (cancelled) return;
            setCatalogModels(catalogModelsFor(provider, catalog));
          })
          .catch(() => {
            if (!cancelled) setCatalogModels(null);
          })
          .finally(() => {
            if (!cancelled) setCatalogLoading(false);
          });
        return () => {
          cancelled = true;
        };
      }, [provider.id, provider.protocol]);

      // 「请先填 Key」提示 4 秒后淡出；Key 就绪后立刻清掉。
      useEffect(() => {
        if (hintCode === null) return undefined;
        const timer = window.setTimeout(() => setHintCode(null), 4500);
        return () => window.clearTimeout(timer);
      }, [hintCode]);
      useEffect(() => {
        if (canFetch) setHintCode(null);
      }, [canFetch]);

      // 服务商切换：清空模型列表、搜索词与下拉状态（避免把上一个平台的模型带过来）。
      useEffect(() => {
        setModels(null);
        setErrorCode(null);
        setQuery('');
        setOpen(false);
      }, [provider.id]);

      // Key / 地址就绪后自动拉取（防抖），公开列表的服务商不需要 Key。
      useEffect(() => {
        if (provider.id === 'custom' || !canFetch) {
          requestSeq.current += 1; // 作废进行中的请求
          setModels(null);
          setErrorCode(null);
          setLoading(false);
          return undefined;
        }
        const timer = window.setTimeout(() => {
          void fetchModels();
        }, 650);
        return () => {
          window.clearTimeout(timer);
        };
      }, [provider.id, canFetch, fetchModels]);

      /** 计算下拉位置：优先向下，底部空间不足时向上；左右夹在视口内。 */
      const updateRect = useCallback(() => {
        const node = anchorRef.current;
        if (node === null) return;
        const rect = node.getBoundingClientRect();
        const width = Math.max(280, Math.min(rect.width, 440));
        const below = window.innerHeight - rect.bottom - 12;
        const above = rect.top - 12;
        const dropUp = below < 220 && above > below;
        const maxHeight = Math.max(180, Math.min(320, dropUp ? above : below));
        let left = rect.left;
        if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
        setMenuRect({
          left: Math.max(12, left),
          width,
          maxHeight,
          ...(dropUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
        });
      }, []);

      // 打开时定位，并跟随窗口尺寸 / 滚动更新；点外部关闭；Escape 关闭。
      useLayoutEffect(() => {
        if (!open) return undefined;
        updateRect();
        const onResize = () => updateRect();
        const onScroll = (event) => {
          if (menuRef.current !== null && event.target instanceof Node && menuRef.current.contains(event.target)) {
            return;
          }
          updateRect();
        };
        window.addEventListener('resize', onResize);
        window.addEventListener('scroll', onScroll, true);
        return () => {
          window.removeEventListener('resize', onResize);
          window.removeEventListener('scroll', onScroll, true);
        };
      }, [open, updateRect]);

      useEffect(() => {
        if (!open) return undefined;
        const onMouseDown = (event) => {
          const target = event.target;
          if (anchorRef.current?.contains(target)) return;
          if (menuRef.current?.contains(target)) return;
          setOpen(false);
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => {
          document.removeEventListener('mousedown', onMouseDown);
        };
      }, [open]);

      const choose = (item) => {
        onChange(item.id);
        setQuery('');
        setOpen(false);
      };

      const toggleOpen = () => {
        if (isCustom) return;
        setQuery('');
        setOpen((current) => {
          if (current) return false;
          if (models === null && errorCode === null) void fetchModels();
          return true;
        });
      };

      const onInputKeyDown = (event) => {
        if (event.key === 'Enter') {
          if (isCustom) return; // 交给弹窗的 Enter 提交逻辑
          event.preventDefault();
          event.stopPropagation();
          if (!open) {
            toggleOpen();
            return;
          }
          const first = filtered[0];
          if (first !== undefined) choose(first);
          return;
        }
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          return;
        }
        if (event.key === 'ArrowDown' && !isCustom) {
          event.preventDefault();
          event.stopPropagation();
          if (!open) toggleOpen();
        }
      };

      const hardError = errorCode !== null && errorCode !== 'route-missing';
      const sourceState = isCustom
        ? { text: t('model.customHint'), tone: undefined }
        : hardError
          ? { text: t('model.failed', { reason: describeModelError(t, errorCode) }), tone: 'error' }
          : hintCode === 'need-key'
            ? { text: t('model.needKey'), tone: 'error' }
            : loading
              ? { text: t('model.loading'), tone: undefined }
              : models !== null
                ? { text: t('model.live', { n: models.length }), tone: 'live' }
                : catalogLoading
                  ? { text: t('catalog.loading'), tone: undefined }
                  : catalogModels !== null
                    ? { text: t('catalog.live', { n: catalogModels.length }), tone: 'info' }
                    : { text: t('model.fallback'), tone: undefined };
      const statusText = sourceState.text;
      const statusTone = sourceState.tone;

      /** 下拉里的「刷新 / 获取平台列表」。没有 Key 时给出明确提示，而不是静默回退。 */
      const refreshModels = () => {
        if (!canFetch) {
          setHintCode('need-key');
          return;
        }
        void fetchModels();
      };

      const menu =
        open && menuRect !== null && typeof document !== 'undefined'
          ? createPortal(
              h(
                'div',
                {
                  ref: menuRef,
                  className: 'dsm-modelMenu',
                  id: listId,
                  role: 'listbox',
                  'aria-label': t('model.listAria'),
                  style: menuRect,
                  onMouseDown: (event) => {
                    event.preventDefault();
                  },
                },
                h(
                  'div',
                  { className: 'dsm-modelHead' },
                  h('span', { className: 'dsm-modelHeadText' }, sourceState.text),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsm-modelRefresh',
                      onClick: refreshModels,
                    },
                    loading ? '…' : t('model.refresh'),
                  ),
                ),
                source.length > 10
                  ? h(
                      'span',
                      { className: 'dsm-modelSearch' },
                      h('input', {
                        ref: searchRef,
                        value: query,
                        placeholder: t('model.search'),
                        'aria-label': t('model.search'),
                        spellCheck: false,
                        onChange: (event) => {
                          setQuery(event.target.value);
                        },
                      }),
                    )
                  : null,
                h(
                  'div',
                  { className: 'dsm-modelList' },
                  loading && source.length === 0
                    ? h('div', { className: 'dsm-modelEmpty' }, t('model.loading'))
                    : filtered.length === 0
                      ? h('div', { className: 'dsm-modelEmpty' }, t('model.empty'))
                      : filtered.map((item) =>
                          h(
                            'button',
                            {
                              type: 'button',
                              key: item.id,
                              className: 'dsm-modelItem',
                              role: 'option',
                              'aria-selected': value === item.id,
                              title: item.id,
                              onClick: () => {
                                choose(item);
                              },
                            },
                            h(
                              'span',
                              { className: 'dsm-modelItemMain' },
                              h(
                                'span',
                                { className: 'dsm-modelItemLabel' },
                                item.label !== undefined && item.label !== item.id ? item.label : item.id,
                              ),
                              item.label !== undefined && item.label !== item.id
                                ? h('span', { className: 'dsm-modelItemId' }, item.id)
                                : null,
                            ),
                            value === item.id
                              ? h('span', { className: 'dsm-modelItemCheck', 'aria-hidden': 'true' }, '✓')
                              : null,
                          ),
                        ),
                ),
              ),
              document.body,
            )
          : null;

      return h(
        Fragment,
        null,
        h(
          'div',
          { className: 'dsm-modelRow' },
          h(
            'span',
            { ref: anchorRef, style: { flex: '1 1 auto', minWidth: 0, display: 'flex' } },
            h(DsmInput, {
              value,
              onChange,
              placeholder: isCustom ? t('field.modelCustomPlaceholder') : t('field.modelPlaceholder'),
              ariaLabel: t('field.model'),
              role: isCustom ? undefined : 'combobox',
              ariaExpanded: isCustom ? undefined : open,
              ariaControls: isCustom ? undefined : listId,
              onKeyDown: onInputKeyDown,
              onFocus: () => {
                if (!isCustom && !open) setOpen(true);
              },
              onClick: () => {
                if (!isCustom && !open) setOpen(true);
              },
            }),
          ),
          isCustom
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  className: 'dsm-modelBtn',
                  'aria-label': t('model.listAria'),
                  'aria-expanded': open,
                  onClick: toggleOpen,
                },
                '⌄',
              ),
        ),
        h(
          'div',
          { className: 'dsm-modelStatus', 'data-tone': statusTone },
          h('span', null, statusText),
        ),
        menu,
      );
    }

    // ─────────────────────────────────────────────────────── 添加模型弹窗

    /**
     * 把界面上的服务商映射成 DSH 模型服务（llm-pi-ai）的协议与兼容地址。
     * pi-ai 只有 openai-completions / openai-responses / anthropic-messages 三种协议；
     * Gemini 的原生 v1beta 接口不在其中，所以改用它官方的 OpenAI 兼容端点。
     */
    function piAiProfileOf(provider, baseUrl) {
      const trimmed = baseUrl.trim() || provider.baseUrl;
      if (provider.id === 'google') {
        return { protocol: 'openai-completions', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' };
      }
      if (provider.protocol === 'anthropic') return { protocol: 'anthropic-messages', baseUrl: trimmed };
      return { protocol: 'openai-completions', baseUrl: trimmed };
    }

    /**
     * 添加模型弹窗（布局版本）：服务商网格 + 接入字段 + 取消/添加。
     * @param {object} props
     * @param {boolean} props.open 是否打开
     * @param {() => void} props.onClose 关闭
     * @param {(draft:object) => void} props.onSubmit 提交（当前只落本地草稿）
     * @param {(key:string) => string} props.t 翻译
     */
    function AddModelDialog({ open, onClose, onSubmit, t }) {
      const [providerId, setProviderId] = useState(PROVIDERS[0].id);
      const [apiKey, setApiKey] = useState('');
      const [baseUrl, setBaseUrl] = useState(PROVIDERS[0].baseUrl);
      const [modelName, setModelName] = useState('');
      const [reveal, setReveal] = useState(false);
      const [submitting, setSubmitting] = useState(false);
      const [submitError, setSubmitError] = useState(null);
      const keyRef = useRef(null);
      const wasOpen = useRef(false);

      // 每次从关闭 → 打开时载入本地草稿。
      useEffect(() => {
        if (open && !wasOpen.current) {
          const draft = readDraft();
          const preset = PROVIDERS.find((item) => item.id === draft.providerId) ?? PROVIDERS[0];
          setProviderId(preset.id);
          setApiKey(typeof draft.apiKey === 'string' ? draft.apiKey : '');
          setBaseUrl(typeof draft.baseUrl === 'string' ? draft.baseUrl : preset.baseUrl);
          setModelName(typeof draft.modelName === 'string' ? draft.modelName : '');
          setReveal(false);
          setSubmitting(false);
          setSubmitError(null);
        }
        wasOpen.current = open;
      }, [open]);

      // 打开后把焦点放到 API Key。
      useEffect(() => {
        if (!open) return undefined;
        const timer = window.setTimeout(() => {
          keyRef.current?.focus();
        }, 30);
        return () => {
          window.clearTimeout(timer);
        };
      }, [open]);

      // Esc 关闭（菜单已由菜单行收起，这里只处理弹窗）。
      useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && !event.shiftKey) {
            event.preventDefault();
            onClose();
          }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [open, onClose]);

      const provider = useMemo(
        () => PROVIDERS.find((item) => item.id === providerId) ?? PROVIDERS[0],
        [providerId],
      );
      const canAdd =
        apiKey.trim() !== '' &&
        modelName.trim() !== '' &&
        (provider.id !== 'custom' || baseUrl.trim() !== '');

      if (!open) return null;

      const chooseProvider = (next) => {
        setProviderId(next.id);
        // 服务商换了，模型 ID 一定不能沿用上一个平台的。
        setModelName('');
        setSubmitError(null);
        if (next.id !== 'custom') setBaseUrl(next.baseUrl);
      };

      /** 提交：写入 llm-pi-ai 的 provider 配置 + DSH 凭据库，成功后由父组件收尾。 */
      const submit = async () => {
        if (!canAdd || submitting) return;
        const target = piAiProfileOf(provider, baseUrl);
        const modelId = modelName.trim();
        const displayName = modelId === '' ? provider.name : `${provider.name} · ${modelId}`;
        setSubmitting(true);
        setSubmitError(null);
        try {
          const response = await fetch(ADD_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              providerId: provider.id,
              protocol: target.protocol,
              baseUrl: target.baseUrl,
              apiKey: apiKey.trim(),
              modelId,
              modelLabel: modelId,
              displayName,
            }),
          });
          if (response.status === 404) {
            setSubmitError(t('add.err.restart'));
            return;
          }
          const data = await response.json().catch(() => null);
          if (data === null || data.ok !== true) {
            const code = data !== null && typeof data.error === 'string' ? data.error : 'generic';
            setSubmitError(describeAddError(t, code, data?.detail ?? ''));
            return;
          }
          onSubmit({ providerId, providerName: provider.name, modelName: modelId, route: data.route });
        } catch {
          setSubmitError(t('add.err.network'));
        } finally {
          setSubmitting(false);
        }
      };

      /** Enter 提交（焦点在输入框时）；按钮自身的 Enter 走原生 click，避免重复提交。 */
      const onDialogKeyDown = (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        const target = event.target;
        if (target instanceof HTMLElement && target.closest('button') !== null) return;
        if (!canAdd || submitting) return;
        event.preventDefault();
        submit();
      };

      const body = h(
        'div',
        { className: 'dsm-body' },
        // 布局版本说明
        h(
          'div',
          { className: 'dsm-note', role: 'note' },
          h('span', { className: 'dsm-noteMark', 'aria-hidden': 'true' }, 'i'),
          h('span', null, t('note.preview')),
        ),
        submitError !== null
          ? h(
              'div',
              { className: 'dsm-submitError', role: 'alert' },
              h('span', { 'aria-hidden': 'true' }, '!'),
              h('span', null, submitError),
            )
          : null,
        // 服务商网格
        h(
          'div',
          { className: 'dsm-section' },
          h('div', { className: 'dsm-sectionTitle' }, t('provider.section')),
          h(
            'div',
            { className: 'dsm-grid', role: 'radiogroup', 'aria-label': t('provider.section') },
            PROVIDERS.map((item) => {
              const selected = item.id === providerId;
              return h(
                'button',
                {
                  type: 'button',
                  key: item.id,
                  className: 'dsm-provider',
                  role: 'radio',
                  'aria-checked': selected,
                  'data-provider-id': item.id,
                  'data-selected': selected ? '1' : undefined,
                  onClick: () => {
                    chooseProvider(item);
                  },
                },
                h(
                  'span',
                  {
                    className: 'dsm-providerBadge',
                    style: { backgroundColor: item.color },
                    'aria-hidden': 'true',
                  },
                  item.badge,
                ),
                h(
                  'span',
                  { className: 'dsm-providerText' },
                  h('span', { className: 'dsm-providerName' }, item.name),
                  h('span', { className: 'dsm-providerHint' }, t(item.hintKey)),
                ),
                selected ? h('span', { className: 'dsm-providerCheck', 'aria-hidden': 'true' }, '✓') : null,
              );
            }),
          ),
        ),
        // 接入配置
        h(
          'div',
          { className: 'dsm-section' },
          h('div', { className: 'dsm-sectionTitle' }, t('config.section')),
          h(
            DsmField,
            { label: t('field.apiKey'), tag: provider.name },
            h(
              'div',
              { className: 'dsm-keyRow' },
              h(DsmInput, {
                value: apiKey,
                onChange: setApiKey,
                type: reveal ? 'text' : 'password',
                placeholder: provider.keyPlaceholder || t('field.apiKeyPlaceholder'),
                ariaLabel: t('field.apiKey'),
                inputRef: keyRef,
              }),
              h(
                DsmButton,
                {
                  variant: 'ghost',
                  size: 'sm',
                  onClick: () => {
                    setReveal((current) => !current);
                  },
                },
                reveal ? t('action.hide') : t('action.reveal'),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dsm-row2' },
            h(
              DsmField,
              { label: t('field.baseUrl') },
              h(DsmInput, {
                value: baseUrl,
                onChange: setBaseUrl,
                placeholder: provider.baseUrl || t('field.baseUrlPlaceholder'),
                ariaLabel: t('field.baseUrl'),
              }),
            ),
            h(
              DsmField,
              { label: t('field.model'), tag: t('tag.optional') },
              h(ModelPicker, {
                provider,
                apiKey,
                baseUrl,
                value: modelName,
                onChange: setModelName,
                t,
              }),
            ),
          ),
          h(
            'div',
            { className: 'dsm-hint' },
            h('span', { 'aria-hidden': 'true' }, '🔒'),
            h('span', null, t('hint.localOnly')),
          ),
        ),
      );

      return h(
        'div',
        { className: 'dsm-root' },
        h('div', { className: 'dsm-mask', 'aria-hidden': 'true', onClick: onClose }),
        h(
          'div',
          {
            className: 'dsm-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('dialog.title'),
            tabIndex: -1,
            'data-testid': 'select-model-dialog',
            onKeyDown: onDialogKeyDown,
          },
          h(
            'div',
            { className: 'dsm-content' },
            h(
              'div',
              { className: 'dsm-header' },
              h('h2', { className: 'dsm-title' }, t('dialog.title')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsm-close',
                  'aria-label': t('action.close'),
                  onClick: onClose,
                },
                '×',
              ),
            ),
            h('p', { className: 'dsm-desc' }, t('dialog.desc')),
            body,
          ),
          h(
            'div',
            { className: 'dsm-footer' },
            h(DsmButton, { variant: 'ghost', onClick: onClose }, t('action.cancel')),
            h(
              DsmButton,
              { variant: 'primary', disabled: !canAdd || submitting, onClick: submit },
              submitting ? t('add.loading') : t('action.add'),
            ),
          ),
        ),
      );
    }

    /** 轻量状态条：提交后提示「草稿已保存」。 */
    function DsmToast({ text, onDone }) {
      useEffect(() => {
        const timer = window.setTimeout(onDone, 3200);
        return () => {
          window.clearTimeout(timer);
        };
      }, [onDone]);
      return h(
        'div',
        { className: 'dsm-toast', role: 'status' },
        h('span', { className: 'dsm-toastMark', 'aria-hidden': 'true' }, '✓'),
        h('span', null, text),
      );
    }

    // ─────────────────────────────────────────────────────── 自检（Inspect Provider）

    /** 轮询等待条件成立。 */
    function waitFor(predicate, timeoutMs = 2500, stepMs = 50) {
      return new Promise((resolve) => {
        const started = Date.now();
        const tick = () => {
          let value = null;
          try {
            value = predicate();
          } catch {
            value = null;
          }
          if (value !== null && value !== undefined && value !== false) {
            resolve(value);
            return;
          }
          if (Date.now() - started >= timeoutMs) {
            resolve(null);
            return;
          }
          window.setTimeout(tick, stepMs);
        };
        tick();
      });
    }

    /** 等待若干毫秒（等入场动画结束再量尺寸）。 */
    function sleep(ms) {
      return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      });
    }

    /**
     * 注册只读自检入口，供 cordis_inspect_query 查询（与 dsh-plugin-edit-files 同款）。
     * @param {object} ctx client 插件上下文
     * @param {ReturnType<typeof createStore>} store 共享 store
     * @param {(key:string) => string} t 翻译
     */
    function installInspectProvider(ctx, store, t) {
      ctx.inject(['cordisInspect'], (inspectCtx) => {
        const registry = inspectCtx.cordisInspect;
        if (registry === undefined || registry === null || typeof registry.register !== 'function') return () => {};

        const findTrigger = () => {
          const buttons = document.querySelectorAll('button[aria-haspopup="menu"][aria-label]');
          for (const button of buttons) {
            if (!(button instanceof HTMLElement)) continue;
            if (MODEL_TRIGGER_LABEL.test(button.getAttribute('aria-label') ?? '')) return button;
          }
          return null;
        };

        const findMenu = () => {
          const menus = document.querySelectorAll('[role="menu"]');
          for (const menu of menus) {
            if (!(menu instanceof HTMLElement)) continue;
            if (MODEL_MENU_LABELS.includes(menu.getAttribute('aria-label') ?? '')) return menu;
          }
          return null;
        };

        const status = () => {
          const triggers = [];
          for (const button of document.querySelectorAll('button[aria-haspopup="menu"][aria-label]')) {
            if (!(button instanceof HTMLElement)) continue;
            if (!MODEL_TRIGGER_LABEL.test(button.getAttribute('aria-label') ?? '')) continue;
            const rect = button.getBoundingClientRect();
            triggers.push({
              label: button.getAttribute('aria-label'),
              visible: button.getClientRects().length > 0,
              expanded: button.getAttribute('aria-expanded'),
              top: Math.round(rect.top),
              left: Math.round(rect.left),
            });
          }
          const modelMenus = [...document.querySelectorAll('[role="menu"]')].filter(
            (node) =>
              node instanceof HTMLElement && MODEL_MENU_LABELS.includes(node.getAttribute('aria-label') ?? ''),
          ).length;
          return {
            plugin: NS,
            hasDocument: typeof document !== 'undefined',
            injectedRows: document.querySelectorAll(`[${ROW_ATTR}]`).length,
            menuOpen: findMenu() !== null,
            dialogOpen: store.get().open === true,
            menuLabels: MODEL_MENU_LABELS,
            addLabel: t('menu.add'),
            triggerCount: triggers.length,
            triggers,
            modelMenuCount: modelMenus,
            dialogNodes: document.querySelectorAll('[data-testid="select-model-dialog"]').length,
            pickerNodes: document.querySelectorAll('.dsm-modelRow').length,
            modelMenuNodes: document.querySelectorAll('.dsm-modelMenu').length,
          };
        };

        /** 把管理弹窗里的每一行读成可比较的结构（名称、副标题、是否当前、按钮）。 */
        const describeManageRows = (dialog) =>
          Array.from(dialog.querySelectorAll('.dsm-manageRow')).map((node) => ({
            name: (node.querySelector('.dsm-manageName')?.textContent ?? '').trim(),
            sub: (node.querySelector('.dsm-manageSub')?.textContent ?? '').trim(),
            current: node.getAttribute('data-current') === '1',
            badge: (node.querySelector('.dsm-manageBadge')?.textContent ?? '').trim() || null,
            buttons: Array.from(node.querySelectorAll('button')).map((button) => ({
              text: (button.textContent ?? '').trim(),
              action: button.getAttribute('data-action'),
              disabled: button.disabled === true,
            })),
          }));

        /** 管理弹窗的整体状态：标题、搜索、当前页的行、分页器与按钮。 */
        const describeManageDialog = (dialog) => {
          const pager = dialog.querySelector('[data-testid="select-model-manage-pager"]');
          const prev = dialog.querySelector('.dsm-footer button[data-action="prev"]');
          const next = dialog.querySelector('.dsm-footer button[data-action="next"]');
          const footer = Array.from(dialog.querySelectorAll('.dsm-footer button')).map((button) => ({
            text: (button.textContent ?? '').trim(),
            action: button.getAttribute('data-action'),
            disabled: button.disabled === true,
          }));
          return {
            title: (dialog.querySelector('.dsm-title')?.textContent ?? '').trim(),
            hasSearch: dialog.querySelector('input') !== null,
            rows: describeManageRows(dialog),
            rowCount: dialog.querySelectorAll('.dsm-manageRow').length,
            pager:
              pager === null
                ? null
                : {
                    label: (pager.textContent ?? '').trim(),
                    prevDisabled: prev?.disabled === true,
                    nextDisabled: next?.disabled === true,
                  },
            footer,
          };
        };

        /** 只读：读取当前已经打开的管理弹窗（不打开/不关闭），用于检查高亮与分页。 */
        const manageState = () => {
          const dialog = document.querySelector('[data-testid="select-model-manage-dialog"]');
          if (dialog === null) return { ok: false, reason: 'manage-dialog-not-open' };
          return { ok: true, ...describeManageDialog(dialog) };
        };

        /** 打开模型菜单 → 点「管理已添加模型」→ 读取管理弹窗；可翻页或试开编辑/删除弹窗（不保存/不删除）。 */
        const manageProbe = async (input) => {
          const action =
            input?.action === 'edit'
              ? 'edit'
              : input?.action === 'delete'
                ? 'delete'
                : input?.action === 'prev'
                  ? 'prev'
                  : input?.action === 'next'
                    ? 'next'
                    : input?.action === 'confirm'
                      ? 'confirm'
                      : 'none';
          if (store.get().open === true || store.get().manageOpen === true) {
            store.set({ open: false, manageOpen: false });
          }
          let menu = findMenu();
          if (menu === null) {
            const trigger = findTrigger();
            if (trigger === null) return { ok: false, reason: 'model-trigger-not-found' };
            trigger.click();
            menu = await waitFor(findMenu);
          }
          if (menu === null) return { ok: false, reason: 'model-menu-not-opened' };
          const manageRow = await waitFor(
            () => menu.querySelector('[data-dsm-manage-row]'),
            3000,
          );
          const result = {
            ok: false,
            menuRows: Array.from(menu.children)
              .filter((node) => node instanceof HTMLElement && node.matches('button[role="menuitem"]'))
              .map((node) => (node.textContent ?? '').trim()),
            manageRowText: manageRow === null ? null : (manageRow.textContent ?? '').trim(),
            manageDialog: null,
            actionDialog: null,
          };
          if (manageRow === null) return result;
          manageRow.click();
          const dialog = await waitFor(
            () => document.querySelector('[data-testid="select-model-manage-dialog"]'),
            3000,
          );
          if (dialog === null) return result;
          await waitFor(
            () =>
              dialog.querySelectorAll('.dsm-manageRow').length > 0 ||
              dialog.querySelector('.dsm-manageEmpty') !== null
                ? true
                : null,
            4000,
          );
          await sleep(120);
          const rows = Array.from(dialog.querySelectorAll('.dsm-manageRow'));
          result.manageDialog = describeManageDialog(dialog);
          result.ok = rows.length >= 0;
          if ((action === 'prev' || action === 'next') && rows.length > 0) {
            const pagerButton = dialog.querySelector(`.dsm-footer button[data-action="${action}"]`);
            if (pagerButton instanceof HTMLElement && pagerButton.disabled !== true) {
              pagerButton.click();
              await sleep(120);
              result.manageDialog = describeManageDialog(dialog);
            }
          }
          if (action === 'confirm') {
            const confirmButton = dialog.querySelector('.dsm-footer button[data-action="confirm"]');
            if (confirmButton instanceof HTMLElement) {
              confirmButton.click();
              await sleep(150);
              result.confirmed = document.querySelector('[data-testid="select-model-manage-dialog"]') === null;
              result.manageDialog = result.confirmed ? null : describeManageDialog(dialog);
            }
          }
          if ((action === 'edit' || action === 'delete') && rows.length > 0) {
            const button = rows[0].querySelector(`button[data-action="${action}"]`);
            if (button instanceof HTMLElement) button.click();
            const modal =
              action === 'edit'
                ? await waitFor(() => document.querySelector('[data-testid="select-model-edit-dialog"]'), 2500)
                : await waitFor(() => document.querySelector('[data-testid="select-model-confirm-dialog"]'), 2500);
            if (modal !== null) {
              result.actionDialog = {
                testid: modal.getAttribute('data-testid'),
                title: (modal.querySelector('.dsm-title')?.textContent ?? '').trim(),
                description: (modal.querySelector('.dsm-desc')?.textContent ?? '').trim(),
                inputs: Array.from(modal.querySelectorAll('input')).map((node) => ({
                  value: node.value,
                  placeholder: node.getAttribute('placeholder'),
                  type: node.getAttribute('type'),
                })),
                footer: Array.from(modal.querySelectorAll('.dsm-footer .dsm-btn')).map((node) => ({
                  text: (node.textContent ?? '').trim(),
                  variant: node.getAttribute('data-variant'),
                })),
              };
              store.set({ editTarget: null, confirmTarget: null });
            }
          }
          return result;
        };

        /** 只读：当前会话、用于高亮的模型选择，以及切换模型所需的 remote 面是否就绪。 */
        const selectionProbe = async () => {
          const sessionId = store.get().sessionId;
          let hasBinding = false;
          let projection = null;
          try {
            const binding = sessionId === undefined ? undefined : ctx.sessions.binding(sessionId);
            hasBinding = binding !== undefined;
            const projected = binding?.session?.projections?.faceOf?.('modelSelection');
            projection = projected?.getSnapshot?.() ?? null;
          } catch (error) {
            projection = { error: String(error?.message ?? error) };
          }
          let catalog = null;
          try {
            const response = await ctx.remote.session.modelCatalog();
            if (response?.ok === true) {
              const groups = Array.isArray(response.value?.groups) ? response.value.groups : [];
              catalog = groups.map((group) => ({
                provider: group.id,
                name: group.name ?? null,
                models: (Array.isArray(group.models) ? group.models : []).map((model) => model.id),
              }));
            } else {
              catalog = { error: response?.error?.code ?? 'model-catalog-failed' };
            }
          } catch (error) {
            catalog = { error: String(error?.message ?? error) };
          }
          return {
            ok: true,
            sessionsService: ctx.sessions !== undefined,
            remoteSession: typeof ctx.remote?.session?.selectModel === 'function',
            sessionId: sessionId === undefined ? null : String(sessionId),
            hasBinding,
            selection: store.get().selection,
            projection,
            catalog,
          };
        };


/** 调试：只改插件 UI 状态（不动 DSH 配置），用于检查「当前选择」高亮样式。 */
        const highlightProbe = (input) => {
          const provider = typeof input?.provider === 'string' ? input.provider : '';
          const model = typeof input?.model === 'string' ? input.model : '';
          if (input?.clear === true || provider === '' || model === '') {
            const sessionId = store.get().sessionId;
            let restored = null;
            try {
              const binding = sessionId === undefined ? undefined : ctx.sessions.binding(sessionId);
              const projected = binding?.session?.projections?.faceOf?.('modelSelection');
              const snapshot = projected?.getSnapshot?.();
              const picked = snapshot?.next ?? snapshot?.lastUsed ?? null;
              if (picked !== null && picked !== undefined) {
                restored = { provider: picked.provider, model: picked.model };
              }
            } catch {
              restored = null;
            }
            store.set({ selection: restored });
            return { ok: true, cleared: true, selection: store.get().selection };
          }
          store.set({ selection: { provider, model } });
          return { ok: true, cleared: false, selection: store.get().selection };
        };

        /** 只打开模型菜单并停在打开状态（供截图检查「添加模型」行）。 */
        const openMenu = async () => {
          if (store.get().open === true) {
            store.set({ open: false });
            await waitFor(() => store.get().open === false, 800);
          }
          let menu = findMenu();
          if (menu === null) {
            const trigger = findTrigger();
            if (trigger === null) return { ok: false, reason: 'model-trigger-not-found' };
            trigger.click();
            menu = await waitFor(findMenu);
          }
          if (menu === null) return { ok: false, reason: 'model-menu-not-opened' };
          const row = await waitFor(() => menu.querySelector(`[${ROW_ATTR}]`));
          const menuRows = Array.from(menu.children)
            .filter((node) => node instanceof HTMLElement && node.matches('button[role="menuitem"]'))
            .map((node) => (node.textContent ?? '').trim());
          if (row === null) return { ok: false, reason: 'add-model-row-not-injected', menuRows };
          const rect = row.getBoundingClientRect();
          return {
            ok: true,
            menuRows,
            row: {
              text: (row.textContent ?? '').trim(),
              isLastRow: row === menu.lastElementChild,
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              top: Math.round(rect.top),
              left: Math.round(rect.left),
            },
          };
        };

        /** 打开模型菜单并点进「添加模型」弹窗，随后**停在打开状态**（供截图 / 目视检查）。 */
        const openPreview = async (input) => {
          const providerId = typeof input?.providerId === 'string' ? input.providerId : null;
          const openModels = input?.openModels === true;
          const direct = input?.direct === true;
          if (store.get().open === true) {
            store.set({ open: false });
            await waitFor(() => store.get().open === false, 800);
          }
          let menuRows = [];
          let rowText = '';
          if (direct) {
            // 调试用：绕过内置菜单，直接打开弹窗（验证弹窗/模型选择器本身）。
            store.set({ open: true });
          } else {
            const trigger = findTrigger();
            if (trigger === null) return { ok: false, reason: 'model-trigger-not-found' };
            trigger.click();
            const menu = await waitFor(findMenu);
            if (menu === null) return { ok: false, reason: 'model-menu-not-opened' };
            menuRows = Array.from(menu.children)
              .filter((node) => node instanceof HTMLElement && node.matches('button[role="menuitem"]'))
              .map((node) => (node.textContent ?? '').trim());
            const row = await waitFor(() => menu.querySelector(`[${ROW_ATTR}]`));
            if (row === null) return { ok: false, reason: 'add-model-row-not-injected', menuRows };
            rowText = (row.textContent ?? '').trim();
            row.click();
          }
          const dialog = await waitFor(
            () => document.querySelector('[data-testid="select-model-dialog"]'),
            2500,
          );
          if (dialog === null) {
            return { ok: false, reason: 'dialog-not-opened', menuRows };
          }
          await sleep(420); // 等 dsmPop 入场动画（scale .985）结束再量真实尺寸

          // 可选：切到指定服务商（验证「换服务商 → 换模型列表」）。
          let switchedProvider = null;
          if (providerId !== null) {
            const card = dialog.querySelector(`[data-provider-id="${providerId}"]`);
            if (card instanceof HTMLElement) {
              card.click();
              switchedProvider = providerId;
              await sleep(260);
            }
          }

          // 可选：打开模型下拉并等列表返回（最多 8s）。
          const pickerStatusNode = dialog.querySelector('.dsm-modelStatus');
          const modelInput = dialog.querySelector('.dsm-modelRow input');
          const picker = {
            status: (pickerStatusNode?.textContent ?? '').trim(),
            statusAll: Array.from(dialog.querySelectorAll('.dsm-modelStatus')).map((node) =>
              (node.textContent ?? '').trim(),
            ),
            dialogCountAtRead: document.querySelectorAll('[data-testid="select-model-dialog"]').length,
            tone: pickerStatusNode?.getAttribute('data-tone') ?? null,
            modelValue: modelInput instanceof HTMLInputElement ? modelInput.value : null,
            hasDropdown: dialog.querySelector('.dsm-modelBtn') !== null,
            dropdownOpen: false,
            searchVisible: false,
            itemCount: 0,
            items: [],
          };
          if (openModels) {
            const openVia = input?.openVia === 'input' ? 'input' : 'button';
            const button =
              openVia === 'input'
                ? dialog.querySelector('.dsm-modelRow input')
                : dialog.querySelector('.dsm-modelBtn');
            if (button instanceof HTMLElement) {
              button.click();
              await waitFor(
                () => {
                  const menuNode = document.querySelector('.dsm-modelMenu');
                  if (menuNode === null) return null;
                  const statusNode = dialog.querySelector('.dsm-modelStatus');
                  const status = (statusNode?.textContent ?? '').trim();
                  const busy = status.includes('正在') || status.includes('Fetching');
                  if (busy) return null; // 还在拉平台列表，别把内置常用型号当成结果
                  const items = menuNode.querySelectorAll('.dsm-modelItem').length;
                  return items > 0 ? true : null;
                },
                12000,
              );
              await sleep(160);
            }
            const menuNode = document.querySelector('.dsm-modelMenu');
            const items = menuNode === null ? [] : Array.from(menuNode.querySelectorAll('.dsm-modelItem'));
            picker.dropdownOpen = menuNode !== null;
            picker.searchVisible = menuNode !== null && menuNode.querySelector('.dsm-modelSearch') !== null;
            picker.itemCount = items.length;
            picker.items = items.slice(0, 8).map((node) => (node.textContent ?? '').trim());
          }

          const finalRect = dialog.getBoundingClientRect();
          const body = dialog.querySelector('.dsm-body');
          const hint = dialog.querySelector('.dsm-hint');
          return {
            ok: true,
            menuRows,
            rowText,
            switchedProvider,
            picker,
            dialog: {
              width: Math.round(finalRect.width),
              height: Math.round(finalRect.height),
              top: Math.round(finalRect.top),
              left: Math.round(finalRect.left),
              bodyScrollHeight: body === null ? null : body.scrollHeight,
              bodyClientHeight: body === null ? null : body.clientHeight,
              hintVisible:
                hint === null ? null : hint.getBoundingClientRect().bottom <= finalRect.bottom - 24,
            },
          };
        };

        /** 只读：通过 remote.settings.describe 验证客户端能读到 llm-pi-ai 的配置与 revision。 */
        const settingsProbe = async () => {
          try {
            const response = await ctx.remote.settings.describe();
            if (!response.ok) {
              return { ok: false, error: response.error?.code ?? 'describe-failed', detail: response.error?.message };
            }
            const namespaces = Array.isArray(response.value?.namespaces) ? response.value.namespaces : [];
            const ns = namespaces.find((item) => item?.ns === 'llm-pi-ai');
            if (ns === undefined) return { ok: false, error: 'namespace-missing', available: namespaces.map((item) => item?.ns) };
            const providers = ns.value?.providers;
            return {
              ok: true,
              revision: ns.revision ?? null,
              providerCount: providers !== null && typeof providers === 'object' ? Object.keys(providers).length : 0,
              providers:
                providers !== null && typeof providers === 'object'
                  ? Object.entries(providers).map(([route, profile]) => ({
                      route,
                      displayName: typeof profile?.displayName === 'string' ? profile.displayName : null,
                      api: typeof profile?.api === 'string' ? profile.api : null,
                      baseURL: typeof profile?.baseURL === 'string' ? profile.baseURL : null,
                      apiKeyEnv: typeof profile?.apiKeyEnv === 'string' ? profile.apiKeyEnv : null,
                      models: Array.isArray(profile?.models)
                        ? profile.models.map((model) => (typeof model?.id === 'string' ? model.id : '')).filter(Boolean)
                        : [],
                    }))
                  : [],
            };
          } catch (error) {
            return { ok: false, error: 'probe-failed', detail: String(error?.message ?? error) };
          }
        };

        /** 直接验证「浏览器直连平台 /models」（不经过 Host 代理）。 */
        const directProbe = async (input) => {
          const startedAt = Date.now();
          const body = {
            providerId: typeof input?.providerId === 'string' ? input.providerId : 'openrouter',
            protocol: typeof input?.protocol === 'string' ? input.protocol : 'openrouter',
            baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl : 'https://openrouter.ai/api/v1',
            apiKey: typeof input?.apiKey === 'string' ? input.apiKey : '',
          };
          try {
            const result = await fetchModelsDirect(body);
            return {
              ok: true,
              elapsedMs: Date.now() - startedAt,
              count: result.count,
              sample: result.models.slice(0, 8),
            };
          } catch (error) {
            return {
              ok: false,
              elapsedMs: Date.now() - startedAt,
              error: typeof error?.code === 'string' ? error.code : 'direct-failed',
              detail: String(error?.detail ?? error?.message ?? error).slice(0, 300),
            };
          }
        };

        /** 直接探测 Host 的模型列表代理（不经过 UI），用于验证路由与归一化结果。 */
        const modelProbe = async (input) => {
          const startedAt = Date.now();
          const body = {
            providerId: typeof input?.providerId === 'string' ? input.providerId : 'openrouter',
            protocol: typeof input?.protocol === 'string' ? input.protocol : 'openrouter',
            baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl : 'https://openrouter.ai/api/v1',
            apiKey: typeof input?.apiKey === 'string' ? input.apiKey : '',
          };
          try {
            const response = await fetch(MODELS_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            });
            const data = await response.json().catch(() => null);
            return {
              ok: response.ok && data !== null && data.ok === true,
              status: response.status,
              elapsedMs: Date.now() - startedAt,
              protocol: data?.protocol ?? body.protocol,
              error: data?.error ?? null,
              detail: data?.detail ?? null,
              count: data?.count ?? 0,
              sample: Array.isArray(data?.models) ? data.models.slice(0, 8) : [],
            };
          } catch (error) {
            return {
              ok: false,
              status: 0,
              elapsedMs: Date.now() - startedAt,
              error: 'fetch-failed',
              detail: String(error?.message ?? error),
            };
          }
        };

        /** 收起弹窗（以及可能残留的模型菜单），恢复现场。 */
        const closePreview = async () => {
          store.set({ open: false, manageOpen: false, editTarget: null, confirmTarget: null });
          await waitFor(() => store.get().open === false, 800);
          document
            .querySelectorAll('[data-testid="select-model-dialog"], [data-testid="select-model-manage-dialog"], [data-testid="select-model-edit-dialog"], [data-testid="select-model-confirm-dialog"]')
            .forEach((node) => node.closest('.dsm-root')?.remove());
          const menu = findMenu();
          if (menu !== null) {
            const trigger = findTrigger();
            if (trigger !== null) trigger.click();
          }
          await waitFor(() => findMenu() === null, 800);
          return {
            ok: store.get().open === false,
            menuOpen: findMenu() !== null,
            dialogOpen: store.get().open === true,
          };
        };

        const selfTest = async () => {
          const report = {
            ok: false,
            steps: [],
            trigger: null,
            menuRows: [],
            injectedRow: null,
            dialog: null,
            menuClosedAfterOpen: null,
          };
          // 先保证弹窗是关闭的
          if (store.get().open === true) {
            store.set({ open: false });
            await waitFor(() => store.get().open === false, 800);
          }
          const trigger = findTrigger();
          if (trigger === null) {
            report.steps.push('model trigger not found');
            return report;
          }
          report.trigger = trigger.getAttribute('aria-label');
          report.steps.push('trigger found');
          trigger.click();
          const menu = await waitFor(findMenu);
          if (menu === null) {
            report.steps.push('model root menu did not open');
            return report;
          }
          report.steps.push('menu opened');
          report.menuRows = Array.from(menu.children)
            .filter((node) => node instanceof HTMLElement && node.matches('button[role="menuitem"]'))
            .map((node) => (node.textContent ?? '').trim());

          const row = await waitFor(() => menu.querySelector(`[${ROW_ATTR}]`));
          if (row === null) {
            report.steps.push('add-model row was not injected');
            return report;
          }
          report.steps.push('add-model row injected');
          const rect = row.getBoundingClientRect();
          report.injectedRow = {
            text: (row.textContent ?? '').trim(),
            tag: row.tagName,
            role: row.getAttribute('role'),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            isLastRow: row === menu.lastElementChild,
          };
          row.click();
          await waitFor(() => store.get().open === true, 1500);
          const dialog = await waitFor(
            () => document.querySelector('[data-testid="select-model-dialog"]'),
            2000,
          );
          if (dialog === null) {
            report.steps.push('dialog did not open');
            return report;
          }
          report.steps.push('dialog opened');
          report.menuClosedAfterOpen = findMenu() === null;
          await sleep(420); // 等 dsmPop 入场动画（scale .985）结束再量真实尺寸
          const dialogRect = dialog.getBoundingClientRect();
          const providers = Array.from(dialog.querySelectorAll('.dsm-provider'));
          const inputs = Array.from(dialog.querySelectorAll('input'));
          const buttons = Array.from(dialog.querySelectorAll('button'));
          report.dialog = {
            title: (dialog.querySelector('.dsm-title')?.textContent ?? '').trim(),
            description: (dialog.querySelector('.dsm-desc')?.textContent ?? '').trim(),
            width: Math.round(dialogRect.width),
            height: Math.round(dialogRect.height),
            top: Math.round(dialogRect.top),
            left: Math.round(dialogRect.left),
            providerCount: providers.length,
            providerNames: providers.map((node) =>
              (node.querySelector('.dsm-providerName')?.textContent ?? '').trim(),
            ),
            selectedProvider:
              (providers.find((node) => node.getAttribute('data-selected') === '1')
                ?.querySelector('.dsm-providerName')?.textContent ?? ''
              ).trim() || null,
            labels: Array.from(dialog.querySelectorAll('.dsm-label')).map((node) =>
              (node.textContent ?? '').trim(),
            ),
            inputs: inputs.map((node) => ({
              type: node.getAttribute('type'),
              placeholder: node.getAttribute('placeholder'),
            })),
            buttons: buttons
              .map((node) => (node.textContent ?? '').trim())
              .filter((text) => text !== ''),
            footerButtons: Array.from(dialog.querySelectorAll('.dsm-footer .dsm-btn')).map((node) => ({
              text: (node.textContent ?? '').trim(),
              variant: node.getAttribute('data-variant'),
              disabled: node.disabled === true,
            })),
            toastAfterSubmit: null,
          };
          // 收起弹窗，恢复现场
          store.set({ open: false });
          await waitFor(() => store.get().open === false, 800);
          report.ok = report.dialog.providerCount === PROVIDERS.length && report.menuClosedAfterOpen === true;
          report.steps.push('dialog closed');
          return report;
        };

        return ctx.effect(
          () =>
            registry.register({
              manifest: {
                id: 'SelectModel',
                description:
                  'dsh-plugin-select-model 的自检：确认模型菜单底部的「添加模型」行已注入、弹窗布局完整、管理弹窗的选择/高亮状态，并在结束时恢复现场；除 highlightProbe 只改界面高亮外均为只读。',
                methods: [
                  {
                    name: 'status',
                    description: '只读：当前注入行数量、菜单/弹窗是否打开、文案样例。',
                    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                    outputSchema: { description: '注入状态。' },
                  },
                  {
                    name: 'selfTest',
                    description:
                      '自动化自检：程序化打开模型菜单 → 检查「添加模型」行 → 点击打开弹窗 → 读取弹窗布局尺寸/服务商/字段/按钮 → 关闭弹窗恢复现场。',
                    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                    outputSchema: { description: '自检报告。' },
                  },
                  {
                    name: 'manage',
                    description:
                      '自动化：打开模型菜单并读取「已添加的第三方模型」列表；可传 action=edit/delete 试开编辑/删除弹窗（只打开不保存/不删除）。',
                    inputSchema: {
                      type: 'object',
                      properties: {
                        action: { type: 'string', description: 'none | prev | next | confirm | edit | delete（prev/next 翻页，confirm 点「确定」并确认弹窗已关；edit/delete 只打开弹窗，不保存/不删除），默认 none' },
                      },
                      additionalProperties: false,
                    },
                    outputSchema: { description: '管理区行、搜索框与弹窗内容。' },
                  },
                  {
                    name: 'selectionProbe',
                    description:
                      '只读：当前会话 id、用于高亮的模型选择（modelSelection 投影），以及 remote.session 是否可用。',
                    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                    outputSchema: { description: '会话与模型选择状态。' },
                  },
                  {
                    name: 'manageState',
                    description: '只读：读取当前已打开的管理弹窗（不打开/不关闭），检查每行的高亮、使用中标记与按钮状态。',
                    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                    outputSchema: { description: '管理弹窗每一行的当前状态。' },
                  },
                  {
                    name: 'highlightProbe',
                    description:
                      '调试：只改界面的「当前选择」高亮（不写 DSH 配置）；传 provider/model 模拟某一行在用，传 clear 恢复为会话真实选择。',
                    inputSchema: {
                      type: 'object',
                      properties: {
                        provider: { type: 'string', description: '模拟的 provider（配置 ID，如 sel-…）' },
                        model: { type: 'string', description: '模拟的模型 ID' },
                        clear: { type: 'boolean', description: '恢复为会话真实选择' },
                      },
                      additionalProperties: false,
                    },
                    outputSchema: { description: '当前高亮状态。' },
                  },
                  {
                    name: 'menu',
                    description: '自动化：只打开模型菜单并保持打开，供截图检查「添加模型」行的位置与样式（用 close 收起）。',
                    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                    outputSchema: { description: '菜单行与新增行的位置尺寸。' },
                  },
                  {
                    name: 'preview',
                    description:
                      '自动化：打开模型菜单并点进「添加模型」弹窗，保持打开状态，供截图或目视检查（用 close 收起）。可选切到某个服务商并打开模型下拉，验证模型列表。',
                    inputSchema: {
                      type: 'object',
                      properties: {
                        providerId: { type: 'string', description: '可选：切到某个服务商，如 openrouter / anthropic' },
                        openModels: { type: 'boolean', description: '可选：点开模型下列表并等待平台列表返回' },
                        direct: { type: 'boolean', description: '可选：绕过内置菜单直接打开弹窗（调试用）' },
                        openVia: { type: 'string', description: '可选：点击输入框(input)或箭头(button)展开模型列表，默认 button' },
                      },
                      additionalProperties: false,
                    },
                    outputSchema: { description: '打开结果、弹窗尺寸与模型选择器状态。' },
                  },
                  {
                    name: 'settingsProbe',
                    description: '只读：通过 remote.settings.describe 读取 llm-pi-ai 的 provider 列表与 revision（验证客户端能否直接读写模型服务配置）。',
                    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                    outputSchema: { description: 'llm-pi-ai 的 provider 摘要（不含密钥）。' },
                  },
                  {
                    name: 'directProbe',
                    description:
                      '直接验证「浏览器直连平台 /models」：不经过 Host 代理，验证 CORS 是否放行、归一化是否正确；默认用 OpenRouter 公开列表。',
                    inputSchema: {
                      type: 'object',
                      properties: {
                        providerId: { type: 'string', description: '服务商 id，默认 openrouter' },
                        protocol: { type: 'string', description: 'openai | google | openrouter，默认 openrouter' },
                        baseUrl: { type: 'string', description: '接口地址，默认 https://openrouter.ai/api/v1' },
                        apiKey: { type: 'string', description: '可选：仅用于这一次探测，不落盘' },
                      },
                      additionalProperties: false,
                    },
                    outputSchema: { description: '直连结果：耗时、数量与样例模型。' },
                  },
                  {
                    name: 'modelProbe',
                    description:
                      '直接调用 Host 的模型列表代理（GET /api/select-model/models 的 POST 版本），验证路由与归一化结果；默认用 OpenRouter 的公开列表，无需 Key。',
                    inputSchema: {
                      type: 'object',
                      properties: {
                        providerId: { type: 'string', description: '服务商 id，默认 openrouter' },
                        protocol: { type: 'string', description: 'openai | anthropic | google | openrouter，默认 openrouter' },
                        baseUrl: { type: 'string', description: '接口地址，默认 https://openrouter.ai/api/v1' },
                        apiKey: { type: 'string', description: '可选：仅用于这一次探测，不落盘' },
                      },
                      additionalProperties: false,
                    },
                    outputSchema: { description: '代理返回的状态、耗时、数量与样例模型。' },
                  },
                  {
                    name: 'close',
                    description: '自动化：收起「添加模型」弹窗与残留的模型菜单，恢复现场。',
                    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                    outputSchema: { description: '收起后的状态。' },
                  },
                ],
              },
              async query(method, input) {
                if (method === 'status') return status();
                if (method === 'selfTest') return selfTest();
                if (method === 'menu') return openMenu();
                if (method === 'preview') return openPreview(input);
                if (method === 'settingsProbe') return settingsProbe();
                if (method === 'manage') return manageProbe(input);
                if (method === 'manageState') return manageState();
                if (method === 'selectionProbe') return selectionProbe();
                if (method === 'highlightProbe') return highlightProbe(input);
                if (method === 'directProbe') return directProbe(input);
                if (method === 'modelProbe') return modelProbe(input);
                if (method === 'close') return closePreview();
                return { ok: false, error: `unknown-method:${method}` };
              },
            }),
          'select-model: inspect provider',
        );
      });
    }

    // ─────────────────────────────────────────────────────── 插件入口

    const plugin = {
      inject: ['slots', 'locale', 'sessions', 'remote', 'remote.settings', 'remote.credentials', 'remote.session'],
      /**
       * Client 插件主体：注册文案/样式、常驻弹窗宿主、模型菜单 DOM 增强、自检入口。
       * @param {object} ctx client 根上下文
       */
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'select-model: dictionaries');
        ctx.effect(() => ensureStyles(), 'select-model: styles');

        // 共享状态：菜单行点击 → 打开弹窗；提交 → 关闭 + Toast。
        // sessionId / selection 由 session 作用域插槽里的探针同步：前者用来调 selectModel，
        // 后者决定管理弹窗里哪一行高亮（「下次打开带高亮」就靠它，来自会话投影而非本地缓存）。
        const store = createStore({
          open: false,
          toast: null,
          editTarget: null,
          confirmTarget: null,
          manageOpen: false,
          manageVersion: 0,
          sessionId: undefined,
          selection: null,
        });
        let toastTimer = null;

        const showToast = (text) => {
          const id = Date.now() + Math.random();
          store.set({ toast: { id, text } });
          if (toastTimer !== null) window.clearTimeout(toastTimer);
          toastTimer = window.setTimeout(() => {
            const current = store.get().toast;
            if (current !== null && current.id === id) store.set({ toast: null });
            toastTimer = null;
          }, 3200);
        };
        ctx.effect(
          () => () => {
            if (toastTimer !== null) window.clearTimeout(toastTimer);
            toastTimer = null;
          },
          'select-model: toast timer',
        );

        // ── 当前会话与它的模型选择 ─────────────────────────────
        // 管理弹窗挂在 shell.overlay（root 作用域），拿不到 sessionId；这里在会话作用域的
        // 输入区插一个「只渲染 null」的探针，把 sessionId 与「当前生效的模型选择」同步进 store。
        // 高亮读的是会话自己的 modelSelection 投影，因此换会话 / 刷新页面 / 下次打开都一致。
        let sessionToken = 0;
        let releaseSession = () => {};

        /** 从 modelSelection 投影里取出当前生效的选择（优先下一轮生效的 next）。 */
        const selectionFromSnapshot = (snapshot) => {
          const picked = snapshot?.next ?? snapshot?.lastUsed ?? null;
          if (picked === null || picked === undefined) return null;
          if (typeof picked.provider !== 'string' || typeof picked.model !== 'string') return null;
          return { provider: picked.provider, model: picked.model };
        };

        /** 读某个会话当前生效的模型选择；投影不可用时返回 null（界面退化为不高亮）。 */
        const readSelection = (sessionId) => {
          try {
            const binding = ctx.sessions.binding(sessionId);
            const projected = binding?.session?.projections?.faceOf?.('modelSelection');
            return selectionFromSnapshot(projected?.getSnapshot?.());
          } catch {
            return null;
          }
        };

        /** 跟随一个会话：写入 sessionId + 当前选择，并订阅投影变化。返回释放函数。 */
        const followSession = (sessionId) => {
          releaseSession();
          const token = (sessionToken += 1);
          let unsubscribe = () => {};
          store.set({ sessionId, selection: readSelection(sessionId) });
          try {
            const binding = ctx.sessions.binding(sessionId);
            const projected = binding?.session?.projections?.faceOf?.('modelSelection');
            if (projected !== undefined && typeof projected.subscribe === 'function') {
              unsubscribe = projected.subscribe(() => {
                if (token !== sessionToken) return;
                store.set({ selection: readSelection(sessionId) });
              });
            }
          } catch {
            /* 订阅失败就退化成每次打开管理弹窗时现读 */
          }
          const release = () => {
            unsubscribe();
            if (token === sessionToken) {
              sessionToken += 1;
              store.set({ sessionId: undefined, selection: null });
            }
          };
          releaseSession = release;
          return release;
        };

        /** 只负责同步当前会话，不渲染任何东西。 */
        function SessionProbe({ sessionId }) {
          useEffect(() => followSession(sessionId), [sessionId]);
          return null;
        }

        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'select-model-session-probe',
              order: 900,
              inject: (sessionId) => ({ sessionId }),
            },
            SessionProbe,
          ),
        );

        /** 编辑一个已添加的模型（写回 llm-pi-ai；Key 留空保持不变）。 */
        function EditModelDialog({ target, onClose, onSaved }) {
          const [displayName, setDisplayName] = useState(target.displayName ?? '');
          const [modelId, setModelId] = useState(target.modelId ?? '');
          const [baseUrl, setBaseUrl] = useState(target.baseURL ?? '');
          const [apiKey, setApiKey] = useState('');
          const [busy, setBusy] = useState(false);
          const [error, setError] = useState(null);

          const save = async () => {
            if (busy) return;
            const trimmedModel = modelId.trim();
            const trimmedBase = baseUrl.trim();
            if (trimmedModel === '') {
              setError(t('add.err.missing-model'));
              return;
            }
            try {
              const parsed = new URL(trimmedBase);
              if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('bad');
            } catch {
              setError(t('add.err.invalid-base-url'));
              return;
            }
            setBusy(true);
            setError(null);
            try {
              const written = await mutateProviders([
                {
                  op: 'set',
                  path: ['providers', target.route],
                  value: {
                    displayName: displayName.trim() === '' ? target.route : displayName.trim(),
                    api: target.api || 'openai-completions',
                    baseURL: trimmedBase,
                    ...(target.apiKeyEnv === undefined ? {} : { apiKeyEnv: target.apiKeyEnv }),
                    models: [{ id: trimmedModel, name: trimmedModel }],
                  },
                },
              ]);
              if (written.ok !== true) {
                setError(t('add.err.settings-failed', { detail: written.error?.message ?? '' }));
                return;
              }
              if (apiKey.trim() !== '' && target.apiKeyEnv !== undefined) {
                const stored = await ctx.remote.credentials.set(target.apiKeyEnv, apiKey.trim());
                if (stored.ok !== true) {
                  setError(t('add.err.generic', { detail: stored.error?.message ?? 'credential-failed' }));
                  return;
                }
              }
              onSaved(trimmedModel);
            } catch {
              setError(t('add.err.network'));
            } finally {
              setBusy(false);
            }
          };

          const onKeyDown = (event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          };

          return h(
            'div',
            { className: 'dsm-root' },
            h('div', { className: 'dsm-mask', 'aria-hidden': 'true', onClick: onClose }),
            h(
              'div',
              {
                className: 'dsm-dialog',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': t('edit.title'),
                'data-testid': 'select-model-edit-dialog',
                onKeyDown,
              },
              h(
                'div',
                { className: 'dsm-content' },
                h(
                  'div',
                  { className: 'dsm-header' },
                  h('h2', { className: 'dsm-title' }, t('edit.title')),
                  h(
                    'button',
                    { type: 'button', className: 'dsm-close', 'aria-label': t('action.close'), onClick: onClose },
                    '×',
                  ),
                ),
                h('p', { className: 'dsm-desc' }, t('edit.desc')),
                h(
                  'div',
                  { className: 'dsm-body' },
                  error !== null
                    ? h('div', { className: 'dsm-submitError', role: 'alert' }, h('span', null, error))
                    : null,
                  h(
                    DsmField,
                    { label: t('edit.displayName') },
                    h(DsmInput, { value: displayName, onChange: setDisplayName, ariaLabel: t('edit.displayName') }),
                  ),
                  h(
                    DsmField,
                    { label: t('edit.model') },
                    h(DsmInput, { value: modelId, onChange: setModelId, ariaLabel: t('edit.model') }),
                  ),
                  h(
                    DsmField,
                    { label: t('edit.baseUrl') },
                    h(DsmInput, { value: baseUrl, onChange: setBaseUrl, ariaLabel: t('edit.baseUrl') }),
                  ),
                  h(
                    DsmField,
                    { label: t('edit.apiKey') },
                    h(DsmInput, {
                      value: apiKey,
                      onChange: setApiKey,
                      type: 'password',
                      placeholder: t('edit.apiKeyPlaceholder'),
                      ariaLabel: t('edit.apiKey'),
                    }),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'dsm-footer' },
                h(DsmButton, { variant: 'ghost', onClick: onClose, disabled: busy }, t('action.cancel')),
                h(DsmButton, { variant: 'primary', onClick: save, disabled: busy }, busy ? t('action.processing') : t('action.save')),
              ),
            ),
          );
        }

        /** 删除确认：删除 provider 配置与凭据，二次确认后执行。 */
        function ConfirmDeleteDialog({ target, onClose, onDeleted }) {
          const [busy, setBusy] = useState(false);
          const [error, setError] = useState(null);
          const remove = async () => {
            if (busy) return;
            setBusy(true);
            setError(null);
            try {
              const removed = await mutateProviders([
                { op: 'unset', path: ['providers', target.route] },
              ]);
              if (removed.ok !== true) {
                setError(t('add.err.generic', { detail: removed.error?.message ?? '' }));
                return;
              }
              if (target.apiKeyEnv !== undefined) {
                await ctx.remote.credentials.unset(target.apiKeyEnv).catch(() => {});
              }
              onDeleted(target);
            } catch (error) {
              setError(t('add.err.generic', { detail: String(error?.message ?? error) }));
            } finally {
              setBusy(false);
            }
          };
          return h(
            'div',
            { className: 'dsm-root' },
            h('div', { className: 'dsm-mask', 'aria-hidden': 'true', onClick: onClose }),
            h(
              'div',
              {
                className: 'dsm-dialog',
                role: 'alertdialog',
                'aria-modal': 'true',
                'aria-label': t('confirm.title'),
                'data-testid': 'select-model-confirm-dialog',
              },
              h(
                'div',
                { className: 'dsm-content' },
                h(
                  'div',
                  { className: 'dsm-header' },
                  h('h2', { className: 'dsm-title' }, t('confirm.title')),
                  h(
                    'button',
                    { type: 'button', className: 'dsm-close', 'aria-label': t('action.close'), onClick: onClose },
                    '×',
                  ),
                ),
                h('p', { className: 'dsm-desc' }, t('confirm.desc', { name: target.displayName, route: target.route })),
                error !== null
                  ? h(
                      'div',
                      { className: 'dsm-body' },
                      h('div', { className: 'dsm-submitError', role: 'alert' }, h('span', null, error)),
                    )
                  : null,
              ),
              h(
                'div',
                { className: 'dsm-footer' },
                h(DsmButton, { variant: 'ghost', onClick: onClose, disabled: busy }, t('confirm.cancel')),
                h(DsmButton, { variant: 'danger', onClick: remove, disabled: busy }, busy ? t('action.processing') : t('confirm.delete')),
              ),
            ),
          );
        }

        /** 「已添加的第三方模型」管理弹窗：搜索 + 列表 + 选择/编辑/删除。 */
        function ManageDialog({ onClose }) {
          const version = useStoreValue(store, (state) => state.manageVersion);
          const selection = useStoreValue(store, (state) => state.selection);
          const [items, setItems] = useState(null);
          const [query, setQuery] = useState('');
          const [busyRoute, setBusyRoute] = useState(null);
          const [page, setPage] = useState(0);

          useEffect(() => {
            let alive = true;
            loadAdded()
              .then((list) => {
                if (alive) {
                  setItems(list);
                  // 编辑/删除后重新加载：回到第 1 页，避免停在越界的旧页码上。
                  setPage(0);
                }
              })
              .catch(() => {
                if (alive) setItems([]);
              });
            return () => {
              alive = false;
            };
          }, [version]);

          // 打开时再对一次投影：探针可能还没挂（例如刚刷新页面就点进来）。
          useEffect(() => {
            const sessionId = store.get().sessionId;
            if (sessionId !== undefined) store.set({ selection: readSelection(sessionId) });
          }, []);

          const isCurrent = (item) =>
            selection !== null && selection.provider === item.route && selection.model === item.modelId;

          /** 把当前会话切到这一项；失败按错误码给出可读原因。 */
          const choose = async (item) => {
            if (busyRoute !== null) return;
            const sessionId = store.get().sessionId;
            if (sessionId === undefined) {
              showToast(t('select.noSession'));
              return;
            }
            if (typeof ctx.remote?.session?.selectModel !== 'function') {
              showToast(t('select.unavailable'));
              return;
            }
            setBusyRoute(item.route);
            try {
              // 通过 remote 对象调用，保留它的 this（remote face 的方法不是脱离对象也能调用的函数）。
              const result = await ctx.remote.session.selectModel({
                sessionId,
                provider: item.route,
                model: item.modelId,
              });
              if (result?.ok === true) {
                store.set({ selection: { provider: item.route, model: item.modelId } });
                showToast(t('toast.selected', { model: item.displayName }));
                // 切换成功即收工：关掉弹窗，下次打开时高亮会落在刚选的这一行。
                onClose();
                return;
              }
              const code = result?.error?.code ?? '';
              const detail = result?.error?.message ?? '';
              if (code === 'session/writer-held') showToast(t('select.writerHeld'));
              else if (code === 'session/model-unavailable') showToast(t('select.modelUnavailable'));
              else if (code === 'session/not-found') showToast(t('select.sessionLost'));
              else showToast(t('select.failed', { detail: detail || code || 'unknown' }));
            } catch (error) {
              showToast(t('select.failed', { detail: String(error?.message ?? error) }));
            } finally {
              setBusyRoute(null);
            }
          };

          const needle = query.trim().toLowerCase();
          const filtered =
            items === null
              ? []
              : needle === ''
                ? items
                : items.filter((item) =>
                    `${item.displayName} ${item.modelId} ${item.baseURL}`.toLowerCase().includes(needle),
                  );
          const PAGE_SIZE = 5;
          const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
          // 删除/搜索后总页数会变，越界时夹到最后一页而不是显示空页。
          const currentPage = Math.min(page, pageCount - 1);
          const pageItems = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

          const renderRow = (item) => {
            const current = isCurrent(item);
            const busy = busyRoute === item.route;
            return h(
              'div',
              {
                className: 'dsm-manageRow',
                key: item.route,
                'data-current': current ? '1' : undefined,
                'data-testid': 'select-model-manage-row',
              },
              h(
                'div',
                { className: 'dsm-manageMain' },
                h(
                  'div',
                  { className: 'dsm-manageTitle' },
                  h('span', { className: 'dsm-manageName', title: item.displayName }, item.displayName),
                  current ? h('span', { className: 'dsm-manageBadge' }, t('manage.current')) : null,
                ),
                h('span', { className: 'dsm-manageSub', title: item.modelId }, item.modelId || item.baseURL),
              ),
              h(
                'div',
                { className: 'dsm-manageActions' },
                h(
                  DsmButton,
                  {
                    size: 'sm',
                    variant: current ? 'ghost' : 'primary',
                    disabled: current || busyRoute !== null,
                    'data-action': 'select',
                    onClick: () => void choose(item),
                  },
                  current ? t('manage.selected') : busy ? t('manage.selecting') : t('manage.select'),
                ),
                h(
                  DsmButton,
                  {
                    size: 'sm',
                    variant: 'ghost',
                    'data-action': 'edit',
                    onClick: () => store.set({ editTarget: item }),
                  },
                  t('manage.edit'),
                ),
                h(
                  DsmButton,
                  {
                    size: 'sm',
                    variant: 'danger',
                    'data-action': 'delete',
                    onClick: () => store.set({ confirmTarget: item }),
                  },
                  t('manage.delete'),
                ),
              ),
            );
          };

          return h(
            'div',
            { className: 'dsm-root' },
            h('div', { className: 'dsm-mask', 'aria-hidden': 'true', onClick: onClose }),
            h(
              'div',
              {
                className: 'dsm-dialog',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': t('manage.title'),
                'data-testid': 'select-model-manage-dialog',
              },
              h(
                'div',
                { className: 'dsm-content' },
                h(
                  'div',
                  { className: 'dsm-header' },
                  h('h2', { className: 'dsm-title' }, t('manage.title')),
                  h(
                    'button',
                    { type: 'button', className: 'dsm-close', 'aria-label': t('action.close'), onClick: onClose },
                    '×',
                  ),
                ),
                h(
                  'div',
                  { className: 'dsm-manageBody' },
                  h(DsmInput, {
                    value: query,
                    onChange: (value) => {
                      setQuery(value);
                      setPage(0);
                    },
                    placeholder: t('manage.search'),
                    ariaLabel: t('manage.search'),
                  }),
                  items === null
                    ? h('div', { className: 'dsm-manageEmpty' }, t('manage.loading'))
                    : filtered.length === 0
                      ? h('div', { className: 'dsm-manageEmpty' }, t('manage.empty'))
                      : h(
                          'div',
                          { className: 'dsm-manageList', 'data-page': String(currentPage + 1) },
                          pageItems.map(renderRow),
                        ),
                ),
              ),
              h(
                'div',
                { className: 'dsm-footer dsm-manageFooter' },
                h(
                  'div',
                  { className: 'dsm-pager' },
                  h(
                    DsmButton,
                    {
                      size: 'sm',
                      variant: 'ghost',
                      'data-action': 'prev',
                      disabled: currentPage <= 0,
                      onClick: () => setPage(currentPage - 1),
                    },
                    t('manage.prev'),
                  ),
                  h(
                    'span',
                    { className: 'dsm-pagerLabel', 'data-testid': 'select-model-manage-pager' },
                    t('manage.page', { page: currentPage + 1, total: pageCount }),
                  ),
                  h(
                    DsmButton,
                    {
                      size: 'sm',
                      variant: 'ghost',
                      'data-action': 'next',
                      disabled: currentPage >= pageCount - 1,
                      onClick: () => setPage(currentPage + 1),
                    },
                    t('manage.next'),
                  ),
                ),
                h(
                  DsmButton,
                  { variant: 'primary', 'data-action': 'confirm', onClick: onClose },
                  t('manage.confirm'),
                ),
              ),
            ),
          );
        }

        /** 常驻 overlay 宿主：弹窗 + 状态条。 */
        function DialogHost() {
          const open = useStoreValue(store, (state) => state.open);
          const toast = useStoreValue(store, (state) => state.toast);
          const editTarget = useStoreValue(store, (state) => state.editTarget);
          const confirmTarget = useStoreValue(store, (state) => state.confirmTarget);
          const manageOpen = useStoreValue(store, (state) => state.manageOpen);
          // 热更新会换掉插件实例：把上一次实例遗留在 body 里的 portal / 弹窗清掉，
          // 避免出现「旧下拉盖住新下拉」这种只在开发时可见的残影。
          useEffect(() => {
            document
              .querySelectorAll('.dsm-modelMenu, .dsm-root, .dsm-toast')
              .forEach((node) => node.remove());
          }, []);
          return h(
            Fragment,
            null,
            editTarget !== null
              ? h(EditModelDialog, {
                  target: editTarget,
                  onClose: () => store.set({ editTarget: null }),
                  onSaved: (model) => {
                    store.set((state) => ({
                      ...state,
                      editTarget: null,
                      manageOpen: true,
                      manageVersion: state.manageVersion + 1,
                    }));
                    bridge.refresh();
                    showToast(t('toast.updated', { model }));
                  },
                })
              : confirmTarget !== null
                ? h(ConfirmDeleteDialog, {
                    target: confirmTarget,
                    onClose: () => store.set({ confirmTarget: null }),
                    onDeleted: (target) => {
                      store.set((state) => ({
                        ...state,
                        confirmTarget: null,
                        manageOpen: true,
                        manageVersion: state.manageVersion + 1,
                      }));
                      bridge.refresh();
                      showToast(t('toast.deleted', { model: target.displayName }));
                    },
                  })
                : manageOpen
                  ? h(ManageDialog, {
                      onClose: () => store.set({ manageOpen: false }),
                    })
                  : h(AddModelDialog, {
                      open,
                      t,
                      onClose: () => store.set({ open: false }),
                      onSubmit: (draft) => {
                        writeDraft(draft);
                        store.set({ open: false });
                        bridge.refresh();
                        showToast(t('toast.added', { model: draft.modelName || draft.providerName }));
                      },
                    }),
            toast !== null
              ? h(DsmToast, {
                  key: toast.id,
                  text: toast.text,
                  onDone: () => {
                    const current = store.get().toast;
                    if (current !== null && current.id === toast.id) store.set({ toast: null });
                  },
                })
              : null,
          );
        }

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'select-model-dialog', order: 55 },
            DialogHost,
          ),
        );

        /** 写入 llm-pi-ai：客户端 Remote 信封要求第 3 个参数（revision），先 describe 再写，冲突时重试一次。 */
        const mutateProviders = async (ops) => {
          const readRevision = async () => {
            const described = await ctx.remote.settings.describe();
            if (described.ok !== true) {
              throw new Error(described.error?.message ?? 'describe-failed');
            }
            const namespace = (described.value?.namespaces ?? []).find((item) => item?.ns === 'llm-pi-ai');
            if (namespace === undefined) throw new Error('namespace-missing');
            return typeof namespace.revision === 'number' ? namespace.revision : 0;
          };
          let revision = await readRevision();
          let response = await ctx.remote.settings.mutate('llm-pi-ai', ops, revision);
          if (response.ok !== true && response.error?.code === 'settings/conflict') {
            revision = await readRevision();
            response = await ctx.remote.settings.mutate('llm-pi-ai', ops, revision);
          }
          return response;
        };

        /** 读取「本插件写入的第三方模型」列表（route 以 sel- 开头）。 */
        const loadAdded = async () => {
          try {
            const response = await ctx.remote.settings.describe();
            const namespaces = response.ok === true ? (response.value?.namespaces ?? []) : [];
            const namespace = namespaces.find((item) => item?.ns === 'llm-pi-ai');
            const providers = namespace?.value?.providers;
            if (providers === null || typeof providers !== 'object') return [];
            const items = [];
            for (const [route, profile] of Object.entries(providers)) {
              if (!route.startsWith('sel-') || profile === null || typeof profile !== 'object') continue;
              const firstModel = Array.isArray(profile.models) ? profile.models[0] : undefined;
              items.push({
                route,
                displayName:
                  typeof profile.displayName === 'string' && profile.displayName !== ''
                    ? profile.displayName
                    : route,
                modelId: typeof firstModel?.id === 'string' ? firstModel.id : '',
                modelLabel: typeof firstModel?.name === 'string' ? firstModel.name : '',
                baseURL: typeof profile.baseURL === 'string' ? profile.baseURL : '',
                api: typeof profile.api === 'string' ? profile.api : 'openai-completions',
                apiKeyEnv: typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : undefined,
              });
            }
            return items.sort((left, right) => left.displayName.localeCompare(right.displayName));
          } catch {
            return [];
          }
        };
        const bridge = { refresh: () => {} };

        // 内置模型菜单没有扩展槽位：用 DOM 增强补「添加模型」行 + 已添加列表。
        ctx.effect(
          () => installMenuBridge(store, t, { loadAdded, bridge }),
          'select-model: model menu bridge',
        );

        // 只读自检入口（cordis_inspect_query → client provider "SelectModel"）。
        installInspectProvider(ctx, store, t);
      },
    };

    return plugin;
  },
});
