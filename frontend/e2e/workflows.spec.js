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
  await page.getByRole("link", { name: "Trades ↓", exact: true }).click();
  await page.getByRole("button", { name: "Add trade", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Strategy", { exact: true }).fill("Browser setup");
  await dialog.getByLabel("Key level / PDA", { exact: true }).fill("FVG");
  await dialog
    .getByLabel("Level timeframe", { exact: true })
    .selectOption("4H");
  await dialog
    .getByLabel("Entry timeframe", { exact: true })
    .selectOption("1m");
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
  await expect(dialog.getByLabel("Strategy", { exact: true })).toHaveValue(
    "Browser setup",
  );
  await expect(
    dialog.getByLabel("Net result ($)", { exact: true }),
  ).toHaveValue("");
  await dialog.getByLabel("Save to", { exact: true }).selectOption("manual");
  await dialog
    .getByLabel("Entry time · New York", { exact: true })
    .fill("2026-07-01T10:30");
  await dialog.getByLabel("Net result ($)", { exact: true }).fill("-50");
  await dialog.getByLabel("Original risk ($)", { exact: true }).fill("50");
  await dialog
    .getByLabel("I have checked the confirmations for this trade")
    .check();
  await dialog.getByRole("button", { name: "Save & log next" }).click();
  await expect(
    dialog.getByLabel("Net result ($)", { exact: true }),
  ).toHaveValue("");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("link", { name: "Results", exact: true }).click();
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
    .getByRole("button", { name: "Live trading", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Live trading results", exact: true })
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
  await page.getByRole("link", { name: "Trades ↓", exact: true }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
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
  await dialog
    .getByLabel("Entry timeframe", { exact: true })
    .selectOption("15s");
  await dialog
    .getByLabel("I have checked the confirmations for this trade")
    .check();
  await dialog.getByRole("button", { name: "Save & next" }).click();
  await expect(dialog.getByLabel("Strategy", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Use previous setup" }).click();
  await expect(dialog.getByLabel("Strategy", { exact: true })).toHaveValue(
    "Replay setup",
  );
  await expect(
    dialog.getByLabel("Entry timeframe", { exact: true }),
  ).toHaveValue("15s");
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
  await page.getByRole("link", { name: "Trades ↓", exact: true }).click();
  await page
    .getByRole("button", { name: "Manage trades", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit strategies & levels" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Strategies", { exact: true })
    .fill("Browser setup\nReplay setup\nMy next model");
  await dialog.getByRole("button", { name: "Save lists" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "My journal", exact: true }).click();
  await page.getByRole("button", { name: "Backup & restore" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download full JSON backup" }).click();
  expect((await download).suggestedFilename()).toBe("primuslab-backup.json");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "My journal", exact: true }).click();
  await page.getByRole("button", { name: "Dark mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: "test-results/primuslab-trades-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "My journal", exact: true }).click();
  await page.getByRole("button", { name: "Light mode", exact: true }).click();
  await page.getByRole("link", { name: "Results", exact: true }).click();
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

test("personal tools use the existing risk calculations without a team login", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole("link", { name: "Team", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "My journal", exact: true }).click();
  await page
    .getByRole("button", { name: "Advanced tools", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tools", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Entry price", { exact: true }).fill("18000");
  await page.getByLabel("Original stop", { exact: true }).fill("17995");
  await page.getByRole("button", { name: "Calculate size" }).click();
  await expect(
    page.locator(".stat").filter({ hasText: "Contracts" }),
  ).toContainText("2");
  await page.getByRole("button", { name: "Open Results" }).click();
  await expect(
    page.getByRole("heading", { name: "Results", exact: true }),
  ).toBeVisible();
});

test("compact navigation and workspace tools remain accessible on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }).getByRole("link"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "My journal", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Backup & restore" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "My journal", exact: true })
    .press("Escape");
  await expect(
    page.getByRole("button", { name: "Backup & restore" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "My journal", exact: true }).click();
  await page.locator(".chart").first().click();
  await expect(
    page.getByRole("button", { name: "Backup & restore" }),
  ).not.toBeVisible();
  await page.getByRole("link", { name: "Trades ↓", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add trade", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByLabel("These trades are…")).not.toBeVisible();
  await page
    .getByText("File options & column mapping", { exact: true })
    .click();
  await expect(page.getByLabel("These trades are…")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.getByRole("link", { name: "Strategy Lab", exact: true }).click();
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
  await page
    .locator(".explorer")
    .getByLabel("Strategy", { exact: true })
    .selectOption("Browser setup");
  await expect(page.locator(".js-plotly-plot")).toHaveCount(1);
  await expect(page.locator(".results-content")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await sources
    .getByRole("button", { name: "Live trading", exact: true })
    .click();
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(1);
  await sources.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(4);
  await page
    .locator(".explorer")
    .getByRole("button", { name: "Reset setup filters" })
    .click();
  await expect(
    page.locator(".explorer").getByLabel("Strategy", { exact: true }),
  ).toHaveValue("All strategies");
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
  const row = page
    .locator(".trade-table tbody tr")
    .filter({ hasText: "FX Replay" })
    .first();
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
    .filter({ hasText: "Live trade" });
  await manual.getByRole("button", { name: /Delete trade/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete trade", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(2);
  await page
    .getByRole("group", { name: "Data source", exact: true })
    .getByRole("button", { name: "Live trading", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Live trading results", exact: true })
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
    await page
      .getByLabel("Choose a trade export")
      .setInputFiles({
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
  await page.getByText("Recognise strategy tags", { exact: true }).click();
  await expect(
    page
      .locator(".tag-map-group")
      .filter({ hasText: "HTF LEVEL 1HR FVG" })
      .getByRole("combobox"),
  ).toHaveCount(2);
  await expect(
    page
      .locator(".tag-map-group")
      .filter({ hasText: "CISD FVG" })
      .getByRole("combobox"),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Save mappings & preview again" })
    .click();
  await page
    .getByRole("button", { name: "Preview trades", exact: true })
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
  await page
    .getByLabel("Update labels on existing trades", { exact: true })
    .check();
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
  await expect(sessions.locator("option")).toHaveCount(7);
  await expect(sessions).toHaveValue("All sessions");
  await page.getByRole("button", { name: "My journal", exact: true }).click();
  await page.getByRole("button", { name: "Lab settings", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Session 1 starts", { exact: true }),
  ).toHaveValue("20:00");
  await expect(
    dialog.getByLabel("Session 6 ends", { exact: true }),
  ).toHaveValue("16:00");
  await dialog
    .getByLabel("Session 4 name", { exact: true })
    .fill("My opening window");
  await dialog
    .getByRole("button", { name: "Save lab settings", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(sessions.locator("option")).toContainText([
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
  await expect(
    page.getByLabel("Session window").locator("option"),
  ).toContainText([
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
