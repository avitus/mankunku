import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import { readFile } from 'node:fs/promises';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

// Control only the user-facing arc draw; restore native randomness afterwards.
function chooseNextArc(seed:number){
 const original=crypto.getRandomValues.bind(crypto);
 crypto.getRandomValues=function<T extends ArrayBufferView<ArrayBuffer>>(array:T):T {
  if(array instanceof Uint32Array && array.length===1){array[0]=seed;crypto.getRandomValues=original;return array;}
  return original(array);
 };
}
for (const [keyboard,choice] of [['piano',3],['organ',3],['piano',10],['piano','initial']] as const) test(`0.19 full Blues connects changed harmony with ${keyboard}, arc ${choice}`, async ({page}, info) => {
 const seed=choice==='initial'?10:choice;
 requireRealtimeAudio(page); test.setTimeout(340_000);
 await seedOnboardedAnonymous(page);
 if(choice==='initial')await page.addInitScript(chooseNextArc,seed);
 await page.goto('/musicality');
 await page.getByTestId('listening-keyboard').selectOption(keyboard);
 if(choice!=='initial')await page.getByTestId('listening-release-example').click();
 if(choice===10){
  // Make the user-facing random-arc choice reproducible, without replacing
  // audio, transport time or generation. Restore randomness after this click.
  await page.evaluate(chooseNextArc,seed);
  await page.getByTestId('listening-new-arc').click();
 }
 await expect(page.getByTestId('listening-tempo')).toHaveValue('140');
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing',{timeout:90_000});
 const evidence = await page.evaluate((keyboard)=>new Promise<{carry:number;breath:number;peaks:number[];pianoBars:Record<string,number>}>(resolve=>{
  const data={carry:0,breath:0,peaks:[-60,-60,-60,-60],pianoBars:{} as Record<string,number>};
  const timer=setInterval(()=>{
   const card=document.querySelector('[data-testid="musician-piano"]')?.textContent??'';
   if(card.includes('Carry common tones into the next chord'))data.carry++;
   if(card.includes('Voice the new chord around held tones'))data.breath++;
   for(const [i,label] of ['Bass',keyboard==='organ'?'Organ':'Piano','Drums','Master'].entries()){
    const db=Number(document.querySelector(`[role="meter"][aria-label="${label} audio signal"]`)?.getAttribute('aria-valuenow')??-60);
    if(Number.isFinite(db))data.peaks[i]=Math.max(data.peaks[i],db);
    const bar=document.querySelector('[data-testid="musician-piano"]')?.getAttribute('data-bar-index');
    if(i===1 && bar && Number.isFinite(db))data.pianoBars[bar]=Math.max(data.pianoBars[bar]??-60,db);
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
 expect(take.playback.params.performanceEnergySeed).toBe(seed);
 expectEveryBarCommittedWithLead(take.playback,52);
 expect(take.playback.provenance.dispatches.every((d:{status:string})=>d.status==='played')).toBe(true);
 const generated=take.playback.generated as GeneratedBacking;
 const carries=generated.compEvents.filter(e=>e.barLineSustain?.version===2);
 expect(carries.length).toBeGreaterThan(0);
 for(const held of carries){
  const boundary=(Math.floor(held.absBeat/4)+1)*4*192;
  if(keyboard==='piano')expect(held.barLineSustain!.releaseTick-boundary).toBe(192);
  const entry=generated.compEvents.filter(e=>parseInt(e.time)>=boundary).sort((a,b)=>parseInt(a.time)-parseInt(b.time))[0];
  expect(parseInt(entry.time)).toBeLessThan(boundary+.15*192);
  for(const attack of generated.compEvents.filter(e=>parseInt(e.time)>=boundary&&parseInt(e.time)<held.barLineSustain!.releaseTick))expect(attack.notes.some(n=>held.notes.includes(n))).toBe(false);
 }

 expect(evidence.carry).toBeGreaterThan(0);expect(evidence.breath).toBeGreaterThan(0);
 for(const peak of evidence.peaks)expect(peak).toBeGreaterThan(-46);
 // Whole-tune peaks cannot detect a silent middle line. Observe the actual
 // keyboard meter in each of those bars, in every chorus, with all stems on.
 if(keyboard==='piano' && seed!==10)for(const start of [8,20,32,44])for(let bar=start;bar<start+4;bar++)
  expect(evidence.pianoBars[bar],`keyboard signal in performance bar ${bar+1}`).toBeGreaterThan(-46);
 if(seed===10)for(const bar of [20,21,32,33]){
  expect(generated.compEvents.some(e=>Math.floor(e.absBeat/4)===bar)).toBe(true);
  expect(evidence.pianoBars[bar],`restored keyboard signal in performance bar ${bar+1}`).toBeGreaterThan(-46);
 }
 expect(evidence.peaks[3]).toBeLessThan(0);
 console.log('COMMON_TONE_AUDITION',JSON.stringify({keyboard,evidence,carries:carries.map(e=>({notes:e.notes,bar:Math.floor(e.absBeat/4)+1,beat:e.absBeat%4+1,releaseTick:e.barLineSustain!.releaseTick,duration:e.duration}))}));
 await page.screenshot({path:info.outputPath('common-tone-complete.png'),fullPage:true});
});
