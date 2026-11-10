/** Causal top-note steps, anchored only to the previous actually emitted chord. */
import type { BackingStyle } from '$lib/types/instruments';
import type { PerformanceEnergy } from './performance-energy';
import type { CoordinatedVoicingMemory } from './coordinated-voicing';
import { createRng, seedFrom } from './generation-rng';

export type KeyboardLineContour = 'arch' | 'lift' | 'fall' | 'neighbor' | 'cadential' | 'slow_lift' | 'slow_fall' | 'settle';
export interface KeyboardLineRequest {
 readonly style: BackingStyle;
 readonly contour: KeyboardLineContour;
 readonly targetMidi: number;
 readonly anchorMidi: number;
 readonly stepSemitones: number;
 readonly maxGuideDetour: 2;
 readonly maxMovementDetour: 4;
 readonly maxTopLeap: 3 | 4 | 5;
}
export interface KeyboardLineInput {
 readonly style: BackingStyle;
 readonly phraseId: string;
 readonly tempo: number;
 readonly seed: number;
 readonly barIndex: number;
 readonly phraseStartBar: number;
 readonly phase: PerformanceEnergy['phase'];
 /** Accepted chord index inside this bar: later attacks sustain the current top-note aim. */
 readonly attackIndex: number;
 readonly previous?: CoordinatedVoicingMemory;
}
const swing = [
 { contour: 'arch', steps: [0,2,1,-2] },
 { contour: 'lift', steps: [0,1,2,-1] },
 { contour: 'fall', steps: [0,-1,-2,1] },
 { contour: 'neighbor', steps: [0,1,-1,0] }
] as const;
const bossa = [
 { contour: 'cadential', steps: [0,0,1,-1] },
 { contour: 'neighbor', steps: [0,1,0,-1] },
 { contour: 'cadential', steps: [0,0,-1,1] }
] as const;
const ballad = [
 { contour: 'slow_lift', steps: [0,0,2,0] },
 { contour: 'slow_fall', steps: [0,0,-2,0] },
 { contour: 'slow_lift', steps: [0,0,1,0] }
] as const;

export function planKeyboardLine(input: KeyboardLineInput): Readonly<KeyboardLineRequest> | undefined {
 if (!['swing','straight','bossa-nova','ballad'].includes(input.style) || !Number.isInteger(input.barIndex) ||
  !Number.isInteger(input.phraseStartBar) || input.phraseStartBar < 0 || input.barIndex < input.phraseStartBar ||
  !Number.isInteger(input.attackIndex) || input.attackIndex < 0 || !Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff ||
  !Number.isFinite(input.tempo) || input.tempo <= 0) throw new Error('Invalid keyboard line context');
 const anchorMidi = input.previous?.notes.at(-1);
 if (anchorMidi === undefined) return;
 if (!Number.isInteger(anchorMidi) || anchorMidi < 48 || anchorMidi > 84) throw new Error('Invalid previous keyboard line anchor');
 const position = (input.barIndex - input.phraseStartBar) % 4;
 const rng = createRng(seedFrom(input.phraseId,input.tempo,'keyboard-line-v1',input.phraseStartBar,input.seed));
 const settling = ['head_return','solo_release','ending'].includes(input.phase);
 const pattern = input.style === 'ballad' ? rng.pick(ballad) : input.style === 'bossa-nova' ? rng.pick(bossa) : rng.pick(swing);
 const settleSteps = input.style === 'ballad' ? [0,0,-1,0] : input.style === 'bossa-nova' ? [0,0,0,-1] : [0,-1,0,-2];
 const stepSemitones = input.attackIndex > 0 ? 0 : settling ? settleSteps[position] : pattern.steps[position];
 return Object.freeze({ style: input.style, contour: settling ? 'settle' : pattern.contour,
  anchorMidi, stepSemitones, targetMidi: Math.max(48,Math.min(84,anchorMidi+stepSemitones)),
  maxGuideDetour: 2, maxMovementDetour: 4, maxTopLeap: input.style === 'ballad' ? 3 : input.style === 'bossa-nova' ? 4 : 5 });
}
