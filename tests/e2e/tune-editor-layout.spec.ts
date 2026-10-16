import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';

test.beforeEach(async ({ page }) => { await seedOnboardedAnonymous(page); });

for (const width of [1280, 375, 320]) {
 test(`shared note workspace and score fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({width, height:800});
  await page.goto('/tunes/editor');
  await expect(page.locator('.abcjs-container svg').first()).toBeVisible();
  const entry=page.getByRole('region', {name:'Note entry'});
  if (width <= 800) await entry.getByRole('button', {name:'Open note entry'}).click();
  await expect(entry.getByRole('button',{name:'C',exact:true})).toHaveCount(1);
  for (const name of ['Whole Note','Half Note','Quarter Note','Eighth Note','Sixteenth Note']) await expect(entry.getByRole('button',{name})).toBeVisible();
  await entry.getByRole('button',{name:'C',exact:true}).click();
  await expect(page.locator('.abcjs-note')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const score=await page.locator('.td-score-well').boundingBox();
  const controls=await entry.boundingBox();
  if (width > 800) expect(controls!.x).toBeGreaterThan(score!.x + score!.width);
  else {
   expect(controls!.y).toBeGreaterThanOrEqual(0);
   expect(controls!.y + controls!.height).toBeLessThanOrEqual(800);
   await entry.getByRole('button', {name:'Close note entry'}).click();
   await expect(entry.getByRole('button', {name:'C',exact:true})).toBeHidden();
  }
 });
}

test('non-4/4 preserves chord editing and section setup without melody entry', async ({page})=>{
 await seedTunes(page,[{id:'e2e-waltz',title:'Test Waltz',key:'C',timeSignature:[3,4],tags:[],sections:[{label:'A',bars:8,notes:[],harmony:[]}],source:'user'}]);
 await page.goto('/tunes/editor?edit=e2e-waltz');
 await expect(page.getByRole('textbox',{name:'Tune title'})).toHaveValue('Test Waltz');
 await expect(page.getByRole('region',{name:'Note entry'})).toContainText('melody entry supports 4/4 only');
 await expect(page.getByRole('button',{name:'C',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Update tune',exact:true})).toBeVisible();
 await page.getByRole('button', {name:'Edit form'}).click();
 await expect(page.getByLabel('Section 1 label')).toBeVisible();
 await page.getByRole('button', {name:'Done',exact:true}).click();
 await page.locator('[data-chord-pos="0:0:0"]').click();
 await page.getByTestId('chord-input').fill('G7');
 await page.getByTestId('chord-input').press('Enter');
 await expect(page.locator('.abcjs-container svg text').filter({hasText:'G7'}).first()).toBeVisible();
});

test('undo and redo preserve notes, composer and the original tune identity',async({page})=>{
 await seedTunes(page);
 await page.goto('/tunes/editor?edit=e2e-user-sheet-1');
 await expect(page.getByRole('textbox',{name:'Tune title'})).toHaveValue('Test Session Tune');
 const composer=page.getByRole('textbox',{name:'Composer'});
 await expect(page.locator('.abcjs-note')).toHaveCount(4);
 const notes=4;
 await composer.fill('A new credit');
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(composer).toHaveValue('E2E');
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 await expect(composer).toHaveValue('A new credit');
 await expect(page.locator('.abcjs-note')).toHaveCount(notes);
 await page.getByRole('button',{name:'Update tune',exact:true}).click();
 await page.waitForURL('**/tunes/test-session-tune');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mankunku:user-tunes')||'[]'));
 expect(saved).toHaveLength(1);expect(saved[0].id).toBe('e2e-user-sheet-1');expect(saved[0].composer).toBe('A new credit');
});

test('editing a curated copy leaves the original intact and creates a new user tune',async({page})=>{
 await page.goto('/tunes/ls-when-the-saints');
 await expect(page.locator('.abcjs-container svg').first()).toBeVisible();
 await page.getByRole('button',{name:'Edit a copy',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Tune title'})).toHaveValue('When the Saints Go Marching In');
 await page.getByRole('textbox',{name:'Tune title'}).fill('Saints arrangement');
 await page.getByRole('button',{name:'Save tune',exact:true}).click();
 await page.waitForURL('**/tunes/saints-arrangement');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mankunku:user-tunes')||'[]'));
 expect(saved).toHaveLength(1);expect(saved[0].id).not.toBe('ls-when-the-saints');
 await page.goto('/tunes/ls-when-the-saints');
 await expect(page.getByRole('heading',{name:'When the Saints Go Marching In',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Edit a copy',exact:true})).toBeVisible();
});


test('a dense 32-bar score keeps four bars per line and its entry controls in reach', async ({ page }) => {
 await page.setViewportSize({ width: 1280, height: 800 });
 await seedTunes(page, [{
  id: 'e2e-long-chart', title: 'Long chart', key: 'C', timeSignature: [4, 4], tags: [], source: 'user',
  sections: ['A', 'B', 'C', 'D'].map(label => ({
   label, bars: 8, harmony: [],
   notes: Array.from({ length: 64 }, (_, i) => ({ pitch: 48 + i % 8, duration: [1, 8], offset: [i, 8] }))
  }))
 }]);
 await page.goto('/tunes/editor?edit=e2e-long-chart');
 await expect(page.locator('.abcjs-note')).toHaveCount(256);
 const systems = await page.locator('.abcjs-staff-wrapper').evaluateAll(nodes => nodes.map(node => node.querySelectorAll('[data-bar-pos]').length));
 expect(systems).toEqual(Array(8).fill(4));
 const rail = page.getByTestId('entry-rail');
 await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'D 8 bars' }).click();
 await expect(rail).toContainText('Section D · Bar 1, Beat 1');
 await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
 for (const name of ['Quarter Note', 'C', 'Delete selected or last note']) {
  const box = await rail.getByRole('button', { name, exact: true }).boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(800);
 }
 // The pinned controls still edit the selected late section, preserving all other notes.
 await page.locator('.abcjs-note').last().locator('.abcjs-notehead').click();
 await rail.getByRole('button', { name: 'Delete selected or last note' }).click();
 await expect(page.locator('.abcjs-note')).toHaveCount(255);
});

test('settings and form dialogs suspend musical keyboard shortcuts', async ({ page }) => {
 await page.goto('/tunes/editor');
 await expect(page.locator('.abcjs-container svg').first()).toBeVisible();
 for (const opener of ['Tune settings', 'Edit form']) {
  await page.getByRole('button', { name: opener, exact: opener === 'Tune settings' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).focus();
  await page.keyboard.press('c');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.abcjs-note')).toHaveCount(0);
 }
 await page.keyboard.press('c');
 await expect(page.locator('.abcjs-note')).toHaveCount(1);
});
