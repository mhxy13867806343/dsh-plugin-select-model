/**
 * dsh-plugin-select-model —— Host 半边。
 *
 * 提供两个同源 Fetch 路由（走 `connection.fetch`，自动带浏览器鉴权）：
 *   GET  /api/select-model/health  → 路由可达性自检
 *   POST /api/select-model/models  → 代查第三方服务商的模型列表
 *
 * 为什么需要 Host 代查：浏览器受同源策略限制，直接请求各家 `/models`
 * 基本都拿不到（没有 CORS 头）。这个代理只在内存里使用一次 API Key，
 * **不落盘、不写日志、不回显**；响应只返回 { id, label } 列表。
 *
 * 支持四种平台协议：
 *   openai      Authorization: Bearer <key>   GET {base}/models   → { data: [...] }
 *   openrouter  Authorization: Bearer <key>   GET {base}/models   → { data: [...] }（列表公开）
 *   anthropic   x-api-key: <key> + anthropic-version  → { data: [...] }
 *   google      ?key=<key>                    GET {base}/models   → { models: [...] }
 */

export const name = 'select-model';
export const inject = ['connection', 'settings', 'credentials'];

const ROUTE_MODELS = '/api/select-model/models';
const ROUTE_HEALTH = '/api/select-model/health';
const ROUTE_ADD = '/api/select-model/add';
const ROUTE_STATE = '/api/select-model/state';
const ROUTE_REMOVE = '/api/select-model/remove';
const PROVIDER_NS = 'llm-pi-ai';
const PROTOCOLS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages']);
const MAX_BODY = 64 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_MODELS = 500;
const PLUGIN_NAME = 'dsh-plugin-select-model';

// 供本机脚本做无 UI 的逻辑自测（导入本模块不会启动路由）。
export { fetchModels, normalizeModels, normalizeBaseUrl, handleAdd, handleState, handleRemove };

