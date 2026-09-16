# WorkManager: Demo Data, Full Functional Cross-Check & Frontend Uplift

## Goal

Make the local preview actually demonstrate the product — seed a realistic multi-rank org so every page has content, then loop (audit → fix → verify) until no page is broken, no control is a no-op, and the UI no longer looks cheap.

---

## Current context / assumptions

**Verified facts (read-only checks run 2026-09-17):**

- Preview runs at `http://localhost:3000` (prod build, `next start`), Postgres in Docker (`wm-postgres`), creds `admin@workmanager.local` / `PreviewEDYR9KtIIhBL1!`.
- **The preview DB is nearly empty — this is the #1 reason "I cannot see anything":**
  ```
  users=1  depts=1  teams=1  projects=0  tasks=0  roles=10  leave=0
  ```
- `packages/database/src/seed.ts` inserts **zero** tasks and **zero** projects (`grep -cE "insert\(.*(tasks|projects)" → 0`). It seeds only org, roles, permissions, one department, one team.
- No demo-seed script exists anywhere in `packages/database/scripts/` or `scripts/`.
- Rank ladder is real and implemented in `packages/shared/src/constants/rank.ts`:
  `super_admin:100, admin:?, general_manager:50, manager:40, team_lead:30, senior_executive:20, executive:10`.
- 29 dashboard routes exist under `apps/web/src/app/(dashboard)/`.
- 30 UI primitives exist in `apps/web/src/components/ui/` (button, card, badge, table, dialog, tabs, stat-card, page-header, toast, …). **Design system already exists — do not build a new one.**
- Design tokens already exist in `apps/web/src/app/globals.css` (606 lines): `--color-surface-*`, `--color-brand-*`, `--color-accent-*`, `--color-status-*`. Tailwind v4 (`^4.3.3`), no `tailwind.config.js` — tokens live in CSS.
- Stack: Next.js 16.3.5, React 19.2.8, framer-motion ^13, pnpm+Turbo monorepo.
- 22 Playwright E2E specs already exist.

**Assumptions:**

- "Looks cheap" = empty states everywhere + inconsistent spacing/typography, **not** a demand to rebrand. Tokens and primitives stay; we make usage consistent and fill pages with real data.
- Local preview only. No Render/DNS work in this plan.
- Postgres stays the Docker container already running.

**Non-goals (explicit YAGNI):**

- No new design system, no component library swap, no CSS framework change.
- No Report Builder PDF/Excel export (separate large slice).
- No social login (hard-blocked on OAuth credentials).
- No Render deploy / DNS.

---

## Architecture / proposed approach

Three phases, strictly ordered. **Phase A** writes one idempotent demo-seed script that populates a believable org across every rank and fills all 29 routes with data — this alone fixes most of "cannot see anything". **Phase B** is a scripted audit loop: with data present, walk every route in a real browser, capture console errors + screenshots, and record findings in a single tracked file. **Phase C** fixes findings in priority order (broken > no-op control > visual inconsistency), each as its own TDD commit, looping back to Phase B until the audit is clean.

The loop terminates when a full Phase B pass yields zero Critical/High findings.

---

## Conventions for every task below

- **Repo root:** `/home/Colt_45/workmanager` — all commands run from there unless stated.
- **Branch per phase.** Never push to `main`.
- **Git identity (required — GH007 blocks otherwise):**
  ```bash
  git config user.name colt453118-a11y
  git config user.email 281028526+colt453118-a11y@users.noreply.github.com
  ```
- **The verification bar** (all must exit 0 before any commit is considered done):
  ```bash
  pnpm --filter @workmanagement/shared test
  pnpm --filter @workmanagement/web test
  pnpm --filter @workmanagement/web typecheck
  pnpm --filter @workmanagement/web lint
  pnpm --filter @workmanagement/shared typecheck
  pnpm --filter @workmanagement/database exec drizzle-kit check
  ```
- **DB URL for every script/command:**
  `DATABASE_URL="postgres://dev:devpassword@localhost:5432/workmanagement"`
