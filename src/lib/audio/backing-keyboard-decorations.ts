/** Ordered decorations of already admitted keyboard attacks; no rhythm selection or future budget. */
import type { RollingBackingDefinition } from './backing-rolling';
import type { RollingPianoMemory } from './backing-rolling-piano';
import type { BarInfo, BassEvent, CompEvent, CoordinatedPianoVoicing } from './backing-generation';
import type { PianoContourMemory } from './backing-piano-contour';
import { describeCoordinatedPlacement, type CoordinatedVoicingMemory } from './coordinated-voicing';
import { proposeKeyboardSuspension, proposeKeyboardResolutionColors, type KeyboardResolutionColor } from './backing-keyboard-suspension';
import { chromaticInnerPair } from './backing-inner-motion';
import { fourthStack } from './backing-phrase-dialogue';
import { dropThirdVoice, spreadFitsBass } from './backing-ensemble-colors';
import { upperStructureTriad, upperStructureFitsBass } from './backing-phrase-colors';
import { pitchClassToNumber } from './voicings';
import { allowsDominantColor, colorDominantNinth, dominantColorFitsBass } from './backing-trio-conversation';
import { selectsPhraseExpression, contrastKeyboardPair } from './backing-phrase-expression';
import { createRng, seedFrom } from './generation-rng';
import { fractionToFloat } from '$lib/music/intervals';

interface DecorationContext {
 readonly score: RollingBackingDefinition;
 readonly bar: number;
 readonly info: BarInfo;
 readonly phraseStart: number;
 readonly barEnd: number;
 readonly backgroundHarmony: boolean;
 readonly arrival: boolean;
 readonly proposal: boolean;
 readonly nativeLatePad: boolean;
 readonly guideTones: boolean;
 readonly contourEnabled: boolean;
 readonly memory: RollingPianoMemory;
 readonly bassEvents?: readonly BassEvent[];
 readonly lastVoicingPredecessor?: CoordinatedVoicingMemory;
}
interface DecorationState {
 events: CompEvent[];
 voicingTrace: CoordinatedPianoVoicing[];
 lastSuspensionBar?: number;
 lastVoicing: number[];
 segmentVoicing: number[];
 voicingMemory?: CoordinatedVoicingMemory;
 contourMemory?: PianoContourMemory;
}

/** Keep policy priority and seeded draws exact, with small independently compiled stages. */
export function applyKeyboardDecorations(context: DecorationContext, state: DecorationState): DecorationState {
 applySuspension(context, state);
 applyExpression(context, state);
 applyDominantColor(context, state);
 applyUpperStructure(context, state);
 applySpread(context, state);
 applyFourthStack(context, state);
 applyInnerMotion(context, state);
 return state;
}

