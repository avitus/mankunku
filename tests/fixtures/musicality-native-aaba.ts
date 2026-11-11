import { LOCAL_LISTENING_AABA } from './musicality-local-aaba';
import { flattenTune } from '../../src/lib/tunes/flatten';
import { addFractions } from '../../src/lib/music/intervals';
import { buildPerformanceForm } from '../../src/lib/audio/performance-form';

/** Pure equivalent of the listening adapter, usable in Playwright discovery. */
export function buildNativeAabaFixture() {
 const flat=flattenTune(LOCAL_LISTENING_AABA,{expandRepeats:true});
 const harmony=[0,32,64,96].flatMap(shift=>flat.harmony.map(segment=>({...segment,chord:{...segment.chord},startOffset:addFractions(segment.startOffset,[shift,1])})));
 const sectionMap=[0,32,64,96].flatMap(shift=>flat.sectionMap.map(section=>({...section,barOffset:section.barOffset+shift})));
 return {id:`musicality-${LOCAL_LISTENING_AABA.id}-C-2`,harmony,sectionMap,
  performanceForm:buildPerformanceForm({totalBars:128,sectionMap,choruses:[
   {role:'head',startBar:0,endBarExclusive:32},{role:'solo',startBar:32,endBarExclusive:64},
   {role:'solo',startBar:64,endBarExclusive:96},{role:'head',startBar:96,endBarExclusive:128}
  ]})};
}
