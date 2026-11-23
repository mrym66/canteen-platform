// 饭卡充值申请与审核：转发到自托管后端（自托管主机）
// 身份只认会话 Cookie（后端从 Cookie 取 studentId），不采信请求体里的学号。

import { proxyToBackend } from '../_lib/proxy.js';
import { preflight } from '../_lib/http.js';

export function onRequestPost({ request, env }) {
  return proxyToBackend(request, env, '/api/recharge');
}

export function onRequestGet({ request, env }) {
  return proxyToBackend(request, env, '/api/recharge');
}

export function onRequestOptions({ request }) {
  return preflight(request);
}
