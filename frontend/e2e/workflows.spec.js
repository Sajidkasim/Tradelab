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

test("manual entry, no page reload, setup graph, and separate results samples", async ({
  page,
}) => {
  const failures = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await open(page);
  const identity = await page.evaluate(() => {
    window.primusTestMarker = "same-document";
    return window.primusTestMarker;
  });
  await page.getByRole("link", { name: "Trades", exact: true }).click();
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
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("link", { name: "Results", exact: true }).click();
  await expect(
    page.locator(".stat").filter({ hasText: "Win rate" }).first(),
  ).toContainText("100.0%");
  await expect(page.locator(".js-plotly-plot")).toBeVisible();
  await page.getByRole("button", { name: "Explore a setup" }).click();
  await expect(
    page.getByRole("heading", { name: "Explore a setup" }),
  ).toBeVisible();
  await page.locator(".explorer").getByLabel("SMT", { exact: true }).check();
  await expect(page.locator(".js-plotly-plot")).toBeVisible();
  await page
    .getByRole("group", { name: "Data source", exact: true })
    .getByRole("button", { name: "All", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Results sample", exact: true })
    .getByRole("button", { name: "Forward testing" })
    .click();
  await expect(
    page.locator(".stat").filter({ hasText: "Trade count" }).first(),
  ).toContainText("0");
  expect(await page.evaluate(() => window.primusTestMarker)).toBe(identity);
  expect(failures).toEqual([]);
});

test("FX Replay preview, confirm, edit and save next, duplicate re-import", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("link", { name: "Trades", exact: true }).click();
  await page
    .getByRole("button", { name: "Import FX Replay", exact: true })
    .click();
  await page
    .getByLabel("Choose a trade export")
    .setInputFiles({
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
  await page.getByRole("button", { name: /Needs tagging/ }).click();
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
    page.getByRole("heading", { name: "Your review queue is clear" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Import FX Replay", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Choose a trade export")
    .setInputFiles({
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
  await page.getByRole("link", { name: "Trades", exact: true }).click();
  await page.getByRole("button", { name: "Edit strategies & levels" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Strategies", { exact: true })
    .fill("Browser setup\nReplay setup\nMy next model");
  await dialog.getByRole("button", { name: "Save lists" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Backup & restore" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download full JSON backup" }).click();
  expect((await download).suggestedFilename()).toBe("primuslab-backup.json");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Dark mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: "test-results/primuslab-trades-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Light mode", exact: true }).click();
  await page.getByRole("link", { name: "Results", exact: true }).click();
  await expect(page.locator(".js-plotly-plot")).toBeVisible();
  await page.screenshot({
    path: "test-results/primuslab-results-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Explore a setup" }).click();
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

test("team invitations and summaries are distinct from private trade journals", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await page.getByRole("button", { name: "Invite teammate" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Their name").fill("Test teammate");
  await dialog
    .getByLabel("Their Google email")
    .fill("browser-teammate@example.com");
  await dialog.getByRole("button", { name: "Allow this teammate" }).click();
  await expect(
    page.getByRole("heading", { name: "Test teammate", exact: true }),
  ).toBeVisible();
  const shared = page.waitForResponse(
    (r) => r.url().endsWith("/api/sharing") && r.status() === 200,
  );
  await page.getByLabel("Share my summary results").check();
  await shared;
  await expect(
    page.getByRole("heading", { name: "Your summary is shared" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Results", exact: true }).click();
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(page.getByLabel("Share my summary results")).toBeChecked();
  await page.getByRole("button", { name: "Pause access" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm pause" })
    .click();
  await expect(page.getByText("Access paused", { exact: true })).toBeVisible();
});
