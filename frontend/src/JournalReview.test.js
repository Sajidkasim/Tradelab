import { describe, expect, it } from 'vitest';
import {
  computeDisciplineInsights,
  filterAccountsByScope,
  recordedTotal,
  scopedAccountResults,
  tradeMatchesFilter,
} from './JournalReview';

const accounts = [
  { id: 1, name: 'Funded A', account_type: 'Funded', status: 'active', starting_balance: 50000 },
  { id: 2, name: 'Eval B', account_type: 'Eval', status: 'active', starting_balance: 25000 },
  { id: 3, name: 'Old Blown 1', account_type: 'Eval', status: 'blown', starting_balance: 50000 },
  { id: 4, name: 'Passed Eval', account_type: 'Eval', status: 'passed', starting_balance: 50000 },
];

describe('JournalReview active-first filtering', () => {
  it('filters active, funded, eval, passed, blown, and all scopes accurately', () => {
    expect(filterAccountsByScope(accounts, 'active').map(a => a.id)).toEqual([1, 2]);
    expect(filterAccountsByScope(accounts, 'funded').map(a => a.id)).toEqual([1]);
    expect(filterAccountsByScope(accounts, 'eval').map(a => a.id)).toEqual([2]);
    expect(filterAccountsByScope(accounts, 'passed').map(a => a.id)).toEqual([4]);
    expect(filterAccountsByScope(accounts, 'blown').map(a => a.id)).toEqual([3]);
    expect(filterAccountsByScope(accounts, 'all').map(a => a.id)).toEqual([1, 2, 3, 4]);
  });

  it('excludes blown accounts under default active scope while preserving unassigned trades and splitting partial copy trades', () => {
    const row = {
      day: '2026-09-10',
      trade_results: [
        { account_id: 1, net_pnl: 400 },
        { account_id: 3, net_pnl: -2500 },
        { account_id: null, net_pnl: 100 },
        { account_id: null, account_ids: [1, 3], net_pnl: 200 },
      ],
    };
    const activeRes = scopedAccountResults(row, null, accounts);
    expect(recordedTotal(activeRes)).toBe(600); // 400 (active) + 100 (unassigned) + 100 (half of [1,3] copy trade)
    expect(activeRes.some(r => r.split)).toBe(true);

    const blownRes = scopedAccountResults(row, 'scope:blown', accounts);
    expect(recordedTotal(blownRes)).toBe(-2400); // -2500 (blown) + 100 (half of [1,3])

    const singleRes = scopedAccountResults(row, 1, accounts);
    expect(recordedTotal(singleRes)).toBe(500); // 400 + 100 (half of [1,3])

    const allRes = scopedAccountResults(row, 'scope:all', accounts);
    expect(recordedTotal(allRes)).toBe(-1800); // 400 - 2500 + 100 + 200
  });

  it('matches trades cleanly against active and specific filters', () => {
    expect(tradeMatchesFilter({ account_id: 1 }, null, accounts)).toBe(true);
    expect(tradeMatchesFilter({ account_id: 3 }, null, accounts)).toBe(false);
    expect(tradeMatchesFilter({ account_id: null }, null, accounts)).toBe(true);
    expect(tradeMatchesFilter({ account_id: 3 }, 'scope:blown', accounts)).toBe(true);
    expect(tradeMatchesFilter({ account_ids: [1, 3] }, 3, accounts)).toBe(true);
  });

  it('computes discipline & mindset insights scoped to active accounts only', () => {
    const rows = [
      {
        day: '2026-09-07', // Monday
        plan_followed: 'Yes',
        mindset: 'Focused',
        trade_results: [{ account_id: 1, net_pnl: 300 }, { account_id: 3, net_pnl: -1000 }],
      },
      {
        day: '2026-09-08', // Tuesday
        plan_followed: 'No',
        mindset: 'Frustrated',
        trade_results: [{ account_id: 2, net_pnl: -150 }],
      },
    ];
    const insights = computeDisciplineInsights(rows, 'scope:active', accounts);
    expect(insights.plan.Yes).toEqual({ days: 1, pnlDays: 1, wins: 1, net: 300 });
    expect(insights.plan.No).toEqual({ days: 1, pnlDays: 1, wins: 0, net: -150 });
    expect(insights.mindset.Focused.net).toBe(300);
    expect(insights.mindset.Frustrated.net).toBe(-150);
    expect(insights.weekdays.Mon).toBe(300);
    expect(insights.weekdays.Tue).toBe(-150);
  });
});
