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
      'dialog.desc': '连接第三方模型服务：选择服务商并填写 API Key，即可在模型菜单中使用。',

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

      'model.loading': '正在从平台获取模型列表…',
      'model.live': '来自平台 · 共 {n} 个模型',
      'model.fallback': '常用模型 · 填写 API Key 后自动获取平台列表',
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

      'hint.localOnly': 'API Key 只在本次请求中经本机转发，不落盘、不上传到第三方以外的地方。',
      'note.preview': '模型列表会从所选平台实时获取；获取失败时展示常用模型，也可以手动输入。',
      'toast.saved': '已保存配置草稿（模型接入尚未实现）',
    };

    /** English，键集与中文一致。 */
    const EN = {
      'menu.add': 'Add model',
      'menu.addHint': 'Third-party / Custom',

      'dialog.title': 'Add a model',
      'dialog.desc': 'Connect a third-party model service: pick a provider and enter its API key to use it from the model menu.',

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

      'model.loading': 'Fetching the model list from the provider…',
      'model.live': 'Live from provider · {n} models',
      'model.fallback': 'Common models · enter an API key to fetch the live list',
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

      'hint.localOnly': 'The API key is only relayed through this machine for this request; it is not persisted.',
      'note.preview': 'The model list is fetched live from the selected provider; when that fails, common models are shown and you can type your own.',
      'toast.saved': 'Draft saved (model wiring is not implemented yet)',
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
    function installMenuBridge(store, t) {
      if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return () => {};

      let disposed = false;
      let scheduled = false;
      let observer = null;
      /** 本实例的标记：清理时只删自己注入的节点，避免 HMR 重载时新旧实例互删。 */
      const owner = Math.random().toString(36).slice(2, 10);

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

      /** 关闭内置菜单：优先点一次它的触发按钮（等价于再点一次），失败再派发 Escape。 */
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

      /** 给一个刚打开的根菜单补齐分隔线 + 添加模型行。 */
      const injectInto = (menu) => {
        if (disposed) return false;
        if (menu.querySelector(`:scope > [${ROW_ATTR}]`) !== null) return true;

        const cells = [];
        for (const node of menu.children) {
          if (node instanceof HTMLElement && node.matches('button[role="menuitem"]')) cells.push(node);
        }
        if (cells.length === 0) return false;

        const template = cells[cells.length - 1];
        const row = template.cloneNode(true);
        if (!(row instanceof HTMLElement)) return false;
        row.removeAttribute('id');
        row.removeAttribute('disabled');
        row.removeAttribute('aria-disabled');
        row.setAttribute(ROW_ATTR, '');
        row.setAttribute('data-dsm-owner', owner);
        row.setAttribute('data-testid', 'select-model-add-row');

        const spans = Array.from(row.children).filter(
          (node) => node instanceof HTMLElement && node.tagName === 'SPAN',
        );
        if (spans[0] !== undefined) spans[0].textContent = t('menu.add');
        if (spans[1] !== undefined) spans[1].textContent = t('menu.addHint');

        row.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          try {
            closeBuiltInMenu(menu);
          } catch {
            /* 关不掉也不影响打开弹窗 */
          }
          store.set({ open: true });
        });

        const divider = document.createElement('div');
        divider.setAttribute(DIVIDER_ATTR, '');
        divider.setAttribute('data-dsm-owner', owner);
        divider.style.cssText =
          'flex:none;height:1px;margin:4px 8px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.28))';

        menu.append(divider, row);
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
        document.querySelectorAll(`[${DIVIDER_ATTR}][data-dsm-owner="${owner}"]`).forEach((node) => node.remove());
      };
    }

    // ─────────────────────────────────────────────────────── 小型基础组件

    /** 主题化文本按钮（等价于内置 Button 的 primary/ghost + md/sm）。 */
    function DsmButton({ variant = 'ghost', size = 'md', disabled, onClick, type = 'button', children }) {
      return h(
        'button',
        {
          type,
          className: 'dsm-btn',
          'data-variant': variant,
          'data-size': size,
          disabled: disabled === true,
          onClick,
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
      const [menuRect, setMenuRect] = useState(null);
      const anchorRef = useRef(null);
      const menuRef = useRef(null);
      const searchRef = useRef(null);
      const requestSeq = useRef(0);
      const listId = 'dsm-model-list';

      const source = models ?? provider.fallbackModels;
      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (needle === '') return source;
        return source.filter((item) => `${item.id} ${item.label ?? ''}`.toLowerCase().includes(needle));
      }, [source, query]);

      /** 询问 Host 代理：按当前服务商 / 地址 / Key 拉取平台模型列表。 */
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
        try {
          const response = await fetch(MODELS_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              providerId: provider.id,
              protocol: provider.protocol,
              baseUrl: trimmedBase,
              apiKey: apiKey.trim(),
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

      // 列表较长时把焦点放进搜索框，方便直接筛。
      useEffect(() => {
        if (!open || source.length <= 10) return undefined;
        const timer = window.setTimeout(() => {
          searchRef.current?.focus();
        }, 40);
        return () => {
          window.clearTimeout(timer);
        };
      }, [open, source.length]);

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
      const statusText = isCustom
        ? t('model.customHint')
        : loading
          ? t('model.loading')
          : hardError
            ? t('model.failed', { reason: describeModelError(t, errorCode) })
            : models !== null
              ? t('model.live', { n: models.length })
              : t('model.fallback');
      const statusTone = !loading && hardError ? 'error' : models !== null && !loading ? 'live' : undefined;

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
                  h(
                    'span',
                    { className: 'dsm-modelHeadText' },
                    loading
                      ? t('model.loading')
                      : models !== null
                        ? t('model.live', { n: models.length })
                        : t('model.fallback'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsm-modelRefresh',
                      onClick: () => {
                        void fetchModels();
                      },
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
      const canAdd = apiKey.trim() !== '' && (provider.id !== 'custom' || baseUrl.trim() !== '');

      if (!open) return null;

      const chooseProvider = (next) => {
        setProviderId(next.id);
        // 服务商换了，模型 ID 一定不能沿用上一个平台的。
        setModelName('');
        if (next.id !== 'custom') setBaseUrl(next.baseUrl);
      };

      const submit = () => {
        if (!canAdd) return;
        onSubmit({
          providerId,
          providerName: provider.name,
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim(),
          modelName: modelName.trim(),
        });
      };

      /** Enter 提交（焦点在输入框时）；按钮自身的 Enter 走原生 click，避免重复提交。 */
      const onDialogKeyDown = (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        const target = event.target;
        if (target instanceof HTMLElement && target.closest('button') !== null) return;
        if (!canAdd) return;
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
              { variant: 'primary', disabled: !canAdd, onClick: submit },
              t('action.add'),
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
          };
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
          if (store.get().open === true) {
            store.set({ open: false });
            await waitFor(() => store.get().open === false, 800);
          }
          const trigger = findTrigger();
          if (trigger === null) return { ok: false, reason: 'model-trigger-not-found' };
          trigger.click();
          const menu = await waitFor(findMenu);
          if (menu === null) return { ok: false, reason: 'model-menu-not-opened' };
          const menuRows = Array.from(menu.children)
            .filter((node) => node instanceof HTMLElement && node.matches('button[role="menuitem"]'))
            .map((node) => (node.textContent ?? '').trim());
          const row = await waitFor(() => menu.querySelector(`[${ROW_ATTR}]`));
          if (row === null) return { ok: false, reason: 'add-model-row-not-injected', menuRows };
          row.click();
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
            tone: pickerStatusNode?.getAttribute('data-tone') ?? null,
            modelValue: modelInput instanceof HTMLInputElement ? modelInput.value : null,
            hasDropdown: dialog.querySelector('.dsm-modelBtn') !== null,
            dropdownOpen: false,
            searchVisible: false,
            itemCount: 0,
            items: [],
          };
          if (openModels) {
            const button = dialog.querySelector('.dsm-modelBtn');
            if (button instanceof HTMLElement) {
              button.click();
              await waitFor(
                () => {
                  const menuNode = document.querySelector('.dsm-modelMenu');
                  if (menuNode === null) return null;
                  const items = menuNode.querySelectorAll('.dsm-modelItem').length;
                  const statusNode = dialog.querySelector('.dsm-modelStatus');
                  const status = (statusNode?.textContent ?? '').trim();
                  const failed = status.includes('失败') || status.includes('failed');
                  return items > 0 || failed ? true : null;
                },
                8000,
              );
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
            rowText: (row.textContent ?? '').trim(),
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
          store.set({ open: false });
          await waitFor(() => store.get().open === false, 800);
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
                  'dsh-plugin-select-model 的只读自检：确认模型菜单底部的「添加模型」行已注入、点击后弹窗布局完整，并在结束时恢复现场。',
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
                      },
                      additionalProperties: false,
                    },
                    outputSchema: { description: '打开结果、弹窗尺寸与模型选择器状态。' },
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
      inject: ['slots', 'locale'],
      /**
       * Client 插件主体：注册文案/样式、常驻弹窗宿主、模型菜单 DOM 增强、自检入口。
       * @param {object} ctx client 根上下文
       */
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'select-model: dictionaries');
        ctx.effect(() => ensureStyles(), 'select-model: styles');

        // 共享状态：菜单行点击 → 打开弹窗；提交 → 关闭 + Toast。
        const store = createStore({ open: false, toast: null });
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

        /** 常驻 overlay 宿主：弹窗 + 状态条。 */
        function DialogHost() {
          const open = useStoreValue(store, (state) => state.open);
          const toast = useStoreValue(store, (state) => state.toast);
          return h(
            Fragment,
            null,
            h(AddModelDialog, {
              open,
              t,
              onClose: () => store.set({ open: false }),
              onSubmit: (draft) => {
                writeDraft(draft);
                store.set({ open: false });
                showToast(t('toast.saved'));
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

        // 内置模型菜单没有扩展槽位：用 DOM 增强补一行。
        ctx.effect(() => installMenuBridge(store, t), 'select-model: model menu bridge');

        // 只读自检入口（cordis_inspect_query → client provider "SelectModel"）。
        installInspectProvider(ctx, store, t);
      },
    };

    return plugin;
  },
});
