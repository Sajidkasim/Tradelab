import { test, expect } from "@playwright/test";

const origin = "http://127.0.0.1:8114";
async function login(page, who) {
  await page.route("https://abcdefghijklmnopqrst.supabase.co/auth/v1/authorize?**", async route => {
    await route.fulfill({ status: 302, headers: { location: `${origin}/auth/callback?code=${who}` }, body: "" });
  });
  await page.goto(origin);
  await expect(page.getByLabel("Lab password", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible();
  await expect(page).toHaveURL(`${origin}/lab`);
  const meta = await (await page.request.get(`${origin}/api/metadata`)).json();
  if (meta.journal_preferences?.welcome_pending) {
    await page.getByRole('button', {name: 'Open my lab', exact: true}).click();
    await expect(page.getByRole('dialog', {name:'Welcome to your lab'})).toHaveCount(0);
  }
  if (meta.journal_preferences?.tour_status === 'pending') {
    await page.getByRole('button',{name:'Skip guide',exact:true}).click();
    await expect(page.locator('.guided-tour')).toHaveCount(0);
  }
}

test("Google opens separate journals, and signing out revokes the browser session", async ({ page, browser }) => {
  await login(page, "owner");
  const post = await page.evaluate(async () => {
    const session = await (await fetch('/api/session')).json();
    const response = await fetch('/api/trades', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Primus-CSRF': session.csrf },
      body: JSON.stringify({ symbol: 'NQ', direction: 'long', account_id: 1, source: 'backtest', strategy: 'Owner private strategy',
        labels: { level: 'FVG' }, confirmed: true, entry_time: '2026-07-01T09:30:00-04:00', exit_time: '2026-07-01T09:40:00-04:00',
        net_pnl: 100, risk_amount: 50 }) });
    return response.status;
  });
  expect(post).toBe(200);
  const other = await browser.newContext();
  const friend = await other.newPage();
  await login(friend, "friend");
  expect(await friend.evaluate(async () => (await fetch('/api/trades')).json())).toEqual([]);
  expect(await page.evaluate(async () => (await (await fetch('/api/trades')).json()).length)).toBe(1);
  await friend.getByRole("button", { name: "My lab", exact: true }).click();
  await friend.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(friend.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  expect(await friend.evaluate(async () => (await fetch('/api/trades')).status)).toBe(401);
  await friend.screenshot({ path: "test-results/primus-google-login-desktop.png", fullPage: true });
  await friend.setViewportSize({ width: 390, height: 844 });
  await expect(friend.getByRole("button", { name: "Continue with Google" })).toBeInViewport();
  expect(await friend.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await friend.screenshot({ path: "test-results/primus-google-login-mobile.png", fullPage: true });
  await other.close();
});

test("only the owner can manage access; blocking revokes sessions and unblocking preserves the journal", async ({ page, browser }) => {
  await login(page, "owner");
  const context = await browser.newContext();
  const friend = await context.newPage();
  await login(friend, "friend");
  await friend.getByRole("button", { name: "My lab", exact: true }).click();
  await expect(friend.getByRole("button", { name: "Manage access", exact: true })).toHaveCount(0);
  expect(await friend.evaluate(async () => (await fetch('/api/access')).status)).toBe(403);
  await friend.getByRole("button", { name: "My lab", exact: true }).click();
  const privateTrade = await friend.evaluate(async () => {
    const session = await (await fetch('/api/session')).json();
    const response = await fetch('/api/trades', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Primus-CSRF': session.csrf },
      body: JSON.stringify({ symbol: 'NQ', direction: 'long', account_id: 1, source: 'backtest', strategy: 'Friend private strategy',
        labels: { level: 'FVG' }, confirmed: true, entry_time: '2026-07-02T09:30:00-04:00', exit_time: '2026-07-02T09:40:00-04:00',
        net_pnl: 120, risk_amount: 50 }) });
    return response.status;
  });
  expect(privateTrade).toBe(200);
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page.getByRole("button", { name: "Manage access", exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage access', exact: true });
  const person = dialog.getByRole('article', { name: 'friend@example.com', exact: true });
  await expect(person.getByText('Signed in', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Friend private strategy', { exact: true })).toHaveCount(0);
  await person.getByRole('button', { name: 'Block access', exact: true }).click();
  await person.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await friend.evaluate(async () => (await fetch('/api/trades')).status)).toBe(200);
  await person.getByRole('button', { name: 'Block access', exact: true }).click();
  await person.getByRole('button', { name: 'Confirm block', exact: true }).click();
  await expect(person.getByText('Blocked', { exact: true })).toBeVisible();
  expect(await friend.evaluate(async () => (await fetch('/api/trades')).status)).toBe(401);
  await friend.reload();
  await friend.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(friend.getByRole('alert')).toContainText('has been blocked');
  await page.screenshot({ path: 'test-results/primus-manage-access-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(person.getByRole('button', { name: 'Unblock access', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/primus-manage-access-mobile.png', fullPage: true });
  await person.getByRole('button', { name: 'Unblock access', exact: true }).click();
  await person.getByRole('button', { name: 'Confirm unblock', exact: true }).click();
  await expect(person.getByText('Signed out', { exact: true })).toBeVisible();
  await friend.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(friend.getByRole('heading', { name: 'Results', exact: true })).toBeVisible();
  expect(await friend.evaluate(async () => (await (await fetch('/api/trades')).json())[0].setup_name)).toBe('Friend private strategy');
  await context.close();
});

test('Lab navigation, reloads and backup links work inside the website section', async ({ page }) => {
  await login(page, 'owner');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/lab/import`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Import trades', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'My lab', exact: true }).click();
  await page.getByRole('button', { name: 'Backup & restore', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download full JSON backup', exact: true })).toHaveAttribute('href', '/api/export/backup');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'My lab', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Advanced tools', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'My lab', exact: true }).press('Escape');
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Strategy Lab', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/lab#results`);
  await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible();
});

test("Manage access refreshes session details after another person signs out", async ({ page, browser }) => {
  await login(page, "owner");
  const context = await browser.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1" });
  const friend = await context.newPage();
  await login(friend, "friend");
  const before = (await (await page.request.get(`${origin}/api/access`)).json()).find((p) => !p.owner).signed_in_sessions;
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page.getByRole("button", { name: "Manage access", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manage access", exact: true });
  const person = dialog.getByRole("article", { name: "friend@example.com", exact: true });
  await person.getByText("Sign-in & device details", { exact: true }).click();
  await expect(person.locator(".access-facts dd").nth(1)).toHaveText(String(before));
  await expect(person.locator(".access-facts")).toContainText("Phone · iOS · Safari");
  await friend.getByRole("button", { name: "My lab", exact: true }).click();
  await friend.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(friend.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await dialog.getByRole("button", { name: "Refresh list", exact: true }).click();
  await expect(person.locator(".access-facts dd").nth(1)).toHaveText(String(before - 1));
  await expect(dialog.locator(".access-refresh")).toContainText("Updated");
  await page.screenshot({ path: "test-results/primus-access-activity.png", fullPage: true });
  await context.close();
});
