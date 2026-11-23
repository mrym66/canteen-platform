// 账号认证：转发到自托管后端（自托管后端）
// 口令校验、PBKDF2 存储、会话签发全部在自有服务器完成，接口层只做边缘转发。
// 前端调用路径保持不变：POST/GET /api/auth

import { proxyToBackend } from '../_lib/proxy.js';
import { preflight } from '../_lib/http.js';

export function onRequestPost({ request, env }) {
  return proxyToBackend(request, env, '/api/auth');
}

export function onRequestGet({ request, env }) {
  return proxyToBackend(request, env, '/api/auth');
}

export function onRequestOptions({ request }) {
  return preflight(request);
}