- **Rebuild + restart the preview after any `apps/web` change** (prod build; `next dev` will NOT hydrate correctly — see Risks):
  ```bash
  cd /home/Colt_45/workmanager
  set -a; . ./.env; set +a
  export DATABASE_URL="postgres://dev:devpassword@localhost:5432/workmanagement"
  export NEXT_PUBLIC_APP_URL="http://localhost:3000"
  export AUTH_URL="http://localhost:3000"
  export BETTER_AUTH_URL="http://localhost:3000"
  export CSRF_TRUSTED_ORIGINS="http://localhost:3000"
  export NODE_ENV=production
  pnpm --filter @workmanagement/web build
  pkill -f "next start"; sleep 2
  cd apps/web && pnpm next start -p 3000 -H 0.0.0.0 > /tmp/wm-local.log 2>&1 &
  ```

---

## PHASE A — Demo data (fixes "cannot see anything")

### Task A1 — Branch

```bash
cd /home/Colt_45/workmanager
git checkout main && git pull origin main
git checkout -b feat/demo-seed
git config user.name colt453118-a11y
git config user.email 281028526+colt453118-a11y@users.noreply.github.com
```
**Verify:** `git branch --show-current` → `feat/demo-seed`

---

### Task A2 — Read the existing seed before writing anything

```bash
cd /home/Colt_45/workmanager
sed -n '1,80p' packages/database/src/seed.ts
grep -n "export" packages/database/src/seed.ts
sed -n '1,60p' scripts/create-admin.ts
```

**Why:** the demo seed must reuse the org/roles/permissions the real seed creates, and reuse `create-admin.ts`'s password-hashing approach. Do not duplicate hashing logic.

**Record before continuing:**
- Exact org row shape + the org id/slug the seed creates.
- The exact scrypt hashing call used in `create-admin.ts`.
- Whether `users.rank` is a plain text column or a pg enum.

---

### Task A3 — Confirm required column shapes

```bash
cd /home/Colt_45/workmanager
docker exec wm-postgres psql -U dev -d workmanagement -c "\d users"  | head -40
docker exec wm-postgres psql -U dev -d workmanagement -c "\d tasks"  | head -40
docker exec wm-postgres psql -U dev -d workmanagement -c "\d projects" | head -30
docker exec wm-postgres psql -U dev -d workmanagement -c "\d departments" | head -20
```

**Expected:** column lists including `users.rank`, `users.department_id`, `users.reporting_manager_id`, `tasks.status`, `tasks.assignee_id`, `tasks.project_id`, `tasks.department_id`.

**Note every NOT NULL column without a default** — the seed must supply all of them. Write them down; the code in A4 must be adjusted to match reality rather than assumed names.

---

### Task A4 — Write `packages/database/scripts/seed-demo.ts`

Create the file. **This is a skeleton with correct structure and intent — adjust column names to whatever A2/A3 actually reported. Do not invent columns.**

