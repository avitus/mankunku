import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { readFile } from 'node:fs/promises';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';
import { CURRENT_MUSICALITY_RELEASE } from '../../src/lib/musicality/release';

for(const keyboard of ['piano','organ'] as const)test(`0.17 full Blues develops longer sentences with ${keyboard}`,async({page})=>{
 requireRealtimeAudio(page);test.setTimeout(240_000);
 await seedOnboardedAnonymous(page);await page.goto('/musicality');
 await expect(page.getByTestId('listening-release-focus')).toContainText(CURRENT_MUSICALITY_RELEASE.version);
 await page.getByTestId('listening-keyboard').selectOption(keyboard);
 await page.getByTestId('listening-release-example').click();
 await expect(page.getByTestId('listening-keyboard')).toHaveValue(keyboard);
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing',{timeout:90_000});
 const observed=await page.evaluate((keyboard)=>new Promise<{sentences:string[];peaks:number[]}>(resolve=>{
  const sentences=new Set<string>(),peaks=[-60,-60,-60,-60];
  const timer=setInterval(()=>{
   for(const instrument of ['bass','piano','drums'])if(document.querySelector(`[data-testid="musician-${instrument}"]`)?.textContent?.includes('Eight-bar sentence'))sentences.add(instrument);
   for(const [i,label] of ['Bass',keyboard==='organ'?'Organ':'Piano','Drums','Master'].entries()) {
    const db=Number(document.querySelector(`[role="meter"][aria-label="${label} audio signal"]`)?.getAttribute('aria-valuenow')??-60);
    if(Number.isFinite(db))peaks[i]=Math.max(peaks[i],db);
   }
   if(!document.querySelector('[data-testid="listening-stop"]')){clearInterval(timer);resolve({sentences:[...sentences],peaks});}
  },100);
 }),keyboard);
 await page.locator('details.take-notes > summary').click();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByTestId('listening-export').click()]);
 const path=(await download.path())!,take=JSON.parse(await readFile(path,'utf8'));
 await test.info().attach('longer-sentences-performed-take',{path,contentType:'application/json'});
 await test.info().attach('longer-sentences-live-evidence',{body:JSON.stringify(observed,null,2),contentType:'application/json'});
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete');
 expect(observed.sentences.sort()).toEqual(['bass','drums','piano']);
 for(const peak of observed.peaks)expect(peak).toBeGreaterThan(-46);
 expect(observed.peaks[3]).toBeLessThan(0);
 expect(take.playback.musicalityRelease.version).toBe(CURRENT_MUSICALITY_RELEASE.version);
 expect(take.playback.params.performanceEnergySeed).toBe(3);
 expect(take.playback.provenance.committedBars).toBe(52);
 expect(take.playback.provenance.dispatches.every((d:{status:string})=>d.status==='played')).toBe(true);
 expect(take.playback.provenance.renderTimings).toHaveLength(52);
 expect(take.playback.provenance.renderTimings.every((r:{accepted:boolean;renderElapsedSeconds:number})=>r.accepted&&r.renderElapsedSeconds<=.025)).toBe(true);
 const generated=take.playback.generated as GeneratedBacking;
 for(const start of [16,28]) {
  const traces=generated.ensembleDevelopment!.pianoMotifs;
  const source=traces.find(t=>t.barIndex>=start&&t.barIndex<=start+2&&t.transform==='statement')!;
  expect(source).toBeTruthy();
  expect(traces.find(t=>t.barIndex===start+7)).toMatchObject({motifId:source.motifId,transform:'shorten'});
  expect(generated.ensembleDevelopment!.drumPhrases.find(t=>t.barIndex===start+3)).toMatchObject({phraseLength:8,ride:{phase:'variation'}});
  expect(generated.ensembleDevelopment!.drumPhrases.find(t=>t.barIndex===start+7)).toMatchObject({phraseLength:8,ride:{phase:'release'}});
  for(let bar=start+1;bar<start+8;bar++)expect(generated.compEvents.some(e=>Math.floor(e.absBeat/4)===bar)).toBe(true);
 }
 await page.getByTestId('listening-review').fill('21');
 for(const musician of ['bass','piano','drums']) {
  await expect(page.getByTestId(`musician-${musician}`)).toContainText('Eight-bar sentence');
  await expect(page.getByTestId(`musician-${musician}`)).not.toContainText('undefined');
 }
 await expect(page.getByTestId('musician-bass')).toContainText('G2');
 await page.screenshot({path:test.info().outputPath('longer-sentences-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByTestId('listening-release-example')).toBeVisible();
 await page.screenshot({path:test.info().outputPath('longer-sentences-mobile.png'),fullPage:true});
});
