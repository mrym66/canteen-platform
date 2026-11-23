#!/usr/bin/env python3
"""一次性迁移：把线上导出数据导入本地 SQLite（幂等，可重复执行）"""
import os
import sqlite3

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "canteen.db")
SQL = os.path.join(BASE, "import.sql")


def split_statements(text):
    """按分号拆分（导出文件里没有嵌套触发器等复杂结构，简单拆分足够）"""
    out, buf = [], []
    for line in text.splitlines():
        if line.strip().startswith("--"):
            continue
        buf.append(line)
        if line.rstrip().endswith(";"):
            stmt = "\n".join(buf).strip()
            if stmt:
                out.append(stmt)
            buf = []
    if buf:
        out.append("\n".join(buf).strip())
    return out


def main():
    sql = open(SQL, encoding="utf-8").read()
    conn = sqlite3.connect(DB)
    ok = skip = fail = 0
    for stmt in split_statements(sql):
        low = stmt.lower()
        if not low.startswith(("create", "insert", "pragma", "begin", "commit", "drop", "alter")):
            continue
        try:
            conn.execute(stmt)
            ok += 1
        except sqlite3.IntegrityError:
            skip += 1          # 已存在的行（主键冲突）→ 跳过
        except sqlite3.OperationalError as e:
            if "already exists" in str(e):
                skip += 1      # 表已存在 → 跳过建表，继续插入
            else:
                fail += 1
                print("FAIL:", str(e)[:120], "|", stmt[:80].replace("\n", " "))
    conn.commit()
    print("statements ok=%d skipped=%d failed=%d" % (ok, skip, fail))
    for t in ["visitors", "visits", "members", "recharge_requests", "dishes_v2", "orders", "rl"]:
        try:
            n = conn.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
            print("%-18s %d" % (t, n))
        except Exception as e:
            print("%-18s ERR %s" % (t, e))
    conn.close()


if __name__ == "__main__":
    main()