```ts
/**
 * Demo seed: a believable org so every dashboard page has content.
 *
 * Idempotent: keyed on stable demo emails / slugs. Safe to re-run.
 * Dev/preview only — never run against production data.
 *
 * Usage:
 *   DATABASE_URL="postgres://dev:devpassword@localhost:5432/workmanagement" \
 *     pnpm --filter @workmanagement/database exec tsx scripts/seed-demo.ts
 */
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../src';

// One knob, deliberately small: enough rows to fill every page, few enough to eyeball.
const DEMO = {
  departments: ['Engineering', 'Sales', 'Operations'],
  // rank ladder mirrored from packages/shared/src/constants/rank.ts
  people: [
    { email: 'gm@demo.local',     name: 'Grace Moore',   rank: 'general_manager',   dept: 'Engineering' },
    { email: 'mgr.eng@demo.local',name: 'Marcus Ellis',  rank: 'manager',           dept: 'Engineering' },
    { email: 'lead.eng@demo.local',name:'Lena Diaz',     rank: 'team_lead',         dept: 'Engineering' },
    { email: 'dev1@demo.local',   name: 'Dan Ito',       rank: 'executive',         dept: 'Engineering' },
    { email: 'dev2@demo.local',   name: 'Dana Roy',      rank: 'senior_executive',  dept: 'Engineering' },
    { email: 'mgr.sales@demo.local',name:'Sam Patel',    rank: 'manager',           dept: 'Sales' },
    { email: 'rep1@demo.local',   name: 'Rita Chen',     rank: 'executive',         dept: 'Sales' },
    { email: 'ops1@demo.local',   name: 'Omar Naz',      rank: 'executive',         dept: 'Operations' },
  ],
  projects: [
    { name: 'Platform Rebuild', dept: 'Engineering' },
    { name: 'Q4 Pipeline',      dept: 'Sales' },
    { name: 'Vendor Migration', dept: 'Operations' },
  ],
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const db = getDb();

  // 1. Reuse the org the base seed created — never create a second org.
  const [org] = await db.select().from(schema.organizations).limit(1);
  if (!org) throw new Error('Run the base seed first: pnpm --filter @workmanagement/database db:seed');

  // 2. Departments (idempotent by name within org)
  // 3. Users — one per rank, each in a department, with reporting_manager_id
  //    wired UP the ladder (executive -> team_lead -> manager -> general_manager).
  //    Reuse the scrypt hashing helper exactly as scripts/create-admin.ts does.
  // 4. Projects — one per department.
  // 5. Tasks — ~8 per project spread across every status value the schema allows
  //    (draft/open/in_progress/blocked/on_hold/done per --color-status-* tokens),
  //    with assignees inside the owning department (respects the department wall),
  //    and due dates spread -7..+21 days so Calendar / Gantt / Overdue all populate.
  // 6. A few approved + pending leave_requests so Calendar overlay and Leave pages fill.
  // 7. A few comments on tasks so global comment search returns hits.

  console.log('✓ demo seed complete');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

**Implementation rules for whoever writes the body:**
- Idempotent: `select` by email/slug first; skip if present. Re-running must not duplicate.
- Every task's `assignee_id` MUST be a user in the same `department_id` as the task — otherwise the department-isolation wall hides it and pages look empty again.
- Spread `status` across **all** allowed values; spread `due_date` across past/today/future.
- Do NOT touch the existing `admin@workmanager.local` user.

---

### Task A5 — Run the demo seed

```bash
cd /home/Colt_45/workmanager
DATABASE_URL="postgres://dev:devpassword@localhost:5432/workmanagement" \
  pnpm --filter @workmanagement/database exec tsx scripts/seed-demo.ts
```
**Expected output:** `✓ demo seed complete`

**Verify row counts are non-zero:**
```bash
docker exec wm-postgres psql -U dev -d workmanagement -tAc "
select 'users='||(select count(*) from users)
||' depts='||(select count(*) from departments)
||' projects='||(select count(*) from projects)
||' tasks='||(select count(*) from tasks)
||' leave='||(select count(*) from leave_requests);"
```
**Expected:** `users=9 depts=3 projects=3 tasks=24 leave>=3` (exact numbers may differ; **every count must be > 0**).

**Re-run the seed once more** and confirm counts are **identical** (idempotency proof).

---

### Task A6 — Confirm the preview is no longer empty

Restart the preview (see "Conventions"), log in, and check the dashboard shows non-zero KPIs.

```bash
curl -s -c /tmp/c.txt -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" -H "Origin: http://localhost:3000" \
  -d '{"email":"admin@workmanager.local","password":"PreviewEDYR9KtIIhBL1!"}' -o /dev/null -w "login %{http_code}\n"
curl -s -b /tmp/c.txt "http://localhost:3000/api/tasks" | head -c 300
```
**Expected:** `login 200`, and the tasks response contains task objects (not `[]`).

**Commit:**
```bash
git add packages/database/scripts/seed-demo.ts
git commit -m "feat(seed): add idempotent demo seed for preview data"
```

---

## PHASE B — The audit loop

### Task B1 — Create the findings file

Create `.hermes/plans/audit-findings.md`:

```markdown
# WorkManager audit findings

Loop iteration: 1
Legend: severity = Critical | High | Medium | Low
        category = Functional | Visual | Console | UX | Accessibility

| # | Route | Severity | Category | Finding | Evidence | Status |
|---|-------|----------|----------|---------|----------|--------|
```

---

### Task B2 — Enumerate every route to test

```bash
cd /home/Colt_45/workmanager
find "apps/web/src/app/(dashboard)" -name "page.tsx" | sed 's|.*/(dashboard)||; s|/page.tsx||' | sed 's|^$|/|' | sort
```
**Expected:** ~29 routes including `/`, `/tasks`, `/projects`, `/calendar`, `/gantt`, `/reports`, `/settings`, `/users`, `/teams`, `/leave`, `/timer`, `/analytics`, `/automation`, `/milestones`, `/notifications`, `/search`, `/corrections`, `/task-templates`.

Paste this list into the findings file as the checklist for this iteration. Dynamic routes (`[id]`) must be visited with a **real id taken from the demo data**, not a placeholder.

---

### Task B3 — Walk each route in the browser (repeat per route)

For **every** route from B2, in one browser session logged in as admin:

1. Navigate to `http://localhost:3000<route>`.
2. Capture a screenshot.
3. Capture console errors.
4. Record in the findings table: route, whether content rendered (not a blank/zero state now that data exists), any console error, any visibly broken layout.

