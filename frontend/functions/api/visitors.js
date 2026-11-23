// 访客档案查询：转发到自托管后端（自托管主机）
// 数据全部在自有服务器 SQLite，接口层不存储、不缓存这部分内容。
// 鉴权（管理员会话或口令）由后端校验。

import { proxyToBackend } from '../_lib/proxy.js';
import { preflight } from '../_lib/http.js';

export function onRequestPost({ request, env }) {
  return proxyToBackend(request, env, '/api/visitors');
}

export function onRequestGet({ request, env }) {
  return proxyToBackend(request, env, '/api/visitors');
}

export function onRequestOptions({ request }) {
  return preflight(request);
}
