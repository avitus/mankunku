import { test, expect } from './fixtures/test';
import { audioReferenceBundle } from './fixtures/audio-reference-bundle';

/** Real PCM proves the routing and gain law, including paths that bypassed Master. */
test('shared mixer separates recording from listening and keeps mute, replay and protection consistent', async ({ page }) => {
 const source=await audioReferenceBundle();
 const results=await page.evaluate(async source => {
  const lib=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
  const render=async (master:number, replay:boolean, loud=false) => {
   const ctx=new OfflineAudioContext(3,4800,48000);
   const listen=ctx.createGain(), recording=ctx.createGain(), merger=ctx.createChannelMerger(3);
   listen.connect(merger,0,0); recording.connect(merger,0,1); merger.connect(ctx.destination);
   const mixer=lib.createMixer(ctx,listen,{master,melody:.5,click:.25,backing:.6});
   mixer.program.connect(recording);
   for (const [target, amplitude] of [[mixer.melody,.2],[mixer.click,.4],[mixer.program,loud?2:.1],...(replay?[[mixer.output,.05]]:[])] as const) {
    const signal=ctx.createConstantSource(); signal.offset.value=amplitude; signal.connect(target); signal.start();
   }
   const audio=await ctx.startRendering();return {listen:audio.getChannelData(0)[4000],recording:audio.getChannelData(1)[4000]};
  };
  return {reference:await render(.8,false),half:await render(.4,false),muted:await render(0,false),replay:await render(.8,true),over:await render(1,false,true)};
 },source);
 expect(results.reference.listen).toBeCloseTo(.24,5);
 expect(results.half.listen).toBeCloseTo(.12,5);
 expect(results.muted.listen).toBe(0);
 for (const row of [results.reference,results.half,results.muted,results.replay]) expect(row.recording).toBeCloseTo(.3,5);
 expect(results.replay.listen).toBeCloseTo(.28,5);
 expect(results.over.listen).toBeCloseTo(10**(-1/20),5);
});

test('drum faders halve waveform amplitude without changing velocity layers or count-off', async ({page}) => {
 const source=await audioReferenceBundle();
 const result=await page.evaluate(async source=>{
  const lib=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
  const render=async (level:number) => {
   const ctx=new OfflineAudioContext(2,24000,48000);
   const band=ctx.createGain(),click=ctx.createGain(),merger=ctx.createChannelMerger(2);
   band.connect(merger,0,0);click.connect(merger,0,1);merger.connect(ctx.destination);
   const buffer=ctx.createBuffer(1,12000,48000);const pcm=buffer.getChannelData(0);
   for(let i=0;i<pcm.length;i++) pcm[i]=.05*Math.sin(i*2*Math.PI*440/48000);
   const drums=await lib.createDrumMixer(ctx,lib.sampler.Sampler,{snare_ghost:buffer,snare_med:buffer,snare_acc:buffer,crossstick:buffer},
    {kick:band,snare:band,cymbals:band},()=>new lib.sampler.Scheduler(ctx,{lookaheadMs:1000}),click);
   drums.setMix({...lib.DEFAULT_BACKING_MIX,snare:level,crossstick:0});
   drums.samplers.snare.start({note:lib.drumBufferForVelocity('snare',.8),velocity:102,time:.05});
   drums.countoff.start({note:'crossstick',velocity:76,time:.05});
   const audio=await ctx.startRendering();
   return Array.from({length:2},(_,c)=>Array.from(audio.getChannelData(c)));
  };
  const a=await render(1),b=await render(.5),mute=await render(0);
  let error=0,clickError=0,peak=0,mutePeak=0;
  for(let i=2400;i<a[0].length;i++) {error=Math.max(error,Math.abs(a[0][i]*.5-b[0][i]));clickError=Math.max(clickError,Math.abs(a[1][i]-b[1][i]),Math.abs(a[1][i]-mute[1][i]));peak=Math.max(peak,Math.abs(a[0][i]));mutePeak=Math.max(mutePeak,Math.abs(mute[0][i]));}
  return {error,clickError,peak,mutePeak};
 },source);
 expect(result.peak).toBeGreaterThan(.001);expect(result.error).toBeLessThan(1e-6);expect(result.clickError).toBeLessThan(1e-6);expect(result.mutePeak).toBeLessThan(1e-6);
});

