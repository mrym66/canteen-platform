// 统一反向代理：接口层 -> 服务端
//
// 为什么需要它：后端与站点不同域，所有请求统一从
// 接口层转发，同时把边缘拿到的地理/网络信息（request.cf）用 X-CF-*
// 头补齐给后端——后端是普通云主机，自己拿不到这些数据。
//
// 关键细节：
//   · 会话 Cookie 必须双向透传（请求带 Cookie，响应回 Set-Cookie），
//     否则登录成功但浏览器存不下会话
//   · 云电脑空闲会休眠，这里设 9 秒超时并返回 503 友好提示，避免前端一直转圈
//   · 响应一律 no-store：这里转发的是账号/订单等私有数据

const FALLBACK_BASE = "http://127.0.0.1:8787";
const TIMEOUT_MS = 12000;

const CF_HEADER_MAP = {
  country: "X-CF-Country",
  region: "X-CF-Region",
  city: "X-CF-City",
  asOrganization: "X-CF-ASOrg",
  asn: "X-CF-ASN",
  colo: "X-CF-Colo",
  timezone: "X-CF-Timezone",
  latitude: "X-CF-Lat",
  longitude: "X-CF-Lng",
  httpProtocol: "X-CF-Proto",
  tlsVersion: "X-CF-TLS",
  clientTcpRtt: "X-CF-RTT"
};

const PASS_HEADERS = ["Content-Type", "Cookie", "User-Agent", "Referer", "Accept", "Accept-Language"];

export async function proxyToBackend(request, env, path) {
  const base = (env && env.CANTEEN_BACKEND_URL) || FALLBACK_BASE;
  const url = new URL(request.url);
  const target = base + path + url.search;

  const headers = new Headers();
  for (const name of PASS_HEADERS) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) {
    headers.set("CF-Connecting-IP", ip);
    headers.set("X-Forwarded-For", ip);
  }
  const cf = request.cf || {};
  for (const [key, header] of Object.entries(CF_HEADER_MAP)) {
    const v = cf[key];
    if (v !== undefined && v !== null) headers.set(header, String(v));
  }

  let body;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.text();
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(target, {
      method: request.method,
      headers: headers,
      body: body,
      signal: ctrl.signal,
      redirect: "manual"
    });
    const text = await resp.text();
    const out = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    const setCookie = resp.headers.get("set-cookie");
    if (setCookie) out.set("Set-Cookie", setCookie);
    return new Response(text, { status: resp.status, headers: out });
  } catch (e) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "backend_unavailable",
        message: "后端服务暂时不可用（云电脑可能处于休眠），请稍后再试"
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );
  } finally {
    clearTimeout(timer);
  }
}
