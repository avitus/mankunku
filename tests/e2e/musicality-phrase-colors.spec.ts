import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { readFile } from 'node:fs/promises';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

test('0.13 full Blues sounds all three phrase colors and shows their actual live decisions',async({page})=>{
 requireRealtimeAudio(page);
 test.setTimeout(240_000);
 await seedOnboardedAnonymous(page);
 await page.addInitScript(()=>{
  const random=crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues=((array:ArrayBufferView<ArrayBuffer>)=>{
   if(array instanceof Uint32Array&&array.length===1){array[0]=2;return array;}
   return random(array);
  }) as typeof crypto.getRandomValues;
 });
 await page.goto('/musicality');
 await expect(page.getByTestId('listening-release-focus')).toContainText('0.15.0');
 await page.getByTestId('listening-style').selectOption('swing');
 await page.getByTestId('listening-keyboard').selectOption('piano');
 await page.getByTestId('listening-tempo').fill('140');
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing',{timeout:90_000});
 const observed=await page.evaluate(()=>new Promise<{labels:string[];peaks:number[]}>(resolve=>{
  const labels=new Set<string>(),peaks=[-60,-60,-60,-60];
  const timer=setInterval(()=>{
   for(const instrument of ['bass','piano','drums']){
    const label=document.querySelector(`[data-testid="musician-${instrument}"] h4`)?.textContent;
    if(label)labels.add(label);
   }
   for(const [i,label] of ['Bass','Piano','Drums','Master'].entries()){
    const db=Number(document.querySelector(`[role="meter"][aria-label="${label} audio signal"]`)?.getAttribute('aria-valuenow')??-60);
    if(Number.isFinite(db))peaks[i]=Math.max(peaks[i],db);
   }
   if(!document.querySelector('[data-testid="listening-stop"]')){clearInterval(timer);resolve({labels:[...labels],peaks});}
  },250);
 }));
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete');
 expect(observed.labels).toEqual(expect.arrayContaining(['Root → seventh','Upper-triad color','Stick hi-hat time']));
 for(const peak of observed.peaks)expect(peak).toBeGreaterThan(-46);
 expect(observed.peaks[3]).toBeLessThan(0);
 await page.locator('details.take-notes > summary').click();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByTestId('listening-export').click()]);
 const path=(await download.path())!;
 const take=JSON.parse(await readFile(path,'utf8'));
 expect(take.playback.musicalityRelease.version).toBe('0.15.0');
 expect(take.playback.provenance.committedBars).toBe(52);
 expect(take.playback.provenance.dispatches.every((d:{status:string})=>d.status==='played')).toBe(true);
 const generated=take.playback.generated as GeneratedBacking;
 for(const [key,card,label] of [['bassEvents','bass','Root → seventh'],['compEvents','piano','Upper-triad color'],['drumEvents','drums','Stick hi-hat time']] as const){
  const event=generated[key].find(e=>key==='drumEvents'?('drum' in e && e.drum==='hihat'&&e.role==='timekeeping'):('phraseColor' in e && e.phraseColor));expect(event).toBeTruthy();
  await page.getByTestId('listening-review').fill(String(Math.floor(event!.absBeat/4)));
  await expect(page.getByTestId(`musician-${card}`)).toContainText(label);
 }
 await page.screenshot({path:test.info().outputPath('phrase-colors-review.png'),fullPage:true});
 await test.info().attach('colors-performed-take',{path,contentType:'application/json'});
 await test.info().attach('colors-live-evidence',{body:JSON.stringify(observed,null,2),contentType:'application/json'});
});