test('WAV export retains fader amplitude, exact mute and compressor behavior', async ({page}) => {
 const { stubCdnInstrumentSamples } = await import('./fixtures/audio');
 await stubCdnInstrumentSamples(page);
 await page.goto('/');
 const source = await audioReferenceBundle();
 const result = await page.evaluate(async source => {
  const lib = await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
  const decode = new OfflineAudioContext(1,1,44100);
  const buffer = decode.createBuffer(1,44100,44100);
  const data = buffer.getChannelData(0);
  for (let i=0;i<data.length;i++) data[i]=.1*Math.sin(i*2*Math.PI*220/44100)*Math.exp(-i/10000);
  const generated = { bassEvents:[],compEvents:[],drumEvents:[{time:'96i',absBeat:.5,drum:'kick',velocity:.4}],totalBeats:2 };
  const rows=[];
  for (const volume of [.6,.3,0]) {
   const blob = await lib.renderEventsToWav(generated,{kick:buffer},{instrument:'piano',style:'swing',tempo:120,volume,mix:{...lib.DEFAULT_BACKING_MIX,room:0},durationSeconds:2});
   rows.push((await decode.decodeAudioData(await blob.arrayBuffer())).getChannelData(0));
  }
  let peak=0,error=0,muted=0;
  for (let i=0;i<rows[0].length;i++) {peak=Math.max(peak,Math.abs(rows[0][i]));error=Math.max(error,Math.abs(rows[0][i]/2-rows[1][i]));muted=Math.max(muted,Math.abs(rows[2][i]));}
  return {peak,error,muted};
 },source);
 expect(result.peak).toBeGreaterThan(.01);
 expect(result.peak).toBeLessThan(.8);
 expect(result.error).toBeLessThan(2/32768);
 expect(result.muted).toBe(0);
});

test('recording media obeys saved Master from first playback and never enters the recording tap', async ({page}) => {
 const { requireRealtimeAudio } = await import('./fixtures/realtime-audio');
 requireRealtimeAudio(page);
 await page.goto('/');
 const source=await audioReferenceBundle();
 const result=await page.evaluate(async source => {
  const lib=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
  lib.setMixerLevels({master:0});
  const decoder=new OfflineAudioContext(1,1,44100);
  const tone=decoder.createBuffer(1,44100,44100);
  const pcm=tone.getChannelData(0);
  for (let i=0;i<pcm.length;i++) pcm[i]=.1*Math.sin(2*Math.PI*441*i/44100);
  const url=URL.createObjectURL(lib.audioBufferToWav16(tone));
  const audio=new Audio(url);audio.loop=true;
  const action=lib.mixAudio(audio);
  await audio.play().catch(error => { if (error.name !== 'AbortError') throw error; });
  // Wait for actual media progress: WebKit can decode after the initial play event.
  for (let attempt=0; attempt<100 && (audio.paused || audio.currentTime < .1); attempt++) {
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  if (audio.paused || audio.currentTime < .1) throw new Error('Replay did not begin');
  const ctx=await lib.getAudioContext();
  const listen=ctx.createAnalyser(),program=ctx.createAnalyser();
  lib.getMasterGain().connect(listen);lib.getProgramGain().connect(program);
  const peak=(analyser:AnalyserNode)=>{const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.max(...data.map(Math.abs));};
  const muted=peak(listen);
  lib.setMixerLevels({master:.8});await new Promise(resolve=>setTimeout(resolve,150));const full=peak(listen);
  const playbackState={context:ctx.state,contextTime:ctx.currentTime,mediaTime:audio.currentTime,paused:audio.paused,muted:audio.muted,master:lib.getMasterGain().gain.value};
  lib.setMixerLevels({master:.4});await new Promise(resolve=>setTimeout(resolve,150));const half=peak(listen),recording=peak(program);
  lib.setMixerLevels({master:0});await new Promise(resolve=>setTimeout(resolve,150));const remuted=peak(listen);
  action.destroy();URL.revokeObjectURL(url);
  return {muted,full,half,recording,remuted,playbackState};
 },source);
 expect(result.muted).toBe(0);
 expect(result.full,JSON.stringify(result)).toBeGreaterThan(.05);
 expect(result.half/result.full).toBeCloseTo(.5,2);
 expect(result.recording).toBe(0);
 expect(result.remuted).toBe(0);
});
