import type { DetectedNote } from '$lib/types/audio';
import { fitPhraseRhythm, type RhythmFit } from '$lib/music/phrase-rhythm';

const TICKS = 6;
const END = 8 * 4 * TICKS;
const SLOTS = [0, 2, 3, 4] as const;

/** Score a complete lick against the count-in clock, keeping tempo fixed. */
export function quantizeRecorderRhythm(detected: DetectedNote[], tempo: number, skipCosts: number[] = detected.map((): number => Infinity), firstTick?: number, endingRelease?: number): RhythmFit {
  if (firstTick !== undefined && (!Number.isInteger(firstTick) || firstTick < 0 || firstTick >= END ||
    !SLOTS.some(slot => slot === firstTick % TICKS))) throw new RangeError('Invalid first-note position');
  return fitRecorder(detected, tempo, skipCosts, firstTick, endingRelease);
}

/** Fixed comparison against the previous phrase-level recorder, before acoustic boundary selection. */
export function previousRecorderRhythm(detected: DetectedNote[], tempo: number): RhythmFit {
  return fitRecorder(detected, tempo);
}

/** Adapt recorder seconds to the shared beat-domain fitter without changing its policy. */
function fitRecorder(detected: DetectedNote[], tempo: number, skipCosts?: number[], firstTick?: number, endingRelease?: number): RhythmFit {
  const beatSeconds = 60 / tempo;
  const input = detected.filter(n => n.onsetTime < END / TICKS * beatSeconds);
  return fitPhraseRhythm(input.map(n => ({ pitch: n.midi, at: n.onsetTime / beatSeconds,
    release: (n.onsetTime + n.duration) / beatSeconds })), {
    endBeat: END / TICKS, beatSeconds, skipCosts, firstTick,
    endingRelease: input.length === detected.length && endingRelease !== undefined ? endingRelease / beatSeconds : undefined,
  });
}
