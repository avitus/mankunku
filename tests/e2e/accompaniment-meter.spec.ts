import { test, expect } from './fixtures/test';
import { seedStorage, seedTunes, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { LOCAL_LISTENING_AABA } from '../fixtures/musicality-local-aaba';

for(const [n,d] of [[3,4],[5,4],[7,4],[6,8]])test(`normal tune playback completes a ${n}/${d} chart with all three sample instruments`,async({page},info)=>{
 requireRealtimeAudio(page);test.setTimeout(150_000);
 await seedStorage(page,{settings:{...SETTINGS_ONBOARDED,backingTrackEnabled:true,backingInstrument:'piano',instrumentId:'piano'},'tour-state':TOUR_DISMISSED,'tune-practice-choruses':0});
 await seedTunes(page,[{...LOCAL_LISTENING_AABA,id:'e2e-meter',title:`Meter ${n}/${d}`,timeSignature:[n,d],backingStyle:'swing',sections:[{label:'A',bars:12,notes:[],harmony:Array.from({length:12},(_,bar)=>({chord:{root:bar%4===0?'Bb':'F',quality:'7'},scaleId:'dominant.mixolydian',symbol:bar%4===0?'Bb7':'F7',startOffset:[bar*n,d],duration:[n,d]}))}]}]);
 await page.addInitScript(()=>{
  const e={starts:[] as {time:number;duration:number}[]};Object.assign(window,{__meterAudio:e});
  const start=AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start=function(...args){if(this.context instanceof AudioContext&&(this.buffer?.length??0)>128&&(args[0]??0)>0)e.starts.push({time:args[0]!,duration:this.buffer!.duration});return Reflect.apply(start,this,args);};
 });
 await page.goto('/tunes/e2e-meter');
 const tempo=page.getByRole('spinbutton',{name:'Tempo',exact:true});await tempo.fill('240');await tempo.press('Tab');
 for(const name of ['Melody','Metronome']){const control=page.getByRole('switch',{name,exact:true});if(await control.getAttribute('aria-checked')==='true')await control.click();}
 await page.getByRole('button',{name:'Play tune',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible({timeout:60_000});
 await expect(page.getByRole('button',{name:'Play tune',exact:true})).toBeVisible({timeout:70_000});
 const e=await page.evaluate(()=>(window as unknown as {__meterAudio:{starts:{time:number;duration:number}[]}}).__meterAudio);
 await info.attach('meter-native-starts',{body:JSON.stringify({meter:[n,d],...e}),contentType:'application/json'});
 expect(e.starts.length).toBeGreaterThan(60);
 // Distinct bundled sample buffers establish real instrument dispatch; unit contracts pin stem identities.
 expect(new Set(e.starts.map(s=>s.duration)).size).toBeGreaterThan(5);
 const starts=e.starts.map(s=>s.time).sort((a,b)=>a-b);
 expect(starts.at(-1)!-starts[0]).toBeGreaterThan(11*n*4/d*.25);
 // Odd-meter count-off begins with only a downbeat; judge continuity after its two bars.
 const sounding=starts.filter(t=>t>=starts[0]+2*n*4/d*.25-.01);
 expect(Math.max(...sounding.slice(1).map((s,i)=>s-sounding[i]))).toBeLessThan(.51);
 expect(Math.max(...starts.slice(1).map((s,i)=>s-starts[i]))).toBeLessThanOrEqual(n*4/d*.25+.01);
 const count=e.starts.length;await page.waitForTimeout(1500);
 expect(await page.evaluate(()=>(window as unknown as {__meterAudio:{starts:unknown[]}}).__meterAudio.starts.length)).toBe(count);
});
