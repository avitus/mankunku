import { describe, it, expect } from 'vitest';
import { prepareReleasedArrangement } from '$lib/audio/backing-arrangement';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import type { BackingStyle } from '$lib/types/instruments';
import type { HarmonicSegment } from '$lib/types/music';
import { drumCountInHits } from '$lib/audio/drum-count-in';
const meters: [number,number][] = [[3,4],[5,4],[7,4],[6,8],[2,2],[7,8],[9,8],[12,8]];
describe('basic non-common-time session musicians', () => {
 for (const meter of meters) for (const style of ['swing','straight','bossa-nova','ballad'] as BackingStyle[]) {
  it(`${meter.join('/')} ${style}: every printed bar has all three players and bounded gates`, () => {
   const [n,d]=meter, beats=n*4/d, tempo=120, ppq=192;
   const harmony: HarmonicSegment[]=Array.from({length:12},(_,bar)=>({chord:{root:bar%4===0?'Bb':'F',quality:'7'},scaleId:'mixolydian',startOffset:[bar*n,d],duration:[n,d]}));
   const params={phraseId:'meter-blues',tempo,ppq,beatsPerBar:n,swing:.62};
   for (const keyboard of ['piano','organ'] as const) {
    const take=prepareReleasedArrangement(harmony,BACKING_STYLES[style],params,keyboard,d,3);
    expect(prepareReleasedArrangement(harmony,BACKING_STYLES[style],params,keyboard,d,3)).toEqual(take);
    for(let bar=0;bar<12;bar++) for(const events of [take.bassEvents,take.compEvents,take.drumEvents]) {
     const played=events.filter(e=>e.absBeat>=bar*beats&&e.absBeat<(bar+1)*beats);
     expect(played.length).toBeGreaterThan(0);
     for(const e of played) {
      const tick=parseInt(e.time,10);expect(tick).toBeGreaterThanOrEqual(bar*beats*ppq);
      expect(tick).toBeLessThan((bar+1)*beats*ppq);
      if('duration' in e) {expect(e.duration).toBeGreaterThan(0);expect(tick/ppq+e.duration*tempo/60).toBeLessThanOrEqual((bar+1)*beats+1e-8);}
     }
    }
   }
  });
 }
 it('6/8 has two dotted-quarter bass pulses, distinct from three walking quarters in 3/4',()=>{
  const h:HarmonicSegment[]=[{chord:{root:'F',quality:'7'},scaleId:'mixolydian',startOffset:[0,1],duration:[3,4]}];
  const make=(n:number,d:number)=>prepareReleasedArrangement(h,BACKING_STYLES.swing,{phraseId:'group',tempo:120,ppq:192,beatsPerBar:n,swing:.62},'piano',d,0);
  expect(make(6,8).bassEvents.map(e=>e.absBeat)).toEqual([0,1.5]);
  expect(make(3,4).bassEvents.map(e=>e.absBeat)).toEqual([0,1,2]);
 });
 it('counts six eighths within one 6/8 bar, then enters the tune at tick 576',()=>{
  expect(drumCountInHits(1,6,192,8).map(e=>e.tick)).toEqual([0,96,192,288,384,480]);
 });
});