function applySuspension(context: DecorationContext, state: DecorationState): void {
 const { score, bar, info, phraseStart, backgroundHarmony, arrival, proposal, nativeLatePad, guideTones, memory, bassEvents } = context;
 const { events, voicingTrace } = state;
 const ensemble = info.ensemble!;
	// An atomic two-attack cell: the resolution is already in this accepted bar,
	// never borrowed from a future bar or another player's response allowance.
	// The 0.10 color cell commits its actual resolution to subsequent history;
	// both native attack envelopes remain unchanged.
	if (score.keyboardSuspensionsVersion && events.length === 2 && voicingTrace.length === 2 &&
		!backgroundHarmony && !arrival && !proposal && !nativeLatePad && !guideTones &&
		ensemble.responseOwner === 'nobody' && !ensemble.coordinatedAccent && !info.isSectionFinalBar && !info.isFinalBar &&
		['solo_build', 'solo_peak', 'solo_release'].includes(ensemble.performanceEnergy?.phase ?? '') &&
		!['active_soloist', 'dense_soloist', 'under_response'].includes(ensemble.piano.rootlessTexture?.reason ?? '') &&
		voicingTrace[0].decision.keyboardContraryMotion?.status !== 'changed' &&
		(state.lastSuspensionBar === undefined || bar - state.lastSuspensionBar >= 3) &&
		createRng(seedFrom(score.phraseId, score.bars[phraseStart].pianoPresenceSeed ?? 0, bar, 'suspension-cell')).chance(.7)) {
		const [first, second] = events;
		const segmentAt = (event: CompEvent) => score.harmony.findIndex(segment => {
			const lookup = event.absBeat + (event.absBeat % 1 ? .5 : 0);
			return lookup >= fractionToFloat(segment.startOffset) * 4 &&
				lookup < (fractionToFloat(segment.startOffset) + fractionToFloat(segment.duration)) * 4;
		});
		const index = segmentAt(first), segment = score.harmony[index];
		const gap = second.absBeat - first.absBeat;
		if (segment && index === segmentAt(second) && first.absBeat >= fractionToFloat(segment.startOffset) * 4 &&
			gap >= .5 && gap <= 3 && parseFloat(first.time) + first.duration * score.tempo / 60 * score.ppq <= parseFloat(second.time) + 1e-8 &&
			voicingTrace[0].decision.resolvedFamily === voicingTrace[1].decision.resolvedFamily) {
			const input = { chord: segment.chord, family: voicingTrace[0].decision.resolvedFamily,
				notes: first.notes, resolutionNotes: second.notes };
			const original = proposeKeyboardSuspension(input);
			const candidates: (NonNullable<typeof original> & { kind?: KeyboardResolutionColor['kind'] })[] = [
				...(original ? [original] : []), ...(score.keyboardSuspensionsVersion === 2 ? proposeKeyboardResolutionColors(input) : [])
			];
			const compatible = candidates.filter(cell => {
				const conflicts = (event: CompEvent, note: number) => !bassEvents || bassEvents.some(bass => {
					const distance = (bass.midi - note + 120) % 12;
					const clashes = score.keyboardSuspensionsVersion === 2 ? distance === 1 || distance === 11 : bass.midi % 12 === cell.toMidi % 12;
					const onset = parseFloat(event.time), release = onset + event.duration * score.tempo / 60 * score.ppq;
					return clashes && parseFloat(bass.time) < release && parseFloat(bass.time) + bass.duration * score.tempo / 60 * score.ppq > onset;
				});
				return !conflicts(first, cell.fromMidi) && (!cell.kind || !conflicts(second, cell.toMidi)) &&
					![cell.suspendedNotes,cell.resolutionNotes].some(notes => voicingTrace[0].decision.spacing?.applied === 'open' && notes.at(-1)! - notes[0] < 14);
			});
			const cell = !compatible.length ? undefined : score.keyboardSuspensionsVersion === 2
				? createRng(seedFrom(score.phraseId, score.bars[phraseStart].pianoPresenceSeed ?? 0, bar, 'resolution-color')).pick(compatible) : compatible[0];
			if (cell) {
				state.lastSuspensionBar = bar;
				events[0] = { ...first, notes: [...cell.suspendedNotes] };
				events[1] = { ...second, notes: [...cell.resolutionNotes] };
				if (cell.kind) {
					state.lastVoicing = events[1].notes; state.segmentVoicing = events[1].notes;
					state.voicingMemory = Object.freeze({ version: 1, chord: Object.freeze({ ...segment.chord }), notes: Object.freeze([...events[1].notes]) });
				}
				for (const attack of [0, 1] as const) {
					const voiced = voicingTrace[attack], notes = Object.freeze([...events[attack].notes]);
					// These comparisons were made before decoration, so do not expose
					// them as claims about the performed suspension or its resolution.
					const { keyboardLine: _line, keyboardContraryMotion: _contrary, ...decision } = voiced.decision;
					// A resolved root is no longer an actual rootless texture; the family
					// and phrase texture still describe the selected base/request.
					if (cell.kind === '9-1' && attack === 1) delete decision.rootlessTexture;
					const previous = attack === 0 ? memory.voicing : { version: 1 as const, chord: segment.chord, notes: cell.suspendedNotes };
					voicingTrace[attack] = Object.freeze({ ...voiced, notes, decision: Object.freeze({ ...decision,
						...describeCoordinatedPlacement(segment.chord, notes, decision.resolvedFamily, Math.round(58 + 8 * info.intensity), previous),
						...(decision.spacing ? { spacing: Object.freeze({ ...decision.spacing, spanSemitones: notes.at(-1)! - notes[0] }) } : {}),
						keyboardSuspension: Object.freeze({ ...(cell.kind ? { kind: cell.kind, chordRoot: segment.chord.root } : {}), phase: attack === 0 ? 'suspension' as const : 'resolution' as const,
							fromMidi: cell.fromMidi, toMidi: cell.toMidi, suspensionAbsBeat: first.absBeat, resolutionAbsBeat: second.absBeat }) }) });
				}
			}
		}
	}
}

