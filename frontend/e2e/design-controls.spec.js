import { pick, options, expectValue } from "./select-helpers";
import { test, expect } from "@playwright/test";

test("Explore supports searchable levels, keyboard choices and removable filters in both themes", async ({
  page,
}) => {
  await page.goto("/");
  const explorer = page.locator(".explorer");
  const compact = await explorer.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    checkbox: el.querySelector('input[type="checkbox"]').getBoundingClientRect()
      .height,
  }));
  expect(compact.height).toBeLessThanOrEqual(860);
  expect(compact.checkbox).toBeLessThanOrEqual(20);

  const picker = explorer.getByRole("button", { name: /Key level \/ PDA/ });
  await picker.click();
  const search = page.getByRole("combobox", {
    name: "Search key level / pda",
    exact: true,
  });
  await search.fill("zz-no-level");
  await expect(page.getByText("No matching options.")).toBeVisible();
  await search.fill("FVG");
  await search.press("Enter");
  await expect(
    page.getByRole("button", { name: "Remove level filter", exact: true }),
  ).toBeVisible();
  await expect(picker).toBeFocused();
  await picker.click();
  await search.press("Escape");
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  const timeframe = explorer.getByLabel("Key level timeframe", { exact: true });
  await pick(timeframe, "1H");
  await expectValue(timeframe, "1H");
  await page
    .getByRole("button", { name: "Remove level tf filter", exact: true })
    .click();
  await expectValue(timeframe, "Any timeframe");
  const order = await explorer.evaluate((el) =>
    Array.from(el.children).map((child) => child.textContent),
  );
  const entry = order.findIndex((text) => text.startsWith("Entry timeframe"));
  expect(order[entry + 1]).toContain("Confirmations");
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove level filter", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page.getByRole("button", { name: "Dark mode", exact: true }).click();
  await picker.click();
  await expect(search).toBeVisible();
  await search.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await picker.click();
  await expect(search).toBeVisible();
  await search.press("Escape");
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page.getByRole("button", { name: "Light mode", exact: true }).click();
});
