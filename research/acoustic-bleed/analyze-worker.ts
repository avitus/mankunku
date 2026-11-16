import { replayFromAudioBuffer } from '../../src/lib/audio/replay';
import { resolveOnsets, findReArticulations, segmentNotes } from '../../src/lib/audio/note-segmenter';
import { runScorePipeline } from '../../src/lib/scoring/score-pipeline';

self.onmessage = async ({data}) => {
  try {
    const results = [];
    for (const channel of [data.original, data.cleaned]) {
      const samples = channel.slice(Math.round(data.start*data.sampleRate), Math.round(data.end*data.sampleRate));
      const replay = await replayFromAudioBuffer({ sampleRate: data.sampleRate, length: samples.length,
        duration: samples.length/data.sampleRate, numberOfChannels: 1, getChannelData: () => samples });
      const base = resolveOnsets(replay.onsets, replay.readings);
      const articulations = findReArticulations(replay.readings, base, []);
      const onsets = [...base, ...articulations].sort((a,b)=>a-b).filter((v,i,a)=>!i || v-a[i-1]>.06);
      const detected = segmentNotes(replay.readings, onsets, replay.duration, undefined, undefined, undefined, replay.onsets, [], articulations, replay.weakReadings);
      const score = runScorePipeline({detected, phrase:data.phrase, tempo:data.tempo, swing:data.swing,
        transportSeconds:0, bleedFilterEnabled:false, readings:replay.readings}).chosen;
      results.push({score, detected, readings:replay.readings.map(r=>({time:r.time,midi:r.midiFloat}))});
    }
    self.postMessage({results});
  } catch(error) { self.postMessage({error:String(error)}); }
};
