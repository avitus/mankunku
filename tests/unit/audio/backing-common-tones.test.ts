import { expect, it } from 'vitest';
import { describeMusicianDecisions } from '$lib/musicality/musician-decisions';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { releasedBackingOptions } from '$lib/audio/backing-release';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { pitchClassToNumber } from '$lib/audio/voicings';
import { fractionToFloat } from '$lib/music/intervals';
const { phrase } = buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
for (const style of ['swing','straight','bossa-nova','ballad'] as const) for (const instrument of ['piano','organ'] as const) {
 it(`${style}/${instrument}: retains shared chord tones while promptly articulating changed harmony`, () => {
  let witnessed=0;
  for (const seed of [3,7,256]) {
   const score=createRollingBacking(phrase.harmony,BACKING_STYLES[style],{phraseId:phrase.id,tempo:style==='ballad'?80:140,ppq:192,beatsPerBar:4,swing:style==='swing'?.62:.5,performanceForm:phrase.performanceForm,sectionMap:phrase.sectionMap,ensemble:{}},{...releasedBackingOptions(instrument,seed),keyboardSustain:'common-tones'});
   let checkpoint:RollingBackingCheckpoint|undefined;
   for(let bar=0;bar<score.totalBars;bar++) {
    const result=advanceRollingBacking(score,checkpoint);
    expect(advanceRollingBacking(score,checkpoint?JSON.parse(JSON.stringify(checkpoint)):undefined)).toEqual(result);
    for(const event of result.compEvents.filter(e=>e.barLineSustain?.version===2)) {
     witnessed++;
     const boundary=(bar+1)*4*score.ppq;
     const source=score.harmony.find(h=>fractionToFloat(h.startOffset)*4<=event.absBeat&&(fractionToFloat(h.startOffset)+fractionToFloat(h.duration))*4>event.absBeat)!;
     const target=score.harmony.find(h=>fractionToFloat(h.startOffset)*4<=boundary/score.ppq&&(fractionToFloat(h.startOffset)+fractionToFloat(h.duration))*4>boundary/score.ppq)!;
     expect(target.chord).not.toEqual(source.chord);
     for(const h of [source,target])for(const midi of event.notes)expect(CHORD_DEFINITIONS[h.chord.quality].intervals.map(i=>(pitchClassToNumber(h.chord.root)+i)%12)).toContain(midi%12);
     expect(event.notes.length).toBeLessThanOrEqual(2);
     expect(score.bars[bar].sourceChorusIndex).toBe(score.bars[bar+1].sourceChorusIndex);
     expect(score.bars[bar].sourceSectionIndex).toBe(score.bars[bar+1].sourceSectionIndex);
     const clear=result.compEvents.filter(e=>e.time===event.time&&e!==event);
     expect(clear.length).toBe(1);
     const sourceCard=describeMusicianDecisions({...result,bassEvents:[...result.bassEvents],compEvents:[...result.compEvents],drumEvents:[...result.drumEvents]},{barIndex:bar,ppq:score.ppq,beatsPerBar:4,style,orchestration:'coordinated'})[1];
     expect(sourceCard.evidence.filter(line=>/^Chord \d+: /.test(line))).toHaveLength(new Set(result.compEvents.map(e=>e.time)).size);
     expect(sourceCard.evidence.some(line=>line.includes('separate held and released voices'))).toBe(true);
     expect(parseInt(clear[0].time)+clear[0].duration*score.tempo/60*score.ppq).toBeLessThanOrEqual(boundary+1e-6);
     expect(clear[0].notes.some(n=>event.notes.includes(n))).toBe(false);
     const next=advanceRollingBacking(score,result.checkpoint);
     expect(next.compEvents.length).toBeGreaterThan(0);
     expect(next.ensemblePlan.bars[0].piano.maxAttacks).toBeGreaterThan(0);
     const entrance=next.compEvents[0];
     const sounding=[...event.notes,...entrance.notes].map(n=>n%12);
     for(const guide of CHORD_DEFINITIONS[target.chord.quality].intervals.filter(i=>i===3||i===4||i===10||i===11))expect(sounding).toContain((pitchClassToNumber(target.chord.root)+guide)%12);
     const cards=describeMusicianDecisions({...next,bassEvents:[...next.bassEvents],drumEvents:[...next.drumEvents],compEvents:[...result.compEvents,...next.compEvents]}, {barIndex:bar+1,ppq:score.ppq,beatsPerBar:4,style,orchestration:'coordinated'});
     expect(cards[1].action).toBe('Voice the new chord around held tones');
     expect(cards[1].evidence.some(line=>line.startsWith('Chord 1 voicing:'))).toBe(false);
     const future={barIndex:bar+1,observedAtBar:bar,source:'microphone' as const,confidence:.95,noteDensity:1,restBeats:0};
     expect(advanceRollingBacking(score,checkpoint,[future])).toEqual(result);
     const denseNext=advanceRollingBacking(score,result.checkpoint,[future]);
     expect(denseNext.compEvents.length).toBeGreaterThan(0);
     expect(denseNext.compEvents.some(e=>e.barLineSustain)).toBe(false);
     if(seed===3)console.log('COMMON_TONE_WITNESS',style,instrument,bar+1,event.notes,entrance.notes);

     expect(Math.min(...next.compEvents.map(e=>parseInt(e.time)))).toBeLessThan(boundary+.15*score.ppq);
     for(const attack of next.compEvents.filter(e=>parseInt(e.time)<event.barLineSustain!.releaseTick))expect(attack.notes.some(n=>event.notes.includes(n))).toBe(false);
     expect(next.compEvents.some(e=>e.barLineSustain)).toBe(false);
     expect(next.bassEvents.length).toBeGreaterThan(0);
     expect(next.drumEvents.some(e=>e.role==='timekeeping')).toBe(true);
    }
    checkpoint=result.checkpoint;
   }
  }
  expect(witnessed).toBeGreaterThan(0);
 });
}

