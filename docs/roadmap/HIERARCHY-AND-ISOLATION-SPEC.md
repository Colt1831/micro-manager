# Hierarchy, Department Isolation, Downward Assignment & Shift-Based Time — Spec

> Status: DRAFT for sign-off. Author: Claude Code (agent) with Colt.
> Base: `main` @ `29c1792`. Delivery: phased PRs (branch → CI → squash-merge).
> Never push to `main` directly.

## 1. Locked decisions (from Colt)

1. **Single org.** Ranks live inside your one org:
   `Owner > General Manager > Manager > Team Lead > Senior Executive > Executive`.
   A **Super Admin** (you) sits above Owner and controls everyone / regulates all access.
2. **Department wall.** Owner + GM see ALL departments. Manager and everyone below
   see ONLY their own department. Super Admin sees everything.
3. **Assignment.** Downward only (assigner rank strictly above assignee), within the
   same department — EXCEPT Owner/GM (and Super Admin) may assign across departments.
4. **Time = clock-in/out shift.** A person clocks in (opens a shift), runs per-task
   timers inside that open shift (real server start/stop timestamps), clocks out.
   A day's worked time = accurate sum of that person's task-timer durations inside the shift.
5. **Fix ALL identified gaps**, spread across the phases below.

## 2. Rank model (the smallest correct shape)

Rank is intrinsically one-per-person, so it is a single field — NOT the M:N role bag.
Capabilities (what actions) stay in `roles`/`permissions`; rank (authority + scope)
is a separate dimension.

Ranks and numeric levels (higher = more authority):

| Rank             | level |
|------------------|-------|
| super_admin      | 100   |
| owner            | 60    |
| general_manager  | 50    |
| manager          | 40    |
| team_lead        | 30    |
| senior_executive | 20    |
| executive        | 10    |

- New shared enum + level map in `packages/shared` (single source of truth).
- Store rank on the user: `users.rank varchar` (+ derived level via the map).
  Reuse existing `roles.priority` for the *capability* roles; do NOT overload it for rank.
- Helpers (shared): `rankLevel(rank)`, `isSuperAdmin(user)`, `canSeeAllDepartments(user)`
  (level ≥ general_manager), `outranks(a, b)` (strictly greater level).
- `SEE_ALL_DEPTS_LEVEL = general_manager (50)`.

Super Admin provisioning: a bootstrap script (mirrors `scripts/create-admin.ts`)
promotes a named user to `super_admin`. Super Admin bypasses the department wall and
the downward-assignment constraint, and is the only rank that can grant `owner`.

## 3. Scope enforcement (the department wall)

Today `withAuth` yields `{ user, orgId }`. Extend the request context with a resolved
**scope** once per request:

```
scope = {
  rank, level,
  departmentId,                 // the actor's department (null for super_admin/owner/gm is fine)
  seeAllDepartments: level >= 50 || isSuperAdmin,
}
```

A shared `applyDeptScope(conditions, scope, deptColumn)` appends
`deptColumn = scope.departmentId` for Manager-and-below, and appends nothing for
GM+/Super Admin. Applied uniformly to **list, detail read, and mutation** paths —
not just list (closing the "known ID is readable" hole).

**Task → department attribution.** Tasks have no reliable department today (only
`teamId`, which can be null). For a security boundary we denormalize:
`tasks.departmentId` (indexed), set at create from the assignee's dept (fallback
team's dept, then creator's dept), and kept in sync on reassignment. Filtering a
denormalized column is correct and cheap; deriving through a nullable team join leaks
team-less tasks. Same wall applied to projects (has `departmentId`), teams, leave
(via requester's dept), time (via user's dept), and search.

## 4. Assignment rules

On task create / update(assignedTo) / batch-assign, enforce:
- `outranks(actor, assignee)` — strictly downward (Super Admin exempt).
- same department, UNLESS `canSeeAllDepartments(actor)` (GM/Owner/Super Admin).
- assignee must be active/unsuspended/same-org (already partly enforced; keep).
Single-assign and batch-assign share ONE helper so they can't diverge again.

## 5. Shift-based time tracking

New `shifts` table:
`id, userId, organizationId, clockIn (ts, notnull), clockOut (ts, null=open),
source, createdAt`. Partial unique index: **one open shift per user**
(`WHERE clock_out IS NULL`), mirroring the existing running-timer index.

Rules:
- **Clock in** opens a shift (409 if one already open).
- **Start task timer** requires an open shift → else 422 `NO_OPEN_SHIFT` ("clock in first").
- **Clock out** auto-stops any running task timer (so no timer bleeds past the shift),
  then closes the shift. All timestamps are server `now()`.
- **Day total** = sum of the user's task-timer `durationMinutes` whose run falls inside
  the shift window. Task timers remain the source of truth for worked time; the shift is
  the attendance envelope + guard.

