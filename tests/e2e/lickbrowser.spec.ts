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

test('Steal adds a persistent personal lick and prevents duplicate copies',async({page})=>{
 await seedOnboardedAnonymous(page);
 await page.goto('/lickbrowser');
 const first=page.locator('article').first();
 await expect(first).toBeVisible({timeout:30000});
 const name=await first.getByRole('heading').innerText();
 await first.getByRole('button',{name:'Steal',exact:true}).click();
 await expect(first.getByRole('button',{name:'Stolen',exact:true})).toBeDisabled();
 await expect(page.getByRole('link',{name:'View lick',exact:true})).toBeVisible();
 await page.reload();
 await expect(page.locator('article').first().getByRole('button',{name:'Stolen',exact:true})).toBeDisabled({timeout:30000});
 await page.goto('/licks');
 await expect(page.getByText(name,{exact:false}).first()).toBeVisible({timeout:30000});
});

for (const [reference, count] of [['1-63', 11], ['1-96', 12]] as const) {
test(`WJD ${reference} engraves its eighth-note line`, async ({ page }) => {
  await seedOnboardedAnonymous(page);
  await page.goto('/lickbrowser');
  await expect(page.locator('article').first()).toBeVisible({ timeout: 30000 });
  await page.getByLabel(/^Artist/).selectOption('Art Pepper');
  await page.getByLabel('Progression', { exact: true }).selectOption('ii-V-I-major');
  const lick = page.locator('article').filter({ has: page.getByText(`Ref: WJD ${reference}`, { exact: true }) });
  for (let batch = 0; batch < 10 && await lick.count() === 0; batch++) {
    await page.getByRole('button', { name: 'Show more', exact: true }).click();
  }
  await expect(lick.locator('.abcjs-note')).toHaveCount(count);
  await expect(lick.locator('.abcjs-note.abcjs-d0-125')).toHaveCount(count);
  await lick.screenshot({ path: test.info().outputPath(`wjd-${reference}-eighths.png`) });
});
}
