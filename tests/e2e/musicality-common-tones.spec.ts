import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { readFile } from 'node:fs/promises';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

for (const keyboard of ['piano','organ'] as const) test(`0.19 full Blues connects changed harmony with ${keyboard}`, async ({page}, info) => {
 requireRealtimeAudio(page); test.setTimeout(340_000);
 await seedOnboardedAnonymous(page); await page.goto('/musicality');
 await page.getByTestId('listening-keyboard').selectOption(keyboard);
 await page.getByTestId('listening-release-example').click();
 await expect(page.getByTestId('listening-tempo')).toHaveValue('140');
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing',{timeout:90_000});
 const evidence = await page.evaluate((keyboard)=>new Promise<{carry:number;breath:number;peaks:number[]}>(resolve=>{
  const data={carry:0,breath:0,peaks:[-60,-60,-60,-60]};
  const timer=setInterval(()=>{
   const card=document.querySelector('[data-testid="musician-piano"]')?.textContent??'';
   if(card.includes('Carry common tones into the next chord'))data.carry++;
   if(card.includes('Voice the new chord around held tones'))data.breath++;
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
 await info.attach('common-tone-performed-take',{path,contentType:'application/json'});
 await info.attach('common-tone-live-evidence',{body:JSON.stringify(evidence),contentType:'application/json'});
 expect(take.playback.provenance.committedBars).toBe(52);
 expectEveryBarCommittedWithLead(take.playback,52);
 expect(take.playback.provenance.dispatches.every((d:{status:string})=>d.status==='played')).toBe(true);
 const generated=take.playback.generated as GeneratedBacking;
 const carries=generated.compEvents.filter(e=>e.barLineSustain?.version===2);
 expect(carries.length).toBeGreaterThan(0);
 for(const held of carries){
  const boundary=(Math.floor(held.absBeat/4)+1)*4*192;
  const entry=generated.compEvents.filter(e=>parseInt(e.time)>=boundary).sort((a,b)=>parseInt(a.time)-parseInt(b.time))[0];
  expect(parseInt(entry.time)).toBeLessThan(boundary+.15*192);
  for(const attack of generated.compEvents.filter(e=>parseInt(e.time)>=boundary&&parseInt(e.time)<held.barLineSustain!.releaseTick))expect(attack.notes.some(n=>held.notes.includes(n))).toBe(false);
 }

 expect(evidence.carry).toBeGreaterThan(0);expect(evidence.breath).toBeGreaterThan(0);
 for(const peak of evidence.peaks)expect(peak).toBeGreaterThan(-46);
 expect(evidence.peaks[3]).toBeLessThan(0);
 console.log('COMMON_TONE_AUDITION',JSON.stringify({keyboard,evidence,carries:carries.map(e=>({notes:e.notes,bar:Math.floor(e.absBeat/4)+1,beat:e.absBeat%4+1,releaseTick:e.barLineSustain!.releaseTick,duration:e.duration}))}));
 await page.screenshot({path:info.outputPath('common-tone-complete.png'),fullPage:true});
});
