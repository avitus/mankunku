import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedStorage, seedUserLicks, SETTINGS_ONBOARDED } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

const phrase = {
 id:'user-studio-dense',name:'A little room to resolve', key:'C',mode:'major',timeSignature:[4,4],
 notes:Array.from({length:32},(_,i)=>({pitch:[60,62,64,65,67,65,64,62][i%8],duration:[1,8],offset:[i,8]})),
 harmony:[{chord:{root:'D',quality:'min7'},scaleId:'minor.dorian',startOffset:[0,1],duration:[1,1]},{chord:{root:'G',quality:'7'},scaleId:'dominant.mixolydian',startOffset:[1,1],duration:[1,1]},{chord:{root:'C',quality:'maj7'},scaleId:'major.ionian',startOffset:[2,1],duration:[2,1]}],
 difficulty:{level:20,pitchComplexity:20,rhythmComplexity:20,lengthBars:4},category:'ii-V-I-major',tags:['bebop'],source:'user-entered'
};
for(const theme of ['dark','light']) for(const width of [1440,390]) {
 test(`detail desk preserves dense notation at ${width}px in ${theme}`,async({page})=>{
  await seedStorage(page,{'settings':{...SETTINGS_ONBOARDED,theme}});
  await seedOnboardedAnonymous(page);await seedUserLicks(page,[phrase]);
  await page.setViewportSize({width,height:1000});await page.goto('/licks/'+phrase.id);
  await expect(page.getByRole('heading',{name:phrase.name,exact:true})).toBeVisible();
  await expect(page.locator('.abcjs-note')).toHaveCount(32);
  await expect(page.locator('.abcjs-staff-wrapper')).toHaveCount(1);
  await expect(page.locator('.abcjs-beam-elem')).toHaveCount(8);
  await expect(page.locator('.abcjs-title')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const before=await page.locator('.ld-score').boundingBox();
  const original=await page.locator('.abcjs-container').innerHTML();
  await page.getByLabel('Play in').selectOption('F');
  await expect(page.getByLabel('Play in')).toHaveValue('F');
  await expect.poll(()=>page.locator('.abcjs-container').innerHTML()).not.toBe(original);
  await expect(page.locator('.abcjs-note')).toHaveCount(32);
  await expect(page.locator('.abcjs-staff-wrapper')).toHaveCount(1);
  await expect(page.locator('.abcjs-beam-elem')).toHaveCount(8);
  expect((await page.locator('.ld-score').boundingBox())!.height).toBeCloseTo(before!.height,0);
  if(width===390)expect(await page.locator('.ld-score').evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);
  await page.getByText('Phrase details',{exact:true}).click();
  await expect(page.getByLabel('Category',{exact:true})).toHaveValue('ii-V-I-major');
  await page.getByText('Phrase details',{exact:true}).click();
  if(theme==='dark') await page.screenshot({path:`/Users/avitus/Documents/Codex/2026-10-10/i-x20/outputs/lick-detail-svelte-${width}.png`,fullPage:true});
 });
}

test('own lick category, practice membership and deletion retain persistence and cancellation',async({page})=>{
 await seedOnboardedAnonymous(page);await seedUserLicks(page,[phrase]);await page.goto('/licks/'+phrase.id);
 await page.getByRole('button',{name:'+ Add to Practice',exact:true}).click();
 await expect(page.getByRole('button',{name:'✓ In Practice Set',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByText('Phrase details',{exact:true}).click();
 await page.getByLabel('Category',{exact:true}).selectOption('blues');
 await page.reload();await page.getByText('Phrase details',{exact:true}).click();
 await expect(page.getByLabel('Category',{exact:true})).toHaveValue('blues');
 await expect(page.getByRole('button',{name:'✓ In Practice Set',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Delete lick',exact:true}).click();
 await page.getByRole('button',{name:'Cancel delete',exact:true}).click();
 await expect(page.getByRole('button',{name:'Confirm Delete',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Edit lick ↗',exact:true}).click();
 await expect(page).toHaveURL(new RegExp('/licks/editor\\?edit='+phrase.id));
 await page.goBack();await page.getByRole('button',{name:'Delete lick',exact:true}).click();
 await page.getByRole('button',{name:'Confirm Delete',exact:true}).click();
 await expect(page).toHaveURL(/\/licks$/);
 expect(await page.evaluate(id=>JSON.parse(localStorage.getItem('mankunku:user-licks')||'[]').some((p:{id:string})=>p.id===id),phrase.id)).toBe(false);
});

test('changing the written key stops the previous audition state',async({page})=>{
 await seedOnboardedAnonymous(page);await seedUserLicks(page,[phrase]);await installAudioMock(page);await stubCdnInstrumentSamples(page);
 await page.goto('/licks/'+phrase.id);
 await page.getByRole('button',{name:'Listen',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
 await page.getByLabel('Play in').selectOption('F');
 await expect(page.getByRole('button',{name:'Listen',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
});
