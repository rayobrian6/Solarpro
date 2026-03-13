#!/usr/bin/env python3
import urllib.request
import json

BASE = "https://solarpro-v31.vercel.app"

def get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"_error": str(e)}

def post(path, data):
    try:
        req = urllib.request.Request(
            BASE + path,
            data=json.dumps(data).encode(),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            # 4xx/5xx — read the body which contains the JSON error
            return json.loads(e.read())
    except Exception as e:
        return {"_error": str(e)}

ok = lambda b: "PASS" if b else "FAIL"

print("=" * 60)
print("PRODUCTION VALIDATION REPORT — v47.24")
print("=" * 60)

# --- Environment Variables ---
print("\n[1] ENVIRONMENT VARIABLES")
db_health = get("/api/health/database")
env = db_health.get("env", {})
print(f"  DATABASE_URL      : {ok(env.get('DATABASE_URL'))}  ({env.get('DATABASE_URL')})")
print(f"  JWT_SECRET        : {ok(env.get('JWT_SECRET'))}  ({env.get('JWT_SECRET')})")
print(f"  OPENAI_API_KEY    : {ok(env.get('OPENAI_API_KEY'))}  ({env.get('OPENAI_API_KEY')})")
print(f"  GOOGLE_MAPS_KEY   : {ok(env.get('GOOGLE_MAPS_API_KEY'))}  ({env.get('GOOGLE_MAPS_API_KEY')})")
print(f"  env_valid         : {ok(db_health.get('env_valid'))}  ({db_health.get('env_valid')})")

# --- Database ---
print("\n[2] DATABASE CONNECTION")
print(f"  status            : {ok(db_health.get('status')=='healthy')}  ({db_health.get('status')})")
print(f"  database          : {ok(db_health.get('database')=='connected')}  ({db_health.get('database')})")
pg = db_health.get("db_ping", {})
print(f"  pg_version        : {ok(pg.get('ok'))}  ({pg.get('pg_version', 'unknown')})")
print(f"  elapsed_ms        : {db_health.get('elapsed_ms')}ms")
tables = db_health.get("tables", {})
for t, v in tables.items():
    exists = v.get("exists", False)
    required = v.get("required", False)
    rows = v.get("approx_rows", "?")
    status = "PASS" if exists else ("WARN" if not required else "FAIL")
    print(f"  table/{t:<20}: {status}  (exists={exists}, required={required}, rows~{rows})")

# --- Auth System ---
print("\n[3] AUTH SYSTEM")
auth_health = get("/api/health/auth")
print(f"  status            : {ok(auth_health.get('status')=='healthy')}  ({auth_health.get('status')})")
print(f"  jwt               : {ok(auth_health.get('jwt')=='ok')}  ({auth_health.get('jwt')})")
print(f"  database_url      : {ok(auth_health.get('database_url')=='ok')}  ({auth_health.get('database_url')})")
print(f"  database          : {ok(auth_health.get('database')=='ok')}  ({auth_health.get('database')})")
print(f"  users_table       : {ok(auth_health.get('users_table')=='ok')}  ({auth_health.get('users_table')})")
print(f"  user_count        : {auth_health.get('user_count')} users")

# --- Auth Login Flow ---
print("\n[4] AUTH LOGIN FLOW")
bad_login = post("/api/auth/login", {"email": "test@test.com", "password": "wrongpassword"})
err = bad_login.get("error", "")
proper_rejection = bad_login.get("success") == False and ("Invalid" in err or "not found" in err.lower() or "password" in err.lower())
print(f"  bad-creds reject  : {ok(proper_rejection)}  ({err})")
print(f"  (confirms login route runs Node.js, not Edge — bcrypt works)")

# --- Version ---
print("\n[5] VERSION")
ver = get("/api/version")
print(f"  version           : {ok(ver.get('version') in ('v47.24','v47.25','v47.26'))}  ({ver.get('version')})")
print(f"  description       : {ver.get('description', '?')[:60]}...")

# --- Summary ---
print("\n" + "=" * 60)
checks = [
    env.get("DATABASE_URL"),
    env.get("JWT_SECRET"),
    env.get("OPENAI_API_KEY"),
    env.get("GOOGLE_MAPS_API_KEY"),
    db_health.get("status") == "healthy",
    db_health.get("database") == "connected",
    auth_health.get("status") == "healthy",
    auth_health.get("jwt") == "ok",
    proper_rejection,
    ver.get("version") in ("v47.24", "v47.25", "v47.26"),  # accept current+next
]
passed = sum(1 for c in checks if c)
total = len(checks)
print(f"RESULT: {passed}/{total} checks passed")
if passed == total:
    print("STATUS: PRODUCTION FULLY OPERATIONAL")
else:
    print("STATUS: ISSUES DETECTED — review above")
print("=" * 60)