function applyExpression(context: DecorationContext, state: DecorationState): void {
 const { score, info, barEnd, backgroundHarmony, arrival, proposal, nativeLatePad, guideTones } = context;
 const { events, voicingTrace } = state;
	if (score.phraseExpressionVersion && selectsPhraseExpression(info, score.phraseId, 'piano') &&
  !backgroundHarmony && !arrival && !proposal && !nativeLatePad && !guideTones &&
  events.length === 2 && voicingTrace.length === 2 && !voicingTrace.some(v => v.decision.keyboardSuspension)) {
  const endTicks = events.map(event => {
   const beat = event.absBeat;
   const segment = score.harmony.find(s => beat >= fractionToFloat(s.startOffset)*4 && beat < (fractionToFloat(s.startOffset)+fractionToFloat(s.duration))*4);
   return segment ? Math.min(barEnd, (fractionToFloat(segment.startOffset)+fractionToFloat(segment.duration))*4*score.ppq) : parseInt(event.time);
  });
  const shaped = contrastKeyboardPair(events, { style: score.style ?? 'swing', instrument: score.keyboardPhrasing!.instrument,
   tempo: score.tempo, ppq: score.ppq, endTicks });
  for (const [i,event] of shaped.entries()) if (event.expression) {
   events[i] = event;
   const { keyboardArticulation: _articulation, ...decision } = voicingTrace[i].decision;
   voicingTrace[i] = Object.freeze({ ...voicingTrace[i], decision: Object.freeze(decision) });
  }
 }
}

function applyDominantColor(context: DecorationContext, state: DecorationState): void {
 const { score, bar, info, barEnd, backgroundHarmony, arrival, proposal, nativeLatePad, guideTones, bassEvents, lastVoicingPredecessor } = context;
 const { events, voicingTrace } = state;
 // Color only the last accepted attack before a declared dominant-to-tonic
 // boundary. The next harmony is chart knowledge, never a future performed note.
 if(score.trioConversationVersion && allowsDominantColor(info) && !backgroundHarmony && !arrival && !proposal &&
  !nativeLatePad && !guideTones && events.length && voicingTrace.length===events.length &&
  !voicingTrace.some(v=>v.decision.keyboardSuspension) &&
  createRng(seedFrom(score.phraseId,score.bars[bar].pianoPresenceSeed??0,bar,'dominant-b9')).chance(.8)) {
  const event=events.at(-1)!, trace=voicingTrace.at(-1)!;
  const index=score.harmony.findIndex(s=>event.absBeat>=fractionToFloat(s.startOffset)*4 && event.absBeat<(fractionToFloat(s.startOffset)+fractionToFloat(s.duration))*4);
  const segment=score.harmony[index], next=score.harmony[index+1];
  if(segment?.chord.quality==='7' && next && event.absBeat+(event.absBeat % 1 ? 0.5 : 0)<(bar+1)*4 && ['rootless-a','rootless-b','shell','drop2'].includes(trace.decision.resolvedFamily) &&
   (fractionToFloat(segment.startOffset)+fractionToFloat(segment.duration))*4===(bar+1)*4 &&
   fractionToFloat(next.startOffset)*4===(bar+1)*4 &&
   (pitchClassToNumber(next.chord.root)-pitchClassToNumber(segment.chord.root)+12)%12===5) {
   const rootPc=pitchClassToNumber(segment.chord.root), cell=colorDominantNinth(event.notes,rootPc);
   const onset=parseInt(event.time), release=onset+event.duration*score.tempo/60*score.ppq;
   if(cell && dominantColorFitsBass(event,bassEvents,rootPc,score.tempo,score.ppq) && release<=barEnd+1e-8) {
    const receipt=Object.freeze({kind:'dominant-b9' as const,fromMidi:cell.fromMidi,toMidi:cell.toMidi,rootPc,targetRootPc:pitchClassToNumber(next.chord.root)});
    events[events.length-1]={...event,notes:cell.notes,conversation:receipt};
    state.lastVoicing=cell.notes;state.segmentVoicing=cell.notes;
    // Retain the actual preceding harmony too: a bar may contain two chords.
    const previous=lastVoicingPredecessor;
    state.voicingMemory=Object.freeze({version:1,chord:Object.freeze({...segment.chord}),notes:Object.freeze([...cell.notes])});
    const {keyboardLine:_line,keyboardContraryMotion:_contrary,...decision}=trace.decision;
    voicingTrace[voicingTrace.length-1]=Object.freeze({...trace,notes:Object.freeze([...cell.notes]),decision:Object.freeze({...decision,
     ...describeCoordinatedPlacement(segment.chord,cell.notes,decision.resolvedFamily,Math.round(58+8*info.intensity),previous),
     ...(decision.spacing?{spacing:Object.freeze({...decision.spacing,spanSemitones:cell.notes.at(-1)!-cell.notes[0]})}:{}),keyboardColor:receipt})});
   }
  }
 }
}

