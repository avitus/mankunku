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
   drums.setMix({...lib.DEFAULT_BACKING_MIX,snare:level,crossstick:0},true);
   drums.samplers.snare.start({note:lib.drumBufferForVelocity('snare',.8),velocity:102,time:0});
   drums.countoff.start({note:'crossstick',velocity:76,time:0});
   const audio=await ctx.startRendering();
   return Array.from({length:2},(_,c)=>Array.from(audio.getChannelData(c)));
  };
  const a=await render(1),b=await render(.5),mute=await render(0);
  let error=0,clickError=0,clickPeak=0,peak=0,mutePeak=0;
  for(let i=0;i<a[0].length;i++) {error=Math.max(error,Math.abs(a[0][i]*.5-b[0][i]));clickPeak=Math.max(clickPeak,Math.abs(a[1][i]));clickError=Math.max(clickError,Math.abs(a[1][i]-b[1][i]),Math.abs(a[1][i]-mute[1][i]));peak=Math.max(peak,Math.abs(a[0][i]));mutePeak=Math.max(mutePeak,Math.abs(mute[0][i]));}
  return {error,clickError,clickPeak,peak,mutePeak};
 },source);
 expect(result.clickPeak).toBeGreaterThan(.001);expect(result.peak).toBeGreaterThan(.001);expect(result.error).toBeLessThan(1e-6);expect(result.clickError).toBeLessThan(1e-6);expect(result.mutePeak).toBeLessThan(1e-6);
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
  const generated = { bassEvents:[],compEvents:[],drumEvents:[{time:'0i',absBeat:0,drum:'kick',velocity:.4}],totalBeats:2 };
  const rows=[];
  for (const [volume,kick] of [[.6,1],[.3,1],[0,1],[.6,.5]]) {
   const blob = await lib.renderEventsToWav(generated,{kick:buffer},{instrument:'piano',style:'swing',tempo:120,volume,mix:{...lib.DEFAULT_BACKING_MIX,room:0,kick},durationSeconds:2});
   rows.push((await decode.decodeAudioData(await blob.arrayBuffer())).getChannelData(0));
  }
  let peak=0,error=0,initialMixError=0,muted=0;
  for (let i=0;i<rows[0].length;i++) {peak=Math.max(peak,Math.abs(rows[0][i]));error=Math.max(error,Math.abs(rows[0][i]/2-rows[1][i]));initialMixError=Math.max(initialMixError,Math.abs(rows[0][i]/2-rows[3][i]));muted=Math.max(muted,Math.abs(rows[2][i]));}
  return {peak,error,initialMixError,muted};
 },source);
 expect(result.peak).toBeGreaterThan(.01);
 expect(result.peak).toBeLessThan(.8);
 expect(result.error).toBeLessThan(2/32768);
 expect(result.initialMixError).toBeLessThan(2/32768);
 expect(result.muted).toBe(0);
});

test('recording media obeys saved Master from first playback and never enters the recording tap', async ({page}) => {
 const { requireRealtimeAudio } = await import('./fixtures/realtime-audio');
 requireRealtimeAudio(page);
 await page.goto('/');
 const source=await audioReferenceBundle();
 await page.evaluate(async source => {
  const lib=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
  lib.setMixerLevels({master:0});
  const decoder=new OfflineAudioContext(1,1,44100);
  const tone=decoder.createBuffer(1,44100,44100);
  const pcm=tone.getChannelData(0);
  for (let i=0;i<pcm.length;i++) pcm[i]=.1*Math.sin(2*Math.PI*441*i/44100);
  const url=URL.createObjectURL(lib.audioBufferToWav16(tone));
  const audio=new Audio(url);audio.loop=true;
  const events: unknown[] = [];
  for (const name of ['play','pause','playing','volumechange']) audio.addEventListener(name, () => events.push({name, paused:audio.paused, muted:audio.muted,time:audio.currentTime}));
  const action=lib.mixAudio(audio);
  const button=document.createElement('button');button.textContent='Play reference recording';
  button.onclick=()=>void audio.play().catch(error=>{if(error.name!=='AbortError')throw error;});
  document.body.append(button);
  Object.assign(window,{referenceReplay:{lib,audio,events,action,url}});
 },source);
 await page.getByRole('button',{name:'Play reference recording',exact:true}).click();
 const result=await page.evaluate(async () => {
  const {lib,audio,events,action,url}=(window as unknown as {referenceReplay:{lib:typeof import('../../src/lib/audio/audio-context') & typeof import('../../src/lib/audio/mixer'),audio:HTMLAudioElement,events:unknown[],action:{destroy():void},url:string}}).referenceReplay;
  // Wait for actual media progress: WebKit can decode after the initial play event.
  for (let attempt=0; attempt<100 && (audio.paused || audio.volume === 0 || audio.currentTime < .1); attempt++) {
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  if (audio.paused || audio.volume === 0 || audio.currentTime < .1) throw new Error(`Replay did not begin: ${JSON.stringify({events,initialized:lib.isAudioInitialized(),paused:audio.paused,muted:audio.muted})}`);
  const ctx=await lib.getAudioContext();
  const listen=ctx.createAnalyser(),program=ctx.createAnalyser(),replay=ctx.createAnalyser();
  lib.getMasterGain().connect(listen);lib.getProgramGain().connect(program);lib.getReplayGain().connect(replay);
  const peak=(analyser:AnalyserNode)=>{const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.max(...data.map(Math.abs));};
  // Native decoding may lag the transport clock. Prove PCM arrived while Master is muted.
  for (let attempt=0;attempt<100 && peak(replay)<.05;attempt++) await new Promise(resolve=>setTimeout(resolve,30));
  if(peak(replay)<.05)throw new Error(`Replay PCM did not arrive: ${JSON.stringify(events)}`);
  // Wait on the audio clock for the 5 ms ramp and analyser window to settle.
  const settle=async()=>{
   const target=ctx.currentTime+.15;
   for(let attempt=0;attempt<100 && ctx.currentTime<target;attempt++)await new Promise(resolve=>setTimeout(resolve,20));
   if(ctx.currentTime<target)throw new Error('Audio clock stopped');
  };
  await settle();const muted=peak(listen);
  lib.setMixerLevels({master:.8});await settle();const full=peak(listen);
  const playbackState={context:ctx.state,contextTime:ctx.currentTime,mediaTime:audio.currentTime,paused:audio.paused,muted:audio.muted,master:lib.getMasterGain().gain.value};
  lib.setMixerLevels({master:.4});await settle();const half=peak(listen),recording=peak(program);
  lib.setMixerLevels({master:0});await settle();const remuted=peak(listen);
  action.destroy();URL.revokeObjectURL(url);
  return {muted,full,half,recording,remuted,playbackState,events};
 });
 expect(result.muted).toBe(0);
 expect(result.full,JSON.stringify(result)).toBeGreaterThan(.05);
 expect(result.half/result.full).toBeCloseTo(.5,2);
 expect(result.recording).toBe(0);
 expect(result.remuted).toBe(0);
});
