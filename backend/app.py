#!/usr/bin/env python3
"""canteen-api — 食堂平台服务端 v3
零第三方依赖：Python 标准库 http.server + sqlite3

v3：业务数据与账号数据全部自托管
  · /api/auth      登录 / 注册 / 改密 / 退出 / 会话查询（PBKDF2-SHA256 + 每账号随机盐）
  · /api/track     访客与设备信息采集（含动作流水）
  · /api/visitors  访客档案查询与统计（仅管理员）
  · /api/recharge  饭卡充值申请与审核
  · /api/orders    下单与订单查询（身份只认会话 Cookie）
  · /api/dishes    菜品目录；/api/dishes/sync 管理员推送
  · /api/stats /api/ops  经营统计与运维信息

会话格式与接口层完全一致：
  token = base64url(payload_json) + "." + base64url(HMAC_SHA256(secret, body))
  Cookie: mrym_auth=...; Path=/; HttpOnly; Secure; SameSite=Lax
  签名密钥来自 CANTEEN_AUTH_SECRET 或 ./auth_secret（chmod 600）
"""
import base64
import datetime
import hashlib
import hmac
import json
import os
import random
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "canteen.db")
BACKUP_DIR = os.path.join(BASE_DIR, "backups")
SECRET_FILE = os.path.join(BASE_DIR, "auth_secret")
ADMIN_HASH_FILE = os.path.join(BASE_DIR, "admin_sha256")
DEMO_PW_FILE = os.path.join(BASE_DIR, "demo_password")
COOKIE_NAME = "mrym_auth"
SESSION_TTL = 12 * 3600
PBKDF2_ITER = 10000
START_TS = time.time()
_AUTO_BACKUP_DATE = None