function applyUpperStructure(context: DecorationContext, state: DecorationState): void {
 const { score, bar, info, backgroundHarmony, arrival, proposal, nativeLatePad, guideTones, contourEnabled, bassEvents, lastVoicingPredecessor } = context;
 const { events, voicingTrace } = state;
 // Expand one existing dominant attack into a complete upper structure;
 // accepted suspensions, replies and 0.12 colors retain their own promises.
 if(score.phraseColorsVersion && allowsDominantColor(info) && !backgroundHarmony && !arrival && !proposal && !nativeLatePad && !guideTones &&
  events.length && voicingTrace.length===events.length && !voicingTrace.some(v=>v.decision.keyboardSuspension) &&
  createRng(seedFrom(score.phraseId,score.bars[bar].pianoPresenceSeed??0,bar,'upper-structure')).chance(.65)) {
  const event=events.at(-1)!,trace=voicingTrace.at(-1)!;
  const lookup=event.absBeat+(event.absBeat%1?0.5:0);
  const segment=score.harmony.find(s=>lookup>=fractionToFloat(s.startOffset)*4&&lookup<(fractionToFloat(s.startOffset)+fractionToFloat(s.duration))*4);
  if(!event.conversation && segment?.chord.quality==='7' && ['rootless-a','rootless-b','drop2','shell'].includes(trace.decision.resolvedFamily)) {
   const rootPc=pitchClassToNumber(segment.chord.root),cell=upperStructureTriad(event.notes,rootPc);
   if(cell && upperStructureFitsBass(event,bassEvents,rootPc,score.tempo,score.ppq,cell.addedMidi)) {
    const receipt=Object.freeze({kind:'upper-structure' as const,rootPc,addedMidi:cell.addedMidi,originalNotes:Object.freeze([...event.notes])});
    events[events.length-1]={...event,notes:cell.notes,phraseColor:receipt};
    if(contourEnabled && state.contourMemory) state.contourMemory=Object.freeze({...state.contourMemory,lastTopMidi:cell.notes.at(-1)!});
    state.lastVoicing=cell.notes;state.segmentVoicing=cell.notes;
    state.voicingMemory=Object.freeze({version:1,chord:Object.freeze({...segment.chord}),notes:Object.freeze([...cell.notes])});
    const {keyboardLine:_line,keyboardContraryMotion:_contrary,keyboardTexture:_texture,rootlessTexture:_rootless,spacing:_spacing,...decision}=trace.decision;
    voicingTrace[voicingTrace.length-1]=Object.freeze({...trace,notes:Object.freeze([...cell.notes]),decision:Object.freeze({...decision,
     ...describeCoordinatedPlacement(segment.chord,cell.notes,decision.resolvedFamily,Math.round(58+8*info.intensity),lastVoicingPredecessor),
     ...(decision.topLine?{topLine:Object.freeze({...decision.topLine,actualMidi:cell.notes.at(-1)!,distance:Math.abs(cell.notes.at(-1)!-decision.topLine.targetMidi)})}:{}),upperStructure:receipt})});
   }
  }
 }
}

