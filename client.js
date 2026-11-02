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
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
    const h = React.createElement;
    const Fragment = React.Fragment;

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
      'field.modelPlaceholder': '可选，例如 gpt-4o',
      'tag.optional': '可选',

      'action.cancel': '取消',
      'action.add': '添加模型',
      'action.reveal': '显示',
      'action.hide': '隐藏',
      'action.close': '关闭',

      'hint.localOnly': 'API Key 只会保存在本机，不会上传到任何服务器。',
      'note.preview': '界面布局预览：模型接入逻辑将在下一步实现。',
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
      'field.model': 'Model name',
      'field.modelPlaceholder': 'Optional, e.g. gpt-4o',
      'tag.optional': 'Optional',

      'action.cancel': 'Cancel',
      'action.add': 'Add model',
      'action.reveal': 'Show',
      'action.hide': 'Hide',
      'action.close': 'Close',

      'hint.localOnly': 'The API key stays on this machine and is never uploaded.',
      'note.preview': 'Layout preview: the model wiring lands in the next step.',
      'toast.saved': 'Draft saved (model wiring is not implemented yet)',
    };

    // ─────────────────────────────────────────────────────── 服务商预设

    /**
     * 第三方服务商预设。badge/color 只用于弹窗里的小色块，不复制任何品牌图标。
     * @type {ReadonlyArray<{id:string,name:string,hintKey:string,baseUrl:string,keyPlaceholder:string,color:string,badge:string}>}
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
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        hintKey: 'provider.anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        keyPlaceholder: 'sk-ant-…',
        color: '#d97757',
        badge: 'A',
      },
      {
        id: 'google',
        name: 'Google Gemini',
        hintKey: 'provider.google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        keyPlaceholder: 'AIza…',
        color: '#4285f4',
        badge: 'G',
      },
      {
        id: 'deepseek',
        name: 'DeepSeek',
        hintKey: 'provider.deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        keyPlaceholder: 'sk-…',
        color: '#4d6bfe',
        badge: 'D',
      },
      {
        id: 'dashscope',
        name: '阿里云百炼',
        hintKey: 'provider.dashscope',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        keyPlaceholder: 'sk-…',
        color: '#ff6a00',
        badge: '百',
      },
      {
        id: 'zhipu',
        name: '智谱 GLM',
        hintKey: 'provider.zhipu',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        keyPlaceholder: '…',
        color: '#3859ff',
        badge: '智',
      },
      {
        id: 'moonshot',
        name: 'Moonshot Kimi',
        hintKey: 'provider.moonshot',
        baseUrl: 'https://api.moonshot.cn/v1',
        keyPlaceholder: 'sk-…',
        color: '#1f1f1f',
        badge: 'K',
      },
      {
        id: 'siliconflow',
        name: '硅基流动',
        hintKey: 'provider.siliconflow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        keyPlaceholder: 'sk-…',
        color: '#7c4dff',
        badge: '硅',
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        hintKey: 'provider.openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyPlaceholder: 'sk-or-…',
        color: '#6467f2',
        badge: 'R',
      },
      {
        id: 'custom',
        name: '自定义',
        hintKey: 'provider.custom',
        baseUrl: '',
        keyPlaceholder: 'sk-…',
        color: '#6b7280',
        badge: '+',
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
.dsm-body{display:flex;flex-direction:column;gap:18px;margin-top:20px;padding:0 24px;min-height:0;overflow-y:auto;max-height:min(64vh,540px)}
.dsm-note{display:flex;align-items:flex-start;gap:6px;padding:7px 10px;border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.10));color:var(--dsw-alias-label-secondary,#a3a3a3);font-size:12px;line-height:18px}
.dsm-noteMark{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dsm-section{display:flex;flex-direction:column;min-width:0}
.dsm-sectionTitle{margin:0 0 8px;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary,#a3a3a3)}
.dsm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.dsm-provider{position:relative;display:flex;align-items:center;gap:8px;box-sizing:border-box;min-height:52px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;text-align:left;cursor:pointer;transition:background .12s ease,border-color .12s ease}
.dsm-provider:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dsm-provider:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.dsm-provider[data-selected="1"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary,#4d6bfe)}
.dsm-providerBadge{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:8px;color:#fff;font-size:11px;font-weight:600;line-height:1}
.dsm-providerText{display:flex;flex-direction:column;min-width:0}
.dsm-providerName{font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-providerHint{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8a8a8a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-providerCheck{position:absolute;top:5px;right:6px;color:var(--dsw-alias-brand-primary,#4d6bfe);font-size:11px;line-height:1}
.dsm-field{display:flex;flex-direction:column;gap:6px;margin-top:12px}
.dsm-field:first-child{margin-top:0}
.dsm-row2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}
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

    /** 写入本地草稿（布局阶段只做留存，不参与真实接入）。 */
    function writeDraft(draft) {
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
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

      return () => {
        disposed = true;
        if (observer !== null) observer.disconnect();
        observer = null;
        document.querySelectorAll(`[${ROW_ATTR}]`).forEach((node) => node.remove());
        document.querySelectorAll(`[${DIVIDER_ATTR}]`).forEach((node) => node.remove());
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
    function DsmInput({ value, onChange, type = 'text', placeholder, ariaLabel, inputRef }) {
      return h(
        'span',
        { className: 'dsm-input' },
        h('input', {
          ref: inputRef,
          className: 'dsm-inputInner',
          type,
          value,
          placeholder,
          'aria-label': ariaLabel,
          spellCheck: false,
          autoComplete: 'off',
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
              h(DsmInput, {
                value: modelName,
                onChange: setModelName,
                placeholder: t('field.modelPlaceholder'),
                ariaLabel: t('field.model'),
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

        const status = () => ({
          plugin: NS,
          hasDocument: typeof document !== 'undefined',
          injectedRows: document.querySelectorAll(`[${ROW_ATTR}]`).length,
          menuOpen: findMenu() !== null,
          dialogOpen: store.get().open === true,
          menuLabels: MODEL_MENU_LABELS,
          addLabel: t('menu.add'),
        });

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
        const openPreview = async () => {
          if (store.get().open === true) {
            return { ok: true, alreadyOpen: true };
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
          const rect = dialog.getBoundingClientRect();
          const body = dialog.querySelector('.dsm-body');
          const hint = dialog.querySelector('.dsm-hint');
          return {
            ok: true,
            menuRows,
            rowText: (row.textContent ?? '').trim(),
            dialog: {
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              bodyScrollHeight: body === null ? null : body.scrollHeight,
              bodyClientHeight: body === null ? null : body.clientHeight,
              hintVisible:
                hint === null ? null : hint.getBoundingClientRect().bottom <= rect.bottom - 24,
            },
          };
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
                    description: '自动化：打开模型菜单并点进「添加模型」弹窗，保持打开状态，供截图或目视检查（用 close 收起）。',
                    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                    outputSchema: { description: '打开结果与弹窗尺寸。' },
                  },
                  {
                    name: 'close',
                    description: '自动化：收起「添加模型」弹窗与残留的模型菜单，恢复现场。',
                    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                    outputSchema: { description: '收起后的状态。' },
                  },
                ],
              },
              async query(method) {
                if (method === 'status') return status();
                if (method === 'selfTest') return selfTest();
                if (method === 'menu') return openMenu();
                if (method === 'preview') return openPreview();
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
