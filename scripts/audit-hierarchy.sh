#!/usr/bin/env bash
# Hierarchy & isolation audit — probes the LIVE api for every spec invariant.
# Read-only except where noted (mutation probes use invalid targets that must be rejected).
# Usage: bash scripts/audit-hierarchy.sh
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
PASS="DemoPass123!"
ADMIN_PASS="$(cut -d'|' -f2 /tmp/wm-preview-creds.txt)"
TMP=$(mktemp -d)
FAILED=0
PASSED=0

# The sign-in endpoint is rate limited (429 under a rapid burst), so back off
# and retry rather than silently proceeding with an unauthenticated jar — an
# unauthenticated request 307s to /auth/login and every assertion reads as a
# false failure.
login() { # login <email> <password> <jarfile>
  local attempt code
  for attempt in 1 2 3 4 5 6; do
    code=$(curl -s --max-time 20 -c "$3" -X POST "$BASE/api/auth/sign-in/email" \
      -H "Content-Type: application/json" -H "Origin: $BASE" \
      -d "$(printf '{"email":"%s","password":"%s"}' "$1" "$2")" -o /dev/null -w "%{http_code}")
    if [ "$code" = "200" ]; then echo "$code"; return 0; fi
    sleep $((attempt * 10))
  done
  echo "$code"
  printf '  !! LOGIN FAILED for %s (last code %s)\n' "$1" "$code" >&2
  return 1
}

# check <description> <expected> <actual>
check() {
  if [ "$2" = "$3" ]; then
    printf '  PASS  %s\n' "$1"; PASSED=$((PASSED+1))
  else
    printf '  FAIL  %s (expected %s, got %s)\n' "$1" "$2" "$3"; FAILED=$((FAILED+1))
  fi
}

get() { curl -s --max-time 20 -b "$1" "$BASE$2"; }
code() { curl -s --max-time 20 -b "$1" -o /dev/null -w "%{http_code}" "$BASE$2"; }

echo "=== logging in every rank (spaced to avoid the login rate limiter) ==="
login_all() {
  login "admin@workmanager.local" "$ADMIN_PASS" "$TMP/admin" >/dev/null || return 1; sleep 3
  login "gm@demo.local"           "$PASS" "$TMP/gm"        >/dev/null || return 1; sleep 3
  login "mgr.eng@demo.local"      "$PASS" "$TMP/mgr_eng"   >/dev/null || return 1; sleep 3
  login "lead.eng@demo.local"     "$PASS" "$TMP/lead_eng"  >/dev/null || return 1; sleep 3
  login "dev1@demo.local"         "$PASS" "$TMP/dev1"      >/dev/null || return 1; sleep 3
  login "mgr.sales@demo.local"    "$PASS" "$TMP/mgr_sales" >/dev/null || return 1; sleep 3
  login "rep1@demo.local"         "$PASS" "$TMP/rep1"      >/dev/null || return 1; sleep 3
  login "ops1@demo.local"         "$PASS" "$TMP/ops1"      >/dev/null || return 1
}
if ! login_all; then
  echo "ABORT: could not authenticate every rank — results would be meaningless." >&2
  exit 2
fi
# Fail loudly if any jar is unauthenticated: a 307 to /auth/login would make
# every wall assertion look like it passed for the wrong reason.
for jar in admin gm mgr_eng lead_eng dev1 mgr_sales rep1 ops1; do
  c=$(curl -s --max-time 20 -b "$TMP/$jar" -o /dev/null -w "%{http_code}" "$BASE/api/tasks?limit=1")
  if [ "$c" != "200" ]; then echo "ABORT: jar '$jar' is not authenticated (/api/tasks -> $c)" >&2; exit 2; fi
done
echo "  all 8 sessions authenticated"

count_prefix() { # count_prefix <jar> <endpoint> <prefix>
  get "$1" "$2" | grep -oE '"taskIdDisplay":"[A-Z]+-[0-9]+"' | sed 's/.*:"//;s/"//' | sed 's/-[0-9]*$//' | grep -c "^$3$"
}