function applySpread(context: DecorationContext, state: DecorationState): void {
 const { score, bar, info, backgroundHarmony, arrival, proposal, nativeLatePad, guideTones, bassEvents, lastVoicingPredecessor } = context;
 const { events, voicingTrace } = state;
 // Open one admitted chord downward without changing its melody, rhythm or gate.
 if(score.ensembleColorsVersion && allowsDominantColor(info) && !backgroundHarmony && !arrival && !proposal && !nativeLatePad && !guideTones &&
  events.length && voicingTrace.length===events.length && !voicingTrace.some(v=>v.decision.keyboardSuspension) &&
  createRng(seedFrom(score.phraseId,score.bars[bar].pianoPresenceSeed??0,bar,'drop-three')).chance(.75)) {
  const event=events.at(-1)!,trace=voicingTrace.at(-1)!;
  const lookup=event.absBeat+(event.absBeat%1?0.5:0);
  const segment=score.harmony.find(s=>lookup>=fractionToFloat(s.startOffset)*4&&lookup<(fractionToFloat(s.startOffset)+fractionToFloat(s.duration))*4);
  const cell=dropThirdVoice(event.notes);
  if(!event.conversation && !event.phraseColor && cell && segment && ['rootless-a','rootless-b','drop2','shell'].includes(trace.decision.resolvedFamily) &&
   spreadFitsBass(event,cell.notes[0],bassEvents,score.tempo,score.ppq)) {
   const receipt=Object.freeze({kind:'drop3' as const,fromMidi:cell.fromMidi,toMidi:cell.toMidi,originalNotes:Object.freeze([...event.notes])});
   events[events.length-1]={...event,notes:cell.notes,ensembleColor:receipt};
   state.lastVoicing=cell.notes;state.segmentVoicing=cell.notes;
   state.voicingMemory=Object.freeze({version:1,chord:Object.freeze({...segment.chord}),notes:Object.freeze([...cell.notes])});
   const {keyboardLine:_line,keyboardContraryMotion:_contrary,keyboardTexture:_texture,rootlessTexture:_rootless,spacing:_spacing,...decision}=trace.decision;
   voicingTrace[voicingTrace.length-1]=Object.freeze({...trace,notes:Object.freeze([...cell.notes]),decision:Object.freeze({...decision,
    ...describeCoordinatedPlacement(segment.chord,cell.notes,decision.resolvedFamily,Math.round(58+8*info.intensity),lastVoicingPredecessor),spreadVoicing:receipt})});
  }
 }
}

