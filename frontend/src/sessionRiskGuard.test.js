import { describe, expect, it } from 'vitest';
import { evaluateRiskGuard } from './components/SessionRiskGuard';

describe('evaluateRiskGuard', () => {
  it('returns unset when neither limit is configured', () => {
    const res = evaluateRiskGuard({ dailyLossLimit: null, maxDailyTrades: null, dayPnl: -250, tradeCount: 2 });
    expect(res.configured).toBe(false);
    expect(res.tone).toBe('unset');
  });

  it('stays safe while green or below 75% of daily loss limit', () => {
    const green = evaluateRiskGuard({ dailyLossLimit: 500, maxDailyTrades: 3, dayPnl: 320, tradeCount: 1 });
    expect(green.tone).toBe('safe');
    expect(green.lossPct).toBe(0);
    expect(green.headline).toContain('In profit');

    const smallLoss = evaluateRiskGuard({ dailyLossLimit: 500, maxDailyTrades: 4, dayPnl: -200, tradeCount: 1 });
    expect(smallLoss.tone).toBe('safe');
    expect(smallLoss.lossPct).toBe(40);
    expect(smallLoss.lossRemaining).toBe(300);
  });

  it('switches to warning at 75% loss or when trade cap is reached', () => {
    const nearLoss = evaluateRiskGuard({ dailyLossLimit: 500, maxDailyTrades: 4, dayPnl: -380, tradeCount: 2 });
    expect(nearLoss.tone).toBe('warning');
    expect(nearLoss.lossWarning).toBe(true);
    expect(nearLoss.lossPct).toBe(76);

    const atCap = evaluateRiskGuard({ dailyLossLimit: 500, maxDailyTrades: 3, dayPnl: 120, tradeCount: 3 });
    expect(atCap.tone).toBe('warning');
    expect(atCap.tradesAtCap).toBe(true);
    expect(atCap.headline).toContain('Trade cap reached');
  });

  it('triggers lockout when daily loss hits 100% or trade cap is exceeded', () => {
    const lossHit = evaluateRiskGuard({ dailyLossLimit: 500, maxDailyTrades: 3, dayPnl: -525, tradeCount: 2 });
    expect(lossHit.tone).toBe('lockout');
    expect(lossHit.lossBreached).toBe(true);
    expect(lossHit.lossPct).toBe(100);

    const overTraded = evaluateRiskGuard({ dailyLossLimit: 500, maxDailyTrades: 3, dayPnl: -100, tradeCount: 4 });
    expect(overTraded.tone).toBe('lockout');
    expect(overTraded.tradesBreached).toBe(true);
  });
});
