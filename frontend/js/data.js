/* ============================================================
 * Mrym College 食堂大数据分析与智能决策平台
 * data.js —— 浏览器端数据仓库（localStorage 持久化 + 种子数据）
 * 数据结构：内置种子数据设计
 *   Canteen / CanteenWindow / Dishes / Students /
 *   ConsumptionRecord / DailyStock
 * ============================================================ */

(function () {
  'use strict';

  const DB_KEY = 'mrym_canteen_db_v6';
  const SESSION_KEY = 'mrym_canteen_session_v5';

  /* ---------------- 种子数据 ---------------- */

  // 可复现的伪随机（保证每次清库重建结果一致，图表好看）
  let _seed = 20261111;
  function rand() {
    _seed = (_seed * 9301 + 49297) % 233280;
    return _seed / 233280;
  }
  function randInt(min, max) { return Math.floor(rand() * (max - min + 1)) + min; }
  function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

  const CANTEENS = [
    { id: 1, name: '樱园食堂', area: '东区', pos: { x: 72, y: 38 }, desc: '东区主食堂，三层楼面，早餐种类最全' },
    { id: 2, name: '梅园食堂', area: '东区', pos: { x: 82, y: 66 }, desc: '紧邻东区宿舍群，晚餐客流最高' },
    { id: 3, name: '桂园食堂', area: '西区', pos: { x: 26, y: 55 }, desc: '西区老牌食堂，主打家常菜' },
    { id: 4, name: '枫林餐厅', area: '西区', pos: { x: 34, y: 24 }, desc: '清真窗口与风味小吃聚集地' }
  ];

  const WINDOWS = [
    { id: 101, canteenId: 1, name: '一楼大众快餐' },
    { id: 102, canteenId: 1, name: '二楼风味炒菜' },
    { id: 103, canteenId: 1, name: '三楼面食档口' },
    { id: 201, canteenId: 2, name: '自选称重区' },
    { id: 202, canteenId: 2, name: '麻辣香锅窗口' },
    { id: 301, canteenId: 3, name: '家常菜窗口' },
    { id: 302, canteenId: 3, name: '粥粉面档' },
    { id: 401, canteenId: 4, name: '清真食堂' },
    { id: 402, canteenId: 4, name: '小吃饮品档' }
  ];

  const TASTES = ['清淡', '香辣', '酸甜', '咸鲜', '麻辣', '酱香'];
  const ALLERGENS = ['花生', '海鲜', '乳制品', '麸质', '鸡蛋'];

  const DISH_SEED = [
    // [名称, 价格, 口味, 食材, 窗口, 热度权重1-5]
    ['清蒸鲈鱼饭', 16.0, '清淡', '鲈鱼、大米', 102, 3],
    ['番茄炒蛋盖饭', 11.0, '酸甜', '番茄、鸡蛋、大米', 101, 5],
    ['宫保鸡丁饭', 13.0, '香辣', '鸡肉、花生、黄瓜', 101, 5],
    ['麻婆豆腐饭', 12.0, '麻辣', '豆腐、牛肉末', 102, 4],
    ['红烧肉套餐', 18.0, '咸鲜', '五花肉、土豆', 101, 4],
    ['白灼菜心', 6.0, '清淡', '菜心', 201, 3],
    ['糖醋里脊饭', 14.0, '酸甜', '里脊、番茄酱', 102, 4],
    ['鱼香肉丝饭', 13.0, '咸鲜', '猪肉、木耳、胡萝卜', 101, 5],
    ['兰州拉面', 12.0, '咸鲜', '牛肉、面粉', 103, 5],
    ['重庆小面', 11.0, '麻辣', '面粉、辣椒油', 103, 4],
    ['阳春面', 8.0, '清淡', '面粉、葱花', 103, 3],
    ['炸酱面', 10.0, '酱香', '面粉、猪肉酱', 103, 3],
    ['自选三菜一荤', 15.0, '清淡', '时蔬、肉类', 201, 5],
    ['麻辣香锅(中辣)', 22.0, '麻辣', '丸类、时蔬、宽粉', 202, 5],
    ['香锅(微辣)', 20.0, '香辣', '丸类、时蔬', 202, 4],
    ['孜然羊肉盖饭', 17.0, '香辣', '羊肉、洋葱', 301, 3],
    ['土豆烧牛腩饭', 15.0, '咸鲜', '牛腩、土豆', 301, 4],
    ['皮蛋瘦肉粥', 7.0, '清淡', '大米、皮蛋、猪肉', 302, 4],
    ['虾米馄饨汤', 10.0, '咸鲜', '猪肉、虾仁、面粉', 302, 4],
    ['肠粉', 8.0, '咸鲜', '米粉、鸡蛋', 302, 3],
    ['手抓羊肉饭', 19.0, '咸鲜', '羊肉、大米、洋葱', 401, 3],
    ['大盘鸡拌面', 18.0, '香辣', '鸡肉、面粉、土豆', 401, 4],
    ['烤鸡翅(2只)', 9.0, '酱香', '鸡翅', 402, 5],
    ['关东煮拼盘', 10.0, '清淡', '丸类、萝卜、昆布', 402, 3],
    ['鲜榨橙汁', 6.0, '酸甜', '橙子', 402, 4],
    ['红豆双皮奶', 7.0, '酸甜', '牛奶、红豆', 402, 3],
    ['清炒时蔬', 5.0, '清淡', '应季蔬菜', 201, 4],
    ['铁板鱿鱼饭', 16.0, '香辣', '鱿鱼、洋葱', 102, 3],
    ['咖喱鸡肉饭', 13.0, '咸鲜', '鸡肉、咖喱、土豆', 101, 4],
    ['南瓜小米粥', 5.0, '清淡', '南瓜、小米', 302, 3]
  ];

  const STAFF_SEED = [
    // 预置测试账号：staff（对应 1 号食堂）
    { id: 'staff', name: '测试员工', canteenId: 1 }
  ];

  const SUR = ['陈', '林', '王', '刘', '黄', '吴', '郑', '赵', '孙', '周', '冯', '蒋', '韩', '杨', '朱', '许', '何', '吕', '施', '张', '孔', '曹', '严', '华', '金', '魏', '陶', '姜', '戚', '谢', '邹', '苏', '潘', '葛', '范', '彭', '鲁', '韦', '方', '邓'];
  const GIV = ['晓', '悦', '子豪', '思远', '佳宁', '桐', '一鸣', '雨欣', '浩然', '子涵', '乐瑶', '明轩', '雪', '帆', '婷婷', '志强', '雨薇', '鹏飞', '雅雯', '启航', '维娜', '俊哲', '文静', '子墨', '诗琪', '东旭', '然', '海宁', '悦悦', '承宇', '晨曦', '嘉懿', '昊天', '可欣', '若曦', '宇轩', '梦琪', '国栋', '书瑶', '明哲'];
  const STUDENT_NAMES = SUR;

  /* ---------------- 建库 ---------------- */

  function buildSeed() {
    _seed = 20261111;
    const dishes = DISH_SEED.map((d, i) => ({
      dishId: i + 1,
      name: d[0],
      price: d[1],
      tastes: d[2],
      ingredients: d[3],
      windowId: d[4],
      heat: d[5],
      dailyStock: randInt(80, 200),
      soldOut: false
    }));

    // 学生：student、teacher + s101~s219
    const students = [];

    // 预置测试账号：student（学生）
    const TEST_TASTES = ['清淡', '香辣', '酸甜', '咸鲜', '麻辣', '酱香'];
    students.push({
      studentId: 'student',
      name: '测试学生',
      preferredTastes: '清淡',
      allergens: '',
      balance: 200,
      type: 'student'
    });
    // 预置测试账号：teacher（教师，功能与点餐流程同学生）
    students.push({
      studentId: 'teacher',
      name: '测试教师',
      preferredTastes: '香辣',
      allergens: '',
      balance: 300,
      type: 'teacher'
    });
    for (let i = 0; i < 119; i++) {
      const tid = randInt(1, 6);
      students.push({
        studentId: 's' + (101 + i),
        name: SUR[i % SUR.length] + GIV[(i % SUR.length + Math.floor(i / SUR.length) * 3) % GIV.length],
        preferredTastes: TASTES[tid - 1],
        allergens: rand() < 0.35 ? pick(ALLERGENS) : '',
        balance: Math.round(rand() * 20000) / 100 + 20,
        type: 'student'
      });
    }

    // 消费记录：最近 30 天
    const records = [];
    let rid = 1;
    const now = new Date();
    const MEAL_SLOTS = [
      { name: '早餐', from: 6.5, to: 9.5, weight: 0.18 },
      { name: '午餐', from: 10.5, to: 13.0, weight: 0.45 },
      { name: '晚餐', from: 16.5, to: 19.5, weight: 0.37 }
    ];
    for (let day = 29; day >= 0; day--) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      const count = Math.round((weekend ? randInt(140, 200) : randInt(280, 380)) * (1 + (29 - day) / 120)); // 略微上升趋势
      for (let k = 0; k < count; k++) {
        // 按权重选餐段
        let r = rand(), slot = MEAL_SLOTS[0];
        let acc = 0;
        for (const s of MEAL_SLOTS) { acc += s.weight; if (r <= acc) { slot = s; break; } }
        const hh = randInt(Math.floor(slot.from), Math.floor(slot.to) - 1);
        const mm = randInt(0, 59);
        // 热度加权选菜
        const totalW = dishes.reduce((a, d) => a + d.heat, 0);
        let rw = rand() * totalW, dish = dishes[0];
        for (const d of dishes) { rw -= d.heat; if (rw <= 0) { dish = d; break; } }
        const stu = students[randInt(0, students.length - 1)];
        const rating = rand() < 0.62 ? randInt(4, 5) : rand() < 0.85 ? 3 : randInt(1, 2);
        const hasComment = rand() < 0.18;
        const COMMENTS = {
          5: ['好吃，下次还来！', '分量足，味道正', '阿姨手不抖，好评', '出品稳定，性价比高'],
          4: ['还不错，稍微有点咸', '挺香的，排队略久', '中规中矩，值得回购'],
          3: ['一般般，中规中矩', '今天做得不如昨天', '希望多点蔬菜'],
          2: ['有点凉了，体验不佳', '口味不稳定', '偏咸，建议改进'],
          1: ['等了二十分钟太久了', '菜里有异物，差评', '太难吃了，希望整改']
        };
        records.push({
          recordId: rid++,
          studentId: stu.studentId,
          dishId: dish.dishId,
          consumeTime: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`,
          mealSlot: slot.name,
          amount: dish.price,
          rating,
          comment: hasComment ? pick(COMMENTS[rating]) : ''
        });
      }
    }

    const orders = []; // 学生端现点现付的订单（也计入流水）

    return {
      version: 5,
      canteens: CANTEENS,
      windows: WINDOWS,
      dishes,
      students,
      staff: STAFF_SEED.map(s => ({ ...s })),
      records,
      orders,
      rechargeRequests: [] // 饭卡充值申请：pending / approved / rejected
    };
  }

  /* ---------------- 读写 ---------------- */

  let _db = null;
  let _dirty = false;   // 模拟流水未落盘标记（批量写入，避免每 10 秒全量序列化）

  function load() {
    if (_db) return _db;
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        const db = JSON.parse(raw);
        if (db && db.version === 5) { _db = db; return _db; }
      }
    } catch (e) { /* 忽略损坏数据 */ }
    _db = buildSeed();
    save();
    return _db;
  }

  /**
   * 落盘。localStorage 只有 ~5MB，模拟流水越攒越多必然写爆。
   * 策略：写失败时按时间先后裁剪历史流水 / 订单 / 充值申请，再重试；
   * 让"数据写不进去"变成"只丢最早的历史"，业务不会整块挂掉。
   */
  function save() {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(_db));
      return true;
    } catch (e) {
      try {
        const trim = (arr, keep) => (Array.isArray(arr) && arr.length > keep ? arr.slice(arr.length - keep) : arr);
        _db.records = trim(_db.records, 1200);
        _db.orders = trim(_db.orders, 400);
        if (Array.isArray(_db.rechargeRequests)) _db.rechargeRequests = trim(_db.rechargeRequests, 200);
        localStorage.setItem(DB_KEY, JSON.stringify(_db));
        console.warn('[mrym] 本地存储接近上限，已自动裁剪最早的历史记录（保留最近 1200 条流水 / 400 条订单）');
        return true;
      } catch (e2) {
        // 仍然写不进：清掉已知的旧版本键，给新数据腾地方
        try {
          ['mrym_canteen_db_v5', 'mrym_canteen_db_v4', 'mrym_canteen_db_v3'].forEach(k => localStorage.removeItem(k));
          localStorage.setItem(DB_KEY, JSON.stringify(_db));
          return true;
        } catch (e3) {
          console.warn('[mrym] 本地存储已满，本次改动只保存在内存中（刷新后可能丢失）', e3);
          return false;
        }
      }
    }
  }

  function reset() {
    _db = buildSeed();
    _liveFeed = [];
    _dirty = false;
    save();
  }

  /** 把模拟流水批量落盘 */
  function flush() {
    if (_dirty) { save(); _dirty = false; }
  }

  /* ---------------- 业务查询 ---------------- */

  function dishById(id) { return load().dishes.find(d => d.dishId === Number(id)); }
  function windowById(id) { return load().windows.find(w => w.id === Number(id)); }
  function canteenById(id) { return load().canteens.find(c => c.id === Number(id)); }
  function windowCanteen(winId) { const w = windowById(winId); return w ? canteenById(w.canteenId) : null; }
  function dishesOfWindow(winId) { return load().dishes.filter(d => d.windowId === Number(winId)); }
  function dishesOfCanteen(cid) {
    const wids = load().windows.filter(w => w.canteenId === Number(cid)).map(w => w.id);
    return load().dishes.filter(d => wids.includes(d.windowId));
  }

  // 学生近 n 天消费（含订单）
  function studentRecords(studentId, days = 7) {
    const db = load();
    const since = Date.now() - days * 86400000;
    const r = db.records.filter(x => x.studentId === studentId);
    const o = db.orders.filter(x => x.studentId === studentId);
    return r.concat(o).filter(x => new Date(x.consumeTime.replace(/-/g, '/')).getTime() >= since)
      .sort((a, b) => b.consumeTime.localeCompare(a.consumeTime));
  }

  // 安全设计（报告 9.2 风险 3）：口令比对一律在服务端 /api/auth 完成。
  // 前端这里只做「档案查询」（不带口令参数、不比对任何口令），
  // 登录成功后用会话里的身份取档案；前端不再保存、不再校验任何口令。
  function studentProfile(id) {
    const db = load();
    return db.students.find(x => x.studentId === id) || null;
  }
  /** 按身份类型取档案：student / teacher */
  function studentProfileAsRole(id, type) {
    const db = load();
    return db.students.find(x => x.studentId === id && (x.type || 'student') === type) || null;
  }
  function staffProfile(id) {
    return load().staff.find(x => x.id === id) || null;
  }
  // 管理员口令校验只在服务端（/api/auth）做：前端不再保留任何口令哈希，
  // 否则下载 JS 就能离线爆破，完全绕开服务端的限速。
  // 本地档案只存业务字段（口味 / 忌口 / 余额），不存口令——口令唯一存放处是
  // 服务端账号库 members 表（PBKDF2 + 盐）。
  function registerStudent(info) {
    const db = load();
    if (db.students.some(s => s.studentId === info.studentId)) return { ok: false, msg: '学号已存在' };
    db.students.push({
      studentId: info.studentId, name: info.name || '新同学',
      preferredTastes: info.preferredTastes || '', allergens: info.allergens || '', balance: 50
    });
    save();
    return { ok: true };
  }

  function placeOrder(studentId, dishId) {
    const db = load();
    const stu = db.students.find(s => s.studentId === studentId);
    const dish = dishById(dishId);
    if (!stu || !dish) return { ok: false, msg: '参数错误' };
    if (dish.soldOut) return { ok: false, msg: '该菜品今日已售罄' };
    if (stu.balance < dish.price) return { ok: false, msg: '余额不足，请先充值' };
    stu.balance = Math.round((stu.balance - dish.price) * 100) / 100;
    const now = new Date();
    const slot = now.getHours() < 10 ? '早餐' : now.getHours() < 15 ? '午餐' : '晚餐';
    db.orders.push({
      recordId: 'W' + Date.now() + randInt(100, 999),
      studentId, dishId: dish.dishId,
      consumeTime: now.toISOString().slice(0, 19).replace('T', ' '),
      mealSlot: slot, amount: dish.price, rating: 0, comment: ''
    });
    save();
    return { ok: true, balance: stu.balance };
  }

  function rateRecord(recordKey, rating, comment) {
    const db = load();
    const rec = db.orders.find(o => String(o.recordId) === String(recordKey)) ||
      db.records.find(r => String(r.recordId) === String(recordKey));
    if (!rec) return { ok: false };
    rec.rating = rating; rec.comment = comment || '';
    save();
    return { ok: true };
  }

  function recharge(studentId, amount) {
    const db = load();
    const stu = db.students.find(s => s.studentId === studentId);
    if (!stu) return { ok: false };
    stu.balance = Math.round((stu.balance + amount) * 100) / 100;
    save();
    return { ok: true, balance: stu.balance };
  }

  function updateProfile(studentId, patch) {
    const db = load();
    const stu = db.students.find(s => s.studentId === studentId);
    if (!stu) return { ok: false };
    Object.assign(stu, patch);
    save();
    return { ok: true };
  }

  /* ------- 饭卡充值申请（扫码转账 → 提交申请 → 管理员确认到账） ------- */

  function submitRechargeRequest(studentId, amount) {
    const db = load();
    if (!amount || amount <= 0 || amount > 5000) return { ok: false, msg: '金额需在 1~5000 元之间' };
    db.rechargeRequests = db.rechargeRequests || [];
    const now = new Date();
    const req = {
      id: 'R' + now.getTime() + randInt(100, 999),
      studentId,
      amount: Math.round(amount * 100) / 100,
      time: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      status: 'pending',
      confirmTime: ''
    };
    db.rechargeRequests.push(req);
    save();
    return { ok: true, req };
  }

  function myRechargeRequests(studentId) {
    return (load().rechargeRequests || [])
      .filter(r => r.studentId === studentId)
      .sort((a, b) => b.id.localeCompare(a.id));
  }

  function pendingRechargeRequests() {
    return (load().rechargeRequests || [])
      .filter(r => r.status === 'pending')
      .sort((a, b) => b.id.localeCompare(a.id));
  }

  function setRechargeRequestStatus(reqId, status) {
    const db = load();
    const req = (db.rechargeRequests || []).find(r => r.id === reqId);
    if (!req || req.status !== 'pending') return { ok: false, msg: '该申请不存在或已处理' };
    req.status = status;
    const now = new Date();
    req.confirmTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (status === 'approved') {
      const stu = db.students.find(s => s.studentId === req.studentId);
      if (stu) stu.balance = Math.round((stu.balance + req.amount) * 100) / 100;
    }
    save();
    return { ok: true };
  }

  /* ------- 智能推荐：四维加权（口味/历史/热销/评分） -------
   * ① 口味偏好匹配 ② 历史点单高频 ③ 热销榜 ④ 高评分
   * 并动态过滤忌口食材（Service 层过滤的思路）                 */
  function recommendFor(studentId, topN = 6) {
    const db = load();
    const stu = db.students.find(s => s.studentId === studentId);
    if (!stu) return [];
    const pref = (stu.preferredTastes || '').split(',').filter(Boolean);
    const allergy = (stu.allergens || '').split(',').filter(Boolean);

    // 忌口过滤
    const pool = db.dishes.filter(d => {
      const ing = d.ingredients || '';
      return !allergy.some(a => a && (ing.includes(a) ||
        (a === '海鲜' && (ing.includes('鱼') || ing.includes('虾') || ing.includes('鱿')))));
    });

    // 历史点单频次
    const hist = {};
    db.records.concat(db.orders).forEach(r => {
      if (r.studentId === studentId) hist[r.dishId] = (hist[r.dishId] || 0) + 1;
    });
    // 全库热销 & 评分
    const sold = {}, rateSum = {};
    db.records.concat(db.orders).forEach(r => {
      sold[r.dishId] = (sold[r.dishId] || 0) + 1;
      if (r.rating) rateSum[r.dishId] = (rateSum[r.dishId] || 0) + r.rating;
    });
    const maxSold = Math.max(1, ...Object.values(sold));

    const scored = pool.map(d => {
      const tasteScore = pref.some(p => d.tastes.includes(p)) ? 34 : 0;
      const histScore = Math.min(28, (hist[d.dishId] || 0) * 4);
      const hotScore = Math.round((sold[d.dishId] || 0) / maxSold * 24);
      const avg = rateSum[d.dishId] ? rateSum[d.dishId] / (sold[d.dishId] || 1) : 3.6;
      const rateScore = Math.round((avg - 3) / 2 * 14);
      return { dish: d, score: tasteScore + histScore + hotScore + rateScore, avgRating: Math.round(avg * 10) / 10, reason: [] };
    });
    scored.forEach(s => {
      const prefHit = pref.some(p => s.dish.tastes.includes(p));
      if (prefHit) s.reason.push('符合你的口味偏好');
      if (hist[s.dish.dishId]) s.reason.push('你近期点过 ' + hist[s.dish.dishId] + ' 次');
      if (s.hotScore >= 16) s.reason.push('全校热销 TOP');
      if (s.avgRating >= 4.5) s.reason.push('评分 ' + s.avgRating);
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, topN);
  }

  /* ------- 大屏统计 ------- */
  function stats(days = 30) {
    const db = load();
    const all = db.records.concat(db.orders);
    const since = Date.now() - days * 86400000;
    const rec = all.filter(r => new Date(r.consumeTime.replace(/-/g, '/')).getTime() >= since);
    const dayMap = {};
    rec.forEach(r => {
      const d = r.consumeTime.slice(0, 10);
      dayMap[d] = dayMap[d] || { revenue: 0, count: 0 };
      dayMap[d].revenue += r.amount;
      dayMap[d].count++;
    });
    const daysArr = Object.keys(dayMap).sort().map(d => ({ date: d.slice(5), revenue: Math.round(dayMap[d].revenue), count: dayMap[d].count }));

    const dishMap = {};
    rec.forEach(r => {
      dishMap[r.dishId] = dishMap[r.dishId] || { count: 0, revenue: 0, rateSum: 0, rated: 0 };
      dishMap[r.dishId].count++;
      dishMap[r.dishId].revenue += r.amount;
      if (r.rating) { dishMap[r.dishId].rateSum += r.rating; dishMap[r.dishId].rated++; }
    });
    const dishRank = Object.entries(dishMap).map(([id, v]) => {
      const d = dishById(id);
      return { name: d.name, canteen: windowCanteen(d.windowId).name, count: v.count, revenue: Math.round(v.revenue), avgRating: v.rated ? Math.round(v.rateSum / v.rated * 10) / 10 : 0 };
    }).sort((a, b) => b.count - a.count);

    const slotMap = { 早餐: 0, 午餐: 0, 晚餐: 0 };
    rec.forEach(r => { if (slotMap[r.mealSlot] !== undefined) slotMap[r.mealSlot]++; });

    const canteenMap = {};
    rec.forEach(r => {
      const d = dishById(r.dishId);
      if (!d) return;
      const c = windowCanteen(d.windowId);
      if (!c) return;
      canteenMap[c.id] = canteenMap[c.id] || { name: c.name, area: c.area, count: 0, revenue: 0, rateSum: 0, rated: 0 };
      canteenMap[c.id].count++;
      canteenMap[c.id].revenue += r.amount;
      if (r.rating) { canteenMap[c.id].rateSum += r.rating; canteenMap[c.id].rated++; }
    });
    const canteenRank = Object.values(canteenMap).map(c => ({ ...c, revenue: Math.round(c.revenue), avgRating: c.rated ? Math.round(c.rateSum / c.rated * 10) / 10 : 0 }));

    const rateDist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    rec.forEach(r => { if (r.rating) rateDist[r.rating]++; });

    // 时段客流（按小时）
    const hourMap = {};
    rec.forEach(r => {
      const h = r.consumeTime.slice(11, 13);
      hourMap[h] = (hourMap[h] || 0) + 1;
    });
    const hourly = Array.from({ length: 18 }, (_, i) => ({ hour: (i + 6) + ':00', count: hourMap[String(i + 6).padStart(2, '0')] || 0 }));

    const totalRevenue = rec.reduce((a, r) => a + r.amount, 0);
    const totalOrders = rec.length;
    const ratedRec = rec.filter(r => r.rating);
    const avgRating = ratedRec.length ? Math.round(ratedRec.reduce((a, r) => a + r.rating, 0) / ratedRec.length * 10) / 10 : 0;
    const badReviews = rec.filter(r => r.rating <= 2).length;

    return { daysArr, dishRank, canteenRank, slotMap, rateDist, hourly, totalRevenue: Math.round(totalRevenue), totalOrders, avgRating, badReviews, days };
  }

  // 今日实时人流（演示用：按当前时段 + 历史均值模拟）
  function crowdNow() {
    const db = load();
    const now = new Date();
    const h = now.getHours();
    const factor = (h >= 6 && h < 10) ? 0.6 : (h >= 11 && h < 13) ? 1.0 : (h >= 17 && h < 19) ? 0.9 : 0.25;
    return db.canteens.map(c => {
      const base = c.area === '东区' ? 320 : 260;
      return { canteenId: c.id, name: c.name, crowd: Math.round(base * factor * (0.7 + ((c.id * 37) % 40) / 100)), level: '' };
    }).map(c => {
      c.level = c.crowd > 240 ? '拥挤' : c.crowd > 130 ? '适中' : '空闲';
      return c;
    });
  }

  /* ------- 活跃度模拟器（纯前端，不上报服务器） -------
   * 定时在学生端/后台产生真实结构的点餐流水，让看板与动态保持"有人用"的样子。
   * 数据只写进本机 localStorage，其它访客互不影响。                  */

  let _liveFeed = [];   // 最近动态（内存，不持久化）

  function buyerPool() {
    const db = load();
    return db.students.filter(s => s.type === 'student' || s.type === 'teacher' || !s.type);
  }

  function simulateActivity(count) {
    const db = load();
    const pool = buyerPool();
    if (!pool.length) return [];
    const h = new Date().getHours();
    const slot = h < 10 ? '早餐' : h < 15 ? '午餐' : h < 21 ? '晚餐' : '夜宵';
    const now = new Date();
    const created = [];
    for (let i = 0; i < count; i++) {
      const dish = db.dishes[randInt(0, db.dishes.length - 1)];
      const buyer = pool[randInt(0, pool.length - 1)];
      const rec = {
        recordId: 'L' + Date.now() + i,
        studentId: buyer.studentId,
        dishId: dish.dishId,
        consumeTime: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`,
        mealSlot: slot === '夜宵' ? '晚餐' : slot,
        amount: dish.price,
        rating: 0,
        comment: ''
      };
      db.orders.push(rec);
      // 流水过多时裁剪，避免 localStorage 膨胀
      if (db.orders.length > 800) db.orders.splice(0, db.orders.length - 800);
      created.push({ rec, dish, buyer });
      _liveFeed.unshift({
        t: Date.now(),
        buyer: buyer.name,
        buyerType: buyer.type || 'student',
        dish: dish.name,
        canteen: windowCanteen(dish.windowId).name,
        amount: dish.price
      });
    }
    _liveFeed = _liveFeed.slice(0, 24);
    _dirty = true;
    return created;
  }

  /** 最新动态列表 */
  function liveFeed(limit = 8) {
    if (!_liveFeed.length) {
      // 首次进入时用已有真实流水填充，避免空白
      const db = load();
      const recent = db.records.slice(-12).reverse();
      _liveFeed = recent.map(r => {
        const d = dishById(r.dishId);
        const b = db.students.find(s => s.studentId === r.studentId);
        return {
          t: new Date(r.consumeTime.replace(/-/g, '/')).getTime(),
          buyer: b ? b.name : '同学',
          buyerType: b ? (b.type || 'student') : 'student',
          dish: d ? d.name : '菜品',
          canteen: d ? windowCanteen(d.windowId).name : '',
          amount: r.amount
        };
      });
    }
    return _liveFeed.slice(0, limit);
  }

  /** 在线人数（按时段模拟，稳定波动，不随后端） */
  function onlineCount() {
    const h = new Date().getHours();
    const base = (h >= 11 && h < 13) ? 168 : (h >= 17 && h < 19) ? 142 : (h >= 7 && h < 10) ? 96 : 38;
    const wave = Math.round(Math.sin(Date.now() / 47000) * 9);
    return Math.max(12, base + wave + randInt(-4, 4));
  }

  /* ------- 会话 ------- */
  function setSession(s) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
  function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
  }
  function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

  window.MRYM = {
    load, save, reset, flush, dishById, windowById, canteenById, windowCanteen,
    dishesOfWindow, dishesOfCanteen, studentRecords,
    studentProfile, studentProfileAsRole, staffProfile, registerStudent, placeOrder, rateRecord,
    recharge, updateProfile, recommendFor, stats, crowdNow,
    submitRechargeRequest, myRechargeRequests, pendingRechargeRequests, setRechargeRequestStatus,
    simulateActivity, liveFeed, onlineCount,
    setSession, getSession, clearSession,
    TASTES, ALLERGENS
  };
})();
