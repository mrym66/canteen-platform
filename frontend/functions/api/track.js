// 访问者/设备信息采集：转发到自托管后端（自托管主机）
// 网络层信息（IP、归属地、ASN、边缘节点、TLS）由本层用 X-CF-* 头补给后端，
// 数据最终落在自有服务器的 SQLite，不经过任何第三方数据库。

import { proxyToBackend } from '../_lib/proxy.js';
import { preflight } from '../_lib/http.js';

export function onRequestPost({ request, env }) {
  return proxyToBackend(request, env, '/api/track');
}

export function onRequestGet({ request, env }) {
  return proxyToBackend(request, env, '/api/track');
}

export function onRequestOptions({ request }) {
  return preflight(request);
}
