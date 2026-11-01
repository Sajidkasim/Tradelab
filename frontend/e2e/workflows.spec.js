import { pick, options, expectValue } from "./select-helpers";
import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const csv = `id,dateStart,dateEnd,pair,rPnL,side,status,entryPrice,amount,maxRiskReward,tags
browser-fx-1,2026-07-01 13:31:00,2026-07-01 13:45:00,CME_MINI:NQ1,-100,sell,closed,18000,20,5,SMT
browser-fx-2,2026-07-01 14:01:00,2026-07-01 14:15:00,CME_MINI:NQ1,250,buy,closed,18100,10,3,CISD
`;

async function open(page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Results", exact: true }),
  ).toBeVisible();
}

async function importSettings(page, section = "File setup") {
  await page
    .getByRole("button", { name: "Import settings", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Import settings",
    exact: true,
  });
  await dialog.getByRole("button", { name: section, exact: true }).click();
  return dialog;
}
async function moreImportOptions(dialog) {
  if (await dialog.locator('.import-extra-options').getAttribute('open') === null)
    await dialog.getByText('More options', {exact:true}).click();
}
async function saveSuggestedTag(page, tag) {
  await page
    .getByRole("button", { name: `Review ${tag}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Save meaning", exact: true }).click();
  await expect(page.locator(".tag-meaning-editor")).toHaveCount(0);
}

test("manual entry, setup exploration and combined or separate source results", async ({
  page,
}) => {
  const failures = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await open(page);
  const identity = await page.evaluate(() => {
    window.primusTestMarker = "same-document";
    return window.primusTestMarker;
  });
  await page.getByRole("button", { name: "Go to trades", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trades", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "Add trade", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Strategy", { exact: true }).fill("Browser setup");
  await pick(dialog.getByLabel("Key level / PDA", { exact: true }), "FVG");
  await pick(dialog.getByLabel("Key level timeframe", { exact: true }), "4H");
  await pick(dialog.getByLabel("Entry timeframe", { exact: true }), "1m");
  await dialog.getByLabel("SMT", { exact: true }).check();
  await dialog.getByLabel("CISD", { exact: true }).check();
  await dialog
    .getByLabel("I have checked the confirmations for this trade")
    .check();
  await dialog
    .getByLabel("Entry time · New York", { exact: true })
    .fill("2026-07-01T09:30");
  await dialog.getByLabel("Net result ($)", { exact: true }).fill("100");
  await dialog.getByLabel("Original risk ($)", { exact: true }).fill("50");
  await dialog.getByRole("button", { name: "Save & log next" }).click();
  await expect(
    page.getByText("Trade saved. Ready for the next.", { exact: true }),
  ).toBeVisible();
  await expectValue(
    dialog.getByLabel("Strategy", { exact: true }),
    "Browser setup",
  );
  await expectValue(dialog.getByLabel("Net result ($)", { exact: true }), "");
  await pick(dialog.getByLabel("Testing type", { exact: true }), "manual");
  await dialog
    .getByLabel("Entry time · New York", { exact: true })
    .fill("2026-07-01T10:30");
  await dialog.getByLabel("Net result ($)", { exact: true }).fill("-50");
  await dialog.getByLabel("Original risk ($)", { exact: true }).fill("50");
  await dialog
    .getByLabel("I have checked the confirmations for this trade")
    .check();
  await dialog.getByRole("button", { name: "Save & log next" }).click();
  await expectValue(dialog.getByLabel("Net result ($)", { exact: true }), "");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("link", { name: "PrimusLab", exact: true }).click();
  await expect(
    page.locator(".stat").filter({ hasText: "Win rate" }).first(),
  ).toContainText("50.0%");
  await expect(page.locator(".js-plotly-plot").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Explore a strategy" }),
  ).toBeVisible();
  await page.locator(".explorer").getByLabel("SMT", { exact: true }).check();
  await expect(page.locator(".js-plotly-plot").first()).toBeVisible();
  await page
    .getByRole("group", { name: "Data source", exact: true })
    .getByRole("button", { name: "All", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Results sample", exact: true }),
  ).toHaveCount(0);
  const combined = page.getByRole("region", {
    name: "Combined results",
    exact: true,
  });
  await expect(
    combined.locator(".stat").filter({ hasText: "Win rate" }),
  ).toContainText("50.0%");
  await expect(
    combined.locator(".stat").filter({ hasText: "Trades analysed" }),
  ).toContainText("2");
  await expect(page.locator(".js-plotly-plot")).toHaveCount(1);
  const sources = page.getByRole("group", { name: "Data source", exact: true });
  await sources
    .getByRole("button", { name: "Backtesting", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Backtesting results", exact: true })
      .locator(".stat")
      .filter({ hasText: "Win rate" }),
  ).toContainText("100.0%");
  await sources
    .getByRole("button", { name: "Live", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Live results", exact: true })
      .locator(".stat")
      .filter({ hasText: "Win rate" }),
  ).toContainText("0.0%");
  await sources.getByRole("button", { name: "All", exact: true }).click();
  await page.getByLabel("Show drawdown", { exact: true }).check();
  await expect(page.locator(".js-plotly-plot")).toHaveCount(1);
  await page.getByLabel("Show drawdown", { exact: true }).uncheck();
  await page.screenshot({
    path: "test-results/primuslab-all-results.png",
    fullPage: true,
  });
  expect(await page.evaluate(() => window.primusTestMarker)).toBe(identity);
  expect(failures).toEqual([]);
});

test("FX Replay preview, confirm, edit and save next, duplicate re-import", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Go to trades", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trades", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByLabel("Choose a trade export")).toBeEnabled();
  await page.getByLabel("Choose a trade export").setInputFiles({
    name: "replay.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Preview trades" }).click();
  await expect(
    page.getByRole("heading", { name: "Check the preview" }),
  ).toBeVisible();
  await expect(page.locator(".preview-card .stat").first()).toContainText("2");
  await expect(page.locator(".preview-card")).toContainText("Backtesting");
  await page
    .getByRole("button", { name: "Import 2 trades", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "2 trades added" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review & tag trades" }).click();
  await page.getByRole("button", { name: /To finish/ }).click();
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(2);
  await page
    .getByRole("button", { name: /Edit trade/ })
    .first()
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Strategy", { exact: true }).fill("Replay setup");
  await pick(dialog.getByLabel("Entry timeframe", { exact: true }), "15s");
  await dialog
    .getByLabel("Original risk is not available — keep R unrecorded", {
      exact: true,
    })
    .check();
  await dialog
    .getByLabel("I have checked the confirmations for this trade")
    .check();
  await dialog.getByRole("button", { name: "Save & next" }).click();
  await expectValue(dialog.getByLabel("Strategy", { exact: true }), "");
  await dialog.getByRole("button", { name: "Use previous setup" }).click();
  await expectValue(
    dialog.getByLabel("Strategy", { exact: true }),
    "Replay setup",
  );
  await expectValue(
    dialog.getByLabel("Entry timeframe", { exact: true }),
    "15s",
  );
  await dialog
    .getByLabel("Original risk is not available — keep R unrecorded", {
      exact: true,
    })
    .check();
  await dialog
    .getByLabel("I have checked the confirmations for this trade")
    .check();
  await dialog.getByRole("button", { name: "Save & next" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "All caught up" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Import", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Choose a trade export")).toBeEnabled();
  await page.getByLabel("Choose a trade export").setInputFiles({
    name: "replay.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Preview trades" }).click();
  await expect(page.locator(".preview-card .stat").nth(1)).toContainText("2");
  await expect(
    page.getByRole("button", { name: "Import 0 trades", exact: true }),
  ).toBeDisabled();
});

test("backup download, playbook, themes and mobile layout", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Go to trades", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trades", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page
    .locator(".workspace-menu")
    .getByRole("button", { name: "Lab settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Strategies & levels", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Strategies", { exact: true })
    .fill("Browser setup\nReplay setup\nMy next model");
  await dialog
    .getByRole("button", { name: "Save strategies & levels" })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page.getByRole("button", { name: "Backup & restore" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download full JSON backup" }).click();
  expect((await download).suggestedFilename()).toBe("primuslab-backup.json");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page.getByRole("button", { name: "Dark mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: "test-results/primuslab-trades-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page.getByRole("button", { name: "Light mode", exact: true }).click();
  await page.getByRole("link", { name: "PrimusLab", exact: true }).click();
  await expect(page.locator(".js-plotly-plot").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/primuslab-results-light.png",
    fullPage: true,
  });
  await expect(page.locator(".results-content")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.screenshot({
    path: "test-results/primuslab-explore-light.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "Results", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/primuslab-mobile.png",
    fullPage: true,
  });
});

test("journal menu keeps settings and backups without Advanced tools", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Advanced tools", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Lab settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Backup & restore", exact: true }),
  ).toBeVisible();
});

test("compact navigation and workspace tools remain accessible on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "PrimusLab", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "PrimusLab", exact: true }).click();
  await expect(page).toHaveURL(/#results$/);
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Backup & restore" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "My lab", exact: true })
    .press("Escape");
  await expect(
    page.getByRole("button", { name: "Backup & restore" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page.locator(".chart").first().click();
  await expect(
    page.getByRole("button", { name: "Backup & restore" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Go to trades", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trades", exact: true })).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Add trade", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByLabel("Testing type")).not.toBeVisible();
  const importDialog = await importSettings(page);
  await expect(page.getByLabel("Testing type")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await importDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("link", { name: "PrimusLab", exact: true }).click();
  await expect(page.locator(".results-content")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator(".js-plotly-plot").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/primuslab-simple-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/primuslab-simple-results.png",
    fullPage: true,
  });
});

test("one journal keeps exploration beside results and trades below, with All first", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole("heading", { name: "Trades", exact: true }),
  ).toBeVisible();
  const sources = page.getByRole("group", { name: "Data source", exact: true });
  await expect(sources.getByRole("button").first()).toHaveText("All");
  await expect(sources.getByRole("button").first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("combobox", { name: "Strategy", exact: true }),
  ).toHaveCount(1);
  await pick(
    page.locator(".explorer").getByLabel("Strategy", { exact: true }),
    "Browser setup",
  );
  await expect(page.locator(".js-plotly-plot")).toHaveCount(1);
  await expect(page.locator(".results-content")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await sources
    .getByRole("button", { name: "Live", exact: true })
    .click();
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(1);
  await sources.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(4);
  await page
    .locator(".explorer")
    .getByRole("button", { name: "Reset setup filters" })
    .click();
  await expectValue(
    page.locator(".explorer").getByLabel("Strategy", { exact: true }),
    "All strategies",
  );
  await expect(page.locator(".results-content")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.screenshot({
    path: "test-results/primuslab-one-page.png",
    fullPage: true,
  });
  await page.goto("/trades");
  await expect(
    page.getByRole("heading", { name: "Results", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Trades", exact: true }),
  ).toBeVisible();
});

test("delete manual and imported trades with cancellation, errors and refreshed results", async ({
  page,
}) => {
  await open(page);
  const imported = (await (await page.request.get('/api/trades')).json()).find(trade => trade.source === 'fxreplay');
  const row = page.locator('.trade-table tbody tr').filter({has: page.getByRole('button',{name:`Edit trade ${imported.id}`,exact:true})});
  const button = row.getByRole("button", { name: /Delete trade/ });
  await button.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("This cannot be undone");
  await dialog.getByRole("button", { name: "Keep trade" }).click();
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(4);
  await button.click();
  await page.route("**/api/trades/*", async (route) => {
    if (route.request().method() === "DELETE")
      await route.fulfill({
        status: 503,
        json: { detail: "Please retry deletion." },
      });
    else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Delete trade", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Please retry deletion",
  );
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(4);
  await page.unroute("**/api/trades/*");
  await dialog
    .getByRole("button", { name: "Delete trade", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(3);
  const manual = page
    .locator(".trade-table tbody tr")
    .filter({ hasText: "Live" });
  await manual.getByRole("button", { name: /Delete trade/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete trade", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(2);
  await page
    .getByRole("group", { name: "Data source", exact: true })
    .getByRole("button", { name: "Live", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Live results", exact: true })
      .locator(".stat")
      .filter({ hasText: "Trades analysed" }),
  ).toContainText("0");
  await page.reload();
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(2);
});

test("composite CSV tags are approved once, notes survive, and re-import previews label updates", async ({
  page,
}) => {
  const tagged = `id,dateStart,dateEnd,pair,rPnL,side,status,tags,notes\nrelease-browser,2013/01/25 17:07:59,2013/01/25 19:13:55,CME_MINI:NQ1,125,sell,closed,"CONTINUATION,HTF LEVEL 1HR FVG,CISD FVG \\",Export note\n`;
  async function choose(content) {
    await expect(page.getByLabel("Choose a trade export")).toBeEnabled();
    await page.getByLabel("Choose a trade export").setInputFiles({
      name: "tagged.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(content),
    });
    await page
      .getByRole("button", { name: "Preview trades", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Check the preview" }),
    ).toBeVisible();
  }
  await open(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await choose(tagged);
  await page
    .getByRole("button", { name: "Review new tags", exact: true })
    .click();
  for (const tag of ["CONTINUATION", "HTF LEVEL 1HR FVG", "CISD FVG \\"]) {
    await saveSuggestedTag(page, tag);
  }
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.locator(".preview-card tbody")).toContainText(
    "Continuation",
  );
  await expect(page.locator(".preview-card tbody")).toContainText("CISD + FVG");
  await page
    .getByRole("button", { name: "Import 1 trades", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "1 trades added", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Import another file", exact: true })
    .click();
  const updateDialog = await importSettings(page);
  await moreImportOptions(updateDialog);
  await updateDialog
    .getByLabel("Update labels on existing trades", { exact: true })
    .check();
  await updateDialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await choose(
    tagged
      .replace(",125,sell", ",9999,sell")
      .replace("Export note", "Another export note"),
  );
  await expect(
    page.locator(".preview-card .stat").filter({ hasText: "Label updates" }),
  ).toContainText("1");
  await page
    .getByRole("button", { name: "Import 0 trades · update 1", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "0 trades added · 1 updated",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review & tag trades", exact: true })
    .click();
  await expect(
    page.locator(".trade-table tbody tr").filter({ hasText: "Continuation" }),
  ).toContainText("125.00");
});

test("Lab settings expose exactly the requested windows and save custom names", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByText("New York focused", { exact: true })).toHaveCount(
    0,
  );
  await page.getByText("Session, news & market", { exact: true }).click();
  const sessions = page.getByLabel("Session window", { exact: true });
  await expect(await options(sessions)).toHaveCount(7);
  await expectValue(sessions, "All sessions");
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page.getByRole("button", { name: "Lab settings", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Session windows", exact: true })
    .click();
  await expectValue(
    dialog.getByLabel("Session 1 starts", { exact: true }),
    "20:00",
  );
  await expectValue(
    dialog.getByLabel("Session 6 ends", { exact: true }),
    "16:00",
  );
  await dialog
    .getByLabel("Session 4 name", { exact: true })
    .fill("My opening window");
  await dialog
    .getByRole("button", { name: "Save lab settings", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(await options(sessions)).toContainText([
    "All sessions",
    "Asia",
    "London",
    "New York pre-market",
    "My opening window",
    "Lunch",
    "Afternoon",
  ]);
  await page.reload();
  await page.getByText("Session, news & market", { exact: true }).click();
  await expect(await options(page.getByLabel("Session window"))).toContainText([
    "All sessions",
    "Asia",
    "London",
    "New York pre-market",
    "My opening window",
    "Lunch",
    "Afternoon",
  ]);
});

test("eight-row pagination and exact-count delete-all handle changed data safely", async ({
  page,
}) => {
  await open(page);
  const identity = await (await page.request.get("/api/session")).json();
  const headers = {
    Origin: "http://127.0.0.1:8111",
    "X-Primus-CSRF": identity.csrf,
  };
  async function seed(index) {
    const response = await page.request.post("/api/trades", {
      headers,
      data: {
        symbol: "ES",
        direction: "long",
        account_id: 1,
        source: "backtest",
        strategy: "Pagination",
        labels: {},
        confirmed: false,
        entry_time: `2026-08-${String(index + 1).padStart(2, "0")}T09:30:00-04:00`,
        exit_time: `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00-04:00`,
        net_pnl: 50,
        risk_amount: 100,
        notes: "Synthetic browser check only",
      },
    });
    expect(response.status()).toBe(200);
  }
  for (let i = 0; i < 8; i++) await seed(i);
  await page.reload();
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(8);
  await page
    .locator(".table-footer")
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Manage trades", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete all trades", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("11");
  await dialog
    .getByRole("button", { name: "Continue to confirmation" })
    .click();
  await dialog.getByRole("textbox").fill("10");
  await expect(
    dialog.getByRole("button", { name: "Delete all 11 trades", exact: true }),
  ).toBeDisabled();
  await seed(8);
  await dialog.getByRole("textbox").fill("11");
  await dialog
    .getByRole("button", { name: "Delete all 11 trades", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Your trades changed");
  await dialog
    .getByRole("button", { name: "Get the latest trade count" })
    .click();
  await expect(dialog).toContainText("12");
  await dialog
    .getByRole("button", { name: "Continue to confirmation" })
    .click();
  await dialog.getByRole("textbox").fill("12");
  await dialog
    .getByRole("button", { name: "Delete all 12 trades", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No trades yet" }).last(),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(0);
});

test("FX Replay tag guide saves before upload and separates levels from confirmations", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const tagDialog = await importSettings(page, "Tag meanings");
  await tagDialog.getByText(/^Suggested meanings/).click();
  for (const tag of [
    "DISPLACEMENT AT KEY LEVEL",
    "REVERSAL AT KEY LEVEL",
    "FVG",
    "1HR",
    "1M",
    "CISD",
    "SMT",
  ]) {
    await saveSuggestedTag(page, tag);
  }
  await tagDialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Import trades", exact: true }),
  ).toBeVisible();
  const reopened = await importSettings(page, "Tag meanings");
  await expect(
    reopened.getByRole("button", {
      name: "Edit DISPLACEMENT AT KEY LEVEL",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    reopened
      .locator(".tag-meaning-row")
      .filter({ hasText: "REVERSAL AT KEY LEVEL" }),
  ).toContainText("Strategy: Reversal at key level");
  await reopened.getByRole("button", { name: "Close", exact: true }).click();
  const content = `id,dateStart,dateEnd,pair,rPnL,side,status,tags
new-guide-preview,2026-07-02 13:31:00,2026-07-02 13:45:00,CME_MINI:NQ1,125,buy,closed,"DISPLACEMENT AT KEY LEVEL,FVG,1HR,1M,CISD,SMT,15M"
`;
  await expect(page.getByLabel("Choose a trade export")).toBeEnabled();
  await page.getByLabel("Choose a trade export").setInputFiles({
    name: "guide.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(content),
  });
  await page
    .getByRole("button", { name: "Preview trades", exact: true })
    .click();
  await expect(page.locator(".preview-card tbody")).toContainText(
    "Displacement at key level",
  );
  await expect(page.locator(".preview-card tbody")).toContainText(
    "FVG · 1H · 1m",
  );
  await expect(page.locator(".preview-card tbody")).toContainText("CISD + SMT");
  await expect(page.locator(".preview-card")).toContainText(
    "15M appears in both",
  );
  await expect(
    page.getByRole("heading", { name: "Check the preview" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to trades", exact: true })
    .click();
  await expect(
    page.getByText("new-guide-preview", { exact: true }),
  ).toHaveCount(0);
});

test("new strategies, renamed CSV tags and keep-only choices work on later imports", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  let dialog = await importSettings(page, "Tag meanings");
  await dialog.getByRole("button", { name: "Add a tag", exact: true }).click();
  await dialog
    .getByLabel("Tag in your CSV", { exact: true })
    .fill("BREAKOUT MODEL");
  await dialog
    .getByLabel("Name in PrimusLab", { exact: true })
    .fill("Breakout and retest");
  await dialog
    .getByRole("button", { name: "Save meaning", exact: true })
    .click();
  await expect(
    dialog.locator(".tag-meaning-row").filter({ hasText: "BREAKOUT MODEL" }),
  ).toContainText("Strategy: Breakout and retest");
  await dialog
    .getByRole("button", {
      name: "Add another CSV name for BREAKOUT MODEL",
      exact: true,
    })
    .click();
  await dialog
    .getByLabel("Tag in your CSV", { exact: true })
    .fill("BREAKOUT MODEL V2");
  await dialog
    .getByRole("button", { name: "Save meaning", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Edit BREAKOUT MODEL", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Edit BREAKOUT MODEL V2", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const content = `id,dateStart,dateEnd,pair,rPnL,side,status,tags\nfuture-tag-guide,2026-07-03 13:31:00,2026-07-03 13:45:00,CME_MINI:NQ1,125,buy,closed,"BREAKOUT MODEL V2,JOURNAL A"\n`;
  async function previewFile() {
    await expect(page.getByLabel("Choose a trade export")).toBeEnabled();
    await page.getByLabel("Choose a trade export").setInputFiles({
      name: "future.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(content),
    });
    await page
      .getByRole("button", { name: "Preview trades", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Check the preview", exact: true }),
    ).toBeVisible();
  }
  await previewFile();
  await expect(
    page.getByRole("heading", { name: "1 new tag to review", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review new tags", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Import settings", exact: true });
  await dialog
    .getByRole("button", { name: "Review JOURNAL A", exact: true })
    .click();
  await dialog.getByLabel("Keep original tag only", { exact: true }).check();
  await dialog
    .getByRole("button", { name: "Save meaning", exact: true })
    .click();
  await expect(dialog.locator(".tag-meaning-editor")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review new tags", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".preview-card tbody")).toContainText(
    "Breakout and retest",
  );
  await page
    .getByRole("button", { name: "Import 1 trades", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "1 trades added", exact: true }),
  ).toBeVisible();
  await page.reload();
  await previewFile();
  await expect(
    page.getByRole("button", { name: "Review new tags", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".preview-card .stat")
      .filter({ hasText: "Duplicates skipped" }),
  ).toContainText("1");
  await expect(page.locator(".preview-card tbody")).toContainText(
    "Breakout and retest",
  );
});

test("import preferences save before upload and settings fit mobile in both themes", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByLabel("Testing type")).toHaveCount(0);
  await expect(page.getByText("Your tag guide", { exact: true })).toHaveCount(
    0,
  );
  let dialog = await importSettings(page);
  await expect(dialog.getByLabel("Save into account", {exact:true})).toHaveCount(0);
  await expect(dialog.getByLabel("Account", {exact:true})).toHaveCount(0);
  const type = dialog.getByRole("combobox", {name:"Testing type",exact:true});
  await expect(await options(type)).toHaveText(["Backtesting", "Live"]);
  await pick(type, "live");
  await expectValue(type, "live");
  await pick(type, "backtesting");
  await pick(
    dialog.getByLabel("File time zone", { exact: true }),
    "Etc/GMT+4",
  );
  await moreImportOptions(dialog);
  await dialog
    .getByLabel("Day-first dates (31/12/2026)", { exact: true })
    .check();
  await dialog
    .getByLabel("Update labels on existing trades", { exact: true })
    .uncheck();
  await dialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  dialog = await importSettings(page);
  await expectValue(
    dialog.getByLabel("File time zone", { exact: true }),
    "Etc/GMT+4",
  );
  await expect(
    dialog.getByLabel("Day-first dates (31/12/2026)", { exact: true }),
  ).toBeChecked();
  await expect(
    dialog.getByLabel("Update labels on existing trades", { exact: true }),
  ).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await dialog
    .getByRole("button", { name: "Tag meanings", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Your tag guide", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/primuslab-import-settings-mobile.png",
  });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page.getByRole("button", { name: "Dark mode", exact: true }).click();
  dialog = await importSettings(page, "Tag meanings");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/primuslab-import-settings-dark-mobile.png",
  });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page.getByRole("button", { name: "Light mode", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/primuslab-simple-import.png" });
});

test("fixed RR results use confirmed backtest outcomes and preserve recorded risk", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  let dialog = await importSettings(page, "Tag meanings");
  await dialog.getByRole("button", { name: "Add a tag", exact: true }).click();
  await dialog.getByLabel("Tag in your CSV", { exact: true }).fill("1:3");
  await pick(
    dialog.getByLabel("Use this tag as", { exact: true }),
    "target_rr",
  );
  await dialog.getByLabel("Name in PrimusLab", { exact: true }).fill("1:3");
  await dialog
    .getByLabel("Wins hit the full target; losses hit the full stop", {
      exact: true,
    })
    .check();
  await dialog
    .getByRole("button", { name: "Save meaning", exact: true })
    .click();
  await expect(dialog.locator(".tag-meaning-editor")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const modelCsv = `id,dateStart,dateEnd,pair,rPnL,side,status,tags\nrr-win,2026-07-04 13:30,2026-07-04 13:40,NQ,300,buy,closed,1:3\nrr-loss,2026-07-05 13:30,2026-07-05 13:40,NQ,-100,buy,closed,1:3\n`;
  async function importCsv(content, count) {
    await expect(page.getByLabel("Choose a trade export")).toBeEnabled();
    await page.getByLabel("Choose a trade export").setInputFiles({
      name: "rr.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(content),
    });
    await page
      .getByRole("button", { name: "Preview trades", exact: true })
      .click();
    await expect(page.locator(".preview-card tbody")).toContainText(
      "Target RR 1:3",
    );
    await page
      .getByRole("button", { name: `Import ${count} trades`, exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: `${count} trades added`, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Review & tag trades", exact: true })
      .click();
    await pick(
      page.locator(".explorer").getByLabel("Target RR", { exact: true }),
      "1:3",
    );
    await expect(page.locator(".results-content")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  }
  await importCsv(modelCsv, 2);
  await expect(page.locator(".lab-rr-model")).toHaveCount(0);
  await expect(
    page.locator(".stat").filter({ hasText: "Average R · fixed test" }).first(),
  ).toContainText("1.00R");
  await expect(
    page.locator(".stat").filter({ hasText: "Average R · fixed test" }).first(),
  ).toContainText("before costs");
  await expect(
    page.locator(".stat").filter({ hasText: "Trades analysed" }).first(),
  ).toContainText("2");
  await page.screenshot({
    path: "test-results/primuslab-fixed-rr-results.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  // Actual exported risk takes priority over the fixed-model comparison.
  const actual = `id,symbol,direction,entry_time,exit_time,pnl,risk_amount,tags\nrr-actual,NQ,buy,2026-07-06 13:30,2026-07-06 13:40,125,50,1:3\n`;
  await importCsv(actual, 1);
  await expect(
    page.locator(".stat").filter({ hasText: "Average R" }).first(),
  ).toContainText("2.50R");
  await expect(
    page.locator(".stat").filter({ hasText: "Average R · fixed test" }),
  ).toHaveCount(0);
  await expect(page.locator(".lab-rr-model")).toHaveCount(0);
  await pick(
    page.locator(".explorer").getByLabel("Target RR", { exact: true }),
    "Any RR",
  );
});

test("weekday exploration updates results and CSV day meanings flag mismatches", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByLabel("Choose a trade export")).toBeEnabled();
  await page.getByLabel("Choose a trade export").setInputFiles({
    name: "weekday.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "id,dateStart,dateEnd,pair,rPnL,side,status,strategy\nweekday-monday,2026-07-06T13:30:00Z,2026-07-06T13:40:00Z,NQ,125,buy,closed,Weekday check\n",
    ),
  });
  await page
    .getByRole("button", { name: "Preview trades", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import 1 trades", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "1 trades added", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review & tag trades", exact: true })
    .click();
  const explorer = page.locator(".explorer");
  const day = explorer.getByLabel("Day", { exact: true });
  await expect(await options(day)).toHaveText([
    "All days",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
  ]);
  await pick(explorer.getByLabel("Strategy", { exact: true }), "Weekday check");
  await pick(day, "Monday");
  await expect(page.locator(".results-content")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.locator(".stat").filter({ hasText: "Trades analysed" }).first(),
  ).toContainText("1");
  await expect(page.locator(".js-plotly-plot").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/primuslab-weekday-results.png",
    fullPage: true,
  });
  await pick(day, "Tuesday");
  await expect(
    page.getByRole("heading", { name: "No trades yet", exact: true }).first(),
  ).toBeVisible();
  await explorer
    .getByRole("button", { name: "Reset setup filters", exact: true })
    .click();
  await expectValue(day, "All days");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = await importSettings(page, "Tag meanings");
  await dialog.getByRole("button", { name: "Add a tag", exact: true }).click();
  await dialog.getByLabel("Tag in your CSV", { exact: true }).fill("FRIDAY");
  await pick(dialog.getByLabel("Use this tag as", { exact: true }), "weekday");
  await pick(dialog.getByLabel("Name in PrimusLab", { exact: true }), "Friday");
  await expect(
    dialog.getByText(
      "Entry date in your session timezone determines the day filter.",
      { exact: false },
    ),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Save meaning", exact: true })
    .click();
  await expect(dialog.locator(".tag-meaning-editor")).toHaveCount(0);
  await expect(dialog).toContainText("Day: Friday");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByLabel("Choose a trade export")).toBeEnabled();
  await page.getByLabel("Choose a trade export").setInputFiles({
    name: "day.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "id,dateStart,dateEnd,pair,rPnL,side,status,tags\nday-preview,2026-07-06 13:30,2026-07-06 13:40,NQ,100,buy,closed,FRIDAY\n",
    ),
  });
  await page
    .getByRole("button", { name: "Preview trades", exact: true })
    .click();
  await expect(
    page.getByText(/Day tag Friday disagrees with entry date/),
  ).toBeVisible();
});

test("break-even import choice excludes zero results, refreshes preview and is remembered", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const choice = page.getByLabel("Include break-even trades?", { exact: true });
  await expectValue(choice, "yes");
  await pick(choice, "no");
  const content =
    "id,dateStart,dateEnd,pair,rPnL,side,status\nbe-browser-zero,2026-07-08T13:30:00Z,2026-07-08T13:40:00Z,NQ,0,buy,closed\nbe-browser-win,2026-07-09T13:30:00Z,2026-07-09T13:40:00Z,NQ,100,buy,closed\nbe-browser-small-loss,2026-07-10T13:30:00Z,2026-07-10T13:40:00Z,NQ,-0.01,buy,closed\n";
  await expect(page.getByLabel("Choose a trade export")).toBeEnabled();
  await page.getByLabel("Choose a trade export").setInputFiles({
    name: "break-even.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(content),
  });
  await page
    .getByRole("button", { name: "Preview trades", exact: true })
    .click();
  await expect(page.locator(".preview-card tbody tr")).toHaveCount(2);
  await expect(page.locator(".preview-card")).toContainText(
    "1 break-even trades excluded",
  );
  await pick(choice, "yes");
  await expect(page.locator(".preview-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Preview trades", exact: true })
    .click();
  await expect(page.locator(".preview-card tbody tr")).toHaveCount(3);
  await pick(choice, "no");
  await page
    .getByRole("button", { name: "Preview trades", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import 2 trades", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "1 break-even trades will also be excluded",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "2 trades added", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".import-success")).toContainText(
    "1 break-even trades excluded",
  );
  await page.reload();
  await expectValue(choice, "no");
  const onlyZero =
    "id,dateStart,dateEnd,pair,rPnL,side,status\nbe-browser-only-zero,2026-07-11T13:30:00Z,2026-07-11T13:40:00Z,NQ,0,buy,closed\n";
  await expect(page.getByLabel("Choose a trade export")).toBeEnabled();
  await page.getByLabel("Choose a trade export").setInputFiles({
    name: "only-zero.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(onlyZero),
  });
  await page
    .getByRole("button", { name: "Preview trades", exact: true })
    .click();
  await expect(
    page.getByText(
      "Nothing to import after excluding break-even trades. Choose Yes above to include them.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import 0 trades", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: "test-results/primuslab-break-even-import.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/primuslab-break-even-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await pick(choice, "yes");
  await page
    .getByRole("button", { name: "Preview trades", exact: true })
    .click();
  await expect(page.locator(".preview-card tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Import 1 trades", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "1 trades added", exact: true }),
  ).toBeVisible();
});

test("strategy editor matches Explore and removed choices do not return after reload", async ({
  page,
}) => {
  await open(page);
  const strategy = page
    .locator(".explorer")
    .getByLabel("Strategy", { exact: true });
  const available = (await (await options(strategy)).allTextContents()).filter(
    (name) => !["All strategies", "Unclassified"].includes(name),
  );
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page
    .locator(".workspace-menu")
    .getByRole("button", { name: "Lab settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Strategies & levels", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expectValue(
    dialog.getByLabel("Strategies", { exact: true }),
    available.join("\n"),
  );
  const active = ["Browser setup", "Replay setup"];
  await dialog
    .getByLabel("Strategies", { exact: true })
    .fill(active.join("\n"));
  await dialog
    .getByRole("button", { name: "Save strategies & levels", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(await options(strategy)).toHaveText([
    "All strategies",
    ...active,
  ]);
  await page.reload();
  await expect(await options(strategy)).toHaveText([
    "All strategies",
    ...active,
  ]);
  await pick(strategy, "Browser setup");
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page
    .locator(".workspace-menu")
    .getByRole("button", { name: "Lab settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Strategies & levels", exact: true })
    .click();
  await expectValue(
    dialog.getByLabel("Strategies", { exact: true }),
    active.join("\n"),
  );
  await dialog.getByLabel("Strategies", { exact: true }).fill("Replay setup");
  await dialog
    .getByRole("button", { name: "Save strategies & levels", exact: true })
    .click();
  await expectValue(strategy, "All strategies");
  await page.getByRole("button", { name: "Add trade", exact: true }).click();
  await expect(dialog.locator("#strategies option")).toHaveCount(1);
  await expect(dialog.locator("#strategies option")).toHaveAttribute(
    "value",
    "Replay setup",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("Lab setup labels edit confirmations and separate timeframes without rewriting old trades", async ({
  page,
}) => {
  await open(page);
  const explorer = page.locator(".explorer");
  async function settings() {
    await page.getByRole("button", { name: "My lab", exact: true }).click();
    await page
      .getByRole("button", { name: "Lab settings", exact: true })
      .click();
    return page.getByRole("dialog", { name: "Lab settings", exact: true });
  }
  let dialog = await settings();
  await expect(
    dialog.getByLabel("Confirmations / confluence", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("Confirmations / confluence", { exact: true })
    .fill("SMT\nMACRO\nMy confluence");
  await dialog
    .getByLabel("Key level timeframes", { exact: true })
    .fill("Daily\n2H");
  await dialog.getByLabel("Entry timeframes", { exact: true }).fill("1m\n30s");
  await dialog
    .getByRole("button", { name: "Save lab settings", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    explorer.getByLabel("My confluence", { exact: true }),
  ).toBeVisible();
  await expect(explorer.getByLabel("CISD", { exact: true })).toHaveCount(0);
  await expect(
    await options(explorer.getByLabel("Key level timeframe", { exact: true })),
  ).toHaveText(["Any", "Daily", "2H"]);
  await expect(
    await options(explorer.getByLabel("Entry timeframe", { exact: true })),
  ).toHaveText(["Any", "1m", "30s"]);
  await page.reload();
  dialog = await settings();
  await expectValue(
    dialog.getByLabel("Confirmations / confluence", { exact: true }),
    "SMT\nMACRO\nMy confluence",
  );
  await expectValue(
    dialog.getByLabel("Key level timeframes", { exact: true }),
    "Daily\n2H",
  );
  await page.screenshot({
    path: "test-results/primuslab-lab-setup-settings.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/primuslab-lab-setup-settings-mobile.png",
  });
  await dialog
    .getByRole("button", { name: "Session windows", exact: true })
    .click();
  await expectValue(
    dialog.getByLabel("Session 4 name", { exact: true }),
    "My opening window",
  );
  await dialog
    .getByRole("button", { name: "News & market", exact: true })
    .click();
  await expect(dialog.getByLabel("News labels", { exact: true })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Setup labels", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Log a disposable trade using the new choices, then hide them in settings.
  await page.getByRole("button", { name: "Add trade", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Strategy", { exact: true }).fill("Replay setup");
  await pick(dialog.getByLabel("Key level timeframe", { exact: true }), "2H");
  await pick(dialog.getByLabel("Entry timeframe", { exact: true }), "30s");
  await dialog.getByLabel("My confluence", { exact: true }).check();
  await dialog
    .getByLabel("Entry time · New York", { exact: true })
    .fill("2026-07-12T09:30");
  await dialog.getByLabel("Net result ($)", { exact: true }).fill("100");
  await dialog.getByLabel("Original risk ($)", { exact: true }).fill("50");
  await dialog
    .getByRole("button", { name: "Save & log next", exact: true })
    .click();
  await expect(
    page.getByText("Trade saved. Ready for the next.", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await pick(explorer.getByLabel("Key level timeframe", { exact: true }), "2H");
  await explorer.getByLabel("My confluence", { exact: true }).check();
  dialog = await settings();
  await dialog
    .getByLabel("Confirmations / confluence", { exact: true })
    .fill("SMT\nMACRO");
  await dialog.getByLabel("Key level timeframes", { exact: true }).fill("Daily");
  await dialog.getByLabel("Entry timeframes", { exact: true }).fill("1m");
  await dialog
    .getByRole("button", { name: "Save lab settings", exact: true })
    .click();
  await expectValue(
    explorer.getByLabel("Key level timeframe", { exact: true }),
    "Any timeframe",
  );
  await expect(
    explorer.getByLabel("My confluence", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: /^Edit trade / })
    .first()
    .click();
  dialog = page.getByRole("dialog");
  await expectValue(
    dialog.getByLabel("Key level timeframe", { exact: true }),
    "2H",
  );
  await expectValue(
    dialog.getByLabel("Entry timeframe", { exact: true }),
    "30s",
  );
  await expect(
    dialog.getByLabel("My confluence", { exact: true }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});
