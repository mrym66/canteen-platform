/*
 * 登录页启动脚本（原来是 index.html 里的内联 <script>）。
 * 移出来的原因：上 CSP 之后 script-src 'self' 会挡掉内联脚本，
 * 登录页背景视频的自动播放就会失效。
 *
 * 另外这里负责「测试账号」区块的显隐：
 * 区块默认 hidden，只在带 ?demo=1（或 #demo）时展开，
 * 或者连续点击左上角校名 5 次。信息本身保留在 index.html 里，没有删除。
 */
(function () {
  'use strict';

  /* ---------- 背景视频自动播放 ---------- */
  function bootVideo() {
    var isMobile = matchMedia('(max-width: 900px)').matches || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    var v = document.querySelector('.login-bg');
    if (!v) return;
    if (isMobile) v.src = v.getAttribute('data-mobile-src') || 'assets/login-bg-m.mp4';
    var kick = function () {
      if (v.paused) {
        var p = v.play();
        if (p && p.catch) p.catch(function () { });
      }
    };
    kick();
    v.addEventListener('loadeddata', kick);
    v.addEventListener('canplay', kick);
    ['touchstart', 'click', 'touchend'].forEach(function (ev) {
      document.addEventListener(ev, kick, { once: true, passive: true });
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
  }

  /* ---------- 测试账号区块显隐 ---------- */
  function revealDemo(force) {
    var box = document.getElementById('demo-accounts');
    if (!box) return;
    if (force === true) box.hidden = false;
    else box.hidden = !box.hidden;
  }

  function wantsDemo() {
    try {
      if (new URLSearchParams(location.search).get('demo') === '1') return true;
    } catch (e) { }
    return location.hash === '#demo';
  }

  function bootDemo() {
    if (wantsDemo()) { revealDemo(true); return; }
    // 隐藏入口：3 秒内连点校名 5 次
    var brand = document.querySelector('.lt-brand');
    if (!brand) return;
    var hits = 0, last = 0;
    brand.addEventListener('click', function () {
      var now = Date.now();
      if (now - last > 900) hits = 0;
      last = now;
      if (++hits >= 5) { hits = 0; revealDemo(); }
    });
  }

  if (document.readyState === 'loading') {
    bootVideo();
    document.addEventListener('DOMContentLoaded', bootDemo);
  } else {
    bootVideo(); bootDemo();
  }
})();
