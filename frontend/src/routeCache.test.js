import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllCache,
  getCached,
  getCachedSession,
  invalidateCache,
  setCached,
  setCachedSession,
  warmApi,
} from './routeCache';

describe('routeCache', () => {
  beforeEach(() => {
    clearAllCache();
  });

  it('stores, retrieves, and invalidates cached API entries by prefix', () => {
    setCached('/metadata', { trade_count: 12 });
    setCached('/results:All', [{ sample: 'Backtesting' }]);
    setCached('/journal', [{ day: '2026-11-26' }]);

    expect(getCached('/metadata')).toEqual({ trade_count: 12 });
    invalidateCache('/results:');
    expect(getCached('/results:All')).toBeNull();
    expect(getCached('/metadata')).toEqual({ trade_count: 12 });
  });

  it('only caches authenticated sessions and clears everything on logout', () => {
    setCachedSession({ authenticated: false, csrf: 'abc' });
    expect(getCachedSession()).toBeNull();

    setCachedSession({ authenticated: true, csrf: 'tok-1', owner: true });
    setCached('/metadata', { ok: true });
    expect(getCachedSession()?.csrf).toBe('tok-1');

    clearAllCache();
    expect(getCachedSession()).toBeNull();
    expect(getCached('/metadata')).toBeNull();
  });

  it('deduplicates concurrent warmApi requests and passes silent401', async () => {
    let resolveReq;
    const mockApi = vi.fn(() => new Promise((r) => { resolveReq = r; }));
    warmApi(mockApi, '/metadata');
    warmApi(mockApi, '/metadata');
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(mockApi).toHaveBeenCalledWith('/metadata', { silent401: true });
    resolveReq({ strategies: ['ORB'] });
    await Promise.resolve();
    await Promise.resolve();
    expect(getCached('/metadata')).toEqual({ strategies: ['ORB'] });
  });
});
