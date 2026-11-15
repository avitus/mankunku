/** Conservative native-style accompaniment when the developed 4/4 vocabulary does not fit. */
import type { HarmonicSegment } from '$lib/types/music';
import type { BackingInstrument } from '$lib/types/instruments';
import type { BackingGenerationParams, GeneratedBacking } from './backing-generation';
import type { StyleDefinition, DrumVoice } from './backing-styles';
import { fractionToFloat } from '$lib/music/intervals';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { isSupportedMeter } from '$lib/tunes/meter';
import { pitchClassToNumber, shellVoicing, voiceLead } from './voicings';
import { createRng, seedFrom } from './generation-rng';

/** Group starts in quarter-note units; fixed defaults until charts can specify grouping. */
export function basicMeterGroups(numerator: number, denominator: number): number[] {
 if (!isSupportedMeter([numerator, denominator])) throw new Error('Invalid backing meter');
 const groups = denominator >= 8 && numerator % 3 === 0 ? Array(numerator / 3).fill(3) as number[]
  : numerator === 5 ? [3,2] : numerator === 7 ? (denominator >= 8 ? [2,2,3] : [4,3])
  : [numerator];
 let at = 0;
 return groups.map(length => { const start = at * 4 / denominator; at += length; return start; });
}

/** Finite, seeded basic trio. Every chord change gets harmony; gates end at its boundary. */
export function prepareBasicMeterArrangement(harmony: HarmonicSegment[], style: StyleDefinition,
 params: BackingGenerationParams, instrument: BackingInstrument, denominator: number, seed: number): GeneratedBacking {
 const groups = basicMeterGroups(params.beatsPerBar, denominator);
 const barBeats = params.beatsPerBar * 4 / denominator, unit = 4 / denominator;
 if (!(Number.isFinite(params.tempo) && params.tempo > 0 && Number.isSafeInteger(params.ppq) && params.ppq > 0)) throw new Error('Invalid backing clock');
 const spans = harmony.map(segment => ({ segment, start: fractionToFloat(segment.startOffset)*4,
  end: (fractionToFloat(segment.startOffset)+fractionToFloat(segment.duration))*4 }));
 const end = spans.at(-1)!.end, bars = Math.ceil((end - 1e-9) / barBeats);
 if (params.performanceForm && params.performanceForm.totalBars !== bars) throw new Error('Performance form must match backing length');
 const voicings = voiceLead(harmony.map(h => h.chord), shellVoicing, 60);
 const out: GeneratedBacking = { bassEvents: [], compEvents: [], drumEvents: [] };
 const kind = style.coordinatedStyle ?? 'swing', soft = kind === 'ballad', latin = kind === 'bossa-nova';
 const compound = denominator >= 8 && params.beatsPerBar % 3 === 0;
 const at = (beat: number) => spans.findIndex(s => beat >= s.start - 1e-9 && beat < s.end - 1e-9);
 for (let bar=0;bar<bars;bar++) {
  const start=bar*barBeats, stop=Math.min(end,start+barBeats);
  const rng=createRng(seedFrom(params.phraseId,seed,bar,'basic-meter'));
  const changes=spans.filter(s=>s.start>=start&&s.start<stop).map(s=>s.start-start);
  const support=groups.length>1 ? groups : [0, ...(params.beatsPerBar>=3 ? [(params.beatsPerBar-1)*unit] : [])];
  const bassGrid=compound ? groups : !soft&&!latin ? Array.from({length:Math.ceil(barBeats)},(_,i)=>i) : support;
  const bassBeats=[...new Set([...bassGrid,...changes])].filter(b=>start+b<stop).sort((a,b)=>a-b);
  bassBeats.forEach((b,i)=>{
   const absBeat=start+b,index=at(absBeat); if(index<0)return;
   const chord=spans[index].segment.chord;
   const root=pitchClassToNumber(chord.bass??chord.root);
   const fifth=CHORD_DEFINITIONS[chord.quality].intervals.find(x=>x>=6&&x<=8)??7;
   const pc=(root+(i%2 && !changes.includes(b) && !chord.bass ? fifth : 0))%12;
   const room=Math.min(stop,spans[index].end,start+(bassBeats[i+1]??barBeats))-absBeat;
   out.bassEvents.push({absBeat,time:`${Math.round(absBeat*params.ppq)}i`,midi:36+pc,
    velocity:rng.int(soft?54:65,soft?62:74),duration:room*(soft?.92:.84)*60/params.tempo});
  });
  // Preserve a light syncopated surface for Latin; Ballad holds its pads.
  const compGrid=soft ? [0] : support.map((b,i)=>latin&&i>0?Math.max(0,b-unit/2):b);
  const compBeats=[...new Set([...compGrid,...changes])].filter(b=>start+b<stop).sort((a,b)=>a-b);
  compBeats.forEach((b,i)=>{
   const absBeat=start+b,index=at(absBeat);if(index<0)return;
   const room=Math.min(stop,spans[index].end,start+(compBeats[i+1]??barBeats))-absBeat;
   const gate=soft?.93:instrument==='organ'?.85:latin?.55:.65;
   out.compEvents.push({absBeat,time:`${Math.round(absBeat*params.ppq)}i`,notes:[...voicings[index]],
    velocity:rng.int(soft?44:53,soft?51:63),duration:room*gate*60/params.tempo});
  });
  const hit=(b:number,drum:DrumVoice,velocity:number)=>{
   if(start+b<stop)out.drumEvents.push({absBeat:start+b,time:`${Math.round((start+b)*params.ppq)}i`,drum,velocity,role:'timekeeping'});
  };
  const pulse=compound?unit:Math.min(1,unit);
  for(let b=0;b<barBeats-1e-9;b+=pulse){
   hit(b,latin?'hihat':'ride',soft?.22:latin?.32:.43);
   // Swing's skip note stays within its beat; compound eighths remain even.
   if(kind==='swing'&&!compound&&pulse===1&&Math.floor(b)%2===1)hit(b+params.swing,'ride',.30);
  }
  for(const b of support){hit(b,'kick',soft?.12:.21);if(b>0)hit(b,latin?'crossstick':'hihat-pedal',soft?.19:latin?.28:.34);}
 }
 return out;
}