it('clears an altered tone, refuses incompatible harmony and protects formal boundaries', async()=>{
 const {sustainAcrossBar}=await import('$lib/audio/backing-keyboard-sustain');
 const base=createRollingBacking(phrase.harmony,BACKING_STYLES.swing,{phraseId:phrase.id,tempo:140,ppq:192,beatsPerBar:4,swing:.62,performanceForm:phrase.performanceForm,ensemble:{}},{...releasedBackingOptions('piano',3),keyboardSustain:'common-tones'});
 const planned=advanceRollingBacking(base).ensemblePlan.bars[0];
 const info={...base.bars[1],ensemble:{...planned,coordinatedAccent:undefined,setupFor:undefined,terminalArrangement:undefined,responseOwner:'nobody' as const,piano:{...planned.piano,rootlessTexture:undefined}}};
 const event={time:'1344i',absBeat:7,notes:[60,61,64,67,70],duration:.25,velocity:60};
 // Keep the seed gate real; select a seed which admits the deliberately controlled chord pair.
 let admitted:ReturnType<typeof sustainAcrossBar>,selected=base;
 for(let seed=0;seed<32&&!admitted;seed++) {
  selected={...base,bars:base.bars.map((b,i)=>i===1?{...b,pianoPresenceSeed:seed}:b),harmony:[{startOffset:[0,1],duration:[2,1],chord:{root:'C',quality:'7b9'},scaleId:'mixolydian'},{startOffset:[2,1],duration:[50,1],chord:{root:'F',quality:'7'},scaleId:'mixolydian'}]};
  admitted=sustainAcrossBar(selected,1,info,[event]);
 }
 expect(admitted).toBeTruthy();
 expect(admitted!.at(-1)!.notes).toEqual([60]);
 expect(admitted![0].notes).toContain(61);
 expect(admitted![0].duration).toBe(event.duration);
 const incompatible={...selected,harmony:selected.harmony.map((h,i)=>i===1?{...h,chord:{root:'D' as const,quality:'maj7' as const}}:{...h,chord:{root:'C' as const,quality:'7' as const}})};
 expect(sustainAcrossBar(incompatible,1,info,[{...event,notes:[60,64,67,70]}])).toBeUndefined();
 expect(sustainAcrossBar({...selected,keyboardSustainVersion:1},1,info,[event])).toBeUndefined();
 const fast={...selected,pianoContinuityVersion:1 as const,harmony:[selected.harmony[0],{...selected.harmony[1],duration:[1,4] as [number,number]},{...selected.harmony[1],startOffset:[9,4] as [number,number],duration:[199,4] as [number,number],chord:{root:'F#' as const,quality:'maj7' as const}}]};
 // The next chord can be anticipated at beat .5: retain the .4-beat gate.
 expect(sustainAcrossBar(fast,1,info,[event])!.at(-1)!.barLineSustain!.releaseTick).toBe(Math.round(8.4*192));
 expect(sustainAcrossBar(selected,1,info,[event],1600)).toBeUndefined();
 expect(sustainAcrossBar({...selected,bars:selected.bars.map((b,i)=>i===2?{...b,sourceSectionIndex:b.sourceSectionIndex+1}:b)},1,info,[event])).toBeUndefined();
});
