// Research artifact producer: compares detector output against known source audio.
import { test, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { replayFromAudioBuffer } from '../../src/lib/audio/replay';
import { resolveOnsets, findReArticulations, segmentNotes } from '../../src/lib/audio/note-segmenter';

test('compare original and cleaned pitch, attacks and relative rhythm', async()=>{
 const cases=['backing_static','metronome_static','backing_drift_200ppm','backing_room_move','backing_clipping','archived_preservation'];
 const report=[];
 for(const name of cases){
  const versions:any={};
  for(const version of ['target','original','cleaned','speex']){
   const b=readFileSync(`research/acoustic-bleed/experiment-input/${name}_${version}.f32`);
   const full=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
   const samples=full.slice(8*48000,25*48000);
   const r=await replayFromAudioBuffer({sampleRate:48000,length:samples.length,duration:samples.length/48000,numberOfChannels:1,getChannelData:()=>samples});
   const base=resolveOnsets(r.onsets,r.readings),art=findReArticulations(r.readings,base,[]);
   const onsets=[...base,...art].sort((a,b)=>a-b).filter((v,i,a)=>!i||v-a[i-1]>.06);
   versions[version]={readings:r.readings,notes:segmentNotes(r.readings,onsets,r.duration,undefined,undefined,undefined,r.onsets,[],art,r.weakReadings)};
  }
  const target=versions.target;
  for(const version of ['original','cleaned','speex']){
   const current=versions[version],frames=new Map(current.readings.map((r:any)=>[r.time.toFixed(5),r]));
   let matches=0,missing=0;const cents:number[]=[];
   for(const r of target.readings){const other:any=frames.get(r.time.toFixed(5));if(!other){missing++;continue;}if(other.midi===r.midi)matches++;cents.push(Math.abs(other.midiFloat-r.midiFloat)*100);}
   // One-to-one chronological pitch-matched note pairing within 150 ms.
   const pairs:any[]=[];let from=0;
   for(const n of target.notes){let best=-1,error=.15;for(let i=from;i<current.notes.length;i++){const c=current.notes[i],e=Math.abs(c.onsetTime-n.onsetTime);if(c.midi===n.midi&&e<error){best=i;error=e;}}if(best>=0){pairs.push([n,current.notes[best]]);from=best+1;}}
   const onset=pairs.map(([a,b])=>Math.abs(a.onsetTime-b.onsetTime)*1000);
   const rhythm=pairs.slice(1).map(([a,b],i)=>Math.abs((b.onsetTime-pairs[i][1].onsetTime)-(a.onsetTime-pairs[i][0].onsetTime))*1000);
   const percentile=(xs:number[],p:number)=>xs.length?[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(p*xs.length))]:null;
   report.push({case:name,version,target_frames:target.readings.length,pitch_agreement_pct:100*matches/Math.max(1,target.readings.length),missing_frames:missing,cents_median:percentile(cents,.5),target_notes:target.notes.length,detected_notes:current.notes.length,matched_notes:pairs.length,onset_error_ms_median:percentile(onset,.5),onset_error_ms_max:percentile(onset,1),relative_rhythm_error_ms_median:percentile(rhythm,.5),notes:current.notes});
  }
 }
 expect(report).toHaveLength(18);
 writeFileSync('test-results/acoustic-bleed-detector.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report.map(({notes,...r})=>r),null,2));
},300_000);