# ---------------------------------------------------------------- 配置
def _read_file(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return None


def auth_secret():
    return os.environ.get("CANTEEN_AUTH_SECRET") or _read_file(SECRET_FILE)


def admin_hash():
    return (os.environ.get("CANTEEN_ADMIN_SHA256") or _read_file(ADMIN_HASH_FILE) or "").lower() or None


def admin_id():
    return os.environ.get("CANTEEN_ADMIN_ID") or "admin"


def admin_name():
    return os.environ.get("CANTEEN_ADMIN_NAME") or "平台管理员"


def demo_password():
    return os.environ.get("CANTEEN_DEMO_PASSWORD") or _read_file(DEMO_PW_FILE)


# ---------------------------------------------------------------- 编码 / 哈希
def b64url_encode(raw):
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def b64url_decode(s):
    s = s.replace("-", "+").replace("_", "/")
    pad = len(s) % 4
    if pad:
        s += "=" * (4 - pad)
    return base64.b64decode(s)


def sha256hex(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def pbkdf2_hash(password, salt, iterations=PBKDF2_ITER):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                               salt.encode("utf-8"), iterations, 32).hex()


def random_hex(nbytes=16):
    return os.urandom(nbytes).hex()


def safe_eq(a, b):
    return hmac.compare_digest(str(a or ""), str(b or ""))


# ---------------------------------------------------------------- 会话
def sign_session(payload):
    secret = auth_secret()
    if not secret:
        return None
    body = b64url_encode(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    sig = b64url_encode(hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest())
    return body + "." + sig


def verify_session(cookie_header):
    """校验 mrym_auth Cookie，返回 payload 或 None。格式与 Functions 版一致。"""
    if not cookie_header:
        return None
    token = None
    for part in cookie_header.split(";"):
        k, _, v = part.strip().partition("=")
        if k == COOKIE_NAME:
            token = v
            break
    if not token or "." not in token:
        return None
    secret = auth_secret()
    if not secret:
        return None
    body, _, sig = token.rpartition(".")
    if not body or not sig:
        return None
    expect = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest()
    try:
        got = b64url_decode(sig)
    except Exception:
        return None
    if not hmac.compare_digest(expect, got):
        return None
    try:
        payload = json.loads(b64url_decode(body).decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict) or not payload.get("id"):
        return None
    if payload.get("exp") and payload["exp"] < time.time():
        return None
    return payload


def session_cookie(token, max_age=SESSION_TTL):
    return "%s=%s; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=%d" % (COOKIE_NAME, token, max_age)


def clear_cookie():
    return "%s=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" % COOKIE_NAME


# ---------------------------------------------------------------- 数据库
def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS dishes (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL NOT NULL,
            canteen TEXT, window TEXT, tastes TEXT
        );
        CREATE TABLE IF NOT EXISTS dishes_v2 (
            dish_id TEXT PRIMARY KEY, name TEXT NOT NULL, price REAL NOT NULL,
            canteen_id TEXT, window_id TEXT, window_name TEXT, ingredients TEXT,
            heat INTEGER DEFAULT 0, daily_stock INTEGER DEFAULT 0, sold_out INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL,
            dish_id INTEGER, dish_key TEXT, qty INTEGER NOT NULL DEFAULT 1,
            amount REAL NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS members (
            id TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT,
            salt TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT, vid TEXT NOT NULL, t INTEGER NOT NULL,
            action TEXT, path TEXT, lat REAL, lng REAL, acc REAL, note TEXT
        );
        CREATE TABLE IF NOT EXISTS recharge_requests (
            id TEXT PRIMARY KEY, student_id TEXT NOT NULL, student_name TEXT,
            amount REAL NOT NULL, t INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
            review_t INTEGER, delivered INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS rl (
            k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL
        );
        """
    )
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(orders)")]
    info = {r["name"]: r for r in conn.execute("PRAGMA table_info(orders)")}
    if "dish_key" not in cols:
        conn.execute("ALTER TABLE orders ADD COLUMN dish_key TEXT")
    if "dish_id" in info and info["dish_id"]["notnull"]:
        conn.executescript(
            """
            CREATE TABLE orders_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL,
                dish_id INTEGER, dish_key TEXT, qty INTEGER NOT NULL DEFAULT 1,
                amount REAL NOT NULL, created_at TEXT NOT NULL
            );
            INSERT INTO orders_new (id, student_id, dish_id, dish_key, qty, amount, created_at)
                SELECT id, student_id, dish_id, dish_key, qty, amount, created_at FROM orders;
            DROP TABLE orders;
            ALTER TABLE orders_new RENAME TO orders;
            """
        )
    conn.commit()
    conn.close()


def do_backup():
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        dst = os.path.join(BACKUP_DIR, "canteen_%s.db" % stamp)
        src = sqlite3.connect(DB_PATH)
        out = sqlite3.connect(dst)
        src.backup(out)
        out.close()
        src.close()
        files = sorted(f for f in os.listdir(BACKUP_DIR) if f.endswith(".db"))
        for old in files[:-7]:
            os.remove(os.path.join(BACKUP_DIR, old))
        return dst
    except Exception:
        return None


def maybe_auto_backup():
    global _AUTO_BACKUP_DATE
    today = datetime.date.today().isoformat()
    if _AUTO_BACKUP_DATE != today:
        do_backup()
        _AUTO_BACKUP_DATE = today


def rate_limit(conn, key, max_n, window_sec):
    """固定窗口计数，与 Functions 版同语义；出错时放行（不影响主流程）"""
    now = int(time.time())
    exp = now + window_sec
    try:
        conn.execute(
            "INSERT INTO rl (k, n, exp) VALUES (?, 1, ?) "
            "ON CONFLICT(k) DO UPDATE SET "
            "n = CASE WHEN rl.exp <= ? THEN 1 ELSE rl.n + 1 END, "
            "exp = CASE WHEN rl.exp <= ? THEN ? ELSE rl.exp END",
            (key, exp, now, now, exp))
        conn.commit()
        row = conn.execute("SELECT n FROM rl WHERE k = ?", (key,)).fetchone()
        n = int(row["n"]) if row else 0
        return n <= max_n
    except Exception:
        return True


# ---------------------------------------------------------------- 账号
DEMO_NAMES = {"staff": "测试员工", "teacher": "测试教师", "student": "测试学生"}


def is_demo_account(uid, role):
    if role == "staff":
        return uid == "staff"
    if role == "teacher":
        return uid == "teacher"
    if role == "student":
        return uid == "student"
    return False


def find_member(conn, uid):
    try:
        row = conn.execute("SELECT id, role, name, salt, hash FROM members WHERE id = ?", (uid,)).fetchone()
        return dict(row) if row else None
    except Exception:
        return None


def authenticate(conn, uid, role, password):
    m = find_member(conn, uid)
    if m:
        if m["role"] != role:
            return None
        if safe_eq(pbkdf2_hash(password, m["salt"]), m["hash"]):
            return {"id": m["id"], "role": m["role"], "name": m["name"] or ""}
        return None
    if not is_demo_account(uid, role):
        return None
    pw = demo_password()
    if not pw or password != pw:
        return None
    return {"id": uid, "role": role, "name": DEMO_NAMES.get(role, uid)}


def login_admin(uid, password):
    expected = admin_hash()
    if not expected:
        return None
    if uid != admin_id():
        return None
    if not safe_eq(sha256hex(password), expected):
        return None
    return {"id": admin_id(), "role": "admin", "name": admin_name()}


# ---------------------------------------------------------------- 工具
def fmt_t(ms):
    """毫秒时间戳 → 北京时间字符串（与 Functions 版一致）"""
    if not ms:
        return ""
    d = datetime.datetime.utcfromtimestamp(ms / 1000 + 8 * 3600)
    return d.strftime("%Y-%m-%d %H:%M")


def txt(v, limit=160):
    if v is None:
        return None
    s = "".join(ch for ch in str(v) if ord(ch) >= 32 or ch == "\n").strip()
    return s[:limit] if s else None


def num(v):
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f


def as_bool(v):
    if v in (True, 1, "1", "true"):
        return 1
    if v in (False, 0, "0", "false"):
        return 0
    return None


TRACK_FIELDS = [
    ("ip", "ip", "txt"), ("country", "country", "txt"), ("region", "region", "txt"),
    ("city", "city", "txt"), ("isp", "isp", "txt"), ("asn", "asn", "num"),
    ("colo", "colo", "txt"), ("cf_tz", "cf_tz", "txt"), ("cf_lat", "cf_lat", "num"),
    ("cf_lng", "cf_lng", "num"), ("http_proto", "http_proto", "txt"), ("tls", "tls", "txt"),
    ("tcp_rtt", "tcp_rtt", "num"), ("ua", "ua", "txt400"), ("referer", "referer", "txt300"),
    ("device_model", "model", "txt80"), ("device_brand", "brand", "txt60"), ("os", "os", "txt60"),
    ("os_ver", "osVer", "txt40"), ("browser", "browser", "txt60"), ("browser_ver", "browserVer", "txt40"),
    ("engine", "engine", "txt40"), ("arch", "arch", "txt40"), ("webview", "webview", "bool"),
    ("app", "app", "bool"), ("screen", "screen", "txt60"), ("viewport", "viewport", "txt60"),
    ("dpr", "dpr", "num"), ("cores", "cores", "num"), ("mem", "mem", "num"),
    ("gpu", "gpu", "txt200"), ("gpu_vendor", "gpuVendor", "txt120"), ("canvas_fp", "fp", "txt40"),
    ("net_type", "netType", "txt40"), ("net_down", "netDown", "num"), ("net_rtt", "netRtt", "num"),
    ("save_data", "saveData", "bool"), ("battery", "battery", "txt40"),
    ("lang", "lang", "txt40"), ("languages", "languages", "txt160"), ("timezone", "timezone", "txt60"),
    ("tz_offset", "tzOffset", "num"), ("touch", "touch", "num"), ("cams", "cams", "num"),
    ("mics", "mics", "num"), ("speakers", "speakers", "num"), ("bluetooth", "bluetooth", "bool"),
    ("audio", "audio", "txt120"), ("storage", "storage", "txt120"),
    ("gps", "gps", "txt120"), ("extra", "extra", "txt1500"),
]

VISITOR_SHOW = [
    "vid", "first_seen", "last_seen", "visits", "ip", "country", "region", "city", "isp", "asn",
    "colo", "cf_tz", "cf_lat", "cf_lng", "http_proto", "tls", "tcp_rtt", "ua", "referer",
    "device_model", "device_brand", "os", "os_ver", "browser", "browser_ver", "engine", "arch",
    "webview", "app", "screen", "viewport", "dpr", "cores", "mem", "gpu", "gpu_vendor", "canvas_fp",
    "net_type", "net_down", "net_rtt", "save_data", "battery", "lang", "languages", "timezone",
    "tz_offset", "touch", "cams", "mics", "speakers", "bluetooth", "audio", "storage", "gps",
    "extra", "admin_note",
]


def ensure_visitors_schema(conn):
    """visitors 表字段很多，用线上导出的 schema；这里只在缺表时建一个最小可用结构"""
    row = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='visitors'").fetchone()
    if row:
        return
    cols = ",\n".join("%s TEXT" % c for c in VISITOR_SHOW)
    conn.executescript(
        "CREATE TABLE visitors (vid TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, "
        "last_seen INTEGER NOT NULL, visits INTEGER NOT NULL DEFAULT 1, %s);" % cols)
    conn.commit()


def client_ip_from_headers(headers):
    return (headers.get("CF-Connecting-IP") or headers.get("X-Real-IP")
            or (headers.get("X-Forwarded-For") or "").split(",")[0].strip() or "unknown")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------ 基础
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")

    def _json(self, code, payload, cookie=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _session(self):
        return verify_session(self.headers.get("Cookie"))

    def _read_body(self, limit=32768):
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
        except ValueError:
            return {}
        if length <= 0 or length > limit:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw or b"{}")
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    # ------------------------------------------------------------ GET
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        ses = self._session()
        conn = db()
        try:
            if u.path == "/health":
                row = conn.execute("SELECT COUNT(*) c FROM orders WHERE substr(created_at,1,10)=?",
                                   (datetime.date.today().isoformat(),)).fetchone()
                self._json(200, {
                    "ok": True, "service": "canteen-api", "version": 3, "host": "self-hosted",
                    "time": datetime.datetime.now().isoformat(timespec="seconds"),
                    "uptime_s": int(time.time() - START_TS),
                    "db_bytes": os.path.getsize(DB_PATH) if os.path.exists(DB_PATH) else 0,
                    "orders_today": row["c"], "auth_ready": bool(auth_secret()),
                })

            elif u.path == "/api/auth":
                if not ses:
                    return self._json(401, {"ok": False, "error": "unauthorized"})
                self._json(200, {"ok": True, "user": {
                    "role": ses.get("role"), "id": ses.get("id"), "name": ses.get("name") or ""}})

            elif u.path == "/api/dishes":
                rows = [dict(r) for r in conn.execute(
                    "SELECT dish_id,name,price,canteen_id,window_id,window_name,ingredients,"
                    "heat,daily_stock,sold_out FROM dishes_v2 ORDER BY dish_id")]
                self._json(200, {"ok": True, "dishes": rows})

            elif u.path == "/api/orders":
                if not ses:
                    return self._json(401, {"ok": False, "error": "unauthorized"})
                if ses.get("role") in ("student", "teacher"):
                    rows = [dict(r) for r in conn.execute(
                        "SELECT * FROM orders WHERE student_id=? ORDER BY id DESC LIMIT 200", (ses["id"],))]
                else:
                    rows = [dict(r) for r in conn.execute("SELECT * FROM orders ORDER BY id DESC LIMIT 200")]
                self._json(200, {"ok": True, "orders": rows})

            elif u.path == "/api/stats":
                if not ses or ses.get("role") not in ("admin", "staff"):
                    return self._json(403, {"ok": False, "error": "forbidden"})
                day = q.get("date", [datetime.date.today().isoformat()])[0]
                row = conn.execute(
                    "SELECT COUNT(*) AS orders, COALESCE(SUM(amount),0) AS revenue, "
                    "COALESCE(SUM(qty),0) AS items FROM orders WHERE substr(created_at,1,10)=?",
                    (day,)).fetchone()
                top = [dict(r) for r in conn.execute(
                    "SELECT COALESCE(dish_key, CAST(dish_id AS TEXT)) AS dish, "
                    "COALESCE((SELECT name FROM dishes_v2 WHERE dish_id=dish_key), "
                    "(SELECT name FROM dishes WHERE id=o.dish_id), '未知菜品') AS name, "
                    "SUM(o.qty) AS sold FROM orders o WHERE substr(o.created_at,1,10)=? "
                    "GROUP BY dish ORDER BY sold DESC LIMIT 5", (day,))]
                self._json(200, {"ok": True, "date": day, "orders": row["orders"],
                                 "revenue": row["revenue"], "items": row["items"], "top": top})

            elif u.path == "/api/ops":
                if not ses or ses.get("role") != "admin":
                    return self._json(403, {"ok": False, "error": "forbidden"})
                today = datetime.date.today().isoformat()
                t = conn.execute("SELECT COUNT(*) c, COALESCE(SUM(amount),0) rev FROM orders "
                                 "WHERE substr(created_at,1,10)=?", (today,)).fetchone()
                total = conn.execute("SELECT COUNT(*) c FROM orders").fetchone()
                ndishes = conn.execute("SELECT COUNT(*) c FROM dishes_v2").fetchone()
                backups = sorted(os.listdir(BACKUP_DIR))[-7:] if os.path.isdir(BACKUP_DIR) else []
                try:
                    members_n = conn.execute("SELECT COUNT(*) c FROM members").fetchone()["c"]
                    visitors_n = conn.execute("SELECT COUNT(*) c FROM visitors").fetchone()["c"]
                except Exception:
                    members_n, visitors_n = 0, 0
                self._json(200, {
                    "ok": True, "service": "canteen-api", "host": "self-hosted",
                    "time": datetime.datetime.now().isoformat(timespec="seconds"),
                    "uptime_s": int(time.time() - START_TS),
                    "db_bytes": os.path.getsize(DB_PATH) if os.path.exists(DB_PATH) else 0,
                    "orders_today": t["c"], "revenue_today": t["rev"], "orders_total": total["c"],
                    "dishes": ndishes["c"], "members": members_n, "visitors": visitors_n,
                    "backups": backups, "auth_ready": bool(auth_secret()),
                })
            else:
                self._json(404, {"ok": False, "error": "not_found"})
        finally:
            conn.close()

    # ------------------------------------------------------------ POST
    def do_POST(self):
        u = urlparse(self.path)
        data = self._read_body()
        ses = self._session()

        if u.path == "/api/auth":
            return self._auth(data)
        if u.path == "/api/track":
            return self._track(data)
        if u.path == "/api/visitors":
            return self._visitors(data)
        if u.path == "/api/recharge":
            return self._recharge(data)
        if u.path == "/api/orders":
            return self._order(data, ses)
        if u.path == "/api/dishes/sync":
            return self._dish_sync(data, ses)
        self._json(404, {"ok": False, "error": "not_found"})

    # ------------------------------------------------------------ 认证
    def _auth(self, body):
        action = str(body.get("action") or "login")

        if action == "logout":
            return self._json(200, {"ok": True}, clear_cookie())

        if not auth_secret():
            return self._json(503, {"ok": False, "error": "auth_not_configured",
                                    "message": "鉴权服务未配置，暂时无法登录，请稍后再试"})

        ip = client_ip_from_headers(self.headers)
        conn = db()
        try:
            if action == "register":
                if not rate_limit(conn, "reg:" + ip, 5, 3600):
                    return self._json(429, {"ok": False, "error": "too_many_attempts",
                                            "message": "尝试次数过多，请 10 分钟后再试"})
                uid = txt(body.get("id"), 20)
                name = txt(body.get("name"), 20)
                pw = str(body.get("password") or "")
                import re as _re
                if not uid or not _re.match(r"^[A-Za-z0-9_]{3,20}$", uid):
                    return self._json(400, {"ok": False, "error": "bad_id",
                                            "message": "学号格式不正确（3~20 位字母数字）"})
                if is_demo_account(uid, "student") or is_demo_account(uid, "teacher") or is_demo_account(uid, "staff"):
                    return self._json(409, {"ok": False, "error": "reserved",
                                            "message": "该学号为演示账号保留，请换一个"})
                if len(pw) < 6:
                    return self._json(400, {"ok": False, "error": "weak_password", "message": "密码至少 6 位"})
                if find_member(conn, uid):
                    return self._json(409, {"ok": False, "error": "exists", "message": "该学号已注册"})
                salt = random_hex(16)
                try:
                    conn.execute("INSERT INTO members (id, role, name, salt, hash, created) VALUES (?,?,?,?,?,?)",
                                 (uid, "student", name, salt, pbkdf2_hash(pw, salt), int(time.time() * 1000)))
                    conn.commit()
                except sqlite3.IntegrityError:
                    return self._json(409, {"ok": False, "error": "exists", "message": "该学号已注册"})
                now = int(time.time())
                token = sign_session({"role": "student", "id": uid, "name": name or "新同学",
                                      "iat": now, "exp": now + SESSION_TTL})
                return self._json(200, {"ok": True, "user": {"role": "student", "id": uid,
                                                             "name": name or "新同学"},
                                        "expiresIn": SESSION_TTL}, session_cookie(token))

            if action == "changepassword":
                ses = self._session()
                if not ses:
                    return self._json(401, {"ok": False, "error": "unauthorized",
                                            "message": "登录状态已失效，请重新登录"})
                old_pw = str(body.get("oldPassword") or "")
                new_pw = str(body.get("newPassword") or "")
                if len(new_pw) < 6:
                    return self._json(400, {"ok": False, "error": "weak_password", "message": "新密码至少 6 位"})
                if not rate_limit(conn, "chpw:" + ses["id"], 5, 600):
                    return self._json(429, {"ok": False, "error": "too_many_attempts",
                                            "message": "尝试次数过多，请 10 分钟后再试"})
                if ses.get("role") == "admin":
                    return self._json(400, {"ok": False, "error": "unsupported",
                                            "message": "管理员密码请在服务端 admin_sha256 文件中修改"})
                m = find_member(conn, ses["id"])
                if not m or m["role"] != ses.get("role"):
                    return self._json(404, {"ok": False, "error": "not_member",
                                            "message": "该账号未在服务端建档，无法在线修改密码"})
                if not safe_eq(pbkdf2_hash(old_pw, m["salt"]), m["hash"]):
                    return self._json(403, {"ok": False, "error": "wrong_old", "message": "原密码不正确"})
                salt = random_hex(16)
                conn.execute("UPDATE members SET salt=?, hash=? WHERE id=?",
                             (salt, pbkdf2_hash(new_pw, salt), ses["id"]))
                conn.commit()
                return self._json(200, {"ok": True, "message": "密码已修改"})

            # 登录
            role = str(body.get("role") or "admin")
            if role not in ("student", "teacher", "staff", "admin"):
                role = "admin"
            uid = txt(body.get("id"), 40)
            pw = str(body.get("password") or "")
            if not uid or not pw:
                return self._json(400, {"ok": False, "error": "need_credentials",
                                        "message": "请输入账号和密码"})
            if not rate_limit(conn, "login:" + ip, 12, 600) or not rate_limit(conn, "login:id:" + uid, 20, 600):
                return self._json(429, {"ok": False, "error": "too_many_attempts",
                                        "message": "尝试次数过多，请 10 分钟后再试"})
            user = login_admin(uid, pw) if role == "admin" else authenticate(conn, uid, role, pw)
            if not user:
                return self._json(403, {"ok": False, "error": "denied", "message": "账号或密码错误"})
            now = int(time.time())
            token = sign_session({"role": user["role"], "id": user["id"], "name": user["name"] or "",
                                  "iat": now, "exp": now + SESSION_TTL})
            return self._json(200, {"ok": True, "user": user, "expiresIn": SESSION_TTL},
                              session_cookie(token))
        finally:
            conn.close()

    # ------------------------------------------------------------ 访客采集
    def _track(self, body):
        ip = client_ip_from_headers(self.headers)
        conn = db()
        try:
            ensure_visitors_schema(conn)
            if not rate_limit(conn, "trk:" + ip, 60, 60):
                return self._json(429, {"ok": False, "error": "too_many_requests"})
            vid = txt(body.get("vid"), 64)
            if not vid or len(vid) < 8:
                return self._json(400, {"ok": False, "error": "bad_vid"})
            now = int(time.time() * 1000)

            f = {"ip": txt(ip if ip != "unknown" else None, 64),
                 "ua": txt(self.headers.get("User-Agent"), 400),
                 "referer": txt(self.headers.get("Referer"), 300)}
            # 边缘节点补全的网络信息，由反代以 X-CF-* 头透传
            cf_headers = {
                "country": "X-CF-Country", "region": "X-CF-Region", "city": "X-CF-City",
                "isp": "X-CF-ASOrg", "asn": "X-CF-ASN", "colo": "X-CF-Colo",
                "cf_tz": "X-CF-Timezone", "cf_lat": "X-CF-Lat", "cf_lng": "X-CF-Lng",
                "http_proto": "X-CF-Proto", "tls": "X-CF-TLS", "tcp_rtt": "X-CF-RTT",
            }
            for col, hname in cf_headers.items():
                raw = self.headers.get(hname)
                if raw is None:
                    continue
                f[col] = num(raw) if col in ("asn", "cf_lat", "cf_lng", "tcp_rtt") else txt(raw, 96)
            for col, key, kind in TRACK_FIELDS:
                if col in f:
                    continue
                v = body.get(key)
                if kind == "num":
                    f[col] = num(v)
                elif kind == "bool":
                    f[col] = as_bool(v)
                elif kind and kind.startswith("txt"):
                    f[col] = txt(v, int(kind[3:]) if len(kind) > 3 else 160)
                else:
                    f[col] = txt(v, 160)

            cols = [c for c in f.keys()]
            vals = [f[c] for c in cols]
            inc = 0 if body.get("hit") is False else 1
            sql = ("INSERT INTO visitors (vid, first_seen, last_seen, visits, %s) "
                   "VALUES (?,?,?,1,%s) ON CONFLICT(vid) DO UPDATE SET last_seen=excluded.last_seen, "
                   "visits=visitors.visits+%d" % (",".join(cols), ",".join("?" * len(cols)), inc))
            sql += "".join(", %s = COALESCE(excluded.%s, %s)" % (c, c, c) for c in cols)
            conn.execute(sql, [vid, now, now] + vals)
            conn.commit()

            action = txt(body.get("action"), 40)
            if action:
                try:
                    conn.execute("INSERT INTO visits (vid, t, action, path, lat, lng, acc, note) "
                                 "VALUES (?,?,?,?,?,?,?,?)",
                                 (vid, now, action, txt(body.get("path"), 120), num(body.get("lat")),
                                  num(body.get("lng")), num(body.get("acc")), txt(body.get("note"), 200)))
                    conn.commit()
                except Exception:
                    pass
            return self._json(200, {"ok": True})
        except Exception as e:
            return self._json(500, {"ok": False, "error": "db_error", "detail": str(e)[:200]})
        finally:
            conn.close()

    # ------------------------------------------------------------ 访客查询（管理员）
    def _visitors(self, body):
        ses = self._session()
        allowed = bool(ses and ses.get("role") == "admin")
        if not allowed:
            pw = str(body.get("password") or "")
            if not pw:
                return self._json(401, {"ok": False, "error": "need_password"})
            if not (admin_hash() and safe_eq(sha256hex(pw), admin_hash())):
                return self._json(403, {"ok": False, "error": "denied"})
        conn = db()
        try:
            ensure_visitors_schema(conn)
            if body.get("setNote") and body.get("noteVid"):
                conn.execute("UPDATE visitors SET admin_note=? WHERE vid=?",
                             (txt(body.get("setNote"), 200), txt(body.get("noteVid"), 64)))
                conn.commit()
                return self._json(200, {"ok": True, "admin_note": txt(body.get("setNote"), 200)})

            limit = max(1, min(int(body.get("limit") or 100), 300))
            out = {"ok": True}
            out["visitors"] = [dict(r) for r in conn.execute(
                "SELECT %s FROM visitors ORDER BY last_seen DESC LIMIT ?" % ",".join(VISITOR_SHOW), (limit,))]
            t = conn.execute("SELECT COUNT(*) devices, COALESCE(SUM(visits),0) hits FROM visitors").fetchone()
            out["totals"] = {"devices": t["devices"], "hits": t["hits"]}
            now = int(time.time() * 1000)
            day_start = (now + 8 * 3600 * 1000) // 86400000 * 86400000 - 8 * 3600 * 1000
            out["todayNew"] = conn.execute("SELECT COUNT(*) n FROM visitors WHERE first_seen >= ?",
                                           (day_start,)).fetchone()["n"]
            out["mobile"] = conn.execute(
                "SELECT COUNT(*) n FROM visitors WHERE ua LIKE '%Mobile%' OR ua LIKE '%Android%' "
                "OR ua LIKE '%iPhone%'").fetchone()["n"]
            out["cities"] = [dict(r) for r in conn.execute(
                "SELECT COALESCE(city, region, country, '未知') AS c, COUNT(*) AS n FROM visitors "
                "GROUP BY c ORDER BY n DESC LIMIT 8")]
            if body.get("vid"):
                out["visits"] = [dict(r) for r in conn.execute(
                    "SELECT id,t,action,path,lat,lng,acc,note FROM visits WHERE vid=? "
                    "ORDER BY t DESC LIMIT 80", (str(body.get("vid"))[:64],))]
            return self._json(200, out)
        except Exception as e:
            return self._json(500, {"ok": False, "error": "db_error", "detail": str(e)[:200]})
        finally:
            conn.close()

    # ------------------------------------------------------------ 充值
    def _recharge(self, body):
        action = str(body.get("action") or "")
        ses = self._session()
        conn = db()
        try:
            now = int(time.time() * 1000)
            if action in ("submit", "mine", "credits", "ack"):
                if not ses or ses.get("role") not in ("student", "teacher"):
                    return self._json(401, {"ok": False, "error": "session_expired",
                                            "message": "登录状态已失效，请重新登录"})
                sid = ses["id"]
                if not rate_limit(conn, "rc:" + sid, 60, 60):
                    return self._json(429, {"ok": False, "error": "too_many_requests"})

                if action == "submit":
                    try:
                        amount = round(float(body.get("amount")) * 100) / 100
                    except (TypeError, ValueError):
                        amount = -1
                    if amount <= 0 or amount > 5000:
                        return self._json(400, {"ok": False, "error": "金额需在 1~5000 元之间"})
                    recent = conn.execute(
                        "SELECT id FROM recharge_requests WHERE student_id=? AND t>? AND status='pending'",
                        (sid, now - 10000)).fetchone()
                    if recent:
                        return self._json(429, {"ok": False, "error": "刚提交过一条申请，请等管理员处理"})
                    rid = "R" + base36(now) + str(random.randint(100, 999))
                    conn.execute("INSERT INTO recharge_requests (id, student_id, student_name, amount, t, status) "
                                 "VALUES (?,?,?,?,?,'pending')",
                                 (rid, sid, txt(ses.get("name"), 60), amount, now))
                    conn.commit()
                    return self._json(200, {"ok": True, "id": rid, "amount": amount})

                if action == "mine":
                    rows = [dict(r) for r in conn.execute(
                        "SELECT id, amount, t, status, review_t FROM recharge_requests "
                        "WHERE student_id=? ORDER BY t DESC LIMIT 20", (sid,))]
                    for r in rows:
                        r["t"] = fmt_t(r["t"])
                        r["review_t"] = fmt_t(r["review_t"])
                    return self._json(200, {"ok": True, "requests": rows})

                if action == "credits":
                    rows = [dict(r) for r in conn.execute(
                        "SELECT id, amount, t FROM recharge_requests WHERE student_id=? "
                        "AND status='approved' AND delivered=0 ORDER BY t ASC LIMIT 20", (sid,))]
                    return self._json(200, {"ok": True, "credits": [
                        {"id": r["id"], "amount": r["amount"], "t": fmt_t(r["t"])} for r in rows]})

                ids = [txt(x, 40) for x in (body.get("ids") or []) if txt(x, 40)][:20]
                if not ids:
                    return self._json(400, {"ok": False, "error": "need_params"})
                conn.execute("UPDATE recharge_requests SET delivered=1 WHERE student_id=? AND id IN (%s)"
                             % ",".join("?" * len(ids)), [sid] + ids)
                conn.commit()
                return self._json(200, {"ok": True})

            # 管理员侧
            ip = client_ip_from_headers(self.headers)
            if not rate_limit(conn, "adm:" + ip, 30, 60):
                return self._json(429, {"ok": False, "error": "too_many_requests"})
            allowed = bool(ses and ses.get("role") == "admin")
            if not allowed:
                pw = str(body.get("password") or "")
                if not pw:
                    return self._json(401, {"ok": False, "error": "need_password"})
                if not (admin_hash() and safe_eq(sha256hex(pw), admin_hash())):
                    return self._json(403, {"ok": False, "error": "denied"})

            if action == "list":
                rows = [dict(r) for r in conn.execute(
                    "SELECT id, student_id, student_name, amount, t, status, review_t FROM recharge_requests "
                    "ORDER BY (status='pending') DESC, t DESC LIMIT 100")]
                for r in rows:
                    r["t"] = fmt_t(r["t"])
                    r["review_t"] = fmt_t(r["review_t"])
                return self._json(200, {"ok": True, "requests": rows})

            if action == "review":
                rid = txt(body.get("id"), 40)
                approve = body.get("approve") in (True, 1, "1")
                if not rid:
                    return self._json(400, {"ok": False, "error": "need_id"})
                r = conn.execute("SELECT id, status FROM recharge_requests WHERE id=?", (rid,)).fetchone()
                if not r:
                    return self._json(404, {"ok": False, "error": "该申请不存在"})
                if r["status"] != "pending":
                    return self._json(409, {"ok": False, "error": "该申请已处理"})
                conn.execute("UPDATE recharge_requests SET status=?, review_t=? WHERE id=?",
                             ("approved" if approve else "rejected", now, rid))
                conn.commit()
                return self._json(200, {"ok": True, "status": "approved" if approve else "rejected"})

            return self._json(400, {"ok": False, "error": "bad_action"})
        except Exception as e:
            return self._json(500, {"ok": False, "error": "db_error", "detail": str(e)[:200]})
        finally:
            conn.close()

    # ------------------------------------------------------------ 下单
    def _order(self, data, ses):
        if not ses:
            return self._json(401, {"ok": False, "error": "unauthorized"})
        if ses.get("role") not in ("student", "teacher"):
            return self._json(403, {"ok": False, "error": "forbidden"})
        sid = ses["id"]
        dish_key = str(data.get("dishId") or data.get("dishKey") or "").strip()
        try:
            qty = max(1, min(int(data.get("qty", 1) or 1), 20))
        except (TypeError, ValueError):
            qty = 1
        if not dish_key:
            return self._json(400, {"ok": False, "error": "need_dishId"})
        maybe_auto_backup()
        conn = db()
        try:
            dish = conn.execute("SELECT * FROM dishes_v2 WHERE dish_id=?", (dish_key,)).fetchone()
            if dish:
                price, name = dish["price"], dish["name"]
            else:
                price, name = float(data.get("amount") or 0), str(data.get("dishName") or "未知菜品")
            if price <= 0:
                return self._json(400, {"ok": False, "error": "bad_amount"})
            now = datetime.datetime.now().isoformat(timespec="seconds")
            cur = conn.execute("INSERT INTO orders (student_id, dish_key, qty, amount, created_at) "
                               "VALUES (?,?,?,?,?)", (sid, dish_key, qty, round(price * qty, 2), now))
            conn.commit()
            return self._json(200, {"ok": True, "orderId": cur.lastrowid, "dish": name,
                                    "amount": round(price * qty, 2), "time": now})
        finally:
            conn.close()

    # ------------------------------------------------------------ 菜品同步
    def _dish_sync(self, data, ses):
        if not ses or ses.get("role") != "admin":
            return self._json(403, {"ok": False, "error": "forbidden"})
        dishes = data.get("dishes")
        if not isinstance(dishes, list) or not dishes:
            return self._json(400, {"ok": False, "error": "need_dishes"})
        maybe_auto_backup()
        conn = db()
        try:
            n = 0
            for d in dishes:
                if not isinstance(d, dict) or not d.get("dishId"):
                    continue
                conn.execute(
                    "INSERT INTO dishes_v2 (dish_id,name,price,canteen_id,window_id,window_name,"
                    "ingredients,heat,daily_stock,sold_out) VALUES (?,?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(dish_id) DO UPDATE SET name=excluded.name, price=excluded.price, "
                    "canteen_id=excluded.canteen_id, window_id=excluded.window_id, "
                    "window_name=excluded.window_name, ingredients=excluded.ingredients, "
                    "heat=excluded.heat, daily_stock=excluded.daily_stock, sold_out=excluded.sold_out",
                    (str(d.get("dishId")), str(d.get("name") or ""), float(d.get("price") or 0),
                     str(d.get("canteenId") or ""), str(d.get("windowId") or ""),
                     str(d.get("windowName") or ""), str(d.get("ingredients") or ""),
                     int(d.get("heat") or 0), int(d.get("dailyStock") or 0),
                     1 if d.get("soldOut") else 0))
                n += 1
            conn.commit()
            return self._json(200, {"ok": True, "synced": n})
        finally:
            conn.close()

    def log_message(self, fmt, *args):
        pass


def base36(n):
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    n = int(n)
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = digits[r] + out
    return out or "0"


if __name__ == "__main__":
    init_db()
    print("canteen-api v3 listening on 0.0.0.0:8787", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8787), Handler).serve_forever()
