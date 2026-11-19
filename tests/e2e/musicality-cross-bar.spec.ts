import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { readFile } from 'node:fs/promises';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

for (const keyboard of ['piano','organ'] as const) test(`0.18 full Rhythm Changes carries ${keyboard} across bridge bar lines`, async ({page}, info) => {
 requireRealtimeAudio(page); test.setTimeout(340_000);
 await seedOnboardedAnonymous(page); await page.goto('/musicality');
 await page.getByTestId('listening-keyboard').selectOption(keyboard);
 await page.getByTestId('listening-tune').selectOption('ls-rhythm-changes');
 await page.getByTestId('listening-key').selectOption('Bb');
 await page.getByTestId('listening-tempo').fill('160');
 await page.evaluate(()=>{const random=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=((a:ArrayBufferView<ArrayBuffer>)=>{if(a instanceof Uint32Array&&a.length===1){a[0]=3;return a;}return random(a);}) as typeof crypto.getRandomValues;});
 await page.getByTestId('listening-new-arc').click();
 await expect(page.getByTestId('listening-tempo')).toHaveValue('160');
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing',{timeout:90_000});
 const evidence = await page.evaluate((keyboard)=>new Promise<{carry:number;breath:number;peaks:number[]}>(resolve=>{
  const data={carry:0,breath:0,peaks:[-60,-60,-60,-60]};
  const timer=setInterval(()=>{
   const card=document.querySelector('[data-testid="musician-piano"]')?.textContent??'';
   if(card.includes('Carry harmony across the bar line'))data.carry++;
   if(card.includes('Breathe over the held harmony'))data.breath++;
   for(const [i,label] of ['Bass',keyboard==='organ'?'Organ':'Piano','Drums','Master'].entries()){
    const db=Number(document.querySelector(`[role="meter"][aria-label="${label} audio signal"]`)?.getAttribute('aria-valuenow')??-60);
    if(Number.isFinite(db))data.peaks[i]=Math.max(data.peaks[i],db);
   }
   if(!document.querySelector('[data-testid="listening-stop"]')){clearInterval(timer);resolve(data);}
  },100);
 }),keyboard);
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete');
 await page.locator('details.take-notes > summary').click();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByTestId('listening-export').click()]);
 const path=(await download.path())!,take=JSON.parse(await readFile(path,'utf8'));
 await info.attach('cross-bar-performed-take',{path,contentType:'application/json'});
 await info.attach('cross-bar-live-evidence',{body:JSON.stringify(evidence),contentType:'application/json'});
 expect(take.playback.provenance.committedBars).toBe(128);
 expectEveryBarCommittedWithLead(take.playback,128);
 expect(take.playback.provenance.dispatches.every((d:{status:string})=>d.status==='played')).toBe(true);
 const generated=take.playback.generated as GeneratedBacking;
 const carries=generated.compEvents.filter(e=>e.barLineSustain);
 expect(carries.length).toBeGreaterThan(0);
 expect(evidence.carry).toBeGreaterThan(0);expect(evidence.breath).toBeGreaterThan(0);
 for(const peak of evidence.peaks)expect(peak).toBeGreaterThan(-46);
 expect(evidence.peaks[3]).toBeLessThan(0);
 console.log('CROSS_BAR_AUDITION',JSON.stringify({keyboard,evidence,carries:carries.map(e=>({bar:Math.floor(e.absBeat/4)+1,beat:e.absBeat%4+1,releaseTick:e.barLineSustain!.releaseTick,duration:e.duration}))}));
 await page.screenshot({path:info.outputPath('cross-bar-complete.png'),fullPage:true});
});
