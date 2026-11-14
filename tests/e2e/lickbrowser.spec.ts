import { test, expect } from "./fixtures/test";
import { seedOnboardedAnonymous } from "./fixtures/storage";
test("Chord browser renders native scores and selects supported progressions", async ({
  page,
}) => {
  await seedOnboardedAnonymous(page);
  await page.goto("/lickbrowser");
  await expect(
    page.getByRole("heading", { name: "Lick browser" }),
  ).toBeVisible();
  await expect(page.locator("article").first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator("article svg").first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("lickbrowser.png"), fullPage: false });
  const selector=page.getByLabel("Progression",{exact:true});
  await expect(selector.locator('option')).toHaveCount(12);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await selector.selectOption('minor-vamp');
  await expect(page.locator('article').first()).toBeVisible();
  await expect(selector).toHaveValue('minor-vamp');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