function applyFourthStack(context: DecorationContext, state: DecorationState): void {
 const { score, bar, info, backgroundHarmony, arrival, proposal, nativeLatePad, guideTones, contourEnabled, bassEvents, lastVoicingPredecessor } = context;
 const { events, voicingTrace } = state;
 // A settled harmony can carry a fourth-stacked upper color above its defining shell.
 if(score.phraseDialogueVersion && allowsDominantColor(info) && !backgroundHarmony && !arrival && !proposal && !nativeLatePad && !guideTones &&
  events.length && voicingTrace.length===events.length && !voicingTrace.some(v=>v.decision.keyboardSuspension) &&
  createRng(seedFrom(score.phraseId,score.bars[bar].pianoPresenceSeed??0,bar,'fourth-stack')).chance(.8)) {
  const event=events.at(-1)!,trace=voicingTrace.at(-1)!;
  const lookup=event.absBeat+(event.absBeat%1?0.5:0);
  const at=(beat:number)=>score.harmony.find(s=>beat>=fractionToFloat(s.startOffset)*4&&beat<(fractionToFloat(s.startOffset)+fractionToFloat(s.duration))*4);
  const segment=at(lookup),prior=at(bar*4-.001);
  if(!event.conversation && !event.phraseColor && !event.ensembleColor && segment && prior &&
   ((segment.chord.root===prior.chord.root && segment.chord.quality===prior.chord.quality) ||
    (fractionToFloat(segment.startOffset)*4<=bar*4 && (fractionToFloat(segment.startOffset)+fractionToFloat(segment.duration))*4>=(bar+1)*4 && event.absBeat>=bar*4+1))) {
   const rootPc=pitchClassToNumber(segment.chord.root),notes=fourthStack(event.notes,rootPc,segment.chord.quality);
   if(notes && spreadFitsBass(event,notes[0],bassEvents,score.tempo,score.ppq)) {
    const velocityScale=Math.sqrt(event.notes.length/notes.length);
    const receipt=Object.freeze({kind:'fourth-stack' as const,originalVelocity:event.velocity,velocityScale,rootPc,third:segment.chord.quality==='min7'?3 as const:4 as const,seventh:segment.chord.quality==='maj7'?11 as const:10 as const,originalNotes:Object.freeze([...event.notes]),notes:Object.freeze([...notes])});
    events[events.length-1]={...event,notes,velocity:event.velocity*velocityScale,phraseDialogue:receipt};
    if(contourEnabled && state.contourMemory)state.contourMemory=Object.freeze({...state.contourMemory,lastTopMidi:notes.at(-1)!});
    state.lastVoicing=notes;state.segmentVoicing=notes;
    state.voicingMemory=Object.freeze({version:1,chord:Object.freeze({...segment.chord}),notes:Object.freeze([...notes])});
    const {keyboardLine:_line,keyboardContraryMotion:_contrary,keyboardTexture:_texture,rootlessTexture:_rootless,spacing:_spacing,...decision}=trace.decision;
    voicingTrace[voicingTrace.length-1]=Object.freeze({...trace,notes:receipt.notes,decision:Object.freeze({...decision,
     resolvedFamily:'quartal' as const,...describeCoordinatedPlacement(segment.chord,notes,'quartal',Math.round(58+8*info.intensity),lastVoicingPredecessor),
     ...(decision.topLine?{topLine:Object.freeze({...decision.topLine,actualMidi:notes.at(-1)!,distance:Math.abs(notes.at(-1)!-decision.topLine.targetMidi)})}:{}),fourthStack:receipt})});
   }
  }
 }
}

function applyInnerMotion(context: DecorationContext, state: DecorationState): void {
 const { score, bar, info, backgroundHarmony, arrival, proposal, nativeLatePad, guideTones, memory, bassEvents } = context;
 const { events, voicingTrace } = state;
 // Resolve a chromatic inner approach within an already accepted native pair.
 if(score.innerMotionVersion && allowsDominantColor(info) && !info.isSectionFinalBar && !backgroundHarmony && !arrival && !proposal && !nativeLatePad && !guideTones &&
  events.length===2 && voicingTrace.length===2 && !voicingTrace.some(v=>v.decision.keyboardSuspension || v.decision.keyboardContraryMotion?.status==='changed')) {
  const rng=createRng(seedFrom(score.phraseId,score.bars[bar].pianoPresenceSeed??0,bar,'chromatic-inner'));
  const at=(event:CompEvent)=>score.harmony.find(s=>event.absBeat+(event.absBeat%1?.5:0)>=fractionToFloat(s.startOffset)*4 && event.absBeat+(event.absBeat%1?.5:0)<(fractionToFloat(s.startOffset)+fractionToFloat(s.duration))*4);
  const segment=at(events[0]);
  if(rng.chance(.6) && segment?.chord.quality==='7' && segment===at(events[1]) && events[0].absBeat>=fractionToFloat(segment.startOffset)*4) {
   const colored=chromaticInnerPair(events,pitchClassToNumber(segment.chord.root),bassEvents,score.tempo,score.ppq);
   if(colored[0].innerMotion?.kind==='chromatic-inner') {
    for(const i of [0,1] as const) {
     events[i]=colored[i];const voiced=voicingTrace[i];
     const {keyboardLine:_line,keyboardContraryMotion:_contrary,...decision}=voiced.decision;
     const previous=i===0?memory.voicing:{version:1 as const,chord:segment.chord,notes:colored[0].notes};
     voicingTrace[i]=Object.freeze({...voiced,notes:Object.freeze([...colored[i].notes]),decision:Object.freeze({...decision,
      ...describeCoordinatedPlacement(segment.chord,colored[i].notes,decision.resolvedFamily,Math.round(58+8*info.intensity),previous),
      chromaticInner:colored[i].innerMotion as Extract<NonNullable<CompEvent['innerMotion']>,{kind:'chromatic-inner'}>})});
    }
   }
  }
 }
}
