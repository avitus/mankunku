import { taggedAttackPeaks } from './fixtures/tagged-attack-audio';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { readFile } from 'node:fs/promises';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

for(const keyboard of ['piano','organ'] as const)test(`0.16 full Blues with ${keyboard} sounds all three inner-motion gestures and shows their actual live decisions`,async({page})=>{
 requireRealtimeAudio(page);
 test.setTimeout(240_000);
 await seedOnboardedAnonymous(page);
 await page.goto('/musicality');
 await expect(page.getByTestId('listening-release-focus')).toContainText('0.16.1');
 await page.getByTestId('listening-keyboard').selectOption(keyboard);
 await page.getByTestId('listening-release-example').click();
 await expect(page.getByTestId('listening-keyboard')).toHaveValue(keyboard);
 await expect(page.getByTestId('listening-style')).toHaveValue('swing');
 await expect(page.getByTestId('listening-tempo')).toHaveValue('140');
 await expect(page.getByTestId('listening-choruses')).toHaveValue('2');
 await expect(page.getByTestId('listening-stop')).toHaveCount(0);
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing',{timeout:90_000});
 await expect(page.getByTestId('listening-release-example')).toBeDisabled();
 const observed=await page.evaluate((keyboard)=>new Promise<{labels:string[];peaks:number[]}>(resolve=>{
  const labels=new Set<string>(),peaks=[-60,-60,-60,-60];
  const timer=setInterval(()=>{
   for(const instrument of ['bass','piano','drums']){
    const label=document.querySelector(`[data-testid="musician-${instrument}"] h4`)?.textContent;
    if(label)labels.add(label);
   }
   for(const [i,label] of ['Bass',keyboard==='organ'?'Organ':'Piano','Drums','Master'].entries()){
    const db=Number(document.querySelector(`[role="meter"][aria-label="${label} audio signal"]`)?.getAttribute('aria-valuenow')??-60);
    if(Number.isFinite(db))peaks[i]=Math.max(peaks[i],db);
   }
   if(!document.querySelector('[data-testid="listening-stop"]')){clearInterval(timer);resolve({labels:[...labels],peaks});}
  },250);
 }),keyboard);

 for(const peak of observed.peaks)expect(peak).toBeGreaterThan(-46);
 expect(observed.peaks[3]).toBeLessThan(0);
 await page.locator('details.take-notes > summary').click();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByTestId('listening-export').click()]);
 const path=(await download.path())!;
 const take=JSON.parse(await readFile(path,'utf8'));
 await test.info().attach('inner-motion-performed-take',{path,contentType:'application/json'});
 await test.info().attach('inner-motion-live-evidence',{body:JSON.stringify(observed,null,2),contentType:'application/json'});
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete');
 expect(take.playback.musicalityRelease.version).toBe('0.16.1');
 expect(take.playback.params.performanceEnergySeed).toBe(256);
 expect(take.playback.provenance.committedBars).toBe(52);
 expect(take.playback.provenance.dispatches.every((d:{status:string})=>d.status==='played')).toBe(true);
 expectEveryBarCommittedWithLead(take.playback,52);

 for(const label of ['Walk through the ninth','Resolve an inner voice','Lift the foot hi-hat'])expect(observed.labels).toContain(label);
 const generated=take.playback.generated as GeneratedBacking;
 for(const [key,card,label] of [['bassEvents','bass','Walk through the ninth'],['compEvents','piano','Resolve an inner voice'],['drumEvents','drums','Lift the foot hi-hat']] as const){
  const event=generated[key].find(e=>e.innerMotion);expect(event).toBeTruthy();
  await page.getByTestId('listening-review').fill(String(Math.floor(event!.absBeat/4)));
  await expect(page.getByTestId(`musician-${card}`)).toContainText(label);
 }
 await page.screenshot({path:test.info().outputPath('inner-motion-review.png'),fullPage:true});
 const isolated = await taggedAttackPeaks(page, generated, 'innerMotion', keyboard);
 await test.info().attach('isolated-tagged-attack-peaks', { body: JSON.stringify(isolated), contentType: 'application/json' });
 for (const peak of isolated) expect(peak, 'accepted tagged attack must produce isolated audio').toBeGreaterThan(.001);

});
