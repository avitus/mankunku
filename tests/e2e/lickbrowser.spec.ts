import { test, expect } from "./fixtures/test";
import { seedOnboardedAnonymous } from "./fixtures/storage";
test("Chord browser renders native scores and rejects invalid input", async ({
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
  await page.getByLabel("Chords · Concert pitch").fill("Not a chord");
  await page.getByRole("button", { name: "Find licks", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not read");
  await expect(page.locator("article")).toHaveCount(0);
});
