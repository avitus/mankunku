import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';

test.beforeEach(async ({ page }) => { await seedOnboardedAnonymous(page); });

for (const width of [1280, 375]) {
 test(`shared note workspace and score fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({width, height:800});
  await page.goto('/tunes/editor');
  await expect(page.locator('.abcjs-container svg').first()).toBeVisible();
  const entry=page.getByRole('region', {name:'Note entry'});
  await expect(entry.getByRole('button',{name:'C',exact:true})).toHaveCount(1);
  for (const name of ['Whole Note','Half Note','Quarter Note','Eighth Note','Sixteenth Note']) await expect(entry.getByRole('button',{name})).toBeVisible();
  await entry.getByRole('button',{name:'C',exact:true}).click();
  await expect(page.locator('.abcjs-note')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const score=await page.locator('.td-score-well').boundingBox();
  const controls=await entry.boundingBox();
  expect(controls!.y).toBeGreaterThan(score!.y + score!.height);
 });
}

test('non-4/4 preserves chord editing and section setup without melody entry', async ({page})=>{
 await seedTunes(page,[{id:'e2e-waltz',title:'Test Waltz',key:'C',timeSignature:[3,4],tags:[],sections:[{label:'A',bars:8,notes:[],harmony:[]}],source:'user'}]);
 await page.goto('/tunes/editor?edit=e2e-waltz');
 await expect(page.getByRole('textbox',{name:'Tune title'})).toHaveValue('Test Waltz');
 await expect(page.getByRole('region',{name:'Note entry'})).toContainText('melody entry supports 4/4 only');
 await expect(page.getByRole('button',{name:'C',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Update tune',exact:true})).toBeVisible();
 await expect(page.getByLabel('Section 1 label')).toBeVisible();
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
