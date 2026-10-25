/** Current-bar walking decisions with retained pitch history and committed launches. */
import { allowsBassScalarContinuation, selectBassScalarContinuation, bassScalarTrace, type BassScalarContinuation, type BassScalarHistory } from './backing-bass-continuation';
import type { RollingBackingDefinition } from './backing-rolling';
import type { BarInfo, BassEvent } from './backing-generation';
import type { EnsembleTiming } from './ensemble-timing';
import { generateBossaBass, chordToneIntervalsForBass, planBassRegisterArc, bassApproachPitches, type BassApproachDevice } from './backing-bass';
import { planBassTurnaround, skippedBassTurnaround, type BassTurnaroundTrace } from './backing-bass-turnaround';
import { createRng, seedFrom } from './generation-rng';
import { pitchClassToNumber } from './voicings';
import { fractionToFloat } from '$lib/music/intervals';
import { getScale } from '$lib/music/scales';
import { realizeScale } from '$lib/music/keys';
import { planStructuralBassFeel, type StructuralBassFeel } from './backing-bass-feel';

export interface RollingBassMemory {
	readonly previousMidi: number | null;
	readonly previousPreviousMidi: number | null;
	readonly direction: number;
	readonly segmentIndex: number | null;
	readonly segmentAnchor: number | null;
	readonly nextTarget: number | null;
	readonly approach: BassApproachDevice;
	readonly feel: 'two' | 'four';
	readonly pendingLaunch: BassTurnaroundTrace | null;
	readonly scalarHistory?: BassScalarHistory;
}
const pc = (midi: number) => (midi % 12 + 12) % 12;
function nearest(pcValue: number, center: number): number {
	const candidates = Array.from({ length: 28 }, (_, i) => i + 28).filter((midi) => pc(midi) === pcValue);
	return candidates.reduce((best, midi) => Math.abs(midi - center) < Math.abs(best - center) ? midi : best);
}