/**
 * 安装两条路由；清理函数由 effect 生命周期托管。
 * @param {object} ctx Host 插件上下文
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ROUTE_HEALTH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async () => json(200, { ok: true, plugin: PLUGIN_NAME, route: ROUTE_MODELS }),
      }),
    'select-model: health route',
  );
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ROUTE_MODELS,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => handleModels(request),
      }),
    'select-model: models route',
  );
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ROUTE_ADD,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => handleAdd(ctx, request),
      }),
    'select-model: add route',
  );
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ROUTE_STATE,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async () => handleState(ctx),
      }),
    'select-model: state route',
  );
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ROUTE_REMOVE,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => handleRemove(ctx, request),
      }),
    'select-model: remove route',
  );
}

/** 读取并解析 JSON body；失败返回 undefined。 */
async function readJson(request) {
  const text = await request.text().catch(() => '');
  if (text.length > MAX_BODY) return undefined;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** 生成一个合法且不会撞车的 provider route id。 */
function newRouteId(providerId) {
  const stem = String(providerId || 'custom')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const safe = /^[a-z]/.test(stem) ? stem : `p-${stem}`;
  const suffix = Math.random().toString(36).slice(2, 6);
  return `sel-${safe}-${suffix}`;
}

/** 由 route 推导凭据引用（与 settings-models 的 deriveKeyRef 同规则）。 */
function keyRefOf(route) {
  return route.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

/**
 * 新增一个模型服务：写入 llm-pi-ai 的 providers.<route>，并把 Key 存进 DSH 凭据库。
 * 成功后模型会在下一次打开模型菜单时出现在该服务商分组里。
 */
async function handleAdd(ctx, request) {
  const payload = await readJson(request);
  if (payload === undefined) return json(400, { ok: false, error: 'invalid-body' });

  const baseUrl = normalizeBaseUrl(payload.baseUrl);
  if (baseUrl === null) return json(400, { ok: false, error: 'invalid-base-url' });
  const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
  if (apiKey === '') return json(400, { ok: false, error: 'missing-api-key' });
  const modelId = typeof payload.modelId === 'string' ? payload.modelId.trim().slice(0, 200) : '';
  if (modelId === '') return json(400, { ok: false, error: 'missing-model' });
  const modelLabel = typeof payload.modelLabel === 'string' ? payload.modelLabel.trim().slice(0, 200) : '';
  const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim().slice(0, 100) : '';
  const protocol = PROTOCOLS.has(payload.protocol) ? payload.protocol : 'openai-completions';

  const route = newRouteId(payload.providerId);
  const keyRef = keyRefOf(route);
  const profile = {
    displayName: displayName === '' ? route : displayName,
    api: protocol,
    baseURL: baseUrl,
    apiKeyEnv: keyRef,
    models: [{ id: modelId, ...(modelLabel === '' ? {} : { name: modelLabel }) }],
  };

  try {
    await ctx.settings.mutate(PROVIDER_NS, [
      { op: 'set', path: ['providers', route], value: profile },
    ]);
  } catch (error) {
    return json(200, {
      ok: false,
      error: typeof error?.code === 'string' ? error.code : 'settings-failed',
      detail: String(error?.message ?? error).slice(0, 300),
    });
  }

  let keyStored = true;
  try {
    await ctx.credentials.set(keyRef, apiKey);
  } catch (error) {
    keyStored = false;
  }

  return json(200, {
    ok: true,
    route,
    keyRef,
    keyStored,
    provider: { displayName: profile.displayName, protocol, baseURL: baseUrl, modelId },
  });
}

/** 只读：列出本插件写入的 provider（不回显 Key）。 */
async function handleState(ctx) {
  try {
    const descriptors = await Promise.resolve(ctx.settings.describe({ redactSecrets: true }));
    const entry = Array.isArray(descriptors)
      ? descriptors.find((item) => item?.ns === PROVIDER_NS || String(item?.ns ?? '').endsWith(PROVIDER_NS))
      : undefined;
    const providers = entry?.value?.providers;
    const rows = [];
    if (providers !== null && typeof providers === 'object') {
      for (const [route, profile] of Object.entries(providers)) {
        if (profile === null || typeof profile !== 'object') continue;
        rows.push({
          route,
          displayName: typeof profile.displayName === 'string' ? profile.displayName : route,
          api: typeof profile.api === 'string' ? profile.api : undefined,
          baseURL: typeof profile.baseURL === 'string' ? profile.baseURL : undefined,
          apiKeyEnv: typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : undefined,
          models: Array.isArray(profile.models)
            ? profile.models.map((model) => (typeof model?.id === 'string' ? model.id : '')).filter(Boolean)
            : [],
          selectModel: route.startsWith('sel-'),
        });
      }
    }
    return json(200, { ok: true, ns: PROVIDER_NS, providers: rows, selectModelCount: rows.filter((row) => row.selectModel).length });
  } catch (error) {
    return json(200, { ok: false, error: 'settings-read-failed', detail: String(error?.message ?? error).slice(0, 300) });
  }
}

/** 删除本插件写入的 provider 与凭据（仅允许 sel- 前缀，避免误删用户自己的服务商）。 */
async function handleRemove(ctx, request) {
  const payload = await readJson(request);
  if (payload === undefined) return json(400, { ok: false, error: 'invalid-body' });
  const route = typeof payload.route === 'string' ? payload.route.trim() : '';
  if (!/^sel-[a-z0-9-]+$/.test(route)) return json(400, { ok: false, error: 'invalid-route' });
  try {
    await ctx.settings.mutate(PROVIDER_NS, [{ op: 'unset', path: ['providers', route] }]);
  } catch (error) {
    return json(200, { ok: false, error: 'settings-failed', detail: String(error?.message ?? error).slice(0, 300) });
  }
  try {
    await ctx.credentials.unset(keyRefOf(route));
  } catch {
    /* 凭据不存在也不影响移除成功 */
  }
  return json(200, { ok: true, route });
}

/** 代查模型列表。永远返回可解析的 JSON，失败用 ok:false + 稳定错误码。 */
async function handleModels(request) {
  const text = await request.text().catch(() => '');
  if (text.length > MAX_BODY) return json(413, { ok: false, error: 'body-too-large' });

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return json(400, { ok: false, error: 'invalid-body' });
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return json(400, { ok: false, error: 'invalid-body' });
  }

  const baseUrl = normalizeBaseUrl(payload.baseUrl);
  if (baseUrl === null) return json(400, { ok: false, error: 'invalid-base-url' });

  const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
  const protocol = normalizeProtocol(payload.protocol);
  const providerId = typeof payload.providerId === 'string' ? payload.providerId.slice(0, 64) : '';

  try {
    const result = await fetchModels({ protocol, baseUrl, apiKey, providerId });
    return json(200, { ok: true, protocol, ...result });
  } catch (error) {
    return json(200, {
      ok: false,
      protocol,
      error: typeof error?.code === 'string' ? error.code : 'request-failed',
      detail: String(error?.detail ?? error?.message ?? error).slice(0, 300),
    });
  }
}

/**
 * 按平台协议请求 `/models` 并归一化列表。
 * @param {{protocol:string, baseUrl:string, apiKey:string, providerId:string}} options
 * @returns {Promise<{models:Array<{id:string,label:string}>, count:number}>}
 */
async function fetchModels({ protocol, baseUrl, apiKey, providerId }) {
  const headers = { accept: 'application/json' };
  let url;
  if (protocol === 'google') {
    url = `${baseUrl}/models${apiKey === '' ? '' : `?key=${encodeURIComponent(apiKey)}`}`;
  } else {
    url = `${baseUrl}/models`;
    if (protocol === 'anthropic') {
      if (apiKey !== '') headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      if (apiKey !== '') headers.authorization = `Bearer ${apiKey}`;
      // OpenRouter 的公开列表建议带上来源标识；不携带任何用户信息。
      if (providerId === 'openrouter') {
        headers['http-referer'] = 'https://github.com/mhxy13867806343/dsh-plugin-select-model';
        headers['x-title'] = 'DSH select model';
      }
    }
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const aborted = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw codeError(aborted ? 'timeout' : 'network-error', String(error?.message ?? error));
  }

  const text = await response.text();
  if (!response.ok) {
    throw codeError(`http_${response.status}`, text.slice(0, 200));
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw codeError('invalid-json', text.slice(0, 200));
  }

  const models = normalizeModels(parsed, protocol);
  if (models.length === 0) throw codeError('empty-list');
  return { models: models.slice(0, MAX_MODELS), count: models.length };
}

/**
 * 把各家五花八门的响应归一化成 [{ id, label }]，去重并按 label 排序。
 * @param {unknown} parsed 上游 JSON
 * @param {string} protocol 平台协议
 * @returns {Array<{id:string,label:string}>}
 */
function normalizeModels(parsed, protocol) {
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

/** 只允许 http/https、无凭据的基地址；去掉查询串与末尾斜杠。 */
function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

/** 只接受已知协议名，未知一律按 OpenAI 兼容处理。 */
function normalizeProtocol(value) {
  return value === 'anthropic' || value === 'google' ? value : value === 'openrouter' ? 'openrouter' : 'openai';
}

/** 带稳定错误码的 Error。 */
function codeError(code, detail) {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}

/** 统一的 JSON Response（禁止缓存）。 */
function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
