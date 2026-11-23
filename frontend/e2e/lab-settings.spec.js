import { test, expect } from "@playwright/test";

for (const appearance of ["Modern"]) {
  test(`${appearance}: strategy lists live in the larger Lab settings window`, async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Manage trades", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit strategies & levels", exact: true })).toHaveCount(0);
    await page.getByRole("heading", { name: "Trades", exact: true }).click();
    await page.getByRole("button", { name: "My lab", exact: true }).click();
    await page.locator(".workspace-menu").getByRole("button", { name: "Lab settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Lab settings", exact: true });
    await dialog.getByRole("button", { name: "Setup Labels", exact: true }).click();
    await expect(dialog.getByLabel("Strategies", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Key levels", { exact: true })).toBeVisible();
    expect((await dialog.boundingBox()).width).toBeGreaterThanOrEqual(1000);
    await page.screenshot({ path: testInfo.outputPath(`${appearance}-strategy-settings.png`) });
    const strategies = dialog.getByLabel("Strategies", { exact: true });
    await strategies.fill("Unsaved strategy");
    await page.mouse.click(5, 5);
    const confirmation = page.getByRole("dialog", { name: "Close Lab settings?" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Keep editing" }).click();
    await expect(strategies).toHaveValue("Unsaved strategy");
    await dialog.getByRole("button", { name: "Dynamic Fields", exact: true }).click();
    await dialog.getByRole("button", { name: "Create a saved filter" }).click();
    await page.getByRole("button", { name: "Open saved filters" }).click();
    const editor = page.getByRole("dialog", { name: "Saved setups" });
    await expect(editor.getByLabel("Save setup as")).toBeVisible();
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "My lab", exact: true }).click();
    await page.locator(".workspace-menu").getByRole("button", { name: "Lab settings", exact: true }).click();
    await dialog.getByRole("button", { name: "Setup Labels", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(dialog.getByRole("button", { name: "Save setup labels", exact: true })).toBeVisible();
  });
}

test("tag inputs and dynamic trade fields update Strategy Lab without reloading", async ({ page }) => {
  await page.goto("/");
  const original = await (await page.request.get("/api/metadata")).json();
  const session = await (await page.request.get("/api/session")).json();
  const headers = { "X-Primus-CSRF": session.csrf, Origin: "http://127.0.0.1:8111" };
  let field;
  try {
    await page.getByRole("button", { name: "My lab", exact: true }).click();
    await page.getByRole("button", { name: "Lab settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Lab settings", exact: true });
    const label = dialog.getByLabel("Confirmations / confluence", { exact: true });
    await label.fill("Browser confluence");
    await label.press("Enter");
    await expect(dialog.getByRole("button", { name: "Remove Browser confluence from Confirmations / confluence" })).toBeVisible();
    await dialog.getByRole("button", { name: "Save setup labels" }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "My lab", exact: true }).click();
    await page.getByRole("button", { name: "Lab settings", exact: true }).click();
    await dialog.getByRole("button", { name: "Dynamic Fields" }).click();
    await dialog.getByLabel("Field name").fill("Browser indicator");
    const options = dialog.getByRole("textbox", { name: "Options", exact: true });
    await options.fill("Present");
    await options.press("Enter");
    await expect(options).toHaveValue("");
    await options.fill("Absent");
    await options.press(",");
    await expect(options).toHaveValue("");
    await options.fill("Temporary");
    await options.press("Enter");
    await options.press("Backspace");
    await expect(dialog.getByRole("button", { name: "Remove option Temporary" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Remove option Absent" }).click();
    await expect(options).toBeFocused();
    await options.fill("Absent");
    const creation = page.waitForResponse((response) =>
      response.url().endsWith("/lab-settings/custom-fields") && response.status() === 201);
    await dialog.getByRole("button", { name: "Add trade field" }).click();
    field = await (await creation).json();
    expect(field.options).toEqual(["Present", "Absent"]);
    await expect(dialog.getByText("Browser indicator", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await expect(page.getByRole("combobox", { name: "Browser indicator", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Go to trades", exact: true }).click();
    await page.getByRole("button", { name: "Add trade", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("combobox", { name: "Browser indicator", exact: true })).toBeVisible();
  } finally {
    if (field?.id) await page.request.delete(`/api/lab-settings/custom-fields/${field.id}`, { headers });
    await page.request.put("/api/lab-settings", { headers, data: original.lab_settings });
  }
});
