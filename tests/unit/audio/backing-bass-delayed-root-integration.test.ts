import { describe, expect, it } from 'vitest';
import { advanceRollingBacking, createRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { realizeRollingBass } from '$lib/audio/backing-rolling-bass';
import { restoreEnsembleTiming } from '$lib/audio/ensemble-timing';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { assessListeningTune, buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';

const styles = ['swing', 'straight', 'bossa-nova', 'ballad'] as const;
function fixture(style: typeof styles[number]) {
 const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
 if (!admitted.ok) throw new Error(admitted.reason);
 // The seed42 Blues has no selected Bossa opportunity. Keep that legal fallback,
 // and use its real native AABA performance to exercise the Bossa device/protections.
 const { phrase } = style === 'bossa-nova' ? admitted.session : buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, key: 'F', soloChoruses: 2 });
 const tempo = style === 'ballad' ? 80 : 140;
 return createRollingBacking(phrase.harmony!, BACKING_STYLES[style], { phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4,
  swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo), sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {} },
 { returningMelodySpace: true, performanceEnergySeed: 42, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
  chorusBoundaryPriority: true, keyboardTexture: true, keyboardPhrasing: 'piano', bassDelayedRoot: true });
}
function contexts(score: ReturnType<typeof fixture>) {
 let checkpoint: RollingBackingCheckpoint | undefined;
 return Array.from({ length: score.totalBars }, (_, bar) => {
  const prior = checkpoint, actual = advanceRollingBacking(score, prior); checkpoint = actual.checkpoint;
  const plan = actual.ensemblePlan.bars[0], info = { ...score.bars[bar], ensemble: plan, intensity: plan.energy };
  const timing = restoreEnsembleTiming({ phraseId: score.phraseId, tempo: score.tempo, ppq: score.ppq, swing: score.swing,
   timingProfiles: score.timingProfiles, trace: [actual.checkpoint.timing] });
  const result = realizeRollingBass(score, bar, info, timing, prior?.bass);
  const ordinary = realizeRollingBass({ ...score, bassDelayedRootVersion: undefined }, bar, info, timing, prior?.bass);
  return { bar, prior, info, timing, result, ordinary };
 });
}

describe('delayed roots in native full-tune bass realization', () => {
 for (const style of styles) it(`${style}: offers audible delayed roots in a full ${style === 'bossa-nova' ? 'AABA' : 'F Blues'} without altering native rhythm or committed history`, () => {
  const score = fixture(style), bars = contexts(score), changed = bars.filter(bar => bar.result.delayedRootTrace);
  process.stdout.write(`delayed-root-witness ${style} ${JSON.stringify(changed.map(bar => ({ bar: bar.bar, degree: bar.result.delayedRootTrace!.degree,
   notes: bar.result.delayedRootTrace!.notes.map(note => [note.absBeat, note.midi]) })))}\n`);
  expect(changed.length).toBeGreaterThan(0);
  expect(changed.length).toBeLessThan(score.totalBars / 3);
  for (const { result, ordinary, prior, bar } of bars) {
   const rhythm = (events: typeof result.events) => events.map(({ midi: _midi, ...event }) => event);
   expect(rhythm(result.events)).toEqual(rhythm(ordinary.events));
   if (!result.delayedRootTrace) { expect(result).toEqual(ordinary); continue; }
   const trace = result.delayedRootTrace;
   expect(trace.notes[0].absBeat).toBe(bar * 4);
   expect(trace.notes[0].midi % 12).not.toBe(trace.rootPc);
   expect(trace.notes[1].midi % 12).toBe(trace.rootPc);
   expect(trace.notes[1].absBeat).toBe(bar * 4 + (result.memory.feel === 'four' ? 1 : 2));
   expect(Math.abs(trace.notes[0].midi - prior!.bass.previousMidi!)).toBeLessThanOrEqual(7);
   if (trace.notes[0].midi !== ordinary.events[0].midi) expect(Math.abs(trace.notes[0].midi - prior!.bass.previousMidi!)).toBeLessThanOrEqual(5);
   for (const note of trace.notes) expect(result.events).toContainEqual(expect.objectContaining(note));
   expect(result.events.every(event => event.midi >= 28 && event.midi <= 55)).toBe(true);
   const history = style === 'bossa-nova' ? result.events : result.events.filter(event => Number.isInteger(event.absBeat));
   expect(result.memory.previousMidi).toBe(history.at(-1)!.midi);
   expect(result.memory.previousPreviousMidi).toBe(history.at(-2)!.midi);
   expect(result.memory.direction).toBe(Math.sign(history.at(-1)!.midi - history.at(-2)!.midi));
   if (result.memory.scalarHistory) expect(result.memory.scalarHistory.pulse.midi).toBe(history.at(-1)!.midi);
  }
 });
 for (const style of styles) it(`${style}: explicit reservations and current solo density retain the complete ordinary line`, () => {
  const score = fixture(style), candidate = contexts(score).find(bar => bar.result.delayedRootTrace);
  expect(candidate).toBeDefined();
  const { bar, prior, info, timing } = candidate!, plan = info.ensemble;
  const accent = { id: 'reserved-arrival', targetBarIndex: bar, beatOffset: 0 as const, strength: 1, participants: ['bass', 'drums'] as const };
  for (const ensemble of [
   { ...plan, responseOwner: 'piano' as const }, { ...plan, coordinatedAccent: accent }, { ...plan, setupFor: accent },
   { ...plan, drums: { ...plan.drums, allowFill: true } },
   { ...plan, piano: { ...plan.piano, rootlessTexture: { request: 'two' as const, reason: 'dense_soloist' as const } }, bass: { ...plan.bass, ornamentScale: .35 } },
   { ...plan, phraseIntent: 'leave_space' as const }
  ]) {
   const protectedInfo = { ...info, ensemble };
   expect(realizeRollingBass(score, bar, protectedInfo, timing, prior!.bass)).toEqual(
    realizeRollingBass({ ...score, bassDelayedRootVersion: undefined }, bar, protectedInfo, timing, prior!.bass));
  }
  for (const flag of ['isSectionFirstBar', 'isSectionFinalBar', 'isChorusFirstBar', 'isChorusFinalBar', 'isFinalBar'] as const) {
   const protectedInfo = { ...info, [flag]: true };
   expect(realizeRollingBass(score, bar, protectedInfo, timing, prior!.bass)).toEqual(
    realizeRollingBass({ ...score, bassDelayedRootVersion: undefined }, bar, protectedInfo, timing, prior!.bass));
  }
  const targetBeat = candidate!.result.delayedRootTrace!.notes[1].absBeat;
  const unavailable = { ...timing, place: (beat: number, role: Parameters<typeof timing.place>[1]) =>
   beat === targetBeat ? (bar + 1) * 4 * score.ppq : timing.place(beat, role) };
  expect(realizeRollingBass(score, bar, info, unavailable, prior!.bass)).toEqual(
   realizeRollingBass({ ...score, bassDelayedRootVersion: undefined }, bar, info, unavailable, prior!.bass));
 });
});
