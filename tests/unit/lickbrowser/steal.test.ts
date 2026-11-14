import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {Phrase} from '$lib/types/music';
import type {Excerpt} from '$lib/lickbrowser/types';
const state=vi.hoisted(()=>({licks:[] as Phrase[],fail:false}));
vi.mock('$lib/persistence/user-licks',()=>({getUserLicksLocal:()=>state.licks,saveUserLick:vi.fn((phrase:Phrase)=>{const saved={...phrase,id:'personal-copy'};if(!state.fail)state.licks.push(saved);return saved;})}));
vi.mock('$lib/persistence/lick-practice-store',()=>({seedStolenLickPracticeDefaults:vi.fn()}));
import {saveUserLick} from '$lib/persistence/user-licks';
import {seedStolenLickPracticeDefaults} from '$lib/persistence/lick-practice-store';
import {stealExcerpt,excerptReference} from '$lib/lickbrowser/steal';
const excerpt={id:'1-40',sourceId:1,notationEnd:192} as Excerpt;
const score={id:'1-40',name:'Artist — Tune',key:'C',mode:'minor',notes:[{pitch:60,offset:[0,1],duration:[1,4]}],harmony:[],tags:[]} as unknown as Phrase;
beforeEach(()=>{state.licks=[];state.fail=false;vi.clearAllMocks();});
describe('Stealing a Weimar excerpt',()=>{
 it('Creates a personal copy preserving score and source attribution',()=>{
  const saved=stealExcerpt(score,excerpt);
  expect(saveUserLick).toHaveBeenCalledWith(expect.objectContaining({id:'',notes:score.notes,key:'C',mode:'minor'}));
  expect(saved.tags).toContain(excerptReference(excerpt));
  expect(saved.source).toContain('Weimar Jazz Database');
  expect(seedStolenLickPracticeDefaults).toHaveBeenCalledWith(saved);
  expect(score.id).toBe('1-40');
 });
 it('Keeps user edits and avoids a duplicate on a repeated steal',()=>{
  const saved=stealExcerpt(score,excerpt);saved.name='My edited name';
  expect(stealExcerpt(score,excerpt).name).toBe('My edited name');
  expect(saveUserLick).toHaveBeenCalledTimes(1);
 });
 it('Does not report success when local storage refuses the save',()=>{
  state.fail=true;expect(()=>stealExcerpt(score,excerpt)).toThrow('could not be saved');
  expect(seedStolenLickPracticeDefaults).not.toHaveBeenCalled();
 });
});
