import { test, expect } from './fixtures/test';
import { readFile } from 'node:fs/promises';
import { audioReferenceBundle } from './fixtures/audio-reference-bundle';

/** Native recordings and production bounce measured against the pre-change reference. */
test('capture shared-mixer reference levels', async ({ page }, info) => {
 test.setTimeout(300_000);
 const [source, events] = await Promise.all([audioReferenceBundle(), readFile('tests/fixtures/backing/golden-backing-mixer-loop-140.json', 'utf8')]);
 await page.goto('/');
 const result = await page.evaluate(async ({ source, events }) => {
  const lib = await import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
  const stats = (buffer: AudioBuffer) => {
   let peak = 0, energy = 0, frames = 0;
   for (let c = 0; c < buffer.numberOfChannels; c++) for (const v of buffer.getChannelData(c)) {
    peak = Math.max(peak, Math.abs(v)); energy += v * v; frames++;
   }
   return { peak, peakDb: 20*Math.log10(peak || 1e-12), rms: Math.sqrt(energy/frames), rmsDb: 10*Math.log10(energy/frames || 1e-24), seconds: buffer.duration };
  };
  const decode = new OfflineAudioContext(2, 1, 44100);
  const drums = Object.fromEntries(await Promise.all(Object.entries(lib.DRUM_BUFFERS).map(async ([name, url]) => {
   const response = await fetch(url as string); if (!response.ok) throw new Error(`Drum HTTP ${response.status}`);
   return [name, await decode.decodeAudioData(await response.arrayBuffer())];
  })));
  const response = await fetch(lib.ROOM_IR_URL);
  const roomIr = await decode.decodeAudioData(await response.arrayBuffer());
  const rows: Record<string, ReturnType<typeof stats>> = {};
  const nativeRender = OfflineAudioContext.prototype.startRendering;
  OfflineAudioContext.prototype.startRendering = async function () {
   const buffer = await nativeRender.call(this); rows.latestRaw = stats(buffer); return buffer;
  };
  try {
   const generated = JSON.parse(events);
   for (const instrument of ['piano', 'organ']) for (const stem of ['band', 'bass', 'comp', 'drums']) {
    const mix = { ...lib.DEFAULT_BACKING_MIX, ...(stem === 'band' ? {} : { bass: +(stem === 'bass'), comp: +(stem === 'comp'), drums: +(stem === 'drums'), room: 0 }) };
    const blob = await lib.renderEventsToWav(generated, drums, { instrument, style: 'swing', tempo: 140, volume: .6, mix, durationSeconds: 9.5, roomIr });
    rows[`${instrument}-${stem}-raw`] = rows.latestRaw;
    rows[`${instrument}-${stem}-export`] = stats(await decode.decodeAudioData(await blob.arrayBuffer()));
   }
   for (const id of ['tenor-sax', 'alto-sax', 'soprano-sax', 'trumpet']) {
    const ctx = new OfflineAudioContext(2, 8*44100, 44100);
    const voice = lib.instrumentVoice(id);
    const filter = ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=voice.warmthCutoffHz; filter.Q.value=.7; filter.connect(ctx.destination);
    const calibration=ctx.createGain(); calibration.gain.value=voice.samples ? lib.SAMPLE_CHANNEL_REFERENCE : lib.SOUNDFONT_REFERENCE; calibration.connect(filter);
    const scheduler = new lib.sampler.Scheduler(ctx, { lookaheadMs: 10000 });
    const players = voice.samples ? await Promise.all(['piano','forte'].map(async layer => {
     const p = new lib.sampler.Sampler(ctx, { ...lib.SAMPLE_OPTIONS, scheduler, destination:calibration, buffers: lib.loadSampleLayer(lib.layerToBuffers(voice.samples[layer])), detune:0, decayTime:.3, lpfCutoffHz:20000 }); await p.load; return p;
    })) : [await new lib.sampler.Soundfont(ctx, { ...lib.SOUNDFONT_OPTIONS, scheduler, destination:calibration, instrument:voice.soundfont, kit:'MusyngKite', loadLoopData:true }).load];
    for (const [i,v] of [60,88,110,88].entries()) players[voice.samples && v>voice.samples.velocitySplit ? 1 : 0].start({note:65,velocity:v,time:.1+i*1.8,duration:1.2});
    rows[id]=stats(await ctx.startRendering()); players.forEach(p=>p.disconnect());
   }
   delete rows.latestRaw;
   return rows;
  } finally { OfflineAudioContext.prototype.startRendering=nativeRender; }
 }, { source, events });
 await info.attach('reference-levels', { body: JSON.stringify(result,null,2), contentType:'application/json' });
 console.log(JSON.stringify(result));
 for (const row of Object.values(result)) { expect(row.peak).toBeGreaterThan(0); expect(Number.isFinite(row.rms)).toBe(true); }
 const before = JSON.parse(await readFile('docs/maintenance/audio-mixer/reference-before.json', 'utf8')).measurements;
 for (const id of ['tenor-sax','alto-sax','soprano-sax','trumpet']) {
  expect(Math.abs(result[id].rmsDb-before[id].rmsDb),id).toBeLessThan(.05);
 }
 for (const instrument of ['piano','organ']) {
  const key=`${instrument}-band-raw`;
  expect(Math.abs(result[key].rmsDb-before[key].rmsDb-6.0412),key).toBeLessThan(.2);
  expect(result[key].peakDb).toBeLessThan(-5);
 }
});
