/* ============================================================
 * Mrym College 食堂大数据分析与智能决策平台 — 主逻辑
 * 角色路由：student / staff / admin
 * ============================================================ */

(function () {
  'use strict';
  const M = window.MRYM;
  const AI = window.MRYM_AI;
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '¥' + Number(n).toFixed(2).replace(/\.00$/, '');

  /* ---------------- toast / modal ---------------- */
  let toastTimer = null;
  function toast(msg, type = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  let modalLocked = false;
  let avStream = null;
  function stopAvStream() {
    if (avStream) { try { avStream.getTracks().forEach(t => t.stop()); } catch (e) { } avStream = null; }
  }
  function openModal(html, locked = false) {
    modalLocked = locked;
    const box = $('#modal-box');
    box.className = 'modal';
    box.innerHTML = html;
    $('#modal-mask').classList.remove('hidden');
  }
  function closeModal() {
    if (modalLocked) return;   // 强制授权弹窗不允许点空白关闭
    $('#modal-mask').classList.add('hidden');
    stopAvStream();
  }
  function unlockModal() { modalLocked = false; closeModal(); }
  window.closeModal = closeModal;
  $('#modal-mask').addEventListener('click', e => { if (e.target.id === 'modal-mask') closeModal(); });

  /* ---------------- 简易 markdown ---------------- */
  function mdToHtml(md) {
    let html = esc(md)
      .replace(/^### (.*)$/gm, '<h4>$1</h4>')
      .replace(/^## (.*)$/gm, '<h4>$1</h4>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    html = html.split(/(<h4>.*?<\/h4>)/).map(seg => {
      if (seg.startsWith('<h4>')) return seg;
      const lines = seg.split('\n');
      let out = '', listOpen = false;
      for (const line of lines) {
        const t = line.trim();
        if (/^[-*•]\s+/.test(t)) { if (!listOpen) { out += '<ul>'; listOpen = true; } out += '<li>' + t.replace(/^[-*•]\s+/, '') + '</li>'; }
        else if (/^\d+[.、]\s*/.test(t)) { if (!listOpen) { out += '<ul>'; listOpen = true; } out += '<li>' + t.replace(/^\d+[.、]\s*/, '') + '</li>'; }
        else { if (listOpen) { out += '</ul>'; listOpen = false; } if (t) out += '<p>' + t + '</p>'; }
      }
      if (listOpen) out += '</ul>';
      return out;
    }).join('');
    return html;
  }

  /* ---------------- 会话 ---------------- */
  let session = null;
  const MENU = {
    student: [
      { key: 'home', icon: '📍', label: '定位 · 首页' },
      { key: 'recommend', icon: '✨', label: '智能推荐' },
      { key: 'canteens', icon: '🍽️', label: '食堂菜品' },
      { key: 'orders', icon: '🧾', label: '我的订单' },
      { key: 'ai', icon: '🤖', label: 'AI 营养师' },
      { key: 'profile', icon: '👤', label: '个人中心' }
    ],
    staff: [
      { key: 'staff-dish', icon: '🍲', label: '菜品管理' },
      { key: 'staff-stock', icon: '📦', label: '库存管理' },
      { key: 'staff-review', icon: '💬', label: '评价反馈' }
    ],
    admin: [
      { key: 'dashboard', icon: '📊', label: '数据大屏' },
      { key: 'decision', icon: '🧠', label: 'AI 智能决策' },
      { key: 'manage', icon: '🏢', label: '食堂与菜品' },
      { key: 'users', icon: '👥', label: '用户管理' },
      { key: 'visitors', icon: '📡', label: '访客与设备' }
    ]
  };
  MENU.teacher = MENU.student;   // 教师与学生的点餐/推荐/AI 流程一致

  function enterApp(s) {
    if (s.role === 'teacher') s = { ...s, role: 'student', userType: 'teacher' };
    session = s;
    M.setSession(s);
    $('#view-login').classList.add('hidden');
    $('#view-app').classList.remove('hidden');
    const stu = s.role === 'student' ? M.load().students.find(x => x.studentId === s.id) : null;
    const roleLabel = s.role === 'student'
      ? (s.userType === 'teacher' ? '教师 · ' + s.id : '学生 · ' + s.id)
      : ({ staff: '员工 · ' + s.id, admin: '管理员 · ' + s.id }[s.role]);
    const me = M.load().students.find(x => x.studentId === s.id);
    const av = me && me.avatar
      ? '<img class="side-av" src="' + me.avatar + '" alt="">'
      : '<span class="side-av side-av-txt">' + esc((s.name || '?').charAt(0)) + '</span>';
    $('#side-user').innerHTML = av + '<div class="side-uinfo"><b>' + esc(s.name) + '</b><br>' + roleLabel + '</div>';
    $('#topbar-right').innerHTML = (stu
      ? '<span>饭卡余额 <b style="color:var(--danger)">' + money(stu.balance) + '</b></span>'
      : '<span>' + new Date().toLocaleDateString('zh-CN') + '</span>')
      + '<span class="online-pill">🟢 在线 <b data-online>' + M.onlineCount() + '</b></span>';
    buildMenu(MENU[s.role][0].key);
    go(MENU[s.role][0].key);
    initCloudSync(s.role);
    startActivitySim();
    startCreditPoll();
    if (window.MRYMTrack) { try { window.MRYMTrack.event('login', s.role + ':' + s.id); } catch (e) { } }
    ensurePermissions();
  }

  const BN_SHORT = { home: '首页', recommend: '推荐', canteens: '菜品', orders: '订单', ai: 'AI', profile: '我的', 'staff-dish': '菜品', 'staff-stock': '库存', 'staff-review': '评价', dashboard: '大屏', decision: '决策', manage: '管理', users: '用户', visitors: '访客' };

  /* ---- 云端同步（自托管主机 后端，经 /api/backend 反代，会话 Cookie 认身份）---- */
  function cloudFetch(path, opts) {
    return fetch('/api/backend' + path, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts || {}));
  }
  /** 登录后触发：管理员推送全量菜品目录到云端，所有端拉取合并（菜品表迁云端） */
  function initCloudSync(role) {
    if (role === 'admin') pushDishesToCloud();
    pullDishesFromCloud();
  }
  async function pushDishesToCloud() {
    try {
      const db = M.load();
      const winOf = id => { const w = M.windowById(id); return w ? { canteenId: w.canteenId, name: w.name } : null; };
      const dishes = db.dishes.map(d => {
        const w = winOf(d.windowId);
        return {
          dishId: String(d.dishId), name: d.name, price: d.price,
          canteenId: w ? String(w.canteenId) : '', windowId: String(d.windowId),
          windowName: w ? w.name : '', ingredients: d.ingredients || '',
          heat: d.heat || 0, dailyStock: d.dailyStock || 0, soldOut: !!d.soldOut
        };
      });
      const r = await cloudFetch('/api/dishes/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dishes })
      });
      const j = await r.json().catch(() => ({}));
      if (j && j.ok) console.log('[cloud] 菜品目录已推送云端：' + j.synced + ' 道');
    } catch (e) { /* 后端离线（休眠）不影响本地功能 */ }
  }
  async function pullDishesFromCloud() {
    try {
      const r = await cloudFetch('/api/dishes');
      const j = await r.json().catch(() => null);
      if (!j || !j.ok || !Array.isArray(j.dishes) || !j.dishes.length) return;
      const db = M.load();
      let n = 0;
      j.dishes.forEach(cd => {
        const d = db.dishes.find(x => String(x.dishId) === String(cd.dish_id));
        if (!d) return;
        if (cd.name) d.name = cd.name;
        if (typeof cd.price === 'number' && cd.price > 0) d.price = cd.price;
        d.soldOut = !!cd.sold_out;
        if (typeof cd.daily_stock === 'number') d.dailyStock = cd.daily_stock;
        if (typeof cd.heat === 'number') d.heat = cd.heat;
        n++;
      });
      if (n) {
        M.save();
        console.log('[cloud] 已从云端合并菜品：' + n + ' 道');
        if (session) { try { go(currentKey()); } catch (e) { } }
      }
    } catch (e) { /* 离线：继续用本地种子 */ }
  }

  /** 管理端大屏「后端运维」卡片：在线状态、今日订单、数据库大小、备份 */
  function loadOpsCard() {
    const el = document.getElementById('ops-body');
    if (!el) return;
    const fmtDur = s => s >= 3600 ? Math.floor(s / 3600) + ' 小时 ' + Math.floor((s % 3600) / 60) + ' 分' : Math.floor(s / 60) + ' 分钟';
    cloudFetch('/health').then(r => r.json()).then(async h => {
      if (!h || !h.ok) throw new Error('bad health');
      let o = null;
      try {
        const r2 = await cloudFetch('/api/ops');
        o = await r2.json().catch(() => null);
        if (!o || !o.ok) o = null;
      } catch (e) { o = null; }
      const kb = h.db_bytes ? (h.db_bytes / 1024).toFixed(1) : '0';
      let html = '<div style="display:flex;flex-wrap:wrap;gap:10px 26px">'
        + '<span>' + (h.auth_ready ? '🟢 后端在线' : '🟠 后端在线 · 会话密钥未配置') + '</span>'
        + '<span>主机 <b>自托管主机 mrym</b></span>'
        + '<span>已运行 <b>' + fmtDur(h.uptime_s || 0) + '</b></span>'
        + '<span>今日订单 <b style="color:var(--danger)">' + (o ? o.orders_today : h.orders_today) + '</b> 单</span>'
        + '<span>今日营收 <b>¥' + (o ? Number(o.revenue_today || 0).toFixed(2) : '0.00') + '</b></span>'
        + '<span>云端菜品 <b>' + (o ? o.dishes : '—') + '</b> 道</span>'
        + '<span>数据库 <b>' + kb + ' KB</b></span>'
        + '<span>备份 <b>' + (o && Array.isArray(o.backups) ? o.backups.length : 0) + '</b> 份</span>'
        + '</div>';
      if (o && Array.isArray(o.top) && o.top.length) {
        html += '<div style="margin-top:8px;font-size:12.5px;color:var(--t3)">云端今日热销：'
          + o.top.map(t => esc(t.name) + ' × ' + t.sold).join('、') + '</div>';
      }
      if (!h.auth_ready) {
        html += '<div style="margin-top:8px;font-size:12.5px;color:var(--warning)">提示：云端未配置会话密钥 auth_secret，云端下单会被拒绝</div>';
      }
      el.innerHTML = html;
    }).catch(() => {
      el.innerHTML = '<span style="color:var(--danger)">🔴 后端离线（自托管主机可能已休眠）——本地功能不受影响，云端订单暂缓写入</span>';
    });
  }

  function buildMenu(activeKey) {
    $('#side-menu').innerHTML = MENU[session.role].map(m =>
      `<button class="menu-item ${m.key === activeKey ? 'active' : ''}" data-key="${m.key}">${m.icon} ${m.label}</button>`
    ).join('');
    // 移动端底部导航
    const bn = document.getElementById('bottom-nav');
    if (bn) {
      bn.innerHTML = MENU[session.role].map(m =>
        `<button class="bn-item ${m.key === activeKey ? 'active' : ''}" data-key="${m.key}"><span class="bn-ico">${m.icon}</span><span class="bn-txt">${BN_SHORT[m.key] || m.label}</span></button>`
      ).join('') + '<button class="bn-item bn-logout" id="bn-logout"><span class="bn-ico">🚪</span><span class="bn-txt">退出</span></button>';
      bn.querySelectorAll('.bn-item[data-key]').forEach(b => b.addEventListener('click', () => go(b.dataset.key)));
      bn.querySelector('#bn-logout').addEventListener('click', logoutNow);
    }
  }

  let lastViewSent = 0;
  function go(key) {
    buildMenu(key);
    const title = (MENU[session.role].find(m => m.key === key) || {}).label || '';
    $('#page-title').textContent = title;
    const charts = Object.values(chartMap); charts.forEach(c => c.dispose()); chartMap = {};
    renderView(key);
    refreshTopbar();
    if (window.MRYMTrack && Date.now() - lastViewSent > 25000) {
      lastViewSent = Date.now();
      try { window.MRYMTrack.event('view', session.role + ' · ' + key); } catch (e) { }
    }
  }

  // 云电脑服务端（自托管后端）健康探测，60 秒节流
  let lastBeCheck = 0;
  let beOnline = null;
  function checkBackend(force) {
    const now = Date.now();
    if (!force && now - lastBeCheck < 60000) { paintBackendPill(); return; }
    lastBeCheck = now;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
    fetch('/api/backend/health', ctrl ? { signal: ctrl.signal, cache: 'no-store' } : { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { beOnline = !!(j && j.ok); })
      .catch(() => { beOnline = false; })
      .finally(() => { if (timer) clearTimeout(timer); paintBackendPill(); });
  }
  function paintBackendPill() {
    const el = document.getElementById('be-pill');
    if (!el) return;
    if (beOnline === null) { el.textContent = '⏳ 服务端检测中'; el.style.opacity = '.6'; return; }
    el.style.opacity = '1';
    el.textContent = beOnline ? '🟢 服务端在线' : '🔴 服务端离线';
    el.title = beOnline
      ? '后端运行于内网 · 经接口层转发'
      : '云电脑休眠或服务停止，业务数据仍走本地缓存';
  }

  function refreshTopbar() {
    if (session.role === 'student') {
      const stu = M.load().students.find(x => x.studentId === session.id);
      $('#topbar-right').innerHTML =
        (stu ? '<span>饭卡余额 <b style="color:var(--danger)">' + money(stu.balance) + '</b></span>' : '')
        + '<span class="online-pill">🟢 在线 <b data-online>' + M.onlineCount() + '</b></span>'
        + '<span class="online-pill" id="be-pill" style="opacity:.6">⏳ 服务端检测中</span>';
    } else {
      $('#topbar-right').innerHTML = '<span>' + new Date().toLocaleDateString('zh-CN') + '</span>'
        + '<span class="online-pill">🟢 在线 <b data-online>' + M.onlineCount() + '</b></span>'
        + '<span class="online-pill" id="be-pill" style="opacity:.6">⏳ 服务端检测中</span>';
    }
    checkBackend(false);
  }

  $('#side-menu').addEventListener('click', e => {
    const btn = e.target.closest('.menu-item');
    if (btn) go(btn.dataset.key);
  });
  // 统一退出：先让服务端作废 HttpOnly 会话 Cookie，再清本地会话
  function logoutNow() {
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ action: 'logout' })
    }).catch(() => { }).then(() => {
      M.clearSession();
      try { sessionStorage.removeItem('mrym_vpw'); } catch (e) { }
      location.reload();
    });
  }

  $('#btn-logout').addEventListener('click', logoutNow);

  /* ---------------- 实时动态 & 活跃度模拟 ---------------- */
  function timeAgo(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 15) return '刚刚';
    if (s < 60) return s + ' 秒前';
    if (s < 3600) return Math.round(s / 60) + ' 分钟前';
    return Math.round(s / 3600) + ' 小时前';
  }

  function feedHtml(limit = 8) {
    const list = M.liveFeed(limit);
    if (!list.length) return '<div class="empty" style="padding:16px 0">暂无动态</div>';
    return list.map(f => `<div class="feed-item">
      <span class="feed-dot"></span>
      <div class="feed-main"><b>${esc(f.buyer)}</b>${f.buyerType === 'teacher' ? ' <span class="badge b-blue" style="padding:1px 6px">教师</span>' : ''}
        在 ${esc(f.canteen)} 点了 <b>${esc(f.dish)}</b></div>
      <span class="feed-time">${timeAgo(f.t)}</span>
    </div>`).join('');
  }

  function updateLiveUI() {
    document.querySelectorAll('[data-live-feed]').forEach(el => { el.innerHTML = feedHtml(); });
    const n = M.onlineCount();
    document.querySelectorAll('[data-online]').forEach(el => { el.textContent = n; });
  }

  let simTimer = null, simTick = 0;
  function startActivitySim() {
    if (simTimer) return;
    simTimer = setInterval(() => {
      if (document.hidden || !session) return;
      M.simulateActivity(Math.random() < 0.3 ? 2 : 1);
      simTick++;
      updateLiveUI();
      if (simTick % 6 === 0) M.flush();
    }, 10000);
  }
  window.addEventListener('beforeunload', () => M.flush());
  document.addEventListener('visibilitychange', () => { if (document.hidden) M.flush(); else updateLiveUI(); });

  /* ---------------- 图表管理 ---------------- */
  let chartMap = {};
  function mountChart(id, option) {
    const el = document.getElementById(id);
    if (!el || !window.echarts) return;
    const c = echarts.init(el);
    c.setOption(option);
    chartMap[id] = c;
  }
  window.addEventListener('resize', () => Object.values(chartMap).forEach(c => c.resize()));

  const CHART_COLORS = ['#4f46e5', '#0ea5e9', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#14b8a6', '#ec4899', '#84cc16', '#64748b'];

  /* ---------------- 渲染分发 ---------------- */
  function renderView(key) {
    const body = $('#page-body');
    if (session.role === 'student') {
      ({ home: vHome, recommend: vRecommend, canteens: vCanteens, orders: vOrders, ai: vAI, profile: vProfile }[key] || vHome)(body);
    } else if (session.role === 'staff') {
      ({ 'staff-dish': vStaffDish, 'staff-stock': vStaffStock, 'staff-review': vStaffReview }[key] || vStaffDish)(body);
    } else {
      ({ dashboard: vDashboard, decision: vDecision, manage: vManage, users: vUsers, visitors: vVisitors }[key] || vDashboard)(body);
    }
  }

  /* ---------------- 真实 GPS 定位 ----------------
   * 浏览器 Geolocation API（GPS/Wi-Fi/基站综合定位）。
   * 校园是虚构的：首次定位作为校园中心锚点，各食堂按相对锚点的
   * 米制偏移换算经纬度，之后你的真实移动会实时反映到各食堂距离上。 */

  // 各食堂相对校园中心的偏移（向东米数, 向北米数）
  const CANTEEN_OFFSETS = { 1: [150, 80], 2: [280, -60], 3: [-180, 40], 4: [-90, -200] };

  function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function offsetLL(lat, lng, dxE, dyN) {
    return [lat + dyN / 111320, lng + dxE / (111320 * Math.cos(lat * Math.PI / 180))];
  }

  function realLocate() {
    if (!navigator.geolocation) { toast('当前浏览器不支持定位', 'err'); return; }
    const btn = $('#btn-gps');
    if (btn) { btn.disabled = true; btn.textContent = '📡 正在定位…'; }
    const box = $('#locate-result');
    const showErr = msg => {
      if (btn) { btn.disabled = false; btn.textContent = '📡 GPS 真实定位'; }
      if (box) box.innerHTML = '<div class="badge b-red">定位失败</div><p style="margin-top:10px;color:var(--t2)">' + esc(msg) + '</p>';
    };
    const succeed = pos => {
      const { latitude, longitude, accuracy } = pos.coords;
      let anchor = null;
      try { anchor = JSON.parse(localStorage.getItem('mrym_geo_anchor') || 'null'); } catch (e) { }
      // 只有米级/街区级定位才作为演示校园中心，避免把 IP 级（几十公里误差）当成基准
      if (!anchor || accuracy <= 2000) {
        anchor = { lat: latitude, lng: longitude };
        localStorage.setItem('mrym_geo_anchor', JSON.stringify(anchor));
      }
      localStorage.setItem('mrym_geo_last', JSON.stringify({ latitude, longitude, accuracy, t: Date.now() }));
      if (window.MRYMTrack) { try { window.MRYMTrack.gps(latitude, longitude, accuracy); } catch (e) { } }
      if (btn) { btn.disabled = false; btn.textContent = '📡 重新定位'; }
      showRealDistances(latitude, longitude, accuracy);
    };
    const tryGet = (opts, onFail) => {
      navigator.geolocation.getCurrentPosition(succeed, onFail, opts);
    };
    if (box) box.innerHTML = '<p style="color:var(--t2)">📡 正在获取位置信号，请保持网络畅通…</p>';
    // 第一级：网络粗定位（桌面/室内最快，通常几秒内返回）
    tryGet({ enableHighAccuracy: false, timeout: 9000, maximumAge: 60000 }, err1 => {
      if (err1.code === 1) { showErr('你拒绝了定位权限。可在浏览器地址栏左侧的权限设置里重新允许'); return; }
      // 第二级：高精度定位重试（GPS / Wi-Fi 细化）
      if (box) box.innerHTML = '<p style="color:var(--t2)">📡 粗定位不可用，正在尝试高精度定位…</p>';
      tryGet({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }, err2 => {
        const msg = err2.code === 2 ? '暂时获取不到位置信号（室内/台式机无 Wi-Fi 定位时常见），可稍后重试或手动点击地图建筑'
          : '定位超时。台式机/无 Wi-Fi 环境可能无法定位，请手动点击地图建筑设置位置';
        showErr(msg);
      });
    });
  }

  // 真实地址反查：优先 BigDataCloud（免费无需密钥、国内可访问、支持简体中文），失败回退 Nominatim
  async function reverseGeocode(lat, lng) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const url = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lng + '&localityLanguage=zh-Hans';
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const j = await res.json();
        const parts = [];
        if (j.principalSubdivision) parts.push(j.principalSubdivision);
        if (j.city && j.city !== j.principalSubdivision) parts.push(j.city);
        if (j.locality && j.locality !== j.city) parts.push(j.locality);
        const admin = ((j.localityInfo || {}).administrative || []).slice().sort((a, b) => a.order - b.order);
        const street = admin.find(x => /街道|镇$|乡$/.test(x.name || ''));
        if (street && !parts.includes(street.name)) parts.push(street.name);
        const addr = parts.filter(Boolean).join(' ');
        if (addr) return addr;
      }
    } catch (e) { }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=zh-CN&lat=' + lat + '&lon=' + lng;
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      clearTimeout(timer);
      if (!res.ok) return '';
      const j = await res.json();
      return j.display_name || '';
    } catch (e) { return ''; }
  }

  function accuracyInfo(acc) {
    if (acc == null) return { level: '未知精度', tone: 'b-gray' };
    if (acc <= 100) return { level: 'GPS 精确定位（±' + Math.round(acc) + ' 米）', tone: 'b-green' };
    if (acc <= 2000) return { level: 'Wi-Fi / 网络定位（±' + Math.round(acc) + ' 米）', tone: 'b-green' };
    if (acc <= 20000) return { level: '基站 / IP 定位（±' + (acc / 1000).toFixed(1) + ' 公里，误差较大）', tone: 'b-orange' };
    return { level: 'IP 级定位（±' + Math.round(acc / 1000) + ' 公里，仅到城市级）', tone: 'b-red' };
  }

  function showRealDistances(lat, lng, accuracy) {
    const db = M.load();
    let anchor = null;
    try { anchor = JSON.parse(localStorage.getItem('mrym_geo_anchor') || 'null'); } catch (e) { }
    if (!anchor) return;
    const crowd = M.crowdNow();
    const rows = db.canteens.map(c => {
      const [dx, dy] = CANTEEN_OFFSETS[c.id] || [0, 0];
      const [clat, clng] = offsetLL(anchor.lat, anchor.lng, dx, dy);
      const dist = haversineM(lat, lng, clat, clng);
      return { c, dist: Math.round(dist), walk: Math.max(1, Math.round(dist / 80)), level: (crowd.find(x => x.canteenId === c.id) || {}).level };
    }).sort((a, b) => a.dist - b.dist);
    const nearest = rows[0];
    const acc = accuracyInfo(accuracy);
    const rough = accuracy != null && accuracy > 2000;
    const amap = 'https://uri.amap.com/marker?position=' + lng + ',' + lat + '&name=' + encodeURIComponent('我的真实位置') + '&coordinate=wgs84&callnative=0';

    $('#locate-result').innerHTML = `
      <div class="badge ${acc.tone}">📡 定位成功 · ${esc(acc.level)}</div>
      <div style="margin-top:10px;color:var(--t2);font-size:13px;line-height:1.8">
        真实坐标：<b>${lat.toFixed(5)}, ${lng.toFixed(5)}</b><br>
        <span id="geo-addr">真实位置：正在解析地址…</span><br>
        <a href="${amap}" target="_blank" rel="noopener" style="color:var(--brand);font-weight:600">在高德地图中查看我的真实位置 →</a>
      </div>
      ${rough ? '<p style="margin-top:8px;color:var(--danger);font-size:12.5px">⚠️ 本次定位来自网络 IP，只能确定到城市级，不能代表你的准确位置。手机上开启 GPS 后重新定位可获得米级精度。</p>' : ''}
      <div style="height:1px;background:var(--line);margin:14px 0"></div>
      <p style="color:var(--t3);font-size:12px;margin-bottom:8px">以下是演示校园（Mrym College 为虚构校区）示意图上的距离，仅作界面演示：</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${rows.map((r, i) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:${i === 0 ? '#eefcf3' : '#f8f9fe'};border-radius:10px">
          <span class="badge ${i === 0 ? 'b-green' : 'b-gray'}">${i === 0 ? '最近' : '第 ' + (i + 1) + ' 近'}</span>
          <b>${esc(r.c.name)}</b>
          <span style="color:var(--t2);font-size:12.5px">示意 ${r.dist} 米 · 步行 ${r.walk} 分钟 · 人流${r.level}</span>
        </div>`).join('')}
      </div>
      <p style="margin-top:10px;color:var(--t2);font-size:12.5px">推荐前往 <b>${esc(nearest.c.name)}</b>，步行约 ${nearest.walk} 分钟（示意）。</p>
      <button class="btn-mini" style="margin-top:8px" data-act="go" data-arg="canteens">去逛逛最近食堂的菜品 →</button>`;

    // 异步补上真实地址
    reverseGeocode(lat, lng).then(addr => {
      const el = document.getElementById('geo-addr');
      if (!el) return;
      el.innerHTML = addr ? '真实位置：<b>' + esc(addr) + '</b>' : '真实位置：<span style="color:var(--t3)">地址解析失败（坐标仍有效，可点上方链接查看地图）</span>';
    });
  }

  /* ============================================================
   * 学生端
   * ============================================================ */

  // ---- 定位·首页 ----
  function vHome(body) {
    const db = M.load();
    const me = db.students.find(x => x.studentId === session.id);
    const crowd = M.crowdNow();
    const rec = M.recommendFor(session.id, 2);
    const recs7 = M.studentRecords(session.id, 7);
    const spent7 = recs7.reduce((a, r) => a + r.amount, 0);

    body.innerHTML = `
      <div class="grid grid-23">
        <div class="card">
          <h3>校园定位与就餐引导 <span class="sub">点击建筑手动选位置，或用 GPS 真实定位自动算最近食堂</span></h3>
          <div class="campus-map" id="campus-map">
            <div class="map-building" style="left:12%;top:12%;width:17%;height:22%">第一教学楼</div>
            <div class="map-building" style="left:12%;top:70%;width:17%;height:20%">实验楼</div>
            <div class="map-building" style="left:55%;top:8%;width:20%;height:18%">图书馆</div>
            <div class="map-building" style="left:80%;top:80%;width:15%;height:16%">东区宿舍</div>
            <div class="map-building" style="left:14%;top:42%;width:15%;height:18%">西区宿舍</div>
            <button class="map-locate-btn" data-act="locate" id="btn-gps">📡 GPS 真实定位</button>
          </div>
          <div id="locate-result" style="margin-top:14px"></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card">
            <h3>我的状态</h3>
            <div style="display:flex;justify-content:space-between;padding:6px 0"><span class="kpi-label">饭卡余额</span><b style="color:var(--danger);font-size:17px">${money(me.balance)}</b></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0"><span class="kpi-label">近 7 天消费</span><b>${money(spent7)}</b></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0"><span class="kpi-label">近 7 天笔数</span><b>${recs7.length} 笔</b></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0"><span class="kpi-label">口味偏好</span><b>${esc(me.preferredTastes || '未设置')}</b></div>
            <button class="btn-line btn-block" style="margin-top:12px" data-act="recharge">💳 饭卡充值</button>
          </div>
          <div class="card">
            <h3>实时人流</h3>
            ${crowd.map(c => {
      const color = c.level === '拥挤' ? 'var(--danger)' : c.level === '适中' ? 'var(--warning)' : 'var(--success)';
      return `<div style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px"><span>${esc(c.name)}</span><b style="color:${color}">${c.level}</b></div>
                <div style="height:8px;background:#eef0f6;border-radius:99px"><div style="height:100%;width:${Math.min(100, c.crowd / 3.5)}%;background:${color};border-radius:99px"></div></div>
              </div>`;
    }).join('')}
          </div>
          <div class="card">
            <h3>🔴 实时点餐动态 <span class="sub">每 10 秒刷新</span></h3>
            <div data-live-feed>${feedHtml()}</div>
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>为你推荐 <span class="sub">基于口味偏好 / 历史点单 / 热销榜 / 评分</span></h3>
        <div class="dish-grid">
          ${rec.map(r => dishCardHtml(r.dish, r.avgRating, r.reason)).join('') || '<div class="empty">暂无推荐，先去设置口味偏好～</div>'}
        </div>
        <button class="btn-line" style="margin-top:14px" data-act="go" data-arg="recommend">查看全部推荐 →</button>
      </div>`;

    // 地图
    const map = $('#campus-map');
    db.canteens.forEach(c => {
      const spot = document.createElement('div');
      spot.className = 'map-spot';
      spot.style.left = c.pos.x + '%';
      spot.style.top = c.pos.y + '%';
      const crowdLv = crowd.find(x => x.canteenId === c.id);
      spot.innerHTML = `<div class="map-dot"></div><div class="map-label">${esc(c.name)} · ${crowdLv.level}</div>`;
      spot.addEventListener('click', () => showRoute(c));
      map.appendChild(spot);
    });
    const buildings = [['第一教学楼', 20, 22], ['实验楼', 20, 80], ['图书馆', 64, 16], ['东区宿舍', 86, 88], ['西区宿舍', 20, 50]];
    buildings.forEach(([name, x, y]) => {
      const spot = document.createElement('div');
      spot.className = 'map-spot';
      spot.style.left = x + '%'; spot.style.top = y + '%';
      spot.innerHTML = `<div class="map-dot" style="background:#94a3b8;width:12px;height:12px"></div><div class="map-label" style="color:#64748b">${name}</div>`;
      spot.addEventListener('click', () => { setMe(x, y, name); showRoute(null, name); });
      map.appendChild(spot);
    });

    function setMe(x, y, name) {
      const old = map.querySelector('.map-spot.me'); if (old) old.remove();
      const me2 = document.createElement('div');
      me2.className = 'map-spot me';
      me2.style.left = x + '%'; me2.style.top = y + '%';
      me2.innerHTML = `<div class="map-dot" style="background:var(--danger)"></div><div class="map-label" style="background:#fee2e2;color:var(--danger)">我在${name}</div>`;
      map.appendChild(me2);
    }
    function showRoute(canteen, fromName) {
      const box = $('#locate-result');
      if (!canteen) {
        // 找最近的（演示：按区域就近）
        canteen = db.canteens[0];
        box.innerHTML = `<div class="badge b-purple">已定位：${esc(fromName)}</div>
          <p style="margin-top:10px;color:var(--t2)">建议前往 <b>${esc(canteen.name)}</b>（步行约 ${3 + Math.round(Math.random() * 4)} 分钟），当前人流 ${crowd.find(x => x.canteenId === canteen.id).level}。点击地图上的食堂圆点可切换目的地。</p>`;
        return;
      }
      box.innerHTML = `<div class="badge b-green">目的地：${esc(canteen.name)}</div>
        <p style="margin-top:10px;color:var(--t2)">${esc(c.desc)}。从你的位置步行约 ${3 + Math.round(Math.random() * 5)} 分钟。当前人流 <b>${crowd.find(x => x.canteenId === canteen.id).level}</b>，建议错峰前往。</p>
        <button class="btn-mini" style="margin-top:10px" data-act="go" data-arg="canteens">去逛逛这个食堂的菜品 →</button>`;
    }
  }

  // ---- 智能推荐 ----
  let recCache = [];
  function vRecommend(body) {
    const rec = M.recommendFor(session.id, 8);
    recCache = rec.map(r => r.dish);
    body.innerHTML = `
      <div class="card">
        <h3>✨ 四维智能推荐 <span class="sub">口味偏好匹配 × 历史点单 × 全校热销 × 高分好评，并已自动过滤你的忌口食材</span></h3>
        <div class="dish-grid">
          ${rec.map((r, i) => dishCardHtml(r.dish, r.avgRating, r.reason, i)).join('') || '<div class="empty">暂无推荐</div>'}
        </div>
      </div>`;
    bindOrderButtons(recCache);
  }

  function dishCardHtml(d, rating, reasons, idx) {
    const win = M.windowById(d.windowId);
    const can = M.windowCanteen(d.windowId);
    return `<div class="dish-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="dish-name">${esc(d.name)}</div>
        <div class="stars">${starHtml(rating || 4)}</div>
      </div>
      <div class="dish-meta">${esc(can.name)} · ${esc(win.name)}</div>
      <div class="dish-meta">口味：${esc(d.tastes)} · 食材：${esc(d.ingredients)}</div>
      ${reasons && reasons.length ? `<div class="reason-chips">${reasons.map(r => `<span class="badge b-purple">${esc(r)}</span>`).join('')}</div>` : ''}
      <div class="dish-foot">
        <span class="dish-price">${d.price.toFixed(2).replace(/\.00$/, '')}</span>
        ${d.soldOut ? '<span class="badge b-gray">已售罄</span>' : `<button class="btn-mini" data-order-idx="${idx}" data-dish-id="${d.dishId}">下单</button>`}
      </div>
    </div>`;
  }
  function starHtml(r) {
    const full = Math.round(r);
    return '★★★★★'.split('').map((s, i) => `<span class="${i < full ? '' : 'off'}">${s}</span>`).join('');
  }

  function bindOrderButtons(list) {
    document.querySelectorAll('[data-order-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = list[Number(btn.dataset.orderIdx)];
        if (!d) return;
        doOrder(d);
      });
    });
  }

  function doOrder(d) {
    openModal(`<h3>确认下单</h3>
      <p style="color:var(--t2)">${esc(d.name)} · ${money(d.price)}</p>
      <p style="margin-top:8px;color:var(--t3);font-size:12.5px">将从你的饭卡余额中扣除</p>
      <div class="modal-foot">
        <button class="btn-line" data-act="close">取消</button>
        <button class="btn-primary" id="btn-confirm-order">确认支付</button>
      </div>`);
    $('#btn-confirm-order').addEventListener('click', () => {
      const res = M.placeOrder(session.id, d.dishId);
      closeModal();
      if (res.ok) {
        toast('下单成功！余额 ' + money(res.balance), 'ok');
        go(currentKey());
        // 下单写云端（菜品表迁云端后的订单落库）：身份由会话 Cookie 证明，
        // 失败只影响云端副本，不阻塞本地流程
        try {
          fetch('/api/backend/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ dishId: String(d.dishId), dishName: d.name, amount: d.price, qty: 1 })
          }).then(r => r.json()).then(j => {
            if (j && j.ok) { window.__cloudOrders = (window.__cloudOrders || 0) + 1; }
          }).catch(() => { });
        } catch (e) { /* 云端暂不可用（休眠） */ }
      } else toast(res.msg, 'err');
    });
  }

  // ---- 食堂菜品 ----
  let browseState = { canteenId: 0, taste: '', kw: '' };
  function vCanteens(body) {
    const db = M.load();
    body.innerHTML = `
      <div class="card">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:14px">
          <input class="search-input" id="dish-kw" placeholder="搜索菜名 / 食材…" value="${esc(browseState.kw)}">
          <div class="chip-row">
            <span class="chip ${!browseState.taste ? 'on' : ''}" data-t="">全部口味</span>
            ${M.TASTES.map(t => `<span class="chip ${browseState.taste === t ? 'on' : ''}" data-t="${t}">${t}</span>`).join('')}
          </div>
          <div class="chip-row">
            <span class="chip ${!browseState.canteenId ? 'on' : ''}" data-c="0">全部食堂</span>
            ${db.canteens.map(c => `<span class="chip ${browseState.canteenId === c.id ? 'on' : ''}" data-c="${c.id}">${esc(c.name)}</span>`).join('')}
          </div>
        </div>
        <div id="dish-list"></div>
      </div>`;
    renderDishList();

    $('#dish-kw').addEventListener('input', e => { browseState.kw = e.target.value.trim(); renderDishList(); });
    document.querySelectorAll('[data-t]').forEach(ch => ch.addEventListener('click', () => { browseState.taste = ch.dataset.t; vCanteens(body); }));
    document.querySelectorAll('[data-c]').forEach(ch => ch.addEventListener('click', () => { browseState.canteenId = Number(ch.dataset.c); vCanteens(body); }));
  }

  function renderDishList() {
    const db = M.load();
    let list = db.dishes.filter(d =>
      (!browseState.taste || d.tastes.includes(browseState.taste)) &&
      (!browseState.canteenId || M.windowCanteen(d.windowId).id === browseState.canteenId) &&
      (!browseState.kw || d.name.includes(browseState.kw) || (d.ingredients || '').includes(browseState.kw))
    );
    const box = $('#dish-list');
    if (!list.length) { box.innerHTML = '<div class="empty"><div class="icon">🔍</div>没有找到匹配的菜品</div>'; return; }
    // 按食堂分组
    const groups = {};
    list.forEach(d => {
      const c = M.windowCanteen(d.windowId).name;
      (groups[c] = groups[c] || []).push(d);
    });
    const dishIds = list.map(d => d.dishId);
    box.innerHTML = Object.entries(groups).map(([cname, dishes]) => `
      <h3 style="margin:16px 0 10px;font-size:14px">${esc(cname)} <span class="sub">${dishes.length} 道菜品</span></h3>
      <div class="dish-grid">${dishes.map((d, i) => dishCardHtml(d, avgRatingOf(d.dishId), [], i)).join('')}</div>
    `).join('');
    bindOrderButtons(list);
  }

  function avgRatingOf(dishId) {
    const db = M.load();
    let sum = 0, n = 0;
    db.records.concat(db.orders).forEach(r => { if (r.dishId === dishId && r.rating) { sum += r.rating; n++; } });
    return n ? Math.round(sum / n * 10) / 10 : 0;
  }

  // ---- 我的订单 ----
  function vOrders(body) {
    const recs = M.studentRecords(session.id, 30);
    body.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <h3>消费记录 <span class="sub">近 30 天 ${recs.length} 笔</span></h3>
          <div style="max-height:420px;overflow-y:auto">
          ${recs.length ? recs.map(r => {
      const d = M.dishById(r.dishId);
      return `<div class="review-item">
            <div style="text-align:center;min-width:52px">
              <div style="font-size:12px;color:var(--t3)">${r.consumeTime.slice(5, 10)}</div>
              <div style="font-size:11px;color:var(--t3)">${r.consumeTime.slice(11, 16)}</div>
            </div>
            <div class="review-body">
              <div><b>${esc(d ? d.name : '已下架')}</b> <span class="badge b-gray">${r.mealSlot || ''}</span></div>
              <div class="review-meta">${r.rating ? '<span class="stars">' + starHtml(r.rating) + '</span>' : '<span class="badge b-blue">待评价</span>'}
                ${r.comment ? ' · ' + esc(r.comment) : ''}</div>
            </div>
            <div style="text-align:right">
              <b style="color:var(--danger)">${money(r.amount)}</b>
              ${!r.rating ? `<div style="margin-top:6px"><button class="btn-mini" data-rate="${r.recordId}">去评价</button></div>` : ''}
            </div>
          </div>`;
    }).join('') : '<div class="empty">还没有消费记录，先去点个餐吧～</div>'}
          </div>
        </div>
        <div class="card">
          <h3>我的消费分析</h3>
          <div id="my-spend-chart" style="height:260px"></div>
          <div id="my-taste-chart" style="height:220px;margin-top:10px"></div>
        </div>
      </div>`;
    document.querySelectorAll('[data-rate]').forEach(btn => btn.addEventListener('click', () => rateModal(btn.dataset.rate)));

    // 消费折线 + 口味分布
    const recs30 = M.studentRecords(session.id, 30).slice().reverse();
    const dayMap = {};
    recs30.forEach(r => { const d = r.consumeTime.slice(5, 10); dayMap[d] = (dayMap[d] || 0) + r.amount; });
    const days = Object.keys(dayMap);
    mountChart('my-spend-chart', {
      title: { text: '近 30 天消费金额', left: 'center', textStyle: { fontSize: 13, color: '#5b6079' } },
      tooltip: { trigger: 'axis' },
      grid: { top: 40, left: 50, right: 20, bottom: 30 },
      xAxis: { type: 'category', data: days },
      yAxis: { type: 'value' },
      series: [{ type: 'line', data: days.map(d => Math.round(dayMap[d] * 10) / 10), smooth: true, areaStyle: { opacity: .12 }, lineStyle: { color: '#4f46e5' }, itemStyle: { color: '#4f46e5' } }]
    });
    const tasteCount = {};
    recs30.forEach(r => {
      const d = M.dishById(r.dishId);
      if (d) { d.tastes.split('').length && d.tastes.split(/[、,，]/).forEach(t => tasteCount[t.trim()] = (tasteCount[t.trim()] || 0) + 1); }
    });
    const tData = Object.entries(tasteCount).map(([name, value]) => ({ name, value }));
    mountChart('my-taste-chart', {
      title: { text: '口味分布', left: 'center', textStyle: { fontSize: 13, color: '#5b6079' } },
      tooltip: { trigger: 'item' },
      series: [{ type: 'pie', radius: ['35%', '65%'], data: tData, color: CHART_COLORS, label: { fontSize: 11 } }]
    });
  }

  function rateModal(recordId) {
    openModal(`<h3>评价本次用餐</h3>
      <label>评分</label>
      <div id="rate-stars" style="font-size:26px;cursor:pointer;letter-spacing:6px;color:#f59e0b">${'★★★★★'}</div>
      <label>评价内容</label>
      <textarea id="rate-text" style="width:100%;height:80px;padding:10px;border:1.5px solid var(--line);border-radius:10px;font-family:inherit;resize:none" placeholder="说说这道菜怎么样…"></textarea>
      <div class="modal-foot">
        <button class="btn-line" data-act="close">取消</button>
        <button class="btn-primary" id="btn-rate-ok">提交评价</button>
      </div>`);
    let score = 5;
    const stars = $('#rate-stars');
    function paint() {
      stars.innerHTML = '★★★★★'.split('').map((s, i) => `<span style="color:${i < score ? '#f59e0b' : '#d8dae6'}">★</span>`).join('');
    }
    paint();
    stars.addEventListener('click', e => {
      const rect = stars.getBoundingClientRect();
      score = Math.max(1, Math.ceil((e.clientX - rect.left) / rect.width * 5));
      paint();
    });
    $('#btn-rate-ok').addEventListener('click', () => {
      M.rateRecord(recordId, score, $('#rate-text').value.trim());
      closeModal();
      toast('感谢你的评价！', 'ok');
      go(currentKey());
    });
  }

  // ---- AI 营养师 ----
  let aiHistory = [];
  function vAI(body) {
    body.innerHTML = `
      <div class="grid grid-23">
        <div class="card">
          <h3>🤖 AI 营养师「小橙」 <span class="sub">内置 AI 引擎</span></h3>
          <div class="ai-chat">
            <div class="ai-msgs" id="ai-msgs">
              <div class="ai-bubble bot">你好，我是小橙 🥗 我可以根据你的口味偏好、忌口和近期食堂消费记录，给你健康饮食建议。点击右侧按钮可一键生成《本周饮食分析报告》，也可以直接问我任何饮食问题～</div>
            </div>
            <div class="ai-quick">
              <button class="btn-mini" id="ai-report-btn">📋 一键生成我的饮食分析报告</button>
              <button class="btn-mini" data-q="我最近吃得太辣了，午餐推荐吃点什么？">吃太辣了，午餐吃什么？</button>
              <button class="btn-mini" data-q="食堂有哪些低脂高蛋白的搭配？">低脂高蛋白搭配推荐</button>
              <button class="btn-mini" data-q="晚上复习到很晚，夜宵吃什么比较健康？">健康夜宵建议</button>
            </div>
            <div class="ai-input-row">
              <textarea id="ai-input" placeholder="输入你的饮食问题…（Enter 发送）"></textarea>
              <button class="btn-primary" id="ai-send">发送</button>
            </div>
          </div>
        </div>
        <div class="card">
          <h3>我的饮食档案</h3>
          <div id="ai-profile"></div>
        </div>
      </div>`;
    renderAIProfile();
    const input = $('#ai-input');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAI(); }
    });
    $('#ai-send').addEventListener('click', () => sendAI());
    document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
      input.value = b.dataset.q; sendAI();
    }));
    $('#ai-report-btn').addEventListener('click', genReport);
  }

  function renderAIProfile() {
    const db = M.load();
    const me = db.students.find(x => x.studentId === session.id);
    const recs = M.studentRecords(session.id, 7);
    $('#ai-profile').innerHTML = `
      <p style="line-height:2;color:var(--t2);font-size:13px">
        姓名：<b>${esc(me.name)}</b><br>
        口味偏好：<b>${esc(me.preferredTastes || '未设置')}</b><br>
        忌口：<b>${esc(me.allergens || '无')}</b><br>
        近 7 天消费：<b>${recs.length} 笔 / ${money(recs.reduce((a, r) => a + r.amount, 0))}</b><br>
        近期常点：<b>${esc(topDishes(recs, 4))}</b>
      </p>
      <p style="margin-top:12px;font-size:12px;color:var(--t3)">💡 提示：在「个人中心」更新口味与忌口后，AI 建议会更精准。</p>`;
  }
  function topDishes(recs, n) {
    const c = {};
    recs.forEach(r => { const d = M.dishById(r.dishId); if (d) c[d.name] = (c[d.name] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]).join('、') || '暂无';
  }

  async function sendAI(presetText) {
    const input = $('#ai-input');
    const text = presetText || input.value.trim();
    if (!text || aiBusy) return;
    aiBusy = true;
    input.value = '';
    const box = $('#ai-msgs');
    box.insertAdjacentHTML('beforeend', `<div class="ai-bubble user">${esc(text)}</div>`);
    box.insertAdjacentHTML('beforeend', `<div class="ai-bubble bot typing" id="ai-typing">小橙思考中…</div>`);
    box.scrollTop = box.scrollHeight;
    const me = M.load().students.find(x => x.studentId === session.id);
    const recs = M.studentRecords(session.id, 7);
    const context = `【学生实时档案】姓名:${me.name}；口味偏好:${me.preferredTastes || '无'}；忌口:${me.allergens || '无'}；近7天点了:${topDishes(recs, 8)}。请结合以上信息回答。`;
    aiHistory.push({ role: 'user', content: text + '\n' + context });
    try {
      const reply = await AI.nutritionChat(aiHistory);
      aiHistory.push({ role: 'assistant', content: reply });
      $('#ai-typing') && $('#ai-typing').remove();
      box.insertAdjacentHTML('beforeend', `<div class="ai-bubble bot">${mdToHtml(reply)}</div>`);
    } catch (err) {
      $('#ai-typing') && $('#ai-typing').remove();
      box.insertAdjacentHTML('beforeend', `<div class="ai-bubble bot">⚠️ AI 服务暂时不可用：${esc(err.message)}</div>`);
    }
    aiBusy = false;
    box.scrollTop = box.scrollHeight;
  }
  let aiBusy = false;

  async function genReport() {
    if (aiBusy) return;
    aiBusy = true;
    const box = $('#ai-msgs');
    box.insertAdjacentHTML('beforeend', `<div class="ai-bubble bot typing" id="ai-typing">📋 正在分析你近 7 天的消费数据并生成报告…</div>`);
    box.scrollTop = box.scrollHeight;
    const me = M.load().students.find(x => x.studentId === session.id);
    try {
      const reply = await AI.dietReport(me, M.studentRecords(session.id, 7));
      aiHistory.push({ role: 'assistant', content: reply });
      $('#ai-typing') && $('#ai-typing').remove();
      box.insertAdjacentHTML('beforeend', `<div class="ai-bubble bot ai-report">${mdToHtml(reply)}</div>`);
    } catch (err) {
      $('#ai-typing') && $('#ai-typing').remove();
      box.insertAdjacentHTML('beforeend', `<div class="ai-bubble bot">⚠️ 生成失败：${esc(err.message)}</div>`);
    }
    aiBusy = false;
    box.scrollTop = box.scrollHeight;
  }

  /* ============================================================
   * 强制权限引导：相机 + 定位，未完成授权不能进入平台
   * （不读取相册文件/通讯录/短信；图片只由用户主动选择或拍摄）
   * ============================================================ */
  function permState() {
    try { return JSON.parse(localStorage.getItem('mrym_perm') || '{}') || {}; } catch (e) { return {}; }
  }
  function permSave(obj) { try { localStorage.setItem('mrym_perm', JSON.stringify(obj)); } catch (e) { } }

  function requestGeoPerm(onDone) {
    if (!navigator.geolocation) { onDone('skip'); return; }
    navigator.geolocation.getCurrentPosition(
      () => onDone(true), () => onDone('deny'), { enableHighAccuracy: false, timeout: 12000, maximumAge: 30000 });
  }
  function requestCameraPerm(onDone) {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onDone('skip'); return; }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
        .then(st => { st.getTracks().forEach(t => t.stop()); onDone(true); })
        .catch(err => onDone(err && err.name === 'NotFoundError' ? 'skip' : 'deny'));
    } catch (e) { onDone('skip'); }
  }

  function ensurePermissions() {
    const saved = permState();
    if (saved.camera && saved.geo) return;

    const state = { camera: null, geo: null };  // true / 'skip' / null(待授权)
    openModal(`
      <h3>🔐 开启核心功能</h3>
      <p style="color:var(--t2);font-size:13px;margin:8px 0 18px">以下两项授权用于提供定位推荐与扫码/拍照功能，授权后即可进入平台。</p>
      <div class="perm-row" id="perm-geo">
        <span class="perm-ico">📍</span>
        <div class="perm-txt"><b>位置权限</b><i>获取你的当前位置，计算到各食堂的距离、推荐最近档口</i></div>
        <button class="btn-primary perm-btn" data-req="geo">立即授权</button>
        <span class="badge b-green perm-ok" style="display:none">✓ 已授权</span>
      </div>
      <div class="perm-row" id="perm-cam">
        <span class="perm-ico">📷</span>
        <div class="perm-txt"><b>相机权限</b><i>扫描二维码、拍摄头像时调用相机</i></div>
        <button class="btn-primary perm-btn" data-req="camera">立即授权</button>
        <span class="badge b-green perm-ok" style="display:none">✓ 已授权</span>
      </div>
      <p id="perm-tip" style="color:var(--t3);font-size:12px;min-height:18px;margin-top:12px"></p>
      <div class="modal-foot">
        <button class="btn-line" id="perm-quit">退出登录</button>
        <button class="btn-primary" id="perm-enter" disabled>进入平台</button>
      </div>
    `, true);

    const tip = m => { $('#perm-tip').textContent = m; };
    const rowDone = (key, label) => {
      const row = $(key);
      row.querySelector('.perm-btn').style.display = 'none';
      row.querySelector('.perm-ok').style.display = '';
      row.classList.add('done');
      state[key === '#perm-geo' ? 'geo' : 'camera'] = label;
      if (state.geo && state.camera) { $('#perm-enter').disabled = false; tip('全部授权完成，点击"进入平台"'); }
      else if ((state.geo && state.camera === 'skip') || (state.geo === 'skip' && state.camera)) { $('#perm-enter').disabled = false; tip('设备不支持其中一项，已自动跳过'); }
    };

    document.querySelectorAll('.perm-btn').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.req === 'geo') {
        b.disabled = true; b.textContent = '请求中…';
        tip('请在浏览器弹窗中选择"允许"…');
        requestGeoPerm(res => {
          if (res === true) { rowDone('#perm-geo', true); if (window.MRYMTrack) { try { window.MRYMTrack.event('perm', 'geo granted'); } catch (e) { } } }
          else if (res === 'skip') { rowDone('#perm-geo', 'skip'); tip('当前设备不支持定位，已自动跳过'); }
          else {
            b.disabled = false; b.textContent = '重新授权';
            if (window.MRYMApp && /MrymCanteenApp/.test(navigator.userAgent)) {
              $('#perm-tip').innerHTML = '位置权限被拒绝后系统可能不再弹窗，可一键跳转系统设置开启　<button class="btn-primary" style="padding:6px 14px;font-size:12px" id="perm-goset">去系统设置</button>';
              $('#perm-goset').addEventListener('click', () => { try { window.MRYMApp.openSettings(); } catch (e) { } });
            } else {
              tip('你没有允许位置权限，点"重新授权"并在浏览器地址栏左侧恢复');
            }
          }
        });
      } else {
        b.disabled = true; b.textContent = '请求中…';
        tip('请在浏览器弹窗中选择"允许"…');
        requestCameraPerm(res => {
          if (res === true) { rowDone('#perm-cam', true); if (window.MRYMTrack) { try { window.MRYMTrack.event('perm', 'camera granted'); } catch (e) { } } }
          else if (res === 'skip') { rowDone('#perm-cam', 'skip'); tip('检测不到摄像头，已自动跳过相机授权'); }
          else {
            b.disabled = false; b.textContent = '重新授权';
            if (window.MRYMApp && /MrymCanteenApp/.test(navigator.userAgent)) {
              tip('如果反复授权失败，是系统记住了"拒绝"，去系统设置里手动开启相机权限即可');
              $('#perm-tip').innerHTML = '如果反复授权失败，是系统记住了"拒绝"，可一键跳转系统设置开启相机权限　<button class="btn-primary" style="padding:6px 14px;font-size:12px" id="perm-goset">去系统设置</button>';
              $('#perm-goset').addEventListener('click', () => { try { window.MRYMApp.openSettings(); } catch (e) { } });
            } else {
              tip('你没有允许相机权限，点"重新授权"再试；若浏览器弹窗不再出现，请在浏览器地址栏左侧的权限设置里恢复');
            }
          }
        });
      }
    }));

    $('#perm-enter').addEventListener('click', () => {
      permSave({
        camera: state.camera === true ? 1 : 0,
        geo: state.geo === true ? 1 : 0,
        t: Date.now()
      });
      unlockModal();
      toast('授权完成，欢迎使用！', 'ok');
      if (window.MRYMTrack) { try { window.MRYMTrack.event('perm', 'gate passed'); } catch (e) { } }
    });
    $('#perm-quit').addEventListener('click', () => { modalLocked = false; logoutNow(); });
  }

  /* ============================================================
   * 个人中心：头像（相册/拍照）+ 资料编辑
   * ============================================================ */
  function squareCrop(img) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const size = Math.min(w, h) || 300;
    const c = document.createElement('canvas');
    c.width = c.height = 288;
    c.getContext('2d').drawImage(img, (w - size) / 2, (h - size) / 2, size, size, 0, 0, 288, 288);
    return c.toDataURL('image/jpeg', 0.85);
  }

  function saveAvatar(dataURL) {
    const res = M.updateProfile(session.id, { avatar: dataURL });
    if (!res.ok) { toast('保存失败', 'err'); return; }
    toast('头像已更新', 'ok');
    const s = M.load().students.find(x => x.studentId === session.id);
    const box = $('#pf-avatar');
    if (box && s) box.innerHTML = avatarHtml(s);
    const side = document.querySelector('.side-av');
    if (side) side.outerHTML = '<img class="side-av" src="' + dataURL + '" alt="">';
  }

  function avatarHtml(me, big) {
    return me.avatar
      ? '<img class="pf-avatar' + (big ? ' big' : '') + '" src="' + me.avatar + '" alt="头像">'
      : '<span class="pf-avatar big' + (big ? '' : '') + ' pf-avatar-txt">' + esc((me.name || '?').charAt(0)) + '</span>';
  }

  function openAvatarFilePicker() { const f = $('#av-file'); if (f) f.click(); }

  function openAvatarCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('当前浏览器不支持相机', 'err'); return; }
    openModal(`
      <h3>📷 拍摄头像</h3>
      <video id="av-video" autoplay playsinline muted style="width:100%;max-width:360px;border-radius:14px;background:#000;display:block;margin:0 auto"></video>
      <p style="color:var(--t3);font-size:12px;margin-top:10px">画面仅在本地预览，拍摄后只保留一张 288×288 的头像，不上传任何视频。</p>
      <div class="modal-foot">
        <button class="btn-line" id="av-cancel">取消</button>
        <button class="btn-primary" id="av-shot">📸 拍摄</button>
      </div>
    `);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } } })
      .then(s => { avStream = s; const v = $('#av-video'); if (v) v.srcObject = s; })
      .catch(() => { toast('相机不可用或未授权', 'err'); closeModal(); });
    const cancel = () => { closeModal(); };
    $('#av-cancel').addEventListener('click', cancel);
    $('#av-shot').addEventListener('click', () => {
      const v = $('#av-video');
      if (!v || !v.videoWidth) { toast('相机还没就绪，稍等一下', 'err'); return; }
      const w = v.videoWidth, h = v.videoHeight;
      const size = Math.min(w, h);
      const c = document.createElement('canvas');
      c.width = c.height = 288;
      c.getContext('2d').drawImage(v, (w - size) / 2, (h - size) / 2, size, size, 0, 0, 288, 288);
      saveAvatar(c.toDataURL('image/jpeg', 0.85));
      closeModal();
    });
  }

  function openEditProfile() {
    const me = M.load().students.find(x => x.studentId === session.id);
    if (!me) return;
    openModal(`
      <h3>✏️ 编辑资料</h3>
      <label>姓名</label>
      <input id="ep-name" value="${esc(me.name)}" maxlength="20">
      <label>原密码（修改密码时必填）</label>
      <input id="ep-old" type="password" placeholder="留空则不改密码">
      <label>新密码</label>
      <input id="ep-new" type="password" placeholder="至少 3 位，留空则不改">
      <div class="modal-foot">
        <button class="btn-line" data-act="close">取消</button>
        <button class="btn-primary" id="ep-save">保存</button>
      </div>
    `);
    $('#ep-save').addEventListener('click', async () => {
      const name = ($('#ep-name').value || '').trim();
      const oldp = $('#ep-old').value, newp = $('#ep-new').value;
      if (!name) { toast('姓名不能为空', 'err'); return; }
      const btn = $('#ep-save');
      // 改密码一律走服务端 /api/auth（会话 Cookie 认身份），前端不再比对任何口令
      if (oldp || newp) {
        if (newp.length < 6) { toast('新密码至少 6 位', 'err'); return; }
        if (btn) btn.disabled = true;
        let ok = false, msg = '';
        try {
          const r = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ action: 'changepassword', oldPassword: oldp, newPassword: newp })
          });
          const j = await r.json().catch(() => ({}));
          ok = r.ok && j.ok;
          msg = j.message || (ok ? '密码已修改' : '修改失败，请稍后再试');
        } catch (e) {
          msg = '网络异常，修改失败';
        }
        if (btn) btn.disabled = false;
        if (!ok) { toast(msg, 'err'); return; }
        toast(msg, 'ok');
      }
      M.updateProfile(session.id, { name });
      session.name = name;
      M.setSession(session);
      closeModal();
      toast('资料已保存', 'ok');
      go('profile');
    });
  }

  // ---- 个人中心 ----
  function vProfile(body) {
    const db = M.load();
    const me = db.students.find(x => x.studentId === session.id);
    if (!me) { body.innerHTML = '<div class="empty">未找到该账户</div>'; return; }
    const tastes = (me.preferredTastes || '').split(',').filter(Boolean);
    const allergens = (me.allergens || '').split(',').filter(Boolean);
    body.innerHTML = `
      <div class="grid grid-2">
        <div class="card pf-card">
          ${avatarHtml(me, true)}
          <div class="pf-info">
            <h3 style="margin-bottom:2px">${esc(me.name)} <span class="badge b-blue">${esc(me.studentId)}</span></h3>
            <p style="color:var(--t2);margin:6px 0 12px">饭卡余额：<b style="color:var(--danger);font-size:16px">${money(me.balance)}</b></p>
            <div class="btn-row">
              <button class="btn-primary" data-act="recharge">💳 充值饭卡</button>
              <button class="btn-line" id="btn-edit-profile">✏️ 编辑资料</button>
            </div>
          </div>
        </div>
        <div class="card">
          <h3>📷 我的头像 <span class="sub">头像只保存在你自己的设备上</span></h3>
          <p style="color:var(--t2);font-size:13px;line-height:1.8">上传或拍摄头像会用到相机 / 相册权限，图片仅在本地压缩后保存，不会上传到任何服务器。</p>
          <div class="btn-row" style="margin-top:12px">
            <button class="btn-primary" id="btn-av-camera">📸 拍照设置</button>
            <button class="btn-line" id="btn-av-file">🖼 从相册选择</button>
            ${me.avatar ? '<button class="btn-danger-mini" id="btn-av-del">移除头像</button>' : ''}
          </div>
          <input type="file" id="av-file" accept="image/*" style="display:none">
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>口味与忌口 <span class="sub">影响智能推荐与 AI 建议</span></h3>
        <label style="display:block;margin:10px 0 6px;color:var(--t2)">口味偏好</label>
        <div class="chip-row" id="pf-tastes">${M.TASTES.map(t => `<span class="chip ${tastes.includes(t) ? 'on' : ''}" data-v="${t}">${t}</span>`).join('')}</div>
        <label style="display:block;margin:16px 0 6px;color:var(--t2)">忌口食材</label>
        <div class="chip-row" id="pf-allergens">${M.ALLERGENS.map(a => `<span class="chip ${allergens.includes(a) ? 'on' : ''}" data-v="${a}">${a}</span>`).join('')}</div>
        <button class="btn-primary" style="margin-top:18px" id="btn-save-pref">保存偏好</button>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>💰 我的充值记录 <span class="sub">微信扫码转账后提交申请，管理员确认到账</span></h3>
        <div id="my-recharges">${renderMyRecharges()}</div>
      </div>`;
    refreshMyRecharges();
    $('#btn-save-pref').addEventListener('click', () => {
      const t = [...document.querySelectorAll('#pf-tastes .chip.on')].map(c => c.dataset.v).join(',');
      const a = [...document.querySelectorAll('#pf-allergens .chip.on')].map(c => c.dataset.v).join(',');
      M.updateProfile(session.id, { preferredTastes: t, allergens: a });
      toast('偏好已更新，推荐会随之变化', 'ok');
    });
    ['#pf-tastes', '#pf-allergens'].forEach(sel =>
      document.querySelectorAll(sel + ' .chip').forEach(ch => ch.addEventListener('click', () => ch.classList.toggle('on')))
    );
    $('#btn-av-camera').addEventListener('click', openAvatarCamera);
    $('#btn-av-file').addEventListener('click', openAvatarFilePicker);
    $('#btn-edit-profile').addEventListener('click', openEditProfile);
    const del = $('#btn-av-del');
    if (del) del.addEventListener('click', () => {
      M.updateProfile(session.id, { avatar: '' });
      go('profile');
      const side = document.querySelector('.side-av');
      const me2 = M.load().students.find(x => x.studentId === session.id);
      if (side && me2) side.outerHTML = '<span class="side-av side-av-txt">' + esc((me2.name || '?').charAt(0)) + '</span>';
      toast('头像已移除', 'ok');
    });
    $('#av-file').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) { toast('图片太大，请换一张', 'err'); return; }
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => { saveAvatar(squareCrop(img)); };
        img.onerror = () => toast('图片读取失败', 'err');
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
      e.target.value = '';
    });
  }

  function rechargeStatusBadge(s) {
    return s === 'pending' ? '<span class="badge b-orange">待管理员确认</span>'
      : s === 'approved' ? '<span class="badge b-green">已到账</span>'
        : '<span class="badge b-red">已拒绝</span>';
  }

  function renderMyRecharges() {
    const list = M.myRechargeRequests(session.id);
    if (!list.length) return '<div class="empty" style="padding:14px 0">暂无充值申请</div>';
    return list.slice(0, 10).map(r => `<div class="feed-item">
      <span class="feed-dot" style="background:${r.status === 'approved' ? '#16a34a' : r.status === 'rejected' ? '#dc2626' : '#f59e0b'}"></span>
      <div class="feed-main"><b>¥${r.amount}</b> · ${esc(r.time)}</div>
      ${rechargeStatusBadge(r.status)}
    </div>`).join('');
  }

  function rechargeApi(payload) {
    return fetch('/api/recharge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    }).then(r => r.json().then(j => ({ httpOk: r.ok, status: r.status, j })).catch(() => ({ httpOk: false, status: r.status, j: { ok: false, error: 'bad_json' } })))
      .then(({ httpOk, status, j }) => (httpOk && j.ok) ? j : { ok: false, error: j.error || 'http', status })
      .catch(() => ({ ok: false, error: 'network' }));
  }

  /* 会话过期统一处理：清掉本地会话，提示重新登录。
     充值/AI 这些接口的身份只认服务端 Cookie，本地 sessionStorage 再多也没用。 */
  let sessionExpiredNotified = false;
  function onSessionExpired() {
    if (sessionExpiredNotified) return;
    sessionExpiredNotified = true;
    toast('登录状态已失效，请重新登录', 'err');
    setTimeout(() => { M.clearSession(); location.reload(); }, 1600);
  }

  /* ------- 服务端充值：提交申请 ------- */
  function serverSubmitRecharge(amount) {
    const db = M.load();
    const me = db.students.find(x => x.studentId === session.id);
    return rechargeApi({
      action: 'submit',
      studentId: session.id,
      studentName: me ? me.name : '',
      amount
    });
  }

  /* ------- 学生端轮询：管理员确认后自动到账 ------- */
  let creditTimer = null;
  function startCreditPoll() {
    if (creditTimer) clearInterval(creditTimer);
    const tick = async () => {
      if (!session || (session.role !== 'student' && session.role !== 'teacher')) return;
      try {
        const r = await rechargeApi({ action: 'credits', studentId: session.id });
        if (r.error === 'session_expired') { onSessionExpired(); return; }
        if (!r.ok || !r.credits || !r.credits.length) return;
        let done = {};
        try { done = JSON.parse(localStorage.getItem('mrym_credit_done') || '{}'); } catch (e) { }
        let changed = false;
        r.credits.forEach(c => {
          if (done[c.id]) return;
          done[c.id] = 1;
          changed = true;
          const res = M.recharge(session.id, c.amount);
          toast('💰 管理员已确认到账 ¥' + c.amount + (res.ok ? '，当前余额 ' + money(res.balance) : ''), 'ok');
        });
        if (changed) {
          try { localStorage.setItem('mrym_credit_done', JSON.stringify(done)); } catch (e) { }
          refreshTopbar();
        }
        rechargeApi({ action: 'ack', studentId: session.id, ids: r.credits.map(c => c.id) });
      } catch (e) { }
    };
    tick();
    creditTimer = setInterval(tick, 20000);
  }

  /* ------- 学生端：从服务端刷新"我的充值记录" ------- */
  function refreshMyRecharges() {
    rechargeApi({ action: 'mine', studentId: session.id }).then(r => {
      if (r.error === 'session_expired') { onSessionExpired(); return; }
      if (!r.ok || !r.requests) return;
      const box = document.getElementById('my-recharges');
      if (!box) return;
      if (!r.requests.length) return;
      box.innerHTML = r.requests.map(req => `<div class="feed-item">
        <span class="feed-dot" style="background:${req.status === 'approved' ? '#16a34a' : req.status === 'rejected' ? '#dc2626' : '#f59e0b'}"></span>
        <div class="feed-main"><b>¥${req.amount}</b> · ${esc(req.t)}</div>
        ${rechargeStatusBadge(req.status)}
      </div>`).join('');
    }).catch(() => { });
  }

  function rechargeModal() {
    const db = M.load();
    const me = db.students.find(x => x.studentId === session.id);
    openModal(`<h3>💳 饭卡充值</h3>
      <div style="text-align:center;background:#f6f7fc;border-radius:12px;padding:16px">
        <img src="assets/wechat-qr.jpg" alt="示例收款码占位图" style="width:190px;height:190px;object-fit:cover;border-radius:8px;background:#fff">
        <p style="margin-top:10px;font-size:12.5px;color:var(--t2);line-height:1.8">
          <b>第 1 步</b>：扫码转账（此处为占位图，部署时替换为实际收款码）<br>
          <b>第 2 步</b>：转账后回到这里，填写相同金额提交申请<br>
          <b>第 3 步</b>：管理员核对到账后，余额自动增加
        </p>
      </div>
      <label>转账金额（元）</label>
      <div class="chip-row" style="margin:8px 0">
        ${[20, 50, 100, 200].map(v => `<span class="chip" data-amt="${v}">¥${v}</span>`).join('')}
      </div>
      <input type="number" id="recharge-amt" placeholder="与你的微信转账金额一致" min="1" style="width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px;font-size:14px">
      <div class="modal-foot">
        <button class="btn-line" data-act="close">取消</button>
        <button class="btn-primary" id="btn-recharge-ok">提交充值申请</button>
      </div>`);
    document.querySelectorAll('[data-amt]').forEach(ch => ch.addEventListener('click', () => {
      $('#recharge-amt').value = ch.dataset.amt;
      document.querySelectorAll('[data-amt]').forEach(x => x.classList.remove('on'));
      ch.classList.add('on');
    }));
    $('#btn-recharge-ok').addEventListener('click', () => {
      const amt = Number($('#recharge-amt').value);
      if (!amt || amt <= 0 || amt > 5000) { toast('金额需在 1~5000 元之间', 'err'); return; }
      const btn = $('#btn-recharge-ok');
      btn.disabled = true; btn.textContent = '提交中…';
      serverSubmitRecharge(amt).then(r => {
        if (r.ok) {
          M.submitRechargeRequest(session.id, amt); // 本地演示库同步留档
          closeModal();
          toast('申请已提交（¥' + amt + '），管理员核对到账后余额自动增加', 'ok');
          if (window.MRYMTrack) { try { window.MRYMTrack.event('recharge', '¥' + amt); } catch (e) { } }
          go(currentKey());
        } else {
          btn.disabled = false; btn.textContent = '提交充值申请';
          if (r.error === 'session_expired') { closeModal(); onSessionExpired(); return; }
          toast(r.error === 'network' ? '网络异常，请稍后重试' : (r.error || '提交失败'), 'err');
        }
      });
    });
  }

  /* ============================================================
   * 员工端（按所属食堂）
   * ============================================================ */
  function staffCanteen() {
    const db = M.load();
    const st = db.staff.find(x => x.id === session.id);
    return M.canteenById(st.canteenId);
  }
  function staffDishes() {
    return M.dishesOfCanteen(staffCanteen().id);
  }
  function canteenReviews(cid) {
    const db = M.load();
    const dishIds = M.dishesOfCanteen(cid).map(d => d.dishId);
    return db.records.concat(db.orders).filter(r => dishIds.includes(r.dishId) && r.rating);
  }

  function vStaffDish(body) {
    const c = staffCanteen();
    const dishes = staffDishes();
    body.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h3>${esc(c.name)} · 菜品管理</h3>
          <button class="btn-primary" id="btn-add-dish">＋ 新增菜品</button>
        </div>
        <table class="table"><thead><tr>
          <th>菜品</th><th>窗口</th><th>口味</th><th>主要食材</th><th>价格</th><th>今日供应</th><th>状态</th><th>操作</th>
        </tr></thead><tbody>
        ${dishes.map(d => `<tr>
          <td><b>${esc(d.name)}</b></td>
          <td>${esc(M.windowById(d.windowId).name)}</td>
          <td>${esc(d.tastes)}</td>
          <td>${esc(d.ingredients)}</td>
          <td>${money(d.price)}</td>
          <td>${d.dailyStock} 份</td>
          <td>${d.soldOut ? '<span class="badge b-gray">已售罄</span>' : '<span class="badge b-green">供应中</span>'}</td>
          <td>
            <button class="btn-mini" data-edit="${d.dishId}">编辑</button>
            <button class="btn-danger-mini" data-toggle="${d.dishId}">${d.soldOut ? '恢复供应' : '标记售罄'}</button>
          </td>
        </tr>`).join('')}
        </tbody></table>
      </div>`;
    $('#btn-add-dish').addEventListener('click', () => dishEditModal(null));
    document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => dishEditModal(Number(b.dataset.edit))));
    document.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
      const db = M.load();
      const d = db.dishes.find(x => x.dishId === Number(b.dataset.toggle));
      d.soldOut = !d.soldOut;
      M.save();
      toast(d.soldOut ? '已标记售罄' : '已恢复供应', 'ok');
      go(currentKey());
    }));
  }

  function dishEditModal(dishId) {
    const db = M.load();
    const d = dishId ? db.dishes.find(x => x.dishId === dishId) : { name: '', price: 10, tastes: '咸鲜', ingredients: '', windowId: staffDishes()[0] ? staffDishes()[0].windowId : db.windows[0].id, dailyStock: 100 };
    const myWindows = db.windows.filter(w => w.canteenId === staffCanteen().id);
    openModal(`<h3>${dishId ? '编辑菜品' : '新增菜品'}</h3>
      <label>菜名</label><input id="d-name" value="${esc(d.name)}">
      <label>所属窗口</label>
      <select id="d-window">${myWindows.map(w => `<option value="${w.id}" ${w.id === d.windowId ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>
      <label>价格（元）</label><input id="d-price" type="number" step="0.5" value="${d.price}">
      <label>口味</label>
      <div class="chip-row" id="d-tastes">${M.TASTES.map(t => `<span class="chip ${d.tastes.includes(t) ? 'on' : ''}" data-v="${t}">${t}</span>`).join('')}</div>
      <label>主要食材</label><input id="d-ing" value="${esc(d.ingredients)}" placeholder="如：鸡肉、花生">
      <label>每日供应量（份）</label><input id="d-stock" type="number" value="${d.dailyStock}">
      <div class="modal-foot">
        <button class="btn-line" data-act="close">取消</button>
        <button class="btn-primary" id="btn-dish-ok">保存</button>
      </div>`);
    document.querySelectorAll('#d-tastes .chip').forEach(ch => ch.addEventListener('click', () => ch.classList.toggle('on')));
    $('#btn-dish-ok').addEventListener('click', () => {
      const name = $('#d-name').value.trim();
      if (!name) { toast('请输入菜名', 'err'); return; }
      const tastes = [...document.querySelectorAll('#d-tastes .chip.on')].map(c => c.dataset.v)[0] || '咸鲜';
      const patch = {
        name, windowId: Number($('#d-window').value), price: Number($('#d-price').value) || 10,
        tastes, ingredients: $('#d-ing').value.trim(), dailyStock: Number($('#d-stock').value) || 100
      };
      const database = M.load();
      if (dishId) Object.assign(database.dishes.find(x => x.dishId === dishId), patch);
      else database.dishes.push({ dishId: Math.max(...database.dishes.map(x => x.dishId)) + 1, heat: 2, soldOut: false, ...patch });
      M.save();
      closeModal();
      toast('保存成功', 'ok');
      go(currentKey());
    });
  }

  function vStaffStock(body) {
    const c = staffCanteen();
    const dishes = staffDishes();
    body.innerHTML = `
      <div class="card">
        <h3>${esc(c.name)} · 今日库存 <span class="sub">供应量动态调整，售罄自动同步到学生端</span></h3>
        <table class="table"><thead><tr><th>菜品</th><th>今日供应</th><th>剩余（预估）</th><th>状态</th><th>操作</th></tr></thead><tbody>
        ${dishes.map(d => {
      const sold = Math.round(d.dailyStock * 0.6);
      const left = Math.max(0, d.dailyStock - sold);
      return `<tr>
            <td><b>${esc(d.name)}</b></td><td>${d.dailyStock} 份</td><td>${left} 份</td>
            <td>${d.soldOut ? '<span class="badge b-gray">已售罄</span>' : left < 20 ? '<span class="badge b-red">即将售罄</span>' : '<span class="badge b-green">充足</span>'}</td>
            <td>
              <button class="btn-mini" data-stock-plus="${d.dishId}">＋20</button>
              <button class="btn-mini" data-stock-minus="${d.dishId}">－20</button>
            </td>
          </tr>`;
    }).join('')}
        </tbody></table>
      </div>`;
    document.querySelectorAll('[data-stock-plus]').forEach(b => b.addEventListener('click', () => adjStock(Number(b.dataset.stockPlus), 20)));
    document.querySelectorAll('[data-stock-minus]').forEach(b => b.addEventListener('click', () => adjStock(Number(b.dataset.stockMinus), -20)));
  }
  function adjStock(dishId, delta) {
    const db = M.load();
    const d = db.dishes.find(x => x.dishId === dishId);
    d.dailyStock = Math.max(0, d.dailyStock + delta);
    if (d.dailyStock === 0) d.soldOut = true;
    M.save();
    toast('已调整「' + d.name + '」供应量', 'ok');
    go(currentKey());
  }

  function vStaffReview(body) {
    const c = staffCanteen();
    const reviews = canteenReviews(c.id).sort((a, b) => b.consumeTime.localeCompare(a.consumeTime));
    const bad = reviews.filter(r => r.rating <= 2);
    body.innerHTML = `
      <div class="grid grid-23">
        <div class="card">
          <h3>${esc(c.name)} · 学生评价 <span class="sub">共 ${reviews.length} 条，平均 ${(reviews.reduce((a, r) => a + r.rating, 0) / (reviews.length || 1)).toFixed(1)} 分</span></h3>
          <div style="max-height:520px;overflow-y:auto">
            ${reviews.slice(0, 60).map(r => {
      const d = M.dishById(r.dishId);
      const stu = M.load().students.find(s => s.studentId === r.studentId);
      return `<div class="review-item">
              <div class="review-body">
                <div><b>${esc(d ? d.name : '')}</b> <span class="stars">${starHtml(r.rating)}</span></div>
                <div class="review-meta">${esc(stu ? stu.name : '匿名同学')} · ${r.consumeTime.slice(0, 16)}</div>
                ${r.comment ? `<div class="review-text">“${esc(r.comment)}”</div>` : ''}
              </div>
            </div>`;
    }).join('') || '<div class="empty">暂无评价</div>'}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card">
            <h3>🚨 差评预警 <span class="badge b-red">${bad.length}</span></h3>
            ${bad.length ? bad.slice(0, 6).map(r => {
      const d = M.dishById(r.dishId);
      return `<div style="padding:8px 0;border-bottom:1px solid #f0f1f7">
                <b style="font-size:13px">${esc(d.name)}</b> <span class="badge b-red">${r.rating} 分</span>
                <div style="font-size:12px;color:var(--t3);margin-top:4px">${esc(r.comment || '（无文字）')} · ${r.consumeTime.slice(5, 10)}</div>
              </div>`;
    }).join('') : '<p style="color:var(--t3)">暂无差评，继续保持 👍</p>'}
          </div>
          <div class="card">
            <h3>🤖 AI 出品改进建议</h3>
            <button class="btn-primary" id="btn-ai-improve" ${bad.length ? '' : 'disabled'}>让 AI 分析差评并给出改进建议</button>
            <div id="ai-improve-result" class="ai-report" style="margin-top:14px"></div>
          </div>
        </div>
      </div>`;
    $('#btn-ai-improve') && $('#btn-ai-improve').addEventListener('click', async () => {
      if (aiBusy || !bad.length) return;
      aiBusy = true;
      const btn = $('#btn-ai-improve');
      btn.disabled = true;
      btn.textContent = 'AI 分析中…';
      // 选差评最多的菜
      const cnt = {};
      bad.forEach(r => cnt[r.dishId] = (cnt[r.dishId] || 0) + 1);
      const worstId = Number(Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]);
      const worst = M.dishById(worstId);
      const comments = bad.filter(r => r.dishId === worstId && r.comment).slice(0, 5).map(r => r.comment);
      try {
        const reply = await AI.dishImprovement(worst, comments.length ? comments : ['口味不稳定', '等餐时间过长']);
        $('#ai-improve-result').innerHTML = mdToHtml(reply);
      } catch (err) {
        $('#ai-improve-result').innerHTML = '<p style="color:var(--danger)">⚠️ ' + esc(err.message) + '</p>';
      }
      btn.disabled = false;
      btn.textContent = '让 AI 分析差评并给出改进建议';
      aiBusy = false;
    });
  }

  /* ============================================================
   * 管理员端
   * ============================================================ */

  function vDashboard(body) {
    const s = M.stats(30);
    const last7 = s.daysArr.slice(-7).reduce((a, d) => a + d.revenue, 0);
    const prev7 = s.daysArr.slice(-14, -7).reduce((a, d) => a + d.revenue, 0);
    const delta = prev7 ? Math.round((last7 - prev7) / prev7 * 1000) / 10 : 0;
    body.innerHTML = `
      <div class="grid grid-kpi">
        <div class="card"><div class="kpi-label">近 30 天总营收</div><div class="kpi-num">¥${s.totalRevenue.toLocaleString()}</div><div class="kpi-delta ${delta >= 0 ? 'up' : 'down'}">近 7 天环比 ${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}%</div></div>
        <div class="card"><div class="kpi-label">订单总数</div><div class="kpi-num">${s.totalOrders.toLocaleString()}</div><div class="kpi-delta up">日均 ${Math.round(s.totalOrders / 30)} 单</div></div>
        <div class="card"><div class="kpi-label">平均评分</div><div class="kpi-num">${s.avgRating}<span style="font-size:14px;color:var(--t3)"> / 5</span></div><div class="kpi-delta">含评分订单 ${(s.rateDist[4] + s.rateDist[5])} 条好评</div></div>
        <div class="card"><div class="kpi-label">差评预警</div><div class="kpi-num" style="color:${s.badReviews > 40 ? 'var(--danger)' : 'var(--success)'}">${s.badReviews}</div><div class="kpi-delta">1-2 星评价，需重点关注</div></div>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>🛠 后端运维 <span class="sub">自托管主机 · SQLite · 经 /api/backend 边缘反代</span></h3>
        <div id="ops-body" style="color:var(--t3);font-size:13.5px">正在检测后端状态…</div>
      </div>
      <div class="grid grid-23" style="margin-top:16px">
        <div class="card"><h3>📈 营收与订单趋势（近 30 天）</h3><div id="ch-trend" style="height:300px"></div></div>
        <div class="card"><h3>🥘 餐段单量分布</h3><div id="ch-slot" style="height:300px"></div></div>
      </div>
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card"><h3>🏆 菜品销量 TOP 10</h3><div id="ch-dish" style="height:320px"></div></div>
        <div class="card"><h3>⭐ 评分分布</h3><div id="ch-rate" style="height:320px"></div></div>
      </div>
      <div class="grid grid-23" style="margin-top:16px">
        <div class="card"><h3>🕐 全天时段客流热力</h3><div id="ch-hour" style="height:280px"></div></div>
        <div class="card">
          <h3>🏢 食堂经营对比</h3>
          <table class="table"><thead><tr><th>食堂</th><th>区域</th><th>单量</th><th>营收</th><th>均分</th></tr></thead><tbody>
          ${s.canteenRank.sort((a, b) => b.revenue - a.revenue).map(c => `<tr>
            <td><b>${esc(c.name)}</b></td><td>${esc(c.area)}</td><td>${c.count}</td><td>¥${c.revenue.toLocaleString()}</td>
            <td><span class="badge ${c.avgRating >= 4.3 ? 'b-green' : c.avgRating >= 3.8 ? 'b-orange' : 'b-red'}">${c.avgRating}</span></td>
          </tr>`).join('')}
          </tbody></table>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>🔴 实时点餐流水 <span class="sub">每 10 秒自动刷新 · 当前在线 ${M.onlineCount()} 人</span></h3>
        <div data-live-feed style="display:grid;grid-template-columns:1fr 1fr;gap:0 28px">${feedHtml(10)}</div>
      </div>`;

    loadOpsCard();

    mountChart('ch-trend', {
      tooltip: { trigger: 'axis' },
      legend: { data: ['营收(元)', '订单数'], top: 0 },
      grid: { top: 34, left: 54, right: 54, bottom: 28 },
      xAxis: { type: 'category', data: s.daysArr.map(d => d.date) },
      yAxis: [{ type: 'value', name: '营收' }, { type: 'value', name: '订单' }],
      series: [
        { name: '营收(元)', type: 'bar', data: s.daysArr.map(d => d.revenue), itemStyle: { color: '#4f46e5', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 16 },
        { name: '订单数', type: 'line', yAxisIndex: 1, data: s.daysArr.map(d => d.count), smooth: true, itemStyle: { color: '#0ea5e9' } }
      ]
    });
    mountChart('ch-slot', {
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie', radius: ['40%', '68%'], center: ['50%', '52%'],
        data: Object.entries(s.slotMap).map(([name, value]) => ({ name: name + ' ' + value + ' 单', value })),
        color: ['#f59e0b', '#4f46e5', '#0ea5e9'],
        label: { fontSize: 12 }
      }]
    });
    const top10 = s.dishRank.slice(0, 10).reverse();
    mountChart('ch-dish', {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { top: 10, left: 110, right: 30, bottom: 30 },
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: top10.map(d => d.name), axisLabel: { fontSize: 11 } },
      series: [{ type: 'bar', data: top10.map(d => d.count), itemStyle: { color: p => CHART_COLORS[p.dataIndex % CHART_COLORS.length], borderRadius: [0, 6, 6, 0] }, barMaxWidth: 14, label: { show: true, position: 'right', fontSize: 11, color: '#5b6079' } }]
    });
    mountChart('ch-rate', {
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie', radius: '62%', center: ['50%', '52%'],
        data: Object.entries(s.rateDist).map(([star, v]) => ({ name: star + ' 星 (' + v + ')', value: v })),
        color: ['#dc2626', '#f97316', '#f59e0b', '#22c55e', '#16a34a'],
        label: { fontSize: 12 }
      }]
    });
    mountChart('ch-hour', {
      tooltip: { trigger: 'axis' },
      grid: { top: 14, left: 50, right: 20, bottom: 28 },
      xAxis: { type: 'category', data: s.hourly.map(h => h.hour) },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: s.hourly.map(h => h.count), itemStyle: { color: '#0ea5e9', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 18 }]
    });
  }

  function vDecision(body) {
    const s = M.stats(30);
    body.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <h3>🧠 AI 经营决策顾问 <span class="sub">基于近 30 天真实经营数据生成</span></h3>
          <p style="color:var(--t2);line-height:1.9;font-size:13.5px">
            将把以下数据交给内置 AI 分析：总营收 <b>¥${s.totalRevenue.toLocaleString()}</b>、总单量 <b>${s.totalOrders}</b>、
            平均评分 <b>${s.avgRating}</b>、差评 <b>${s.badReviews}</b> 条、菜品销量榜与食堂对比。
          </p>
          <button class="btn-primary" id="btn-decision" style="margin-top:14px">⚡ 生成经营决策建议</button>
          <div class="ai-report" id="decision-result" style="margin-top:16px"></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card">
            <h3>🚨 全校差评预警榜 <span class="sub">差评最多的菜品</span></h3>
            ${badRankHtml(s)}
          </div>
          <div class="card">
            <h3>📦 补货与售罄监控</h3>
            <table class="table"><thead><tr><th>菜品</th><th>今日供应</th><th>状态</th></tr></thead><tbody>
            ${M.load().dishes.filter(d => d.soldOut || d.dailyStock < 90).slice(0, 8).map(d => `<tr>
              <td>${esc(d.name)}</td><td>${d.dailyStock} 份</td>
              <td>${d.soldOut ? '<span class="badge b-gray">已售罄</span>' : '<span class="badge b-orange">库存偏低</span>'}</td></tr>`).join('') || '<tr><td colspan="3" style="color:var(--t3)">全部供应正常</td></tr>'}
            </tbody></table>
          </div>
        </div>
      </div>`;
    $('#btn-decision').addEventListener('click', async () => {
      if (aiBusy) return;
      aiBusy = true;
      const btn = $('#btn-decision');
      btn.disabled = true;
      btn.textContent = 'AI 正在分析经营数据…';
      try {
        const reply = await AI.decisionAdvice(s);
        $('#decision-result').innerHTML = mdToHtml(reply);
        toast('决策建议已生成', 'ok');
      } catch (err) {
        $('#decision-result').innerHTML = '<p style="color:var(--danger)">⚠️ ' + esc(err.message) + '</p>';
      }
      btn.disabled = false;
      btn.textContent = '⚡ 生成经营决策建议';
      aiBusy = false;
    });
  }

  function badRankHtml(s) {
    const db = M.load();
    const cnt = {};
    db.records.concat(db.orders).forEach(r => { if (r.rating <= 2) cnt[r.dishId] = (cnt[r.dishId] || 0) + 1; });
    const rows = Object.entries(cnt).map(([id, n]) => ({ d: M.dishById(id), n })).filter(x => x.d).sort((a, b) => b.n - a.n).slice(0, 6);
    if (!rows.length) return '<p style="color:var(--t3)">近 30 天暂无差评 🎉</p>';
    return `<table class="table"><thead><tr><th>菜品</th><th>食堂</th><th>差评数</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${esc(r.d.name)}</b></td><td>${esc(M.windowCanteen(r.d.windowId).name)}</td><td><span class="badge b-red">${r.n}</span></td></tr>`).join('')}
      </tbody></table>`;
  }

  function vManage(body) {
    const db = M.load();
    body.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3>全校食堂 / 窗口 / 菜品</h3>
          <button class="btn-primary" id="btn-admin-add-dish">＋ 新增菜品（任选窗口）</button>
        </div>
        ${db.canteens.map(c => {
      const wins = db.windows.filter(w => w.canteenId === c.id);
      return `<h3 style="margin:18px 0 8px;font-size:14px;color:var(--brand-dark)">${esc(c.name)} <span class="sub">${esc(c.area)} · ${esc(c.desc)}</span></h3>
        ${wins.map(w => {
        const ds = M.dishesOfWindow(w.id);
        return `<div style="margin:0 0 14px 16px">
          <div style="font-size:13px;color:var(--t2);margin-bottom:6px"><b>${esc(w.name)}</b>（${ds.length} 道菜）</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${ds.map(d => `<span style="display:inline-flex;align-items:center;gap:6px;background:#f6f7fc;border-radius:999px;padding:5px 12px;font-size:12.5px">
              ${esc(d.name)} <b style="color:var(--danger)">¥${d.price}</b>
              ${d.soldOut ? '<span class="badge b-gray">售罄</span>' : ''}
              <button class="btn-danger-mini" style="padding:2px 8px" data-del-dish="${d.dishId}">删</button>
            </span>`).join('')}
          </div>
        </div>`;
      }).join('')}`;
    }).join('')}
      </div>`;
    $('#btn-admin-add-dish').addEventListener('click', () => adminAddDish());
    document.querySelectorAll('[data-del-dish]').forEach(b => b.addEventListener('click', () => {
      const id = Number(b.dataset.delDish);
      const d = M.dishById(id);
      openModal(`<h3>删除菜品</h3><p style="color:var(--t2)">确定删除「<b>${esc(d.name)}</b>」？该操作不可撤销。</p>
        <div class="modal-foot"><button class="btn-line" data-act="close">取消</button>
        <button class="btn-danger-mini" id="btn-del-ok" style="padding:10px 18px;font-size:14px">确认删除</button></div>`);
      $('#btn-del-ok').addEventListener('click', () => {
        const database = M.load();
        database.dishes = database.dishes.filter(x => x.dishId !== id);
        M.save();
        closeModal();
        toast('已删除', 'ok');
        go(currentKey());
      });
    }));
  }

  function adminAddDish() {
    const db = M.load();
    openModal(`<h3>新增菜品</h3>
      <label>菜名</label><input id="ad-name">
      <label>食堂</label><select id="ad-canteen">${db.canteens.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <label>窗口</label><select id="ad-window"></select>
      <label>价格（元）</label><input id="ad-price" type="number" step="0.5" value="12">
      <label>口味</label><div class="chip-row" id="ad-tastes">${M.TASTES.map(t => `<span class="chip" data-v="${t}">${t}</span>`).join('')}</div>
      <label>主要食材</label><input id="ad-ing" placeholder="如：鸡肉、土豆">
      <div class="modal-foot"><button class="btn-line" data-act="close">取消</button>
      <button class="btn-primary" id="btn-ad-ok">保存</button></div>`);
    const fillWins = () => {
      const cid = Number($('#ad-canteen').value);
      $('#ad-window').innerHTML = db.windows.filter(w => w.canteenId === cid).map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
    };
    fillWins();
    $('#ad-canteen').addEventListener('change', fillWins);
    document.querySelectorAll('#ad-tastes .chip').forEach(ch => ch.addEventListener('click', () => { document.querySelectorAll('#ad-tastes .chip').forEach(x => x.classList.remove('on')); ch.classList.add('on'); }));
    $('#btn-ad-ok').addEventListener('click', () => {
      const name = $('#ad-name').value.trim();
      if (!name) { toast('请输入菜名', 'err'); return; }
      const tastes = [...document.querySelectorAll('#ad-tastes .chip.on')].map(c => c.dataset.v)[0] || '咸鲜';
      db.dishes.push({
        dishId: Math.max(...db.dishes.map(x => x.dishId)) + 1, name,
        price: Number($('#ad-price').value) || 12, tastes, ingredients: $('#ad-ing').value.trim(),
        windowId: Number($('#ad-window').value), heat: 2, dailyStock: 100, soldOut: false
      });
      M.save();
      closeModal();
      toast('菜品已上架', 'ok');
      go(currentKey());
    });
  }

  /* ============================================================
   * 访客与设备（数据存于账号库，仅管理员凭口令可读）
   * ============================================================ */
  let visitorPw = '';
  try { visitorPw = sessionStorage.getItem('mrym_vpw') || ''; } catch (e) { }

  function fmtDT(ts) {
    if (!ts) return '—';
    const d = new Date(ts), p = n => String(n).padStart(2, '0');
    return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function visitorsApi(pw, vid) {
    const payload = { limit: 200, vid: vid || '' };
    if (pw) payload.password = pw;   // 已登录管理员无需再传口令，服务端认 Cookie
    return fetch('/api/visitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    }).then(r => r.json().then(j => ({ httpOk: r.ok, j })).catch(() => ({ httpOk: false, j: { error: 'bad_json' } })))
      .then(({ httpOk, j }) => (httpOk && j.ok) ? j : { ok: false, error: j.error || 'http' })
      .catch(() => ({ ok: false, error: 'network' }));
  }

  function visitorGate(box, err) {
    box.innerHTML = `<div class="card visitor-gate">
      <h3>📡 访客与设备</h3>
      <p style="color:var(--t2);font-size:13px;margin:8px 0 16px">设备档案保存在服务端数据库，浏览器本地不存副本，需要管理员口令才能查看。</p>
      ${err ? `<div class="badge b-red" style="display:inline-block;margin-bottom:14px">${esc(err)}</div>` : ''}
      <input type="password" id="vpw" class="search-input" placeholder="管理员口令" autocomplete="current-password">
      <button class="btn-primary btn-block" id="vpw-go" style="margin-top:12px">解锁查看</button>
    </div>`;
    const submit = () => {
      const v = ($('#vpw').value || '').trim();
      if (!v) { toast('请输入口令', 'err'); return; }
      visitorPw = v;
      try { sessionStorage.setItem('mrym_vpw', v); } catch (e) { }
      const body = $('#page-body');
      body.innerHTML = '<div class="card"><p style="color:var(--t2)">正在读取服务端数据…</p></div>';
      visitorsApi(v).then(res => {
        if (!res.ok) {
          visitorPw = '';
          try { sessionStorage.removeItem('mrym_vpw'); } catch (e) { }
          visitorGate(body, res.error === 'denied' ? '口令不正确' : '读取失败，请稍后重试（' + res.error + '）');
          return;
        }
        renderVisitorTable(body, res);
      });
    };
    $('#vpw-go').addEventListener('click', submit);
    $('#vpw').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }

  function devName(v) {
    if (v.device_model) {
      const b = (v.device_brand || '').split(' ')[0];
      return (b && !v.device_model.toLowerCase().includes(b.toLowerCase()) ? b + ' ' : '') + v.device_model;
    }
    if (v.device_brand) return v.device_brand;
    if (v.os === 'Windows') return 'Windows 电脑';
    if (v.os === 'macOS') return 'Mac 电脑';
    if (v.os) return v.os + ' 设备';
    return '未知设备';
  }

  function osText(v) {
    return [(v.os || '未知系统'), v.os_ver].filter(Boolean).join(' ');
  }

  function renderVisitorTable(body, data) {
    const list = data.visitors || [];
    const t = data.totals || { devices: 0, hits: 0 };
    const mob = data.mobile || 0;
    const cities = data.cities || [];
    const maxCity = Math.max(1, ...cities.map(c => c.n));

    body.innerHTML = `
      <div class="grid grid-kpi">
        <div class="card"><div class="kpi-label">独立设备</div><div class="kpi-num">${t.devices}</div><div class="kpi-delta">去重后的访客数</div></div>
        <div class="card"><div class="kpi-label">累计访问</div><div class="kpi-num">${t.hits}</div><div class="kpi-delta up">人均 ${t.devices ? (t.hits / t.devices).toFixed(1) : 0} 次</div></div>
        <div class="card"><div class="kpi-label">今日新增设备</div><div class="kpi-num">${data.todayNew || 0}</div><div class="kpi-delta">按北京时间统计</div></div>
        <div class="card"><div class="kpi-label">移动端占比</div><div class="kpi-num">${t.devices ? Math.round(mob / t.devices * 100) : 0}<span style="font-size:14px;color:var(--t3)">%</span></div><div class="kpi-delta">${mob} 台手机 / 平板</div></div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="visitor-head">
          <h3>📋 设备档案 <span class="sub">共 ${list.length} 台（最新访问在前）</span></h3>
          <div class="visitor-tools">
            <input class="search-input" id="vis-kw" placeholder="搜索机型 / 城市 / IP…" style="max-width:200px">
            <button class="btn-line" id="vis-refresh">刷新</button>
            <button class="btn-line" id="vis-csv">导出 CSV</button>
          </div>
        </div>
        <div style="overflow-x:auto">
          <table class="table" id="vis-table">
            <thead><tr><th>设备</th><th>系统</th><th>浏览器</th><th>屏幕</th><th>网络 / 地区</th><th>IP</th><th>首次</th><th>最近</th><th>次数</th><th></th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:16px">
        <div class="card">
          <h3>🗺️ 来源地区分布</h3>
          ${cities.length ? cities.map(c => `<div class="bar-row">
            <span class="bar-name">${esc(c.c)}</span>
            <span class="bar-track"><i style="width:${Math.round(c.n / maxCity * 100)}%"></i></span>
            <span class="bar-val">${c.n}</span>
          </div>`).join('') : '<p style="color:var(--t3)">暂无数据</p>'}
        </div>
        <div class="card">
          <h3>🔐 数据说明</h3>
          <p class="tip-line">· 采集内容：机型、系统、浏览器、屏幕、GPU、CPU 核心 / 内存、网络类型、运营商、IP 归属地、时区、语言、摄像头 / 麦克风数量、蓝牙可用性、授权后的 GPS 坐标。</p>
          <p class="tip-line">· 不采集：相册、通讯录、短信、通话记录、剪贴板、密码。手机号无法通过网页获取，只能由用户自己填写后经短信验证。</p>
          <p class="tip-line">· 存储位置：服务端账号库，浏览器 localStorage 仅保存一个随机访客 ID。</p>
          <p class="tip-line">· ⚠️ 「地区」显示的是 <b>IP 归属地</b>（运营商地址库的注册地）。手机流量 / 热点用的是运营商大地址池，常常注册在上海、烟台等汇聚点，和真实位置无关。真实位置以 📍GPS 标记为准（用户授权定位后才有）。</p>
          <p class="tip-line">· 该页面仅管理员可见，数据不会打包进前端代码。</p>
        </div>
      </div>`;

    const tbody = body.querySelector('#vis-table tbody');
    const kw = () => (($('#vis-kw') || {}).value || '').trim().toLowerCase();

    const draw = () => {
      const q = kw();
      const rows = list.filter(v => !q || [devName(v), v.os, v.city, v.region, v.ip, v.isp, v.device_model].some(x => (x || '').toLowerCase().includes(q)));
      tbody.innerHTML = rows.length ? rows.map(v => `<tr>
        <td><b>${esc(devName(v))}</b>${v.app ? ' <span class="badge b-green" style="padding:1px 6px">APP</span>' : (v.webview ? ' <span class="badge b-gray" style="padding:1px 6px">WebView</span>' : '')}</td>
        <td>${esc(osText(v))}</td>
        <td>${esc((v.browser || '') + (v.browser_ver ? ' ' + v.browser_ver.split('.')[0] : ''))}</td>
        <td>${esc(v.screen || '—')}</td>
        <td>${esc([v.city || v.region || v.country, v.isp].filter(Boolean).join(' · ') || '—')}${v.gps ? ' <span class="badge b-green" style="padding:1px 6px">📍GPS</span>' : ''}<br><span style="color:var(--t3);font-size:12px">${esc(v.net_type || '—')}</span></td>
        <td><code style="font-size:12px">${esc(v.ip || '—')}</code></td>
        <td>${fmtDT(v.first_seen)}</td>
        <td>${fmtDT(v.last_seen)}<br><span style="color:var(--t3);font-size:12px">${timeAgo(v.last_seen)}</span></td>
        <td><b>${v.visits}</b></td>
        <td><button class="btn-mini" data-vis="${esc(v.vid)}">详情</button></td>
      </tr>`).join('') : '<tr><td colspan="10" style="text-align:center;color:var(--t3);padding:24px">没有匹配的设备</td></tr>';
      tbody.querySelectorAll('[data-vis]').forEach(b => b.addEventListener('click', () => {
        const v = list.find(x => x.vid === b.dataset.vis);
        if (v) showVisitorDetail(v);
      }));
    };
    draw();
    $('#vis-kw').addEventListener('input', draw);
    $('#vis-refresh').addEventListener('click', () => go('visitors'));
    $('#vis-csv').addEventListener('click', () => {
      const head = ['设备', '品牌', '系统', '系统版本', '浏览器', '屏幕', '视口', 'CPU核心', '内存GB', 'GPU', '网络', '运营商', '国家', '省', '市', 'IP', 'ASN', 'GPS', '首次访问', '最近访问', '次数', '访客ID'];
      const lines = [head.join(',')];
      list.forEach(v => {
        const row = [devName(v), v.device_brand, v.os, v.os_ver, v.browser, v.screen, v.viewport, v.cores, v.mem, v.gpu, v.net_type, v.isp, v.country, v.region, v.city, v.ip, v.asn, v.gps, new Date(v.first_seen).toLocaleString('zh-CN'), new Date(v.last_seen).toLocaleString('zh-CN'), v.visits, v.vid];
        lines.push(row.map(x => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"').join(','));
      });
      const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mrym-visitors-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    });
  }

  // 入网型号 → 商用名（人工核实过的映射，优先于 AI 推测）
  const MODEL_KNOWN = {
    'V2547DA': { name: 'vivo X300 Ultra', tier: '旗舰', year: '2026', note: '骁龙 8 Elite Gen 5 · 2 亿像素主摄' },
    'V2547A': { name: 'vivo X300 Ultra', tier: '旗舰', year: '2026', note: '骁龙 8 Elite Gen 5 · 2 亿像素主摄' }
  };

  // AI 把入网型号（如 V2547DA）推测成商用名称与档位（入网型号大多不在 AI 知识库，只能推断）
  function aiDeviceReport(v) {
    const box = document.getElementById('ai-dev-report');
    if (!box) return;
    const known = MODEL_KNOWN[(v.device_model || '').trim().toUpperCase()];
    if (known) {
      box.innerHTML = '<div class="ai-report"><b>✅ 已核实：' + esc(known.name) + '</b><br>'
        + '定位档位：' + esc(known.tier) + ' · 发布年份：约 ' + esc(known.year) + ' 年<br>'
        + '<span style="color:var(--t3)">' + esc(known.note) + '（人工核实，非 AI 推测）</span></div>';
      return;
    }
    if (!v.device_model && !v.gpu) { box.innerHTML = '<p class="tip-line">该设备没有采集到型号信息（如部分 iOS / 桌面端），无法推测。</p>'; return; }
    const key = 'mrym_devai_' + (v.device_model || '') + '|' + (v.gpu || '').slice(0, 40);
    let cached = null;
    try { cached = sessionStorage.getItem(key); } catch (e) { }
    if (cached) { box.innerHTML = '<div class="ai-report">' + esc(cached).replace(/\n/g, '<br>') + '</div>'; return; }
    box.innerHTML = '<p style="color:var(--t3)">🤖 AI 正在推测设备…</p>';
    const sys = '你是设备知识助手。用户给你一个安卓"入网型号"（监管备案代码）和硬件信息。注意：大多数入网型号不在你的知识库里，'
      + '你很难凭编号直接知道对应机型，所以：\n'
      + '1. 只有当你确定在训练数据中见过该编号对应的具体机型时才给确定答案（格式：商用名称：xxx / 定位档位：旗舰|高端|中端|入门 / 发布年份：约 20xx 年）\n'
      + '2. 没把握时，必须以品牌 + GPU + 屏幕分辨率 + 系统版本为主要依据做档位推断（如 Adreno 7xx → 骁龙 8 系旗舰、Adreno 6xx/7xx 中段 → 中端），'
      + '给出"档位/年份/可能系列"的推断结论，并明确写"推断依据：xxx"，严禁给出具体型号名称当作答案\n'
      + '3. 全部输出不超过 70 字，不编造参数。';
    const user = '入网型号：' + (v.device_model || '未知')
      + '\n品牌：' + (v.device_brand || '未知')
      + '\nGPU：' + (v.gpu || '未知')
      + '\n系统：' + (v.os || '') + ' ' + (v.os_ver || '')
      + '\n屏幕：' + (v.screen || '')
      + '\n内存：' + (v.mem ? v.mem + 'GB（浏览器上报上限）' : '未知')
      + '\nUA：' + (v.ua || '').slice(0, 160);
    MRYM_AI.chat([{ role: 'system', content: sys }, { role: 'user', content: user }], 0.2)
      .then(txt => {
        const clean = String(txt || '').trim();
        if (!clean) throw new Error('empty');
        box.innerHTML = '<div class="ai-report">' + esc(clean).replace(/\n/g, '<br>') + '</div>';
        try { sessionStorage.setItem(key, clean); } catch (e) { }
      })
      .catch(err => { box.innerHTML = '<p class="tip-line">AI 推测失败：' + esc(String(err && err.message || err)).slice(0, 80) + '</p>'; });
  }

  function showVisitorDetail(v) {
    const kv = (k, val) => `<div class="kv-item"><span>${k}</span><b>${val == null || val === '' ? '—' : esc(String(val))}</b></div>`;
    openModal(`
      <div class="vis-detail-head">
        <h3>📱 ${esc(devName(v))}</h3>
        <span class="badge b-blue">${v.visits} 次访问</span>
      </div>
      <div class="vis-group"><h4>设备与系统</h4>
        <div class="kv-grid">
          ${kv('型号', v.device_model)}
          ${kv('品牌', v.device_brand)}
          ${kv('系统', osText(v))}
          ${kv('架构', v.arch)}
          ${kv('浏览器', (v.browser || '') + (v.browser_ver ? ' ' + v.browser_ver : ''))}
          ${kv('内核', v.engine)}
          ${kv('运行环境', v.app ? 'Mrym App（WebView）' : (v.webview ? '应用内 WebView' : '独立浏览器'))}
          ${kv('设备指纹', v.canvas_fp)}
        </div>
      </div>
      <div class="vis-group"><h4>屏幕与硬件</h4>
        <div class="kv-grid">
          ${kv('分辨率', v.screen)}
          ${kv('视口', v.viewport)}
          ${kv('像素比', v.dpr)}
          ${kv('CPU 核心', v.cores)}
          ${kv('内存', v.mem ? v.mem + ' GB（浏览器上报上限）' : null)}
          ${kv('存储', v.storage ? v.storage + '（浏览器配额，非磁盘总量）' : null)}
          ${kv('GPU', v.gpu)}
          ${kv('GPU 厂商', v.gpu_vendor)}
          ${kv('电量', v.battery)}
          ${kv('音频', v.audio)}
        </div>
      </div>
      <div class="vis-group"><h4>网络与位置</h4>
        <div class="kv-grid">
          ${kv('网络类型', v.net_type)}
          ${kv('下行 / 延迟', [v.net_down ? v.net_down + ' Mbps' : null, v.net_rtt ? v.net_rtt + ' ms' : null].filter(Boolean).join(' / '))}
          ${kv('IP', v.ip)}
          ${kv('运营商 / ASN', [v.isp, v.asn ? 'AS' + v.asn : null].filter(Boolean).join(' · '))}
          ${kv('归属地', [v.country, v.region, v.city].filter(Boolean).join(' / '))}
          ${kv('边缘节点', v.colo)}
          ${kv('协议 / TLS', [v.http_proto, v.tls].filter(Boolean).join(' · '))}
          ${kv('GPS 坐标', v.gps)}
          ${v.gps ? '<div class="kv-item"><span>📍 详细地址</span><b id="gps-addr" style="color:var(--primary)">反查中…</b></div>' : ''}
          ${v.gps ? '<div class="kv-item"><span>位置说明</span><b style="color:var(--t3)">GPS 为真实位置；归属地仅为运营商登记地</b></div>' : ''}
          ${kv('城市级近似坐标', (v.cf_lat && v.cf_lng) ? v.cf_lat.toFixed(3) + ', ' + v.cf_lng.toFixed(3) : null)}
        </div>
      </div>
      <div class="vis-group"><h4>环境与传感器</h4>
        <div class="kv-grid">
          ${kv('语言', [v.lang, v.languages].filter(Boolean).join(' · '))}
          ${kv('时区', v.timezone + (v.tz_offset != null ? '（UTC' + (v.tz_offset <= 0 ? '+' : '-') + Math.abs(v.tz_offset / 60) + '）' : ''))}
          ${kv('触点', v.touch)}
          ${kv('摄像头 / 麦克风 / 扬声器', [v.cams, v.mics, v.speakers].map(x => x == null ? '—' : x).join(' / '))}
          ${kv('蓝牙可用', v.bluetooth == null ? null : (v.bluetooth ? '是' : '否'))}
          ${kv('首次 / 最近', fmtDT(v.first_seen) + ' → ' + fmtDT(v.last_seen))}
        </div>
      </div>
      <div class="vis-group"><h4>其他</h4>
        <div class="kv-grid">
          ${kv('访客 ID', v.vid)}
          ${kv('User-Agent', v.ua)}
          ${kv('来源页面', v.referer)}
          ${kv('附加信息', v.extra)}
        </div>
      </div>
      <div id="vis-visits" style="margin-top:14px"><p style="color:var(--t3)">正在读取行为流水…</p></div>
      <div class="vis-group"><h4>🤖 商用机型 <span style="color:var(--t3);font-weight:400;font-size:11px">人工核实优先 · AI 推测仅供参考</span></h4>
        <div id="ai-dev-report"><p style="color:var(--t3)">🤖 AI 正在推测设备…</p></div>
      </div>
      <div class="vis-group"><h4>📝 管理员备注 <span style="color:var(--t3);font-weight:400;font-size:11px">记录你对这台设备的判断（如纠正机型、标记身份），仅自己可见</span></h4>
        <div style="display:flex;gap:8px">
          <input id="vis-note-input" type="text" maxlength="200" placeholder="${esc(v.admin_note || '填写备注…')}" style="flex:1" value="${esc(v.admin_note || '')}">
          <button class="btn-primary" id="vis-note-save" style="padding:8px 18px">保存</button>
        </div>
      </div>
      <div class="modal-foot"><button class="btn-line" data-act="close">关闭</button></div>
    `);
    $('#modal-box').classList.add('wide');
    aiDeviceReport(v);

    // GPS 详细地址反查
    if (v.gps) {
      const gm = String(v.gps).match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
      if (gm) {
        reverseGeocode(parseFloat(gm[1]), parseFloat(gm[2])).then(addr => {
          const el = document.getElementById('gps-addr');
          if (el) el.textContent = addr || '反查失败（该坐标无匹配地址）';
        });
      }
    }

    // 备注保存
    $('#vis-note-save').addEventListener('click', () => {
      const note = $('#vis-note-input').value.trim();
      const btn = $('#vis-note-save');
      btn.disabled = true; btn.textContent = '保存中…';
      fetch('/api/visitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: visitorPw || undefined, setNote: note, noteVid: v.vid }), credentials: 'same-origin'
      }).then(r => r.json())
        .then(j => {
          if (j.ok) { v.admin_note = note; toast('备注已保存', 'ok'); }
          else { toast('保存失败：' + (j.error || '未知错误'), 'err'); if (j.error === 'denied') { visitorPw = ''; } }
        })
        .catch(() => toast('保存失败：网络错误', 'err'))
        .finally(() => { btn.disabled = false; btn.textContent = '保存'; });
    });

    visitorsApi(visitorPw, v.vid).then(res => {
      const box = document.getElementById('vis-visits');
      if (!box) return;
      const rows = res.visits || [];
      if (!rows.length) { box.innerHTML = '<p style="color:var(--t3)">暂无行为记录</p>'; return; }
      box.innerHTML = `<h4 style="margin-bottom:8px">最近行为（${rows.length} 条）</h4>
        <div style="max-height:200px;overflow:auto"><table class="table">
          <thead><tr><th>时间</th><th>动作</th><th>页面</th><th>坐标</th></tr></thead><tbody>
          ${rows.map(r => `<tr><td>${fmtDT(r.t)}</td><td>${esc(r.action || '')}</td><td>${esc(r.path || '—')}</td><td>${r.lat ? r.lat.toFixed(4) + ', ' + r.lng.toFixed(4) + ' ±' + Math.round(r.acc || 0) + 'm' : '—'}</td></tr>`).join('')}
        </tbody></table></div>`;
    });
  }

  async function vVisitors(body) {
    // 管理员登录态由服务端 Cookie 证明，无需再输口令
    if (session.role === 'admin' || visitorPw) {
      body.innerHTML = '<div class="card"><p style="color:var(--t2)">正在读取服务端数据…</p></div>';
      const res = await visitorsApi(visitorPw);
      if (res.ok) { renderVisitorTable(body, res); return; }
      visitorPw = '';
      try { sessionStorage.removeItem('mrym_vpw'); } catch (e) { }
      visitorGate(body, res.error === 'session_expired' || res.error === 'need_password'
        ? '管理员会话已过期，请重新登录或输入口令'
        : (res.error === 'denied' ? '口令已变更，请重新输入' : '读取失败：' + res.error));
      return;
    }
    visitorGate(body);
  }

  // 服务端充值审核（复用访客页的管理员口令缓存）
  function renderServerRecharges() {
    const box = document.getElementById('recharge-admin');
    if (!box) return;
    if (!visitorPw && session.role !== 'admin') {
      box.innerHTML = `<h3>💰 充值审核 <span class="sub">申请存在服务端数据库，任何设备提交的都能在这里看到</span></h3>
        <p style="color:var(--t3);padding:6px 0">输入管理员口令查看（与"访客与设备"页共用）：</p>
        <div style="display:flex;gap:8px;max-width:340px">
          <input id="re-pw" type="password" placeholder="管理员口令" class="search-input" style="flex:1">
          <button class="btn-primary" id="re-unlock" style="padding:8px 20px">查看</button>
        </div>`;
      $('#re-unlock').addEventListener('click', () => {
        visitorPw = $('#re-pw').value.trim();
        if (visitorPw) { try { sessionStorage.setItem('mrym_vpw', visitorPw); } catch (e) { } renderServerRecharges(); }
      });
      $('#re-pw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#re-unlock').click(); });
      return;
    }
    rechargeApi({ action: 'list', password: visitorPw || undefined }).then(r => {
      if (r.error === 'denied') {
        visitorPw = '';
        try { sessionStorage.removeItem('mrym_vpw'); } catch (e) { }
        renderServerRecharges();
        return;
      }
      if (!r.ok) { box.innerHTML = '<h3>💰 充值审核</h3><p style="color:var(--t3)">读取失败：' + esc(r.error || '未知错误') + '</p>'; return; }
      const reqs = r.requests || [];
      const pending = reqs.filter(x => x.status === 'pending');
      const done = reqs.filter(x => x.status !== 'pending').slice(0, 8);
      box.innerHTML = `<h3>💰 充值审核 <span class="sub">来自服务端数据库，跨设备可见</span> <span class="badge ${pending.length ? 'b-orange' : 'b-gray'}">${pending.length} 条待审</span></h3>
        ${pending.length ? `<table class="table"><thead><tr><th>学号</th><th>姓名</th><th>金额</th><th>申请时间</th><th>操作</th></tr></thead><tbody>
          ${pending.map(x => `<tr>
            <td><b>${esc(x.student_id)}</b></td><td>${esc(x.student_name || '—')}</td>
            <td><b style="color:var(--danger)">¥${x.amount}</b></td><td>${esc(x.t)}</td>
            <td>
              <button class="btn-mini" data-approve="${x.id}">✓ 确认到账</button>
              <button class="btn-danger-mini" data-reject="${x.id}">✗ 拒绝</button>
            </td>
          </tr>`).join('')}
        </tbody></table>` : '<p style="color:var(--t3);padding:6px 0">暂无待审核的充值申请。学生在任何设备提交的申请都会出现在这里。</p>'}
        ${done.length ? `<p style="margin-top:10px;color:var(--t3);font-size:12px">最近处理：${done.map(x => esc(x.student_id) + ' ¥' + x.amount + '（' + (x.status === 'approved' ? '已到账' : '已拒绝') + '）').join('、')}</p>` : ''}`;
      box.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => reviewRecharge(b.dataset.approve, true)));
      box.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => reviewRecharge(b.dataset.reject, false)));
    });
  }

  function reviewRecharge(id, approve) {
    rechargeApi({ action: 'review', password: visitorPw || undefined, id, approve }).then(r => {
      toast(r.ok ? (approve ? '已确认到账，学生端会在一分钟内自动收到' : '已拒绝该申请') : (r.error || '操作失败'), r.ok ? 'ok' : 'err');
      renderServerRecharges();
    });
  }

  function vUsers(body) {
    const db = M.load();
    body.innerHTML = `
      <div class="card" id="recharge-admin" style="margin-bottom:16px">
        <h3>💰 充值审核 <span class="sub">申请存在服务端数据库，任何设备提交的都能在这里看到；确认后余额自动打给学生</span></h3>
        <p style="color:var(--t3);padding:6px 0">正在读取服务端充值申请…</p>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3>学生用户管理 <span class="sub">共 ${db.students.length} 人 · 数据存储于浏览器演示库</span></h3>
          <button class="btn-line" id="btn-reset-db">重置演示数据</button>
        </div>
        <input class="search-input" id="stu-kw" placeholder="搜索学号 / 姓名…">
        <div id="stu-table" style="margin-top:12px"></div>
      </div>`;
    renderServerRecharges();
    const renderTable = () => {
      const kw = ($('#stu-kw').value || '').trim();
      const list = db.students.filter(s => !kw || s.studentId.includes(kw) || s.name.includes(kw));
      $('#stu-table').innerHTML = `<table class="table"><thead><tr><th>学号</th><th>姓名</th><th>口味偏好</th><th>忌口</th><th>余额</th><th>近 30 天消费</th></tr></thead><tbody>
        ${list.slice(0, 40).map(s => {
        const spend = M.studentRecords(s.studentId, 30).reduce((a, r) => a + r.amount, 0);
        return `<tr><td><b>${esc(s.studentId)}</b></td><td>${esc(s.name)}</td><td>${esc(s.preferredTastes || '—')}</td><td>${esc(s.allergens || '—')}</td><td>${money(s.balance)}</td><td>${money(spend)}</td></tr>`;
      }).join('')}
        </tbody></table>${list.length > 40 ? `<p style="margin-top:10px;color:var(--t3);font-size:12px">仅显示前 40 条，共 ${list.length} 条</p>` : ''}`;
    };
    renderTable();
    $('#stu-kw').addEventListener('input', renderTable);
    $('#btn-reset-db').addEventListener('click', () => {
      openModal(`<h3>重置演示数据</h3><p style="color:var(--t2)">将清除所有演示期间的订单、评价与账户变更，恢复到内置种子数据。</p>
        <div class="modal-foot"><button class="btn-line" data-act="close">取消</button>
        <button class="btn-danger-mini" id="btn-reset-ok" style="padding:10px 18px;font-size:14px">确认重置</button></div>`);
      $('#btn-reset-ok').addEventListener('click', () => { M.reset(); closeModal(); toast('已重置', 'ok'); go(currentKey()); });
    });
  }

  /* ============================================================
   * 登录 / 注册
   * ============================================================ */
  let loginRole = 'student';
  function currentKey() {
    const active = document.querySelector('.menu-item.active');
    return active ? active.dataset.key : MENU[session.role][0].key;
  }

  document.querySelectorAll('.ltab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.ltab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('#form-login').classList.toggle('hidden', t.dataset.tab !== 'login');
    $('#form-register').classList.toggle('hidden', t.dataset.tab !== 'register');
  }));

  document.querySelectorAll('#role-seg .seg-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#role-seg .seg-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    loginRole = b.dataset.role;
  }));

  /* 服务端登录：所有角色都先过这一步。
     成功后服务端下发 HttpOnly 会话 Cookie，业务接口（充值 / AI / 访客）只认这个 Cookie。 */
  async function serverLogin(role, id, pw) {
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'login', role, id, password: pw })
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) return { ok: true, user: j.user || {} };
      if (r.status >= 500) return { ok: false, unavailable: true };
      return { ok: false, code: j.error || 'http', msg: j.message };
    } catch (e) {
      return { ok: false, unavailable: true };
    }
  }

  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const id = $('#login-id').value.trim();
    const pw = $('#login-pw').value;
    if (!id || !pw) { toast('请输入账号和密码', 'err'); return; }

    const role = loginRole;
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    const res = await serverLogin(role, id, pw);
    if (btn) btn.disabled = false;

    if (res.ok) {
      try { sessionStorage.removeItem('mrym_vpw'); } catch (err) { }
      if (role === 'admin') {
        enterApp({ role: 'admin', id: res.user.id, name: res.user.name });
        return;
      }
      if (role === 'staff') {
        enterApp({ role: 'staff', id, name: res.user.name || id });
        return;
      }
      // 学生 / 教师：本地留一份档案用于余额、头像、口味画像
      // （只查档案，不比口令——口令校验已全部在服务端完成）
      const s = M.studentProfileAsRole(id, role) || M.studentProfile(id);
      enterApp({ role, id, name: (s && s.name) || res.user.name || id });
      return;
    }

    // 服务端失联（云电脑休眠 / 隧道中断）：直接提示，不再回落本地口令比对
    if (res.unavailable) {
      toast('服务端暂时不可达（云电脑可能处于休眠），请稍后重试', 'err');
      return;
    }

    // 服务端明确拒绝：一律按口令错误处理，前端不再保留任何本地比对或自动补建逻辑
    toast(res.msg || (role === 'admin' ? '管理员账号或密码错误' : '账号或密码错误'), 'err');
  });

  // 注册表单的偏好 chips
  function initRegChips(sel, list) {
    $(sel).innerHTML = list.map(v => `<span class="chip" data-v="${v}">${v}</span>`).join('');
    document.querySelectorAll(sel + ' .chip').forEach(ch => ch.addEventListener('click', () => ch.classList.toggle('on')));
  }
  initRegChips('#reg-tastes', M.TASTES);
  initRegChips('#reg-allergens', M.ALLERGENS);

  $('#form-register').addEventListener('submit', async e => {
    e.preventDefault();
    const id = $('#reg-id').value.trim();
    const name = $('#reg-name').value.trim();
    const pw = $('#reg-pw').value;
    if (!id || !name) { toast('请填写学号和姓名', 'err'); return; }
    if (pw.length < 6) { toast('密码至少 6 位', 'err'); return; }
    if (!/^[A-Za-z0-9_]{3,20}$/.test(id)) { toast('学号只能用 3~20 位字母、数字或下划线', 'err'); return; }

    const tastes = [...document.querySelectorAll('#reg-tastes .chip.on')].map(c => c.dataset.v).join(',');
    const allergens = [...document.querySelectorAll('#reg-allergens .chip.on')].map(c => c.dataset.v).join(',');

    // 先在服务端建号：这是本平台唯一能真正校验口令的地方，注册成功即拿到会话 Cookie
    let serverOk = false, offline = false, serverMsg = '';
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'register', id, name, password: pw })
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) serverOk = true;
      else if (r.status >= 500) offline = true;
      else serverMsg = j.message || '注册失败';
    } catch (err) { offline = true; }

    if (!serverOk && !offline) { toast(serverMsg, 'err'); return; }

    // 本地也建一份档案：余额、口味偏好、头像等展示数据都存在浏览器这边
    const res = M.registerStudent({ studentId: id, name, preferredTastes: tastes, allergens });
    if (!res.ok && !serverOk) { toast(res.msg, 'err'); return; }

    toast(offline ? '已按离线模式注册（服务端暂不可用）' : '注册成功，欢迎使用！', offline ? 'err' : 'ok');
    enterApp({ role: 'student', id, name });
  });

  // 登录框保持空白，不预填账号密码

  /* ---------------- 对外暴露 ---------------- */
  // 统一的事件委托：页面里不再写 onclick="..." 内联属性（CSP 已禁止内联脚本），
  // 需要交互的元素挂 data-act="close|go|recharge|locate" 即可。
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'close') { e.preventDefault(); closeModal(); }
    else if (act === 'go') { e.preventDefault(); go(el.dataset.arg); }
    else if (act === 'recharge') { e.preventDefault(); rechargeModal(); }
    else if (act === 'locate') { e.preventDefault(); realLocate(); }
  });

  window.APP = { go, rechargeModal, realLocate };

  // 尝试恢复会话
  (async function restoreSession() {
    const saved = M.getSession();
    if (!saved || !saved.role) return;

    // 管理员身份只认服务端会话：sessionStorage 里伪造的 role 会被直接踢回登录页
    if (saved.role === 'admin') {
      try {
        const r = await fetch('/api/auth', { credentials: 'same-origin', cache: 'no-store' });
        const j = r.ok ? await r.json() : null;
        if (!j || !j.ok) { M.clearSession(); return; }
        enterApp({ role: 'admin', id: j.user.id, name: j.user.name });
      } catch (e) {
        M.clearSession();
      }
      return;
    }

    // 学生 / 教师 / 员工：校验账号仍存在
    const db = M.load();
    const ok = saved.role === 'student' ? db.students.some(s => s.studentId === saved.id)
      : saved.role === 'staff' ? db.staff.some(s => s.id === saved.id)
        : false;
    if (ok) enterApp(saved);
  })();
})();
