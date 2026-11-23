// 共享会话层：HMAC-SHA256 签名的令牌 + HttpOnly Cookie。
// 所有接口的身份一律从这里取，不再相信请求体里的 studentId / role。

export const COOKIE_NAME = 'mrym_auth';
export const SESSION_TTL = 12 * 3600; // 12 小时

// 安全设计（报告 9.2 补充风险）：签名密钥不允许存在公开兜底值——
// 谁都能用公开值伪造令牌等于没有签名。未配置 AUTH_SECRET 时全部鉴权接口
// fail closed：登录返回 503、已有会话一律视为无效，直到配置好环境变量。
function getSecret(env) {
  return (env && env.AUTH_SECRET) || null;
}

/** 鉴权是否可用（AUTH_SECRET 已配置） */
export function authConfigured(env) {
  return !!getSecret(env);
}

function b64urlFromBytes(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlEncode(str) {
  return b64urlFromBytes(new TextEncoder().encode(str));
}

function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmac(env, data) {
  const secret = getSecret(env);
  if (!secret) throw new Error('auth_not_configured');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64urlFromBytes(sig);
}

export async function signToken(env, payload) {
  const body = b64urlEncode(JSON.stringify(payload));
  return body + '.' + (await hmac(env, body));
}

export async function verifyToken(env, token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const i = token.lastIndexOf('.');
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = await hmac(env, body);
  if (sig.length !== expect.length) return null;
  let diff = 0;
  for (let k = 0; k < sig.length; k++) diff |= sig.charCodeAt(k) ^ expect.charCodeAt(k);
  if (diff !== 0) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(body)); } catch (e) { return null; }
  if (!payload || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const p of raw.split(';')) {
    const idx = p.indexOf('=');
    if (idx < 0) continue;
    if (p.slice(0, idx).trim() === name) {
      try { return decodeURIComponent(p.slice(idx + 1).trim()); } catch (e) { return ''; }
    }
  }
  return '';
}

export function sessionCookie(token, maxAge) {
  return COOKIE_NAME + '=' + encodeURIComponent(token) +
    '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge;
}

export function clearCookie() {
  return COOKIE_NAME + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

/** 当前请求的会话（任何角色），没有则 null；AUTH_SECRET 未配置时一律 null */
export async function getSession(request, env) {
  if (!authConfigured(env)) return null;
  const payload = await verifyToken(env, readCookie(request, COOKIE_NAME));
  if (!payload || !payload.role || !payload.id) return null;
  return payload;
}

/** 要求会话属于指定角色之一，否则 null */
export async function requireRole(request, env, roles) {
  const s = await getSession(request, env);
  if (!s) return null;
  return roles.indexOf(s.role) >= 0 ? s : null;
}

export async function requireAdmin(request, env) {
  return requireRole(request, env, ['admin']);
}

export async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 管理员口令校验：期望哈希只从环境变量 ADMIN_SHA256 读取。
 * 源码中不允许出现任何哈希默认值 —— 否则既能被离线爆破，
 * 又会在管理员改密后让旧口令永久有效。
 */
export async function adminPasswordMatches(env, password) {
  const expected = String((env && env.ADMIN_SHA256) || '').toLowerCase();
  if (!expected || typeof password !== 'string' || !password) return false;
  const actual = await sha256hex(password);
  if (actual.length !== expected.length) return false;
  // 定长比较，避免通过响应时间推断匹配前缀
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/* ---------------- 口令：PBKDF2 + 随机盐 ---------------- */
// 迭代次数取 10000：单请求 CPU 预算很小，10 万次会顶到上限。
// 对演示系统足够；真实系统应把登录放进独立的、预算更宽的 Worker 里跑 10 万次以上。

const PBKDF2_ITER = 10000;

export function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function pbkdf2Hash(password, salt, iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: iter, hash: 'SHA-256' },
    key, 256
  );
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function pbkdf2Verify(password, salt, expectedHex, iter = PBKDF2_ITER) {
  const got = await pbkdf2Hash(password, salt, iter);
  if (got.length !== String(expectedHex || '').length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

/* ---------------- 限速：固定窗口计数 ---------------- */
// 接口层没有内置限速，用一张两列的小表按窗口计数。
// 账号库不可用时降级为放行（fail-open），并保证不影响主流程。

let rlReady = false;

async function ensureRl(db) {
  if (rlReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS rl (k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL)').run();
  rlReady = true;
}

export async function rateLimit(env, key, max, windowSec) {
  const db = env && env.canteen_db;
  if (!db) return { ok: true, degraded: true };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + windowSec;
  try {
    await ensureRl(db);
    await db.prepare(
      'INSERT INTO rl (k, n, exp) VALUES (?, 1, ?) ' +
      'ON CONFLICT(k) DO UPDATE SET ' +
      'n = CASE WHEN rl.exp <= ? THEN 1 ELSE rl.n + 1 END, ' +
      'exp = CASE WHEN rl.exp <= ? THEN ? ELSE rl.exp END'
    ).bind(key, exp, now, now, exp).run();
    const row = await db.prepare('SELECT n, exp FROM rl WHERE k = ?').bind(key).first();
    const n = row ? Number(row.n) || 0 : 0;
    return { ok: n <= max, n, max, degraded: false };
  } catch (e) {
    return { ok: true, degraded: true };
  }
}
