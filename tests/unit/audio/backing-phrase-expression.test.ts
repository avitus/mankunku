import { describe, expect, it } from 'vitest';
import { shapeBassPulse, contrastKeyboardPair, ghostSnareAnswer } from '$lib/audio/backing-phrase-expression';
import type { BassEvent, CompEvent } from '$lib/audio/backing-generation';
const bass: BassEvent[] = [0,1,2,3].map(absBeat => ({absBeat,time:`${absBeat*192}i`,midi:41+absBeat,duration:.4,velocity:80}));
const pair: CompEvent[] = [0,2].map(absBeat => ({absBeat,time:`${absBeat*192}i`,notes:[53,57,63],duration:.3,velocity:74}));
describe('phrase expression on accepted native gestures',()=>{
 it('gives walking backbeats buoyancy without changing pitches, gates or onset grid',()=>{
  const after=shapeBassPulse(bass,0,'swing');
  expect(after.map(e=>e.velocity)).toEqual([72,88,72,88]);
  expect(after.reduce((n,e)=>n+e.velocity,0)).toBe(320);
  expect(after.map(({velocity,expression,...e})=>e)).toEqual(bass.map(({velocity,...e})=>e));
  expect(bass[0].velocity).toBe(80);
 });
 it.each(['bossa-nova','ballad'] as const)('%s retains native bass emphasis',style=>expect(shapeBassPulse(bass,0,style)).toEqual(bass));
 it('does not reshape broken time or ornamented walking',()=>{
  expect(shapeBassPulse(bass.slice(0,3),0,'swing')).toEqual(bass.slice(0,3));
  const embellished=[...bass,{...bass[0],absBeat:.5,time:'96i'}];
  expect(shapeBassPulse(embellished,0,'swing')).toEqual(embellished);
 });
 it.each(['piano','organ'] as const)('%s contrasts a short attack with held harmony without losing support',instrument=>{
  const after=contrastKeyboardPair(pair,{style:'swing',instrument,tempo:120,ppq:192,endTicks:[768,768]});
  expect(after[1].duration).toBeGreaterThanOrEqual(after[0].duration*2);
  expect(after.reduce((n,e)=>n+e.duration,0)).toBeGreaterThanOrEqual(.6);
  expect(after[1].expression?.kind).toBe('short-held');
  expect(after.map(({duration,expression,...e})=>e)).toEqual(pair.map(({duration,...e})=>e));
 });
 it('declines if the harmony boundary cannot fit a complete contrasting pair',()=>{
  expect(contrastKeyboardPair(pair,{style:'swing',instrument:'piano',tempo:120,ppq:192,endTicks:[192,400]})).toEqual(pair);
 });
 it('never thins an already sustained pair',()=>{
  const pads=pair.map(e=>({...e,duration:.95}));
  expect(contrastKeyboardPair(pads,{style:'ballad',instrument:'organ',tempo:120,ppq:192,endTicks:[384,768]})).toEqual(pads);
 });
 it('keeps Bossa shorter than Swing without importing swing offsets',()=>{
  const bossa=contrastKeyboardPair(pair,{style:'bossa-nova',instrument:'piano',tempo:120,ppq:192,endTicks:[768,768]});
  const swing=contrastKeyboardPair(pair,{style:'swing',instrument:'piano',tempo:120,ppq:192,endTicks:[768,768]});
  expect(bossa[1].duration).toBeLessThan(swing[1].duration);
  expect(bossa.map(e=>e.time)).toEqual(pair.map(e=>e.time));
 });
 it('voices an existing snare pair as an accented statement and ghosted answer',()=>{
  const hits=[{drum:'snare' as const,beatOffset:.5,velocity:.3,role:'commentary' as const},{drum:'snare' as const,beatOffset:2,velocity:.3,role:'commentary' as const}];
  const after=ghostSnareAnswer(hits);
  expect(after[0].velocity).toBeCloseTo(.324);expect(after[1].velocity).toBeCloseTo(.15);
  expect(after.map(({velocity,expression,...h})=>h)).toEqual(hits.map(({velocity,...h})=>h));
 });
 it('ghosts only the interior snare of an existing fill, keeping its launch and landing',()=>{
  const hits=[0,1/3,2/3].map(beatOffset=>({drum:'snare' as const,beatOffset,velocity:.3,role:'commentary' as const}));
  const after=ghostSnareAnswer(hits);expect(after.map(h=>h.velocity)).toEqual([.3,.15,.3]);
  expect(after[0]).toEqual(hits[0]);expect(after[2]).toEqual(hits[2]);
 });
 it('preserves both ends of a two-hit setup',()=>{
  const hits=[0,1].map(beatOffset=>({drum:'snare' as const,beatOffset,velocity:.3,role:'commentary' as const}));
  expect(ghostSnareAnswer(hits,true)).toEqual(hits);
 });
 it('never ghosts a reserved accent, kick or single commentary hit',()=>{
  for(const hits of [[{drum:'snare' as const,beatOffset:1,velocity:.4}], [{drum:'kick' as const,beatOffset:1,velocity:.3},{drum:'snare' as const,beatOffset:2,velocity:.3}], [{drum:'snare' as const,beatOffset:1,velocity:.3,role:'accent' as const},{drum:'snare' as const,beatOffset:2,velocity:.3}]]) expect(ghostSnareAnswer(hits)).toEqual(hits);
 });
});
