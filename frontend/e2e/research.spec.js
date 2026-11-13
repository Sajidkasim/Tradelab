import { pick, options, expectValue } from "./select-helpers";
import { test, expect } from "@playwright/test";

test("risk review and saved setups preserve existing experiment data without test controls", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Results", exact: true }),
  ).toBeVisible();
  const identity = await (await page.request.get("/api/session")).json();
  const headers = {
    Origin: "http://127.0.0.1:8111",
    "X-Primus-CSRF": identity.csrf,
  };
  const original = await (await page.request.get("/api/export/backup")).body();
  try {
    const metadata = await (await page.request.get("/api/metadata")).json();
    await page.request.put("/api/lab-settings", {
      headers,
      data: {
        ...metadata.lab_settings,
        confirmations: ["SMT", "Second sweep", "Second Sweep"],
      },
    });
    await page.request.put("/api/tag-mappings", {
      headers,
      data: {
        "SWEEP UPPER": { field: "confirmation", value: "Second Sweep" },
        "SWEEP LOWER": { field: "confirmation", value: "Second sweep" },
      },
    });
    await page.reload();
    const experiment = await page.request.post("/api/studies", {
      headers,
      data: {
        name: "Existing legacy experiment",
        strategy: "Research reversal",
        target_rr: "1:3",
        rules: "Original saved rules",
      },
    });
    expect(experiment.ok()).toBe(true);
    const testId = (await experiment.json()).id;
    await page.reload();
    await expect(
      page.getByRole("button", { name: "My tests", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Research test", { exact: true })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(
      page.getByLabel("Import into test", { exact: true }),
    ).toHaveCount(0);
    let dialog;
    const csv = `id,dateStart,dateEnd,pair,rPnL,side,status,strategy,tags\nresearch-a,2026-07-02 13:30,2026-07-02 13:45,NQ,300,buy,closed,Research reversal,SWEEP UPPER\nresearch-b,2026-07-01 13:30,2026-07-01 13:45,NQ,-100,sell,closed,Research reversal,SWEEP LOWER\n`;
    await page.getByLabel("Choose a trade export").setInputFiles({
      name: "research.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page
      .getByRole("button", { name: "Preview trades", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Import 2 trades", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(page).toHaveURL(/#trades$/);
    const imported = await (await page.request.get("/api/trades")).json();
    expect(
      (
        await page.request.post("/api/study-assignment", {
          headers,
          data: { ids: imported.map((row) => row.id), study_id: testId },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await page
      .getByRole("button", { name: "Go to trades", exact: true })
      .click();
    await expect(page.locator(".trade-table tbody tr")).toHaveCount(2);
    await page
      .locator(".trade-table tbody tr")
      .first()
      .getByRole("button", { name: "Add original risk", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Review trade", exact: true });
    await expect(
      dialog.getByLabel("Original risk ($)", { exact: true }),
    ).toBeFocused();
    await dialog.getByLabel("Original risk ($)", { exact: true }).fill("100");
    await dialog
      .getByLabel("I have checked the confirmations for this trade")
      .check();
    await dialog
      .getByRole("button", { name: "Save & next", exact: true })
      .click();
    // Wait for the next trade to replace the submitted form before editing it.
    await expectValue(
      dialog.getByLabel("Original risk ($)", { exact: true }),
      "",
    );
    await dialog
      .getByLabel("Original risk is not available — keep R unrecorded", {
        exact: true,
      })
      .check();
    await dialog
      .getByLabel("I have checked the confirmations for this trade")
      .check();
    await dialog
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "To finish · 0", exact: true }),
    ).toBeVisible();
    const before = await (await page.request.get("/api/trades")).json();
    expect(
      before.find((row) => row.external_id === "research-a").r_multiple,
    ).toBe(3);
    expect(
      before.find((row) => row.external_id === "research-b").r_multiple,
    ).toBe(null);
    await pick(
      page.locator(".explorer").getByLabel("Strategy", { exact: true }),
      "Research reversal",
    );
    await page.locator(".explorer").getByLabel("SMT", { exact: true }).check();
    await page
      .getByRole("button", { name: "Save current setup", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Saved setups", exact: true });
    await dialog
      .getByLabel("Save setup as", { exact: true })
      .fill("Reversal + SMT");
    await dialog
      .getByRole("button", { name: "Save these filters", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await page
      .locator(".explorer")
      .getByLabel("SMT", { exact: true })
      .uncheck();
    const saved = await (await page.request.get("/api/metadata")).json();
    await pick(
      page.getByLabel("Saved setup", { exact: true }),
      saved.saved_setups[0].id,
    );
    await expect(
      page.locator(".explorer").getByLabel("SMT", { exact: true }),
    ).toBeChecked();
    await page.getByRole("button", { name: "My lab", exact: true }).click();
    await page
      .getByRole("button", { name: "Lab settings", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Lab settings", exact: true });
    await dialog
      .getByRole("button", { name: "Maintenance", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Second sweep / Second Sweep", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Preview label change", exact: true })
      .click();
    await expect(dialog.locator(".cleanup-preview")).toContainText(
      "1 saved trades",
    );
    expect(await (await page.request.get("/api/trades")).json()).toEqual(
      before,
    );
    await dialog
      .getByRole("button", { name: "Apply label change", exact: true })
      .click();
    await expect(dialog.locator(".cleanup-preview")).toHaveCount(0);
    await expect(
      dialog.getByRole("heading", {
        name: "Keep your tags consistent",
        exact: true,
      }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    const after = await (await page.request.get("/api/trades")).json();
    for (const row of after) {
      const previous = before.find((item) => item.id === row.id);
      for (const key of [
        "net_pnl",
        "initial_risk",
        "r_multiple",
        "notes",
        "study_id",
      ])
        expect(row[key]).toEqual(previous[key]);
      expect(row.labels.confirmations).toContain("Second sweep");
      expect(row.labels.confirmations).not.toContain("Second Sweep");
    }
    await page.reload();
    await expect(page.getByLabel("Saved setup", { exact: true })).toBeVisible();
    await page.screenshot({
      path: "test-results/research-results-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "My lab", exact: true }).click();
    await page
      .getByRole("button", { name: "Lab settings", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Lab settings", exact: true }),
    ).toBeVisible();
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/research-tests-mobile.png",
      fullPage: true,
    });
  } finally {
    const snapshot = await (
      await page.request.post("/api/trades/deletion-preview", { headers })
    ).json();
    if (snapshot.count)
      await page.request.delete("/api/trades", {
        headers,
        data: {
          confirmation_count: snapshot.count,
          preview_token: snapshot.preview_token,
        },
      });
    const restored = await page.request.post("/api/restore", {
      headers,
      multipart: {
        file: {
          name: "original.json",
          mimeType: "application/json",
          buffer: original,
        },
      },
    });
    expect(restored.ok()).toBe(true);
  }
});
