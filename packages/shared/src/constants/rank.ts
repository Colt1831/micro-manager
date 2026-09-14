// ─── Organizational Rank Hierarchy ───────────────────────────
//
// Rank is the authority + scope dimension of a person, distinct from
// capability roles (roles/permissions tables). Every user has exactly ONE
// rank, so it lives as a single column on the user — not the M:N role bag.
//
// Higher level = more authority. Assignment is downward only (a strictly
// higher level may act on a strictly lower one). Level >= SEE_ALL_DEPTS_LEVEL
// sees every department; below that, a person is walled to their own.

export const RANKS = [
  'super_admin',
  'owner',
  'general_manager',
  'manager',
  'team_lead',
  'senior_executive',
  'executive',
] as const;

export type Rank = (typeof RANKS)[number];

/** Numeric authority level per rank. Higher = more authority. */
export const RANK_LEVELS: Record<Rank, number> = {
  super_admin: 100,
  owner: 60,
  general_manager: 50,
  manager: 40,
  team_lead: 30,
  senior_executive: 20,
  executive: 10,
};

export const RANK_LABELS: Record<Rank, string> = {
  super_admin: 'Super Admin',
  owner: 'Owner',
  general_manager: 'General Manager',
  manager: 'Manager',
  team_lead: 'Team Lead',
  senior_executive: 'Senior Executive',
  executive: 'Executive',
};

/** The lowest level that is exempt from the department wall (GM and up). */
export const SEE_ALL_DEPTS_LEVEL = RANK_LEVELS.general_manager;

/** The default rank a brand-new (non-bootstrap) user receives. */
export const DEFAULT_RANK: Rank = 'executive';

export function isRank(value: unknown): value is Rank {
  return typeof value === 'string' && (RANKS as readonly string[]).includes(value);
}

/** Level for a rank; unknown/absent ranks fall to 0 (below everyone). */
export function rankLevel(rank: string | null | undefined): number {
  return isRank(rank) ? RANK_LEVELS[rank] : 0;
}

export function isSuperAdmin(rank: string | null | undefined): boolean {
  return rank === 'super_admin';
}

/** GM+ (or super_admin) — sees across all departments. */
export function canSeeAllDepartments(rank: string | null | undefined): boolean {
  return rankLevel(rank) >= SEE_ALL_DEPTS_LEVEL;
}

/**
 * True when `actor` outranks `target` — strictly higher authority level.
 * super_admin outranks everyone (including another super_admin is false:
 * strictly-greater, so peers cannot act on peers).
 */
export function outranks(
  actorRank: string | null | undefined,
  targetRank: string | null | undefined,
): boolean {
  return rankLevel(actorRank) > rankLevel(targetRank);
}

/**
 * Whether `actor` may grant `grantedRank` to someone.
 * Rule: you can only grant ranks strictly below your own. `owner` may only be
 * granted by a super_admin (owner cannot mint peers). No self-level grants.
 */
export function canGrantRank(
  actorRank: string | null | undefined,
  grantedRank: string | null | undefined,
): boolean {
  if (!isRank(grantedRank)) return false;
  if (grantedRank === 'owner') return isSuperAdmin(actorRank);
  return outranks(actorRank, grantedRank);
}