Timer accuracy fixes rolled in here (see Phase 4 gaps).

## 6. Gap fixes — all of them, mapped to phases

### Phase 1 — Rank foundation + RBAC correctness
- Add rank model (§2): shared enum/levels, `users.rank`, helpers, seed 7 system roles,
  bootstrap super-admin script.
- Seed `task:view_all` and rank-appropriate permission bundles (GM+ get org-wide within
  the dept rules; today no one gets `task:view_all`).
- RBAC: **deny-override** — `rolePermissions.allow = false` overrides an allow.
- RBAC: ignore **deleted/disabled/expired** roles — join `roles.isActive`,
  `roles.deletedAt`, and `userRoles.expiresAt` in permission resolution.
- Role assignment gated by rank: you may only grant roles/ranks strictly below your own;
  only Super Admin grants `owner`; no self-escalation; validate target user's org/dept.

### Phase 2 — Department isolation
- `withAuth` scope resolution (§3) + `applyDeptScope` helper.
- `tasks.departmentId` denormalization + backfill migration.
- Apply wall to tasks/projects/teams/leave/time/search — list + detail + mutation.
- Leave reads scoped (self + dept managers + `time:manage`), not "any authenticated user".
- Search respects dept scope (and per-task visibility).
- CSRF: reject when Origin invalid and Referer absent (no silent pass).
- Redact / downgrade password-reset URL logging (currently info-level, unredacted).

### Phase 3 — Assignment rules + task lifecycle correctness
- Downward+dept assignment helper (§4) across create/update/batch.
- Batch ops routed through the SAME transition/permission/history/reindex path as single
  updates (no more state-machine bypass).
- Reorder readonly vs transition check so `closed → reopened` works.
- Fix updated-description mentions (currently assigned to `updateData` AFTER the update).
- Fix `restore`/`permanent` routes parsing the literal path segment as the task UUID.
- Guard checklist/comment mutations on closed/archived tasks.
- Cross-tenant reference validation: milestone↔project, team/dept on project & user,
  replacement owner/lead/head on updates.

### Phase 4 — Shift + time accuracy
- `shifts` table + clock-in/out endpoints + timer-requires-open-shift + auto-stop.
- Manual entry schema: accept explicit `startTime`/`endTime` (remove the `body.startTime`
  hack that bypasses the strict schema).
- Running-timer precheck filters `entryType = 'timer'` (not any null-end row).
- Timer-produced entries are not freely editable — changes go through the existing
  time-correction approval workflow (protects "exact and correct" timings).
- `recalcTaskHours` as a single atomic SQL sum (no read-modify-write lost updates).
- `time` reports require a `report:view`/appropriate permission + dept scope.

### Phase 5 — Leave correctness
- `daysCount` column → numeric (supports 0.5 half-days that the API already sends).
- Recompute `daysCount`/overlap/balance on edit; enforce `end ≥ start`; validate
  leave-type org + active.
- Approved-leave cancellation implemented (restores balance atomically).
- `leave-types` GET becomes read-only (no seed-on-read), filters active, uses the
  session user (drops `x-user-id` trust).

### Phase 6 — Remaining platform gaps
- EOD cron idempotency (unique per org per day); stop "immutable" snapshot AI-summary
  mutation (backfill once or store summary separately).
- AI: honor org-saved provider/model (not just the key); make the Settings "test"
  actually call the provider.
- Webhook/notification delivery retry: a cron sweep consumes `nextRetryAt` (columns
  exist, no consumer today) — or the columns are removed if we decide fire-and-forget
  is acceptable (decision at phase start).
- Encrypt stored Slack webhook URL (encryption infra already exists).
- Search reindex purges stale/deleted docs.
- Automation actions routed through the shared task-mutation service (so they emit
  history/search/webhook side effects); recipient lookups org-scoped.
- Attachments: enforce MIME (not warn-only), clean up orphaned objects on failed
  metadata insert.
- Prod compose/infra: wire `ENCRYPTION_KEY`/`CRON_SECRET`/build arg; bump migrate
  container off Node 20.

## 7. Test + verification per phase
- Every phase lands with unit/integration tests green, typecheck clean, lint clean,
  E2E green in CI — the repo's existing bar (1618 web + 273 shared unit today).
- Security-boundary phases (1–4) add integration tests proving cross-department reads
  are denied and downward-only assignment holds under the wall.
- No claim of "done" without a fresh test run + CI check.

## 8. Open confirmations before Phase 1
1. Multiple Owners/GMs allowed (no cap)? Assumed **yes**.
2. Super Admin provisioned via bootstrap script (like `create-admin`)? Assumed **yes**.
3. Webhook retry: build the retry sweep, or drop the unused columns? Decide at Phase 6.
