import { observeListeningOutput, expectAudibleListeningOutput } from './fixtures/listening-output';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { readFile } from 'node:fs/promises';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';
import { CURRENT_MUSICALITY_RELEASE } from '../../src/lib/musicality/release';

for(const keyboard of ['piano','organ'] as const)test(`0.17 full Blues develops longer sentences with ${keyboard}`,async({page})=>{
 requireRealtimeAudio(page);test.setTimeout(240_000);
 await observeListeningOutput(page);
 await seedOnboardedAnonymous(page);await page.goto('/musicality');
 await expect(page.getByTestId('listening-release-focus')).toContainText(CURRENT_MUSICALITY_RELEASE.version);
 await page.getByTestId('listening-keyboard').selectOption(keyboard);
 // Pin the 0.17 audition recipe independently of the current release example.
 await page.getByTestId('listening-tune').selectOption('ls-mankunku-blues');
 await page.getByTestId('listening-key').selectOption('F');
 await page.evaluate(()=>{const random=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=((array:ArrayBufferView<ArrayBuffer>)=>{if(array instanceof Uint32Array&&array.length===1){array[0]=3;return array;}return random(array);}) as typeof crypto.getRandomValues;});
 await page.getByTestId('listening-new-arc').click();
 await expect(page.getByTestId('listening-keyboard')).toHaveValue(keyboard);
 await page.getByTestId('listening-play').click();
 await expect(page.getByTestId('listening-status')).toHaveText('Playing',{timeout:90_000});
 const observed=await page.evaluate((keyboard)=>new Promise<{sentences:string[];peaks:number[]}>(resolve=>{
  const sentences=new Set<string>(),peaks=[-60,-60,-60,-60];
  const timer=setInterval(()=>{
   for(const instrument of ['bass','piano','drums'])if(document.querySelector(`[data-testid="musician-${instrument}"]`)?.textContent?.includes('Eight-bar sentence'))sentences.add(instrument);
   for(const [i,label] of ['Bass',keyboard==='organ'?'Organ':'Piano','Drums','Backing'].entries()) {
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
 expect(take.playback.musicalityRelease.version).toBe(CURRENT_MUSICALITY_RELEASE.version);
 expect(take.playback.params.performanceEnergySeed).toBe(3);
 expect(take.playback.provenance.committedBars).toBe(52);
 expect(take.playback.provenance.dispatches.every((d:{status:string})=>d.status==='played')).toBe(true);
 expect(take.playback.provenance.renderTimings).toHaveLength(52);
 expectEveryBarCommittedWithLead(take.playback, 52);
 const generated=take.playback.generated as GeneratedBacking;
 await expectAudibleListeningOutput(page, generated);
 for(const start of [16,28]) {
  const traces=generated.ensembleDevelopment!.pianoMotifs;
  const source=traces.find(t=>t.barIndex>=start&&t.barIndex<=start+2&&t.transform==='statement')!;
  expect(source).toBeTruthy();
  const ending = traces.find(t => t.barIndex === start + 7);
  if (start === 16) {
   // Later releases keep the written chord entrance. The first sentence answers
   // one bar earlier, then its common tones ring into the new harmony.
   expect(traces.find(t => t.barIndex === start + 6)).toMatchObject({ motifId: source.motifId, transform: 'answer' });
   expect(ending).toMatchObject({ sentenceSourceBar: source.barIndex, reason: 'common_tone_entry', transform: 'fallback' });
   const entry = ending!.commonToneEntry!;
   expect(entry.heldNotes.length).toBeGreaterThan(0);
   expect(generated.compEvents).toContainEqual(expect.objectContaining({ time: entry.time, notes: entry.notes }));
  } else {
   expect(ending).toMatchObject({ motifId: source.motifId, transform: 'shorten' });
  }
  expect(generated.ensembleDevelopment!.drumPhrases.find(t=>t.barIndex===start+3)).toMatchObject({phraseLength:8,ride:{phase:'variation'}});
  expect(generated.ensembleDevelopment!.drumPhrases.find(t=>t.barIndex===start+7)).toMatchObject({phraseLength:8,ride:{phase:'release'}});
  for(let bar=start+1;bar<start+8;bar++)expect(generated.compEvents.some(e=>Math.floor(e.absBeat/4)===bar)).toBe(true);
 }
 await page.getByTestId('listening-review').fill('20');
 for(const musician of ['bass','piano','drums']) {
  await expect(page.getByTestId(`musician-${musician}`)).toContainText('Eight-bar sentence');
  await expect(page.getByTestId(`musician-${musician}`)).not.toContainText('undefined');
 }
 await page.getByTestId('listening-review').fill('21');
 await expect(page.getByTestId('musician-bass')).toContainText('G2');
 await expect(page.getByTestId('musician-piano')).toContainText('Voice the new chord around held tones');
 await page.screenshot({path:test.info().outputPath('longer-sentences-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByTestId('listening-release-example')).toBeVisible();
 await page.screenshot({path:test.info().outputPath('longer-sentences-mobile.png'),fullPage:true});
});
