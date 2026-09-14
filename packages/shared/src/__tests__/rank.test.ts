import { describe, it, expect } from 'vitest';
import {
  rankLevel,
  isSuperAdmin,
  canSeeAllDepartments,
  outranks,
  canGrantRank,
  RANK_LEVELS,
} from '../constants/rank';

describe('rank hierarchy', () => {
  it('orders levels owner > gm > manager > team_lead > senior_exec > executive', () => {
    expect(RANK_LEVELS.owner).toBeGreaterThan(RANK_LEVELS.general_manager);
    expect(RANK_LEVELS.general_manager).toBeGreaterThan(RANK_LEVELS.manager);
    expect(RANK_LEVELS.manager).toBeGreaterThan(RANK_LEVELS.team_lead);
    expect(RANK_LEVELS.team_lead).toBeGreaterThan(RANK_LEVELS.senior_executive);
    expect(RANK_LEVELS.senior_executive).toBeGreaterThan(RANK_LEVELS.executive);
    expect(RANK_LEVELS.super_admin).toBeGreaterThan(RANK_LEVELS.owner);
  });

  it('unknown/null ranks fall to level 0', () => {
    expect(rankLevel(null)).toBe(0);
    expect(rankLevel('nonsense')).toBe(0);
  });

  it('department visibility: GM and up see all, manager and below do not', () => {
    expect(canSeeAllDepartments('super_admin')).toBe(true);
    expect(canSeeAllDepartments('owner')).toBe(true);
    expect(canSeeAllDepartments('general_manager')).toBe(true);
    expect(canSeeAllDepartments('manager')).toBe(false);
    expect(canSeeAllDepartments('team_lead')).toBe(false);
    expect(canSeeAllDepartments('executive')).toBe(false);
  });

  it('outranks is strictly-greater (peers cannot act on peers)', () => {
    expect(outranks('manager', 'executive')).toBe(true);
    expect(outranks('manager', 'manager')).toBe(false);
    expect(outranks('executive', 'manager')).toBe(false);
    expect(outranks('super_admin', 'owner')).toBe(true);
  });

  it('isSuperAdmin only for super_admin', () => {
    expect(isSuperAdmin('super_admin')).toBe(true);
    expect(isSuperAdmin('owner')).toBe(false);
  });

  it('rank granting: only strictly below own, owner only by super_admin', () => {
    // super_admin can grant owner and everything below
    expect(canGrantRank('super_admin', 'owner')).toBe(true);
    expect(canGrantRank('super_admin', 'executive')).toBe(true);
    // owner CANNOT grant owner (no minting peers), but can grant GM and below
    expect(canGrantRank('owner', 'owner')).toBe(false);
    expect(canGrantRank('owner', 'general_manager')).toBe(true);
    // manager cannot grant manager (same level) or above
    expect(canGrantRank('manager', 'manager')).toBe(false);
    expect(canGrantRank('manager', 'general_manager')).toBe(false);
    expect(canGrantRank('manager', 'team_lead')).toBe(true);
    // invalid granted rank rejected
    expect(canGrantRank('super_admin', 'nonsense')).toBe(false);
  });
});
