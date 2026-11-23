// /api/backend/* -> 自托管后端 反向代理（业务数据：菜品/订单/统计/运维）
// 与 /api/auth、/api/track、/api/visitors、/api/recharge 共用同一套转发逻辑。

import { proxyToBackend } from '../../_lib/proxy.js';

export function onRequest({ request, env }) {
  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/api\/backend/, '') || '/';
  return proxyToBackend(request, env, rest);
}
