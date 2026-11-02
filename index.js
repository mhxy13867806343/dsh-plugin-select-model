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
export const inject = ['connection'];

const ROUTE_MODELS = '/api/select-model/models';
const ROUTE_HEALTH = '/api/select-model/health';
const MAX_BODY = 64 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_MODELS = 500;
const PLUGIN_NAME = 'dsh-plugin-select-model';

// 供本机脚本做无 UI 的逻辑自测（导入本模块不会启动路由）。
export { fetchModels, normalizeModels, normalizeBaseUrl };

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
