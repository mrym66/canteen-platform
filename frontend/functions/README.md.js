// 遮蔽 /README.md：仓库说明不对外提供
export async function onRequestGet() {
  return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
export async function onRequestPost() {
  return new Response('Not Found', { status: 404 });
}
