import { test, expect } from "./fixtures/test";
import { createStubCloud, installStubCloud } from "./fixtures/stub-cloud";
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

// CodeRabbit on #306: a signed-in device that mounts before its cloud licks
// arrive must not Steal a second copy of an excerpt the cloud already holds.
test('Steal waits for cloud hydration before checking for an earlier copy', async ({ page, baseURL }) => {
 await installStubCloud(page.context(), createStubCloud(), { id: 'aaaaaaaa-0000-4000-8000-000000000306', email: 'steal@e2e.dev' }, baseURL as string);
 await seedOnboardedAnonymous(page);
 let release!: () => void;
 const held = new Promise<void>(resolve => { release = resolve; });
 let requested = false;
 // A page route runs before the context's stub cloud; fallback hands it on.
 await page.route('**/rest/v1/user_licks**', async route => {
  if (route.request().method() === 'GET') {
   requested = true;
   await held;
  }
  await route.fallback();
 });
 try {
  await page.goto('/lickbrowser');
  const first = page.locator('article').first();
  await expect(first).toBeVisible({ timeout: 30000 });
  await expect.poll(() => requested).toBe(true);
  await expect(first.getByRole('button', { name: 'Steal', exact: true })).toBeDisabled();
 } finally {
  release();
 }
 await expect(page.locator('article').first().getByRole('button', { name: 'Steal', exact: true })).toBeEnabled();
});

test('A copy stolen on another device reads Stolen once its cloud licks arrive, even after a failed read', async ({ page, baseURL, browser }) => {
 const cloud = createStubCloud();
 const user = { id: 'aaaaaaaa-0000-4000-8000-000000000307', email: 'steal-twice@e2e.dev' };
 // Device A steals the first excerpt; the copy reaches the shared cloud.
 await installStubCloud(page.context(), cloud, user, baseURL as string);
 await seedOnboardedAnonymous(page);
 await page.goto('/lickbrowser');
 const firstA = page.locator('article').first();
 await expect(firstA).toBeVisible({ timeout: 30000 });
 const name = await firstA.getByRole('heading').innerText();
 await firstA.getByRole('button', { name: 'Steal', exact: true }).click();
 await expect(firstA.getByRole('button', { name: 'Stolen', exact: true })).toBeDisabled();
 await expect.poll(() => cloud.rows('user_licks').some(row =>
  (row.tags as string[] | undefined)?.some(tag => tag.startsWith('wjazzd:'))), { timeout: 15000 }).toBe(true);

 // Device B: same account, nothing local, its cloud read held back.
 const contextB = await browser.newContext({ baseURL });
 const pageB = await contextB.newPage();
 const errors: string[] = [];
 pageB.on('console', msg => {
  if (msg.type() !== 'error') return;
  // The browser reports each read the test refuses; that one resource only.
  if (msg.location().url.includes('/rest/v1/user_licks') && msg.text().includes('500')) return;
  errors.push(`${msg.text()} (${msg.location().url})`);
 });
 pageB.on('pageerror', err => errors.push(err.message));
 try {
  await installStubCloud(contextB, cloud, user, baseURL as string);
  await seedOnboardedAnonymous(pageB);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  // hold → the read is pending; fail → it errors; pass → the stub cloud answers.
  let mode: 'hold' | 'fail' | 'pass' = 'hold';
  await pageB.route('**/rest/v1/user_licks**', async route => {
   if (route.request().method() === 'GET') {
    requested = true;
    if (mode === 'hold') await held;
    if (mode === 'fail') {
     await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'unavailable' }) });
     return;
    }
   }
   await route.fallback();
  });
  await pageB.goto('/lickbrowser');
  const firstB = pageB.locator('article').first();
  await expect(firstB).toBeVisible({ timeout: 30000 });
  await expect(firstB.getByRole('heading')).toHaveText(name);
  await expect.poll(() => requested).toBe(true);
  await expect(firstB.getByRole('button', { name: 'Steal', exact: true })).toBeDisabled();
  // The read fails: Steal stays paused rather than trusting an empty local book.
  mode = 'fail';
  release();
  await expect(pageB.getByRole('alert').filter({ hasText: 'Steal is paused' })).toBeVisible();
  await expect(firstB.getByRole('button', { name: 'Steal', exact: true })).toBeDisabled();
  // The cloud recovers: a retry finds device A's copy.
  mode = 'pass';
  await pageB.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(firstB.getByRole('button', { name: 'Stolen', exact: true })).toBeDisabled();
  await expect(pageB.getByRole('alert').filter({ hasText: 'Steal is paused' })).toHaveCount(0);
  expect(cloud.rows('user_licks').filter(row => !row.deleted_at)).toHaveLength(1);
  expect(errors, errors.join('\n')).toEqual([]);
 } finally {
  await contextB.close();
 }
});
