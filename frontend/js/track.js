/* ============================================================
 * 访问设备信息采集（前端部分）
 * 只采集浏览器/系统本来就暴露给网页的信息，不读取任何文件、相册、
 * 通讯录、短信，也不尝试绕过任何权限。定位仅在用户点击并被授权后上报。
 * ============================================================ */
(function () {
  if (window.MRYMTrack) return;

  var API = '/api/track';
  var KEY = 'mrym_vid';
  var CONSENT_KEY = 'mrym_consent';

  /* 设备指纹（canvas / GPU / 音频 / 媒体设备数量）属于《个人信息保护法》里的
     设备标识信息，不是“型号、系统、浏览器”这类基础信息，必须先取得同意。
     基础信息（型号/系统/浏览器/网络/屏幕）与隐私说明一致，不需要单独同意。 */
  function consentFull() {
    try { return localStorage.getItem(CONSENT_KEY) === 'full'; } catch (e) { return false; }
  }
  function hasConsent() {
    try { return !!localStorage.getItem(CONSENT_KEY); } catch (e) { return false; }
  }
  function setConsent(v) {
    try { localStorage.setItem(CONSENT_KEY, v); } catch (e) { }
  }

  function getVid() {
    try {
      var v = localStorage.getItem(KEY);
      if (!v || v.length < 8) {
        v = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
        localStorage.setItem(KEY, v);
      }
      return v;
    } catch (e) {
      return 'v' + Math.random().toString(36).slice(2, 12);
    }
  }
  var VID = getVid();

  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  /* ---------- 系统 / 浏览器 / 机型 ---------- */
  function parseUA(ua) {
    var d = {};
    if (!ua) return d;
    var m;
    if ((m = ua.match(/Windows NT ([\d.]+)/))) {
      d.os = 'Windows';
      d.osVer = { '10.0': '10 / 11', '6.3': '8.1', '6.2': '8', '6.1': '7' }[m[1]] || m[1];
    } else if ((m = ua.match(/Android\s+([\d.]+)/))) {
      d.os = 'Android'; d.osVer = m[1];
    } else if ((m = ua.match(/iPhone OS ([\d_]+)/))) {
      d.os = 'iOS'; d.osVer = m[1].replace(/_/g, '.');
    } else if ((m = ua.match(/iPad; CPU OS ([\d_]+)/))) {
      d.os = 'iPadOS'; d.osVer = m[1].replace(/_/g, '.');
    } else if (/Mac OS X/.test(ua)) {
      d.os = 'macOS';
      m = ua.match(/Mac OS X ([\d_]+)/); if (m) d.osVer = m[1].replace(/_/g, '.');
    } else if (/HarmonyOS|OpenHarmony/i.test(ua)) {
      d.os = 'HarmonyOS';
    } else if (/Linux/.test(ua)) {
      d.os = 'Linux';
    }

    // 安卓机型的 UA 里通常带型号，例如 "Android 15; V2547DA Build/..."
    if (d.os === 'Android') {
      m = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build[/;]|[;)])/);
      if (m) {
        var cand = m[1].replace(/\s*(Build\/.*|wv|Mobile)$/i, '').trim();
        if (cand && !/^(wv|Mobile|Tablet)$/i.test(cand) && cand.length <= 40) d.model = cand;
      }
    }

    if (/Edg\//.test(ua)) { d.browser = 'Edge'; m = ua.match(/Edg\/([\d.]+)/); }
    else if (/OPR\/|Opera/.test(ua)) { d.browser = 'Opera'; m = ua.match(/OPR\/([\d.]+)/); }
    else if (/MicroMessenger/i.test(ua)) { d.browser = '微信内置浏览器'; m = ua.match(/MicroMessenger\/([\d.]+)/); }
    else if (/QQBrowser/.test(ua)) { d.browser = 'QQ 浏览器'; m = ua.match(/QQBrowser\/([\d.]+)/); }
    else if (/UCBrowser/.test(ua)) { d.browser = 'UC 浏览器'; m = ua.match(/UCBrowser\/([\d.]+)/); }
    else if (/HuaweiBrowser/.test(ua)) { d.browser = '华为浏览器'; m = ua.match(/HuaweiBrowser\/([\d.]+)/); }
    else if (/MiuiBrowser/.test(ua)) { d.browser = '小米浏览器'; m = ua.match(/MiuiBrowser\/([\d.]+)/); }
    else if (/Chrome\//.test(ua)) { d.browser = 'Chrome'; m = ua.match(/Chrome\/([\d.]+)/); }
    else if (/Firefox\//.test(ua)) { d.browser = 'Firefox'; m = ua.match(/Firefox\/([\d.]+)/); }
    else if (/Safari\//.test(ua)) { d.browser = 'Safari'; m = ua.match(/Version\/([\d.]+)/); }
    if (m) d.browserVer = m[1];

    if (/Trident|MSIE/.test(ua)) d.engine = 'Trident';
    else if (/Gecko\/|Firefox/.test(ua)) d.engine = 'Gecko';
    else if (/AppleWebKit/.test(ua)) d.engine = /Chrome|Chromium|Edg|OPR/.test(ua) ? 'Blink' : 'WebKit';

    if (/;\s*wv\)/.test(ua)) d.webview = true;               // 安卓 WebView 壳
    else if (/iPhone|iPad/.test(ua) && !/Safari/.test(ua)) d.webview = true;
    if (/MrymCanteenApp/i.test(ua)) d.app = true;            // 自家 App 的 UA 标记
    return d;
  }

  function brandOf(model, ua) {
    if (!model) return null;
    var s = model.toUpperCase();
    var map = [
      [/^(SM|GT)-/, '三星 Samsung'], [/^PIXEL/, '谷歌 Google'], [/^V2\d|^V1\d/, 'vivo'],
      [/^(M2|M1|REDMI|MI |2\d{7})/, '小米 Xiaomi'], [/^(PRA|ANA|LYA|ELE|NOH|ALN|JAD)/, '华为 Huawei'],
      [/^(PG|PGB|PRA)/, 'OPPO'], [/^RMX/, 'realme'], [/^(CPH|PHB|PCH)/, 'OPPO'],
      [/^(DN|FNE|JSN)/, '荣耀 HONOR'], [/^ONEPLUS|^IN20/, '一加 OnePlus'], [/^MEIZU|^M\d{3}/, '魅族 Meizu'],
      [/^MOT|^XT/, '摩托罗拉 Motorola'], [/^ASUS|^ZS/, '华硕 ASUS'], [/^NOKIA/, '诺基亚 Nokia']
    ];
    for (var i = 0; i < map.length; i++) if (map[i][0].test(s)) return map[i][1];
    if (/HUAWEI|HONOR/i.test(ua)) return '华为 / 荣耀';
    return null;
  }

  /* ---------- 硬件 / 图形 / 音频 ---------- */
  function gpuInfo() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return {};
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      var vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      var renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return { gpu: String(renderer || ''), gpuVendor: String(vendor || '') };
    } catch (e) { return {}; }
  }

  function canvasFp() {
    try {
      var c = document.createElement('canvas');
      c.width = 240; c.height = 60;
      var x = c.getContext('2d');
      if (!x) return '';
      x.textBaseline = 'top';
      x.font = '14px Arial';
      x.fillStyle = '#f60'; x.fillRect(0, 0, 90, 20);
      x.fillStyle = '#069'; x.fillText('Mrym.Canteen 设备指纹', 2, 24);
      x.fillStyle = 'rgba(102,204,0,0.65)'; x.fillText('🍊 食堂数据平台', 100, 24);
      return hash(c.toDataURL());
    } catch (e) { return ''; }
  }

  function audioInfo() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return '';
      var ac = new AC();
      var s = 'sr=' + ac.sampleRate + ',ch=' + ac.destination.maxChannelCount;
      if (typeof ac.baseLatency === 'number') s += ',lat=' + Math.round(ac.baseLatency * 1000) + 'ms';
      try { ac.close(); } catch (e) { }
      return s;
    } catch (e) { return ''; }
  }

  function mediaInfo() {
    var out = { cams: null, mics: null, speakers: null };
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return out;
      navigator.mediaDevices.enumerateDevices().then(function (list) {
        var c = 0, m = 0, s = 0;
        list.forEach(function (d) {
          if (d.kind === 'videoinput') c++;
          else if (d.kind === 'audioinput') m++;
          else if (d.kind === 'audiooutput') s++;
        });
        out.cams = c; out.mics = m; out.speakers = s;
        // 未授权时拿不到设备名称，这里不尝试申请权限
        if (!window.__mrymMediaSent && (c || m)) {
          window.__mrymMediaSent = 1;
          send({ cams: c, mics: m, speakers: s }, 'media', { hit: 0 });
        }
      }).catch(function () { });
    } catch (e) { }
    return out;
  }

  /* ---------- 组装 ---------- */
  function collect() {
    var ua = navigator.userAgent || '';
    var p = parseUA(ua);
    var sc = window.screen || {};
    var nav = navigator;
    var conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
    var full = consentFull();
    var g = full ? gpuInfo() : {};

    var d = {
      vid: VID,
      ua: ua,
      os: p.os, osVer: p.osVer,
      browser: p.browser, browserVer: p.browserVer, engine: p.engine,
      model: p.model, brand: brandOf(p.model, ua),
      webview: !!p.webview, app: !!p.app,

      screen: (sc.width || 0) + '×' + (sc.height || 0)
        + (sc.availWidth ? ' (可用 ' + sc.availWidth + '×' + sc.availHeight + ', ' + (sc.colorDepth || 0) + 'bit)' : ''),
      viewport: window.innerWidth + '×' + window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      cores: nav.hardwareConcurrency || null,
      mem: nav.deviceMemory || null,
      gpu: full ? g.gpu : null, gpuVendor: full ? g.gpuVendor : null,
      fp: full ? canvasFp() : null,

      netType: conn.effectiveType ? (conn.effectiveType + (conn.type ? '/' + conn.type : '')) : (conn.type || null),
      netDown: conn.downlink != null ? conn.downlink : null,
      netRtt: conn.rtt != null ? conn.rtt : null,
      saveData: conn.saveData != null ? conn.saveData : null,

      lang: nav.language, languages: (nav.languages || []).join(','),
      timezone: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return null; } })(),
      tzOffset: new Date().getTimezoneOffset(),
      touch: nav.maxTouchPoints || 0,
      audio: full ? audioInfo() : null,

      extra: JSON.stringify({
        dnt: nav.doNotTrack || null,
        cookie: nav.cookieEnabled,
        plugins: nav.plugins ? nav.plugins.length : 0,
        pdfViewer: !!nav.pdfViewerEnabled,
        standalone: !!(nav.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)),
        secure: window.isSecureContext,
        sessionStorage: (function () { try { sessionStorage.setItem('_t', '1'); sessionStorage.removeItem('_t'); return true; } catch (e) { return false; } })(),
        uaBrands: (nav.userAgentData && nav.userAgentData.brands || []).map(function (b) { return b.brand + ' ' + b.version; }).join(' | ') || null
      })
    };

    // 蓝牙是否可用（只能判断有没有，无法列出周围设备）
    try {
      if (nav.bluetooth && nav.bluetooth.getAvailability) {
        nav.bluetooth.getAvailability().then(function (ok) { d.bluetooth = !!ok; });
      }
    } catch (e) { }

    if (full) {
      var mi = mediaInfo();
      d.cams = mi.cams; d.mics = mi.mics; d.speakers = mi.speakers;
    }
    return d;
  }

  /* ---------- 高熵信息（Chrome / 安卓） ---------- */
  function highEntropy() {
    return new Promise(function (resolve) {
      var uad = navigator.userAgentData;
      if (!uad || !uad.getHighEntropyValues) return resolve({});
      var t = setTimeout(function () { resolve({}); }, 1200);
      try {
        uad.getHighEntropyValues(['model', 'platform', 'platformVersion', 'architecture', 'bitness', 'uaFullVersion', 'fullVersionList', 'wow64'])
          .then(function (h) {
            clearTimeout(t);
            var o = {};
            if (h.model) o.model = h.model;
            if (h.platform && h.platform !== 'Windows') {
              // Windows 的 UA-CH platformVersion（如 19.0.0）对用户没意义，保留 UA 里的可读版本
              o.os = h.platform;
              o.osVer = h.platformVersion;
            }
            if (h.architecture) o.arch = h.architecture + (h.bitness ? '/' + h.bitness : '');
            if (h.uaFullVersion) o.browserVer = h.uaFullVersion;
            if (h.model && !o.brand) o.brand = brandOf(h.model, navigator.userAgent || '');
            resolve(o);
          }).catch(function () { clearTimeout(t); resolve({}); });
      } catch (e) { resolve({}); }
    });
  }

  function battery() {
    return new Promise(function (resolve) {
      try {
        if (!navigator.getBattery) return resolve(null);
        var t = setTimeout(function () { resolve(null); }, 1200);
        navigator.getBattery().then(function (b) {
          clearTimeout(t);
          resolve(Math.round(b.level * 100) + '%' + (b.charging ? ' 充电中' : ''));
        }).catch(function () { clearTimeout(t); resolve(null); });
      } catch (e) { resolve(null); }
    });
  }

  function storageEstimate() {
    return new Promise(function (resolve) {
      var heap = null;
      try {
        if (performance && performance.memory) {
          heap = 'JS堆 ' + Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB';
        }
      } catch (e) { }
      var settled = false;
      var done = function (s) { if (!settled) { settled = true; resolve(s); } };
      var timer = setTimeout(function () { done(heap); }, 1800);
      try {
        if (navigator.storage && navigator.storage.estimate) {
          navigator.storage.estimate().then(function (e) {
            clearTimeout(timer);
            if (e && e.quota) {
              var s = '已用 ' + (e.usage / 1048576).toFixed(1) + 'MB / 配额 ' + (e.quota / 1073741824).toFixed(2) + 'GB';
              done(heap ? heap + ' · ' + s : s);
            } else done(heap);
          }).catch(function () { clearTimeout(timer); done(heap); });
        } else { clearTimeout(timer); done(heap); }
      } catch (e) { clearTimeout(timer); done(heap); }
    });
  }

  /* ---------- 上报 ---------- */
  var done = false;
  function send(extra, action, opts) {
    opts = opts || {};
    var d = collect();
    for (var k in extra) if (extra[k] !== undefined && extra[k] !== null) d[k] = extra[k];
    if (action) d.action = action;
    if (opts.path) d.path = opts.path;
    if (opts.note) d.note = opts.note;
    if (opts.hit === 0) d.hit = false;
    var body = JSON.stringify(d);
    try {
      if (navigator.sendBeacon) {
        var ok = navigator.sendBeacon(API, new Blob([body], { type: 'application/json' }));
        if (ok) return Promise.resolve();
      }
    } catch (e) { }
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true })
      .catch(function () { });
  }

  function boot() {
    if (done) return;
    done = true;
    Promise.all([highEntropy(), battery(), storageEstimate()]).then(function (r) {
      var h = r[0] || {}, b = r[1], st = r[2];
      var extra = {};
      for (var k in h) extra[k] = h[k];
      if (b) extra.battery = b;
      if (st) extra.storage = st;
      send(extra, 'open', { path: location.pathname + location.hash });
    });
  }

  /* ---------- 首次访问的同意条 ---------- */
  function refreshFull() {
    Promise.all([highEntropy(), battery(), storageEstimate()]).then(function (r) {
      var extra = {};
      var h = r[0] || {};
      for (var k in h) extra[k] = h[k];
      if (r[1]) extra.battery = r[1];
      if (r[2]) extra.storage = r[2];
      send(extra, 'consent', { path: location.pathname, hit: 0 });
    });
  }

  function closeBar() {
    var b = document.getElementById('mrym-consent');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  function showConsent() {
    if (hasConsent() || document.getElementById('mrym-consent')) return;
    var box = document.createElement('div');
    box.id = 'mrym-consent';
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#141126;color:#e8e6f5;' +
      'padding:13px 16px calc(13px + env(safe-area-inset-bottom));font-size:12.5px;line-height:1.7;' +
      'box-shadow:0 -6px 24px rgba(0,0,0,.4);display:flex;flex-wrap:wrap;gap:10px;align-items:center';

    var t = document.createElement('div');
    t.style.cssText = 'flex:1 1 100%;color:#cfcbe4';
    t.appendChild(document.createTextNode('本平台记录访问设备的型号、系统、浏览器与网络信息用于统计。若同意，还会采集设备特征（GPU / 画布 / 音频）用于设备识别；不同意也不影响使用。'));
    box.appendChild(t);

    var row = document.createElement('div');
    row.style.cssText = 'flex:1 0 100%;display:flex;justify-content:flex-end;gap:8px';

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.textContent = '同意';
    yes.style.cssText = 'flex:0 0 auto;background:#7c3aed;color:#fff;border:0;border-radius:8px;padding:9px 18px;font-size:12.5px;font-weight:600';
    yes.addEventListener('click', function () {
      setConsent('full');
      closeBar();
      refreshFull();
    });
    row.appendChild(yes);

    var no = document.createElement('button');
    no.type = 'button';
    no.textContent = '仅必要';
    no.style.cssText = 'flex:0 0 auto;background:transparent;color:#a9a3c9;border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:9px 16px;font-size:12.5px';
    no.addEventListener('click', function () {
      setConsent('min');
      closeBar();
    });
    row.appendChild(no);
    box.appendChild(row);

    document.body.appendChild(box);
  }

  if (document.readyState === 'complete') { setTimeout(boot, 300); setTimeout(showConsent, 700); }
  else window.addEventListener('load', function () { setTimeout(boot, 300); setTimeout(showConsent, 700); });

  window.MRYMTrack = {
    vid: VID,
    // 行为流水
    event: function (action, note) {
      send({}, action, { path: location.hash ? location.hash.slice(1) : '/', note: note, hit: 0 });
    },
    // 用户授权定位后调用
    gps: function (lat, lng, acc) {
      return send({ gps: lat.toFixed(6) + ',' + lng.toFixed(6) + ' ±' + Math.round(acc) + 'm' }, 'gps', { lat: lat, lng: lng, acc: acc, hit: 0 });
    }
  };
})();
