import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { readFile } from 'node:fs/promises';
import { expectEveryBarCommittedWithLead } from './fixtures/rolling-lead';

// These seeds exercise the WebKit late-take spikes captured in 0.16. Each test
// gets a fresh browser context and must complete without a retry. The spikes
// are 15–30 ms pauses a few times a take (bars ~22, ~39, ~48), not slow music:
// CI's nine stopped takes of 2026-11-12 each had 335–381 ms of lead left. A bar
// is therefore held to the lead it left, not to a 25 ms generation time.
for (const seed of [243, 7, 9, 256]) for (const keyboard of ['piano', 'organ'] as const)
test(`completes 52-bar ${keyboard} take with seed ${seed}`, async ({ page, browserName }) => {
 test.skip(browserName !== 'webkit', 'WebKit-specific budget regression; other engines have full-tune coverage.');
 requireRealtimeAudio(page);
 test.setTimeout(240_000);
 await seedOnboardedAnonymous(page);
 await page.addInitScript((seed)=>{
  const random=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=((a:ArrayBufferView<ArrayBuffer>)=>{if(a instanceof Uint32Array&&a.length===1){a[0]=seed;return a;}return random(a);}) as typeof crypto.getRandomValues;
 },seed);
 await page.goto('/musicality');
 await expect(page.getByTestId('listening-release-focus')).toContainText('0.16.1');
 await page.getByTestId('listening-keyboard').selectOption(keyboard);
 await page.getByTestId('listening-style').selectOption('swing');
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
 await test.info().attach('webkit-reliability-performed-take',{path,contentType:'application/json'});
 await test.info().attach('webkit-reliability-live-evidence',{body:JSON.stringify(observed,null,2),contentType:'application/json'});
 // Export before asserting, so a stopped take retains the rejected timing.
 await expect(page.getByTestId('listening-status')).toHaveText('Take complete');
 expect(take.playback.status).toBe('completed');
 expect(take.playback.error).toBeNull();
 expect(take.playback.params.performanceEnergySeed).toBe(seed);
 expect(take.playback.provenance.committedBars).toBe(52);
 expect(take.playback.provenance.dispatches.length).toBeGreaterThan(0);
 expect(take.playback.provenance.dispatches.every((d: { status: string }) => d.status === 'played')).toBe(true);
 const events = [...take.playback.generated.bassEvents, ...take.playback.generated.compEvents, ...take.playback.generated.drumEvents];
 const expectedTicks = [...new Set(events.map((event: { time: string }) => parseInt(event.time, 10)))].sort((a,b) => a-b);
 expect(take.playback.provenance.dispatches.map((d: { tick: number }) => d.tick).sort((a: number,b: number) => a-b)).toEqual(expectedTicks);
 const smallestLead = expectEveryBarCommittedWithLead(take.playback, 52);
 console.log('PLAYBACK_BUDGET ' + JSON.stringify({ seed, keyboard, bars: 52, smallestLeadMilliseconds: Math.round(smallestLead * 1000),
  maxMilliseconds: Math.max(...take.playback.provenance.renderTimings.map((r: { renderElapsedSeconds: number }) => r.renderElapsedSeconds * 1000)) }));
});