**Hydration sanity check** (do this once per session — catches the class of bug that made login fail before):
- Click the password eye toggle on `/auth/login`; the input `type` must flip `password` → `text`.
- If it does not flip, **stop** — the server is serving an unhydrated build; fix that before auditing anything else.

**Severity rules:**
- **Critical** — page 500s, blank page, login/auth broken, data loss.
- **High** — control does nothing (no-op button), form cannot submit, console error thrown on load.
- **Medium** — visual inconsistency, misaligned layout, wrong empty-state copy.
- **Low** — polish, spacing, copy nits.

---

### Task B4 — Hunt no-op controls specifically

Known suspects already identified (verify each in the browser before filing):

```bash
cd /home/Colt_45/workmanager
grep -n "onClick\|disabled" "apps/web/src/app/(dashboard)/reports/reports-client.tsx" | head -20
grep -rn "Button" "apps/web/src/app/(dashboard)/leave/leave-client.tsx" | head
```

Files flagged by the button-vs-onClick heuristic (more `<Button>` than `onClick` — may be legitimate `href`/`type="submit"`, so **confirm in the browser**):
- `(dashboard)/leave/leave-client.tsx` (buttons=3, onClick=1)
- `(dashboard)/leave/new/new-leave-client.tsx` (buttons=2, onClick=1)
- `(dashboard)/leave/[id]/leave-detail-client.tsx` (buttons=5, onClick=3)
- `(dashboard)/dependencies/[id]/dependency-graph-client.tsx` (buttons=2, onClick=1)

Known product gap (**do not file as a bug — out of scope**): Report Builder template buttons and PDF/Excel export.

---

### Task B5 — Cross-check against the hierarchy spec

```bash
cd /home/Colt_45/workmanager
sed -n '1,120p' docs/roadmap/HIERARCHY-AND-ISOLATION-SPEC.md
```

With demo users at different ranks, verify the two rules the spec locks down:

1. **Department wall** — a `manager` in Sales must NOT see Engineering tasks/users.
2. **Downward-only assignment** — a `team_lead` must not be able to assign to a `manager`.

Test by logging in as `mgr.sales@demo.local` and confirming Engineering data is absent from `/tasks` and `/users`.

**File any violation as Critical** — this is the core product invariant.

---

## PHASE C — Fix loop

### Task C1 — Order the work

Sort findings: Critical → High → Medium → Low. Fix in that order. **One finding = one commit.**

### Task C2 — Per-finding TDD cycle

For each finding:

1. **Write the failing test first.**
   - API/logic → unit test beside the route, e.g. `apps/web/src/app/api/<area>/__tests__/<name>.test.ts`
   - User-visible behavior → Playwright spec in `apps/web/__tests__/e2e/`
2. **Run it; confirm it FAILS** (proves the test tests the bug):
   ```bash
   pnpm --filter @workmanagement/web exec vitest run <path-to-test>
   ```
3. **Implement the minimal fix.** Root cause, not symptom — grep callers of any shared function before editing it.
4. **Run the test; confirm it PASSES.**
5. **Run the full bar** (all six commands from Conventions) — all exit 0.
6. **Commit:**
   ```bash
   git add <only the files for this fix>
   git commit -m "fix(<area>): <what was broken>"
   ```

**E2E mock gotcha (has broken CI twice):** if a fix adds a field/group to any API response, update **every** Playwright route mock under `apps/web/__tests__/e2e/helpers/*.ts`. A mock missing a new key throws at runtime and renders nothing — unit tests and typecheck still pass while E2E fails.

---

### Task C3 — Frontend consistency pass (only after Critical + High are zero)

**Reuse the existing system. Do not create new primitives or new tokens.**

Audit for consistency against what already exists:

```bash
cd /home/Colt_45/workmanager
ls apps/web/src/components/ui/
grep -n "color-surface\|color-brand\|color-accent\|color-status" apps/web/src/app/globals.css | head -40
```