echo
echo "=== 3. DEPARTMENT WALL — list scoping ==="
check "super_admin sees all 19 tasks"      "19" "$(get "$TMP/admin"     '/api/tasks?limit=100' | grep -o taskIdDisplay | wc -l | tr -d ' ')"
check "general_manager sees all 19 tasks"  "19" "$(get "$TMP/gm"        '/api/tasks?limit=100' | grep -o taskIdDisplay | wc -l | tr -d ' ')"
check "ENG manager sees only 8 ENG tasks"   "8" "$(get "$TMP/mgr_eng"   '/api/tasks?limit=100' | grep -o taskIdDisplay | wc -l | tr -d ' ')"
check "SLS manager sees only 6 SLS tasks"   "6" "$(get "$TMP/mgr_sales" '/api/tasks?limit=100' | grep -o taskIdDisplay | wc -l | tr -d ' ')"
check "OPS exec sees only 5 OPS tasks"      "5" "$(get "$TMP/ops1"      '/api/tasks?limit=100' | grep -o taskIdDisplay | wc -l | tr -d ' ')"
check "ENG manager sees 0 PIPE(sales) tasks" "0" "$(count_prefix "$TMP/mgr_eng" '/api/tasks?limit=100' 'PIPE')"
check "SLS manager sees 0 PLAT(eng) tasks"   "0" "$(count_prefix "$TMP/mgr_sales" '/api/tasks?limit=100' 'PLAT')"

echo
echo "=== 3. DEPARTMENT WALL — users list ==="
check "super_admin sees all 9 users" "9" "$(get "$TMP/admin"     '/api/users?limit=100' | grep -o '"email"' | wc -l | tr -d ' ')"
check "GM sees all 9 users"          "9" "$(get "$TMP/gm"        '/api/users?limit=100' | grep -o '"email"' | wc -l | tr -d ' ')"
check "SLS manager sees 2 SLS users" "2" "$(get "$TMP/mgr_sales" '/api/users?limit=100' | grep -o '"email"' | wc -l | tr -d ' ')"
check "OPS exec sees 1 OPS user"     "1" "$(get "$TMP/ops1"      '/api/users?limit=100' | grep -o '"email"' | wc -l | tr -d ' ')"

echo
echo "=== 3. DEPARTMENT WALL — projects list ==="
check "GM sees 3 projects"            "3" "$(get "$TMP/gm"        '/api/projects?limit=100' | grep -o '"ownerId"' | wc -l | tr -d ' ')"
check "SLS manager sees 1 project"    "1" "$(get "$TMP/mgr_sales" '/api/projects?limit=100' | grep -o '"ownerId"' | wc -l | tr -d ' ')"
check "ENG manager sees 1 project"    "1" "$(get "$TMP/mgr_eng"   '/api/projects?limit=100' | grep -o '"ownerId"' | wc -l | tr -d ' ')"

echo
echo "=== 3. DEPARTMENT WALL — DETAIL READ (the 'known ID is readable' hole) ==="
ENG_TASK=$(get "$TMP/mgr_eng" '/api/tasks?limit=1' | grep -oE '"id":"[a-f0-9-]{36}"' | head -1 | sed 's/.*:"//;s/"//')
SLS_TASK=$(get "$TMP/mgr_sales" '/api/tasks?limit=1' | grep -oE '"id":"[a-f0-9-]{36}"' | head -1 | sed 's/.*:"//;s/"//')
ENG_PROJ=$(get "$TMP/mgr_eng" '/api/projects?limit=1' | grep -oE '"id":"[a-f0-9-]{36}"' | head -1 | sed 's/.*:"//;s/"//')
SLS_PROJ=$(get "$TMP/mgr_sales" '/api/projects?limit=1' | grep -oE '"id":"[a-f0-9-]{36}"' | head -1 | sed 's/.*:"//;s/"//')
check "SLS mgr CANNOT read an ENG task by id"    "404" "$(code "$TMP/mgr_sales" "/api/tasks/$ENG_TASK")"
check "ENG mgr CANNOT read a SLS task by id"     "404" "$(code "$TMP/mgr_eng"   "/api/tasks/$SLS_TASK")"
check "ENG mgr CAN read its own task"            "200" "$(code "$TMP/mgr_eng"   "/api/tasks/$ENG_TASK")"
check "GM CAN read an ENG task"                  "200" "$(code "$TMP/gm"        "/api/tasks/$ENG_TASK")"
check "GM CAN read a SLS task"                   "200" "$(code "$TMP/gm"        "/api/tasks/$SLS_TASK")"
check "SLS mgr CANNOT read an ENG project by id" "404" "$(code "$TMP/mgr_sales" "/api/projects/$ENG_PROJ")"
check "ENG mgr CAN read its own project"         "200" "$(code "$TMP/mgr_eng"   "/api/projects/$ENG_PROJ")"