export function realizeRollingBass(score: RollingBackingDefinition, bar: number, info: BarInfo,
	timing: EnsembleTiming, previous?: RollingBassMemory): { events: BassEvent[]; memory: RollingBassMemory; trace: BassTurnaroundTrace[]; feelTrace?: StructuralBassFeel; continuationTrace?: readonly BassScalarContinuation[] } {
	const memory: RollingBassMemory = previous ?? { previousMidi: null, previousPreviousMidi: null, direction: 0, segmentIndex: null,
		segmentAnchor: null, nextTarget: null, approach: 'chromatic-below' as const, feel: 'four' as const, pendingLaunch: null };
	if (score.style === 'bossa-nova') {
		const infos = score.bars.map((entry, index) => index === bar ? info : entry);
		const events = generateBossaBass([...score.harmony], 4, { phraseId: score.phraseId, tempo: score.tempo,
			ppq: score.ppq, beatsPerBar: 4, swing: score.swing, timing: score.timingProfiles, ensembleTiming: timing }, infos, bar).events;
		for (const event of events) {
			const tick = Math.max(bar * 4 * score.ppq, parseInt(event.time));
			event.time = `${tick}i`;
			event.duration = Math.min(event.duration, ((bar + 1) * 4 * score.ppq - tick) * 60 / score.tempo / score.ppq);
		}
		const accepted = events.filter((event) => event.duration > 0);
		const last = accepted.at(-1)?.midi ?? memory.previousMidi;
		const before = accepted.at(-2)?.midi ?? memory.previousMidi;
		return { events: accepted, trace: [], memory: { ...memory, previousMidi: last, previousPreviousMidi: before,
			direction: last !== null && before !== null ? Math.sign(last - before) : 0, feel: 'two', pendingLaunch: null } };
	}
	let { previousMidi, previousPreviousMidi, direction, segmentIndex, segmentAnchor, nextTarget, approach } = memory;
	let pendingLaunch = memory.pendingLaunch;
	const centers = planBassRegisterArc(score.totalBars, [...score.bars], score.phraseId, score.tempo);
	const segments = score.harmony.map((segment) => {
		const root = pitchClassToNumber(segment.chord.root);
		const tones = chordToneIntervalsForBass(segment.chord.quality);
		const scale = getScale(segment.scaleId);
		const fallback = segment.chord.quality === 'min7b5' ? [1, 2, 2, 1, 2, 2, 2]
			: segment.chord.quality.startsWith('min') ? [2, 1, 2, 2, 2, 1, 2]
				: segment.chord.quality.startsWith('maj') ? [2, 2, 1, 2, 2, 2, 1] : [2, 2, 1, 2, 2, 1, 2];
		return { start: fractionToFloat(segment.startOffset) * 4, length: fractionToFloat(segment.duration) * 4, root,
			chordPcs: [0, tones.third, tones.fifth, ...(tones.seventh === null ? [] : [tones.seventh])].map((interval) => pc(root + interval)),
			scalePcs: realizeScale(segment.chord.root, scale?.intervals ?? fallback) };
	});
	const structuralFeels = score.style === 'ballad' ? undefined
		: planStructuralBassFeel(score.performanceForm, score.bars.map((entry) => entry.performanceEnergy), score.phraseId, score.tempo);
	const feelAt = (index: number): 'two' | 'four' => {
		if (score.style === 'ballad') return 'two';
		if (structuralFeels) return structuralFeels[index].feel;
		const context = score.bars[index];
		if ((context.chorusIndex ?? 0) !== 0 || context.isSectionFinalBar) return 'four';
		if (index % 4 === 3 && createRng(seedFrom(score.phraseId, score.tempo, 'bass-feel-escape', index)).chance(0.3)) return 'four';
		return createRng(seedFrom(score.phraseId, score.tempo, 'bass-feel', 0)).chance(0.65) ? 'two' : 'four';
	};
	const feel = feelAt(bar);
	const targetAt = (index: number, reference: number | null): number => {
		const segment = segments[index];
		const context = score.bars[Math.floor(segment.start / 4)];
		const targetRng = createRng(seedFrom(score.phraseId, score.tempo, 'bass-target', index));
		const targetPc = index === 0 || context.isChorusFirstBar ? segment.root
			: targetRng.weighted([{ value: segment.root, weight: 72 }, { value: segment.chordPcs[1], weight: 14 }, { value: segment.chordPcs[2], weight: 14 }]);
		let target = nearest(targetPc, centers[Math.floor(segment.start / 4)]);
		if (reference !== null && Math.abs(target - reference) > 7) {
			const nearby = nearest(targetPc, reference);
			if (Math.abs(nearby - centers[Math.floor(segment.start / 4)]) <= 9) target = nearby;
		}
		return target;
	};
	const trace: BassTurnaroundTrace[] = [];
	const continuationTrace: BassScalarContinuation[] = [];
	let scalarHistory: BassScalarHistory | undefined;
	const events: BassEvent[] = [];
	const endTick = (bar + 1) * 4 * score.ppq;
	const push = (absBeat: number, midi: number, durationBeats: number, velocity: number) => {
		const tick = Math.max(bar * 4 * score.ppq, timing.place(absBeat, 'bass'));
		if (tick >= endTick) return false;
		if (score.bassScalarContinuation) {
			if (Number.isInteger(absBeat)) scalarHistory = { pulse: { absBeat, midi, time: `${tick}i` }, ornamentAfterPulse: false };
			else if (scalarHistory) scalarHistory = { ...scalarHistory, ornamentAfterPulse: true };
		}
		events.push({ absBeat, midi, velocity, time: `${tick}i`, duration: Math.min(durationBeats * 60 / score.tempo,
			(endTick - tick) * 60 / score.tempo / score.ppq) });
		return true;
	};
	for (let beat = 0; beat < 4; beat++) {
		const absBeat = bar * 4 + beat;
		const index = segments.findIndex((segment) => absBeat >= segment.start && absBeat < segment.start + segment.length);
		const segment = segments[index];
		const isChange = segment.start === absBeat;
		let scalarChanged = false;
		if (index !== segmentIndex) {
			segmentAnchor = pendingLaunch?.notes.find((note) => note.absBeat === absBeat)?.midi ?? nextTarget ?? targetAt(index, previousMidi);
			segmentIndex = index;
			nextTarget = index + 1 < segments.length ? targetAt(index + 1, segmentAnchor) : null;
			approach = createRng(seedFrom(score.phraseId, score.tempo, 'bass-appr', index)).weighted<BassApproachDevice>([
				{ value: 'chromatic-below', weight: 28 }, { value: 'chromatic-above', weight: 16 },
				{ value: 'scalar', weight: 16 }, { value: 'dominant', weight: 14 }, { value: 'enclosure', weight: 12 }, { value: 'double-chromatic', weight: 8 }
			]);
		}
		const arrival = beat === 0 ? score.performanceForm.choruses.find((chorus, index, choruses) => index > 0 &&
			Math.max(choruses[index - 1].startBar, chorus.startBar - 2) === bar) : undefined;
		if (arrival) {
			let candidate: BassTurnaroundTrace;
			const arrivalSegment = segments.findIndex((entry) => entry.start === arrival.startBar * 4);
			if (arrival.startBar - bar !== 2) candidate = skippedBassTurnaround(bar, arrival.startBar, 'short_chorus');
			else if (feel !== 'four' || feelAt(bar + 1) !== 'four') candidate = skippedBassTurnaround(bar, bar + 2, 'non_walking');
			else if (!isChange || arrivalSegment < 0) candidate = skippedBassTurnaround(bar, bar + 2, 'unsupported_harmony');
			else if (info.ensemble!.bass.ornamentScale < 0.75 || ['leave_space', 'release'].includes(info.ensemble!.phraseIntent)) candidate = skippedBassTurnaround(bar, bar + 2, 'reserved_space');
			else if (info.ensemble!.responseOwner !== 'nobody') candidate = skippedBassTurnaround(bar, bar + 2, 'response_reserved');
			else if (info.ensemble!.coordinatedAccent || info.ensemble!.setupFor) candidate = skippedBassTurnaround(bar, bar + 2, 'arrival_reserved');
			else if (previousMidi === null) candidate = skippedBassTurnaround(bar, bar + 2, 'no_entry');
			else candidate = planBassTurnaround({ phraseId: score.phraseId, tempo: score.tempo, startBar: bar, arrivalBar: bar + 2,
				entryMidi: previousMidi, startMidi: segmentAnchor!, targetMidi: nearest(segments[arrivalSegment].root, centers[bar + 2]),
				beats: Array.from({ length: 8 }, (_, offset) => {
					const at = bar * 4 + offset;
					const chord = segments.find((entry) => at >= entry.start && at < entry.start + entry.length)!;
					return { absBeat: at, chordPcs: chord.chordPcs, scalePcs: chord.scalePcs, harmonicChange: at === chord.start };
				}) });
			trace.push(candidate);
			if (candidate.status === 'planned') pendingLaunch = candidate;
		}
		const committed = pendingLaunch?.notes.find((note) => note.absBeat === absBeat)?.midi;
		if (feel === 'two' && beat % 2 !== 0 && !isChange && committed === undefined) continue;
		let midi: number;
		if (committed !== undefined) {
			midi = committed;
			if (isChange) segmentAnchor = midi;
		} else if (isChange) midi = segmentAnchor!;
		else if (feel === 'two') {
			const wanted = beat === 0 ? segment.root : segment.chordPcs[2];
			midi = nearest(wanted, segmentAnchor!);
		} else if (nextTarget !== null && absBeat >= segment.start + segment.length - (['enclosure', 'double-chromatic'].includes(approach) && segment.length >= 4 ? 2 : 1)) {
			const pitches = bassApproachPitches(approach, nextTarget, segment.scalePcs,
				createRng(seedFrom(score.phraseId, score.tempo, 'rolling-bass-approach', index)));
			const remaining = segment.start + segment.length - absBeat;
			midi = pitches[Math.max(0, pitches.length - remaining)];
			while (midi < 28) midi += 12;
			while (midi > 55) midi -= 12;
		} else {
			const previousPitch = previousMidi ?? segmentAnchor!;
			const target = nextTarget ?? nearest(segment.root, centers[bar]);
			const options = Array.from({ length: 28 }, (_, offset) => offset + 28).filter((candidate) => candidate !== previousPitch && Math.abs(candidate - previousPitch) <= 5 &&
				(beat % 2 === 0 ? segment.chordPcs.includes(pc(candidate)) : segment.scalePcs.includes(pc(candidate))));
			const rng = createRng(seedFrom(score.phraseId, score.tempo, 'rolling-bass-pitch', absBeat));
			midi = options.length ? rng.weighted(options.map((candidate) => ({ value: candidate,
				weight: (Math.abs(candidate - previousPitch) <= 2 ? 4 : 1) * (Math.abs(candidate - target) < Math.abs(previousPitch - target) ? 2 : 1) *
					(candidate === previousPreviousMidi ? 0.4 : 1) * (direction !== 0 && Math.sign(candidate - previousPitch) === direction ? 1.25 : 1) }))) : nearest(segment.root, previousPitch);
		}
		if (score.bassScalarContinuation && beat === 1 && committed === undefined && !pendingLaunch && feel === 'four' &&
			segment.start === bar * 4 && segment.length === 4 && ['enclosure', 'double-chromatic'].includes(approach) && nextTarget !== null &&
			index > 0 && (score.harmony[index].chord.root !== score.harmony[index - 1].chord.root || score.harmony[index].chord.quality !== score.harmony[index - 1].chord.quality) &&
			allowsBassScalarContinuation(info.ensemble) && memory.scalarHistory?.pulse.absBeat === bar * 4 - 1 &&
			!memory.scalarHistory.ornamentAfterPulse && events.some(event => event.absBeat === bar * 4) &&
			!events.some(event => event.absBeat > bar * 4)) {
			const arrival = events.find(event => event.absBeat === bar * 4)!;
			const pitches = bassApproachPitches(approach, nextTarget, segment.scalePcs,
				createRng(seedFrom(score.phraseId, score.tempo, 'rolling-bass-approach', index)));
			let deviceEntry = pitches[0];
			while (deviceEntry < 28) deviceEntry += 12;
			while (deviceEntry > 55) deviceEntry -= 12;
			const selected = selectBassScalarContinuation({ phraseId: score.phraseId, tempo: score.tempo, boundaryAbsBeat: bar * 4,
				previousMidi: memory.scalarHistory.pulse.midi, arrivalMidi: arrival.midi, ordinaryMidi: midi,
				candidates: Array.from({ length: 28 }, (_, offset) => offset + 28), scalePcs: segment.scalePcs, deviceEntryMidi: deviceEntry });
			scalarChanged = selected !== midi;
			midi = selected;
		}
		const velocity = createRng(seedFrom(score.phraseId, score.tempo, 'rolling-bass-velocity', absBeat)).int(76, 88) + (beat === 0 ? 4 : beat === 2 ? 2 : 0);
		const durationBeats = feel === 'two' ? 1.7 : 0.85;
		const acceptedPulse = push(absBeat, midi, structuralFeels && feel === 'two' ? Math.min(durationBeats, segment.start + segment.length - absBeat) : durationBeats, velocity);
		if (scalarChanged) {
			const arrival = events.find(event => event.absBeat === bar * 4);
			const continuation = events.find(event => event.absBeat === absBeat);
			if (arrival && continuation) continuationTrace.push(bassScalarTrace(memory.scalarHistory!.pulse, arrival, continuation));
		}
		if (!pendingLaunch && feel === 'four'  && createRng(seedFrom(score.phraseId, score.tempo, 'rolling-bass-ghost', absBeat)).chance(0.06 * info.ensemble!.bass.ornamentScale)) push(absBeat + 0.5, midi, 0.2, 38);
		if (!score.bassScalarContinuation || acceptedPulse) {
			previousPreviousMidi = previousMidi;
			if (previousMidi !== null) direction = Math.sign(midi - previousMidi);
			previousMidi = midi;
		}
	}
	if (pendingLaunch && pendingLaunch.arrivalBar <= bar) pendingLaunch = null;
	return { events, trace, ...(continuationTrace.length ? { continuationTrace } : {}), ...(structuralFeels ? { feelTrace: structuralFeels[bar] } : {}), memory: { previousMidi, previousPreviousMidi, direction, segmentIndex, segmentAnchor, nextTarget, approach, feel, pendingLaunch, ...(scalarHistory ? { scalarHistory } : {}) } };
}