Rules:
1. **Every page uses `PageHeader`** (`components/ui/page-header.tsx`) — same title/subtitle/action placement.
2. **Raw hex colors in components are replaced with tokens.** Find offenders:
   ```bash
   grep -rnE "#[0-9a-fA-F]{6}" apps/web/src/app/\(dashboard\) --include=*.tsx | grep -v __tests__ | head -30
   ```
   Each hit becomes a `--color-*` token already defined in `globals.css`.
3. **Every list/table page has a real empty state** via `components/ui/state-display.tsx` — icon + explanation + primary action, never a bare "No data".
4. **Card/stat usage is consistent** — `StatCard` for KPIs, `Card` for content. No hand-rolled divs imitating either.

One commit per rule, each behind the full verification bar.

---

### Task C4 — Loop

Re-run **Phase B** end to end. Increment `Loop iteration` in the findings file.

**Termination condition:** a full Phase B pass produces **zero Critical and zero High** findings. Medium/Low may remain — list them as follow-ups rather than blocking.

If new findings appear, return to C2.

---

### Task C5 — Ship

```bash
cd /home/Colt_45/workmanager
# full bar one last time (all six commands)
git push -u origin feat/demo-seed
gh pr create --repo Colt1831/micro-manager --base main --head feat/demo-seed \
  --title "feat: demo seed + audit fixes + UI consistency pass" \
  --body "See .hermes/plans/audit-findings.md for the audit trail."
gh pr checks <n> --repo Colt1831/micro-manager --watch
```
**Expected:** 8/8 CI checks green before merge.

---

## Tests / validation summary

| Layer | Command | Expected |
|---|---|---|
| Demo data | `psql -tAc "select count(*) from tasks"` | `> 0`, identical after re-running seed |
| Unit | `pnpm --filter @workmanagement/web test` | all pass (~1680+) |
| Shared | `pnpm --filter @workmanagement/shared test` | all pass |
| Types | `pnpm --filter @workmanagement/web typecheck` | exit 0 |
| Lint | `pnpm --filter @workmanagement/web lint` | exit 0 |
| Schema | `pnpm --filter @workmanagement/database exec drizzle-kit check` | `Everything's fine` |
| E2E | `pnpm --filter @workmanagement/web exec playwright test --project=chromium` | 0 failures |
| Hydration | eye toggle flips `password`→`text` | flips |
| CI | `gh pr checks <n> --watch` | 8/8 green |

---

## Risks, tradeoffs, open questions

**Risks**

1. **`next dev` will waste hours.** Next blocks its own dev/HMR resources from non-localhost origins; React never hydrates and forms silently fall back to native GET (this previously dumped credentials into the URL bar). Backend curl checks still return 200, so it looks fine server-side. **Always audit against a production build.**
2. **Demo seed must respect the department wall.** A task assigned to someone outside its department is invisible to everyone — pages will look empty and the audit will chase phantom bugs.
3. **Parallel agents share one working tree.** If this is delegated, every agent needs its own `git worktree`; concurrent `git checkout` wipes uncommitted work (already happened once this project).
4. **Scope creep in C3.** "Looks cheap" invites a redesign. The plan deliberately limits it to consistency using existing tokens/primitives. A redesign is a separate decision.
5. **Seed drift.** If `seed.ts` changes org/role shape, `seed-demo.ts` breaks. Mitigated by reading the org from the DB rather than hardcoding it.

**Tradeoffs**

- Demo seed is a **script, not a migration** — it never runs in production, and there's no rollback story. Correct for preview data.
- Fixed roster instead of a faker dependency: no new dep, deterministic, screenshot-stable.
- Audit is manual/browser-driven rather than automated — slower, but it catches visual and UX issues an assertion suite cannot.

**Open questions**

1. **Is "looks cheap" about consistency, or do you want a visual redesign?** Plan assumes consistency. A redesign changes C3 substantially.
2. **Should demo data ship in the repo** (useful for every future preview) **or stay local-only?** Plan commits the script — it's inert unless explicitly run.
3. **How many demo users?** Plan uses 8 + admin, one per rank. Say the word if you want a bigger org for load-realistic tables.
4. **Are Medium/Low findings blocking?** Plan says no — they become follow-ups so the loop terminates.