echo
echo "=== 3. DEPARTMENT WALL — user detail read ==="
ENG_USER=$(get "$TMP/mgr_eng" '/api/users?limit=100' | grep -oE '"id":"[^"]+"' | head -1 | sed 's/.*:"//;s/"//')
SLS_USER=$(get "$TMP/mgr_sales" '/api/users?limit=100' | grep -oE '"id":"[^"]+"' | head -1 | sed 's/.*:"//;s/"//')
check "SLS mgr CANNOT read an ENG user by id" "404" "$(code "$TMP/mgr_sales" "/api/users/$ENG_USER")"
check "GM CAN read an ENG user by id"         "200" "$(code "$TMP/gm"        "/api/users/$ENG_USER")"

echo
echo "=== 3. DEPARTMENT WALL — search ==="
check "SLS mgr search finds 0 ENG tasks" "0" "$(get "$TMP/mgr_sales" '/api/search?q=auth' | grep -o 'Split the monolith' | wc -l | tr -d ' ')"
# >0 rather than ==1: the term matches both the title and the description,
# so the raw occurrence count is 2 for a single hit.
GM_HITS=$(get "$TMP/gm" '/api/search?q=auth' | grep -o 'Split the monolith' | wc -l | tr -d ' ')
check "GM search finds the ENG task" "yes" "$([ "$GM_HITS" -gt 0 ] && echo yes || echo no)"

echo
echo "=== 4. ASSIGNMENT — downward only, same department ==="
# ids for assignment probes
uid() { get "$TMP/admin" '/api/users?limit=100' | tr ',' '\n' | grep -B0 -A0 "$1" >/dev/null 2>&1; }
ALL_USERS=$(get "$TMP/admin" '/api/users?limit=100')
get_uid_by_email() {
  echo "$ALL_USERS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
us=d.get('users',d) if isinstance(d,dict) else d
print(next((u['id'] for u in us if u.get('email')=='$1'),''))"
}
GM_ID=$(get_uid_by_email 'gm@demo.local')
MGR_ENG_ID=$(get_uid_by_email 'mgr.eng@demo.local')
DEV1_ID=$(get_uid_by_email 'dev1@demo.local')
REP1_ID=$(get_uid_by_email 'rep1@demo.local')

patch_assign() { # patch_assign <jar> <taskid> <assigneeid>
  curl -s --max-time 20 -b "$1" -X PATCH "$BASE/api/tasks/$2" \
    -H "Content-Type: application/json" -H "Origin: $BASE" \
    -d "$(printf '{"assignedTo":"%s"}' "$3")" -o /dev/null -w "%{http_code}"
}
# team_lead(30) assigning UP to manager(40) must be rejected
check "team_lead CANNOT assign upward to a manager" "403" "$(patch_assign "$TMP/lead_eng" "$ENG_TASK" "$MGR_ENG_ID")"
# team_lead assigning UP to GM(50) must be rejected
check "team_lead CANNOT assign upward to the GM"    "403" "$(patch_assign "$TMP/lead_eng" "$ENG_TASK" "$GM_ID")"
# ENG manager assigning ACROSS to a sales exec must be rejected (not GM+)
check "ENG manager CANNOT assign across departments" "403" "$(patch_assign "$TMP/mgr_eng" "$ENG_TASK" "$REP1_ID")"
# manager assigning DOWN within dept is allowed
check "ENG manager CAN assign downward in-dept"      "200" "$(patch_assign "$TMP/mgr_eng" "$ENG_TASK" "$DEV1_ID")"

echo
echo "=== 4. MUTATION WALL — cross-dept writes rejected ==="
check "SLS mgr CANNOT patch an ENG task" "404" "$(patch_assign "$TMP/mgr_sales" "$ENG_TASK" "$REP1_ID")"

echo
echo "=== 1. RANK — self-escalation and upward grants ==="
patch_rank() { # patch_rank <jar> <userid> <rank>
  curl -s --max-time 20 -b "$1" -X PATCH "$BASE/api/users/$2" \
    -H "Content-Type: application/json" -H "Origin: $BASE" \
    -d "$(printf '{"rank":"%s"}' "$3")" -o /dev/null -w "%{http_code}"
}
MGR_SALES_ID=$(get_uid_by_email 'mgr.sales@demo.local')
check "manager CANNOT self-promote to super_admin" "403" "$(patch_rank "$TMP/mgr_eng" "$MGR_ENG_ID" 'super_admin')"
check "manager CANNOT promote anyone to owner"     "403" "$(patch_rank "$TMP/mgr_eng" "$DEV1_ID" 'owner')"
check "team_lead CANNOT promote a peer upward"     "403" "$(patch_rank "$TMP/lead_eng" "$DEV1_ID" 'manager')"

echo
echo "════════════════════════════════════"
printf 'PASSED: %d   FAILED: %d\n' "$PASSED" "$FAILED"
rm -rf "$TMP"
[ "$FAILED" -eq 0 ]
