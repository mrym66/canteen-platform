// 共享 HTTP 工具：统一的 JSON 响应、请求体读取（带大小上限）、字段清洗、同源 CORS。
// 所有 /api/* 的响应都带上这组安全头——Functions 的响应不经过静态资源那条 _headers 规则，
// 必须在代码里自己加一遍。

export const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=(), payment=()'
};

export function json(obj, status = 200, extra) {
  const headers = Object.assign(
    {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    SEC_HEADERS,
    extra || {}
  );
  return new Response(JSON.stringify(obj), { status, headers });
}

/** 同源 CORS：只放行本站 Origin，绝不回 *。非同源请求一律不带 CORS 头。 */
export function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  let self = '';
  try { self = new URL(request.url).origin; } catch (e) { self = ''; }
  const h = { 'Vary': 'Origin' };
  if (origin && self && origin === self) {
    h['Access-Control-Allow-Origin'] = self;
    h['Access-Control-Allow-Credentials'] = 'true';
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

/** 预检：只回 204 + 同源头，不再允许任何站点跨域调用 */
export function preflight(request) {
  return new Response(null, { status: 204, headers: Object.assign({}, SEC_HEADERS, corsHeaders(request)) });
}

export function clientIp(request) {
  // 只信边缘注入的 cf-connecting-ip，不看 X-Forwarded-For（可伪造）
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
}

/** 读请求体：限制大小，只接受 JSON，失败返回空对象 */
export async function readJson(request, maxBytes = 16384) {
  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  if (ct && ct.indexOf('application/json') < 0) {
    return { ok: false, error: 'bad_content_type', body: {} };
  }
  const cl = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (cl > maxBytes) return { ok: false, error: 'too_large', body: {} };
  let raw = '';
  try { raw = await request.text(); } catch (e) { return { ok: false, error: 'read_failed', body: {} }; }
  if (raw.length > maxBytes) return { ok: false, error: 'too_large', body: {} };
  if (!raw) return { ok: true, body: {} };
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, error: 'bad_body', body: {} };
    }
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: 'bad_json', body: {} };
  }
}

export function txt(v, max = 160) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export function bool(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return 1;
  if (v === false || v === 0 || v === '0' || v === 'false') return 0;
  return null;
}
