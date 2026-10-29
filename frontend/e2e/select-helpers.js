import { expect } from "@playwright/test";

export async function options(control) {
  control = control.first();
  if ((await control.getAttribute("aria-expanded")) !== "true")
    await control.click();
  return control.page().getByRole("option");
}
export async function pick(control, value) {
  const rows = await options(control);
  const values = await rows.evaluateAll((items) =>
    items.map((item) => item.dataset.value),
  );
  const index = values.indexOf(String(value));
  expect(index, `Dropdown option ${value}`).toBeGreaterThanOrEqual(0);
  await rows.nth(index).click();
}
export async function expectValue(control, value) {
  control = control.first();
  await expect
    .poll(() =>
      control.evaluate((element) => element.dataset.value ?? element.value),
    )
    .toBe(String(value));
}
