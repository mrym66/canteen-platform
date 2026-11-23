// 账号层：服务端可验证的身份来源。
//
// 为什么需要它：原来 student / teacher / staff 的口令比对完全在前端做（localStorage），
// 服务端只拿到一个 body.studentId 就当真——任何人把 studentId 换成别人的学号就能读别人的数据。
// 现在改成：登录时服务端校验口令 → 签发 HttpOnly 会话 Cookie → 业务接口从 Cookie 取身份。
//
// 口令存储：
//   · 通过注册页新建的账号 → 账号库 members 表，PBKDF2-SHA256 + 每账号随机盐
//   · 内置演示账号 → 只认环境变量 DEMO_PASSWORD，且默认关闭：
//     没有配置 DEMO_PASSWORD 时演示账号一律登录失败（fail closed）。
//     安全设计（报告 9.2 风险 2）：源码与文档中不再出现任何演示口令。

import { pbkdf2Hash, pbkdf2Verify, randomHex } from './session.js';

let schemaReady = false;

export async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS members (' +
    'id TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT, salt TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL)'
  ).run();
  schemaReady = true;
}

/** 内置演示账号：学号 student、s101~s219，工号 teacher，员工 staff */
export function isDemoAccount(id, role) {
  // 只开放三个固定演示账号；种子数据里的 s101~s219 等虚拟师生仅用于
  // 营造活跃氛围（流水、评价、榜单），不提供任何登录入口。
  if (role === 'staff') return id === 'staff';
  if (role === 'teacher') return id === 'teacher';
  if (role === 'student') return id === 'student';
  return false;
}

export function demoPassword(env) {
  // 只有显式配置了 DEMO_PASSWORD 才启用演示账号，不再有公开默认口令
  return (env && env.DEMO_PASSWORD) || null;
}

export async function findMember(db, id) {
  try {
    await ensureSchema(db);
    const row = await db.prepare('SELECT id, role, name, salt, hash FROM members WHERE id = ?').bind(id).first();
    return row || null;
  } catch (e) {
    return null;
  }
}

export async function createMember(db, id, role, name, password) {
  await ensureSchema(db);
  const salt = randomHex(16);
  const hash = await pbkdf2Hash(password, salt);
  await db.prepare(
    'INSERT INTO members (id, role, name, salt, hash, created) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, role, name || null, salt, hash, Date.now()).run();
  return true;
}

export async function checkMemberPassword(db, member, password) {
  if (!member) return false;
  return pbkdf2Verify(password, member.salt, member.hash);
}

/**
 * 校验账号口令，成功返回 { id, role, name }，失败返回 null。
 * 先查 members 表（真实注册账号），再落到演示账号规则。
 */
export async function authenticate(env, db, id, role, password) {
  if (!id || !password) return null;

  if (db) {
    const m = await findMember(db, id);
    if (m) {
      if (m.role !== role) return null;
      return (await checkMemberPassword(db, m, password)) ? { id: m.id, role: m.role, name: m.name || '' } : null;
    }
  }

  if (!isDemoAccount(id, role)) return null;
  const demoPw = demoPassword(env);
  if (!demoPw) return null; // 演示账号未启用
  if (password !== demoPw) return null;
  return { id, role, name: demoName(id, role) };
}

function demoName(id, role) {
  if (role === 'staff') return '测试员工';
  if (role === 'teacher') return '测试教师';
  if (id === 'student') return '测试学生';
  return '学生 ' + id;
}
