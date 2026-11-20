import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

test('root deployment retains its existing navigation', async () => {
  vi.resetModules();
  const { labHref, journalPage } = await import('./paths');
  expect(labHref()).toBe('/');
  expect(labHref('import')).toBe('/import');
  expect(journalPage('/', '#trades')).toBe('trades');
  expect(journalPage('/tools')).toBe('tools');
});

test('server-selected lab section keeps navigation under /lab', async () => {
  vi.stubGlobal('document', { querySelector: () => ({ content: '/lab' }) });
  vi.resetModules();
  const { labHref, journalPage, isSitePath, isSpaPath } = await import('./paths');
  expect(labHref()).toBe('/lab');
  expect(labHref('import')).toBe('/lab/import');
  expect(journalPage('/lab')).toBe('results');
  expect(journalPage('/lab', '#trades')).toBe('trades');
  expect(journalPage('/lab/tools')).toBe('tools');
  expect(isSitePath('/journal')).toBe(true);
  expect(isSitePath('/lab')).toBe(false);
  expect(isSpaPath('/journal')).toBe(true);
  expect(isSpaPath('/backtesting')).toBe(true);
  expect(isSpaPath('/lab')).toBe(true);
  expect(isSpaPath('/lab/tools')).toBe(true);
  expect(isSpaPath('/privacy')).toBe(false);
  expect(isSpaPath('/api/session')).toBe(false);
  expect(isSpaPath('/auth/callback')).toBe(false);
  expect(isSpaPath('/unknown-page')).toBe(false);
});
