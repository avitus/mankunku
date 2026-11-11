import type { DetectedNote } from '$lib/types/audio';
import type { Note } from '$lib/types/music';
import { reduceFraction } from '$lib/music/intervals';
import { applySwingToBeats, MAX_SWING } from '$lib/music/swing';

// Six ticks per quarter: straight eighths use tick 3; triplets use 2 and 4.
// A tick is a unit of notation. Its elapsed time depends on the swing feel.
const TICKS = 6;
const END = 8 * 4 * TICKS; // eight bars of recorder 4/4
const SLOTS = [0, 2, 3, 4] as const;
const SWINGS = [0.5, 0.6, 2 / 3, 0.75, MAX_SWING];
const isTriplet = (tick: number) => tick % TICKS === 2 || tick % TICKS === 4;

/** Reject straight and triplet offbeats occupying the same quarter-note beat. */
function mixesSubdivisions(from: number, to: number) {
	return Math.floor(from / TICKS) === Math.floor(to / TICKS) &&
		from % TICKS !== 0 && isTriplet(from) !== isTriplet(to);
}

interface Path {
	tick: number;
	index: number;
	cost: number;
	previous?: Path;
}

/** Cost a candidate interval against elapsed beats, allowing penalized collisions. */
function transition(from: number, to: number, elapsed: number, swing: number, pitchChanged: boolean): number {
	const length = to - from;
	if (length < 0) return Infinity;
	// Subdivision collisions are possible at the detector's resolution. Cost
	// them explicitly; prefer retaining a real articulation on a plausible slot.
	if (length === 0) return (pitchChanged ? 0.25 : 0.10) + elapsed * elapsed;
	if (mixesSubdivisions(from, to)) return Infinity;
	const interval = applySwingToBeats(to / TICKS, swing) - applySwingToBeats(from / TICKS, swing);
	const shapeCost = 0.6 * (elapsed - interval) ** 2;
	if (length % 3 === 0) return shapeCost; // eighths, quarters and their ties
	if (length === 2 || length === 4) return shapeCost + 0.006;
	return shapeCost + 0.055; // irregular spans between rhythmic figures
}

/** Keep the cheapest history ending at each slot so later attacks can resolve
 * earlier ambiguity, including across a barline. */
function align(times: number[], input: DetectedNote[], tripletEvidence: boolean[], swingAccent: number[], phase: number, swing: number, skipCosts?: number[], firstTick?: number): Path {
	let previous: Path[] = [];
	for (const [i, time] of times.entries()) {
		const beat = Math.max(0, Math.min(END / TICKS - 1, Math.floor(time - phase)));
		const next: Path[] = [];

		for (let b = Math.max(0, beat - 1); b <= Math.min(END / TICKS - 1, beat + 1); b++) {
			for (const slot of SLOTS) {
				const tick = b * TICKS + slot;
				if (i === 0 && firstTick !== undefined && tick !== firstTick) continue;
				const error = time - phase - applySwingToBeats(tick / TICKS, swing);
				// A lone ambiguous triplet subdivision is weaker evidence than a
				// complete figure. Prefer the simpler entrance when both fit.
				const tupletCost = skipCosts ? 0.060 : 0.031;
				const entranceCost = skipCosts && i === 0 && !tripletEvidence[i] && slot !== 0
					? (slot === 3 ? 0.025 : 0.08) : 0;
				const contrast = swingAccent[i];
				const accentCost = contrast > 0 && slot !== 0 ? contrast : contrast < 0 && slot !== 3 ? -contrast : 0;
				const local = error * error + accentCost + entranceCost + (isTriplet(tick) && !tripletEvidence[i] ? tupletCost : 0);
				let best = previous.length ? Infinity : 0;
				let parent: Path | undefined;
				for (const path of previous) {
					const cost = path.cost + transition(path.tick, tick, time - times[path.index], swing, input[i].midi !== input[path.index].midi);
					if (cost < best) {
						best = cost;
						parent = path;
					}
				}
				if (Number.isFinite(best)) next.push({ tick, index: i, cost: best + local, previous: parent });
			}
		}
		if (skipCosts && Number.isFinite(skipCosts[i])) {
			for (const path of previous) next.push({ ...path, cost: path.cost + skipCosts[i] });
		}
		previous = next;
	}
	return previous.reduce((a, b) => a.cost <= b.cost ? a : b);
}

/** Fit a release to a conventional duration without crossing the next attack. */
function releaseTick(start: number, limit: number, releaseBeat: number, phase: number, swing: number) {
	let bestEnd = limit;
	let bestCost = Infinity;
	for (let end = start + 1; end <= limit; end++) {
		if (!SLOTS.some(slot => slot === end % TICKS)) continue;
		if (mixesSubdivisions(start, end)) continue;
		const length = end - start;
		const error = applySwingToBeats(end / TICKS, swing) + phase - releaseBeat;
		// Prefer conventional lengths and metrically strong endings; allow
		// ties (including a 5/8 sustain) when the release supports them.
		const conventional = [3, 6, 12, 24].includes(length);
		const complexity = conventional ? 0 : length % 3 === 0 ? 0.025 : 0.07;
		const cost = error * error + complexity + (isTriplet(end) ? 0.035 : 0);
		if (cost < bestCost) {
			bestCost = cost;
			bestEnd = end;
		}
	}
	return bestEnd;
}

/** Score a complete lick against the count-in clock, keeping tempo fixed. */
export function quantizeRecorderRhythm(detected: DetectedNote[], tempo: number, skipCosts = detected.map(() => Infinity), firstTick?: number, endingRelease?: number) {
	if (firstTick !== undefined && (!Number.isInteger(firstTick) || firstTick < 0 || firstTick >= END ||
		!SLOTS.some(slot => slot === firstTick % TICKS))) throw new RangeError('Invalid first-note position');
	return fitRhythm(detected, tempo, skipCosts, firstTick, endingRelease);
}

/** Fixed comparison against the previous phrase-level recorder, before acoustic boundary selection. */
export function previousRecorderRhythm(detected: DetectedNote[], tempo: number) {
	return fitRhythm(detected, tempo);
}

/** Fit a shared clock and swing feel, then emit notes and rests within eight bars. */
function fitRhythm(detected: DetectedNote[], tempo: number, skipCosts?: number[], firstTick?: number, endingRelease?: number) {
	const beatSec = 60 / tempo;
	const input = detected.filter(n => n.onsetTime < END / TICKS * beatSec);
	if (!input.length) return { notes: [], phaseSeconds: 0, collisions: 0, omittedIndices: [] as number[] };
	const times = input.map(n => Math.max(0, n.onsetTime / beatSec));
	// Three near-equal attacks spaced by a third or two-thirds of a beat
	// support a true tuplet. A long–short swung pair alone never qualifies.
	const tripletEvidence = times.map(() => false);
	for (let i = 2; i < times.length; i++) {
		const left = times[i - 1] - times[i - 2];
		const right = times[i] - times[i - 1];
		if ([1 / 3, 2 / 3].some(span => Math.abs(left - span) < 0.075 && Math.abs(right - span) < 0.075)) {
			tripletEvidence.fill(true, i - 2, i + 1);
		}
	}
	// A long-short pair spanning one beat votes for the first attack
	// being on the beat. A short-long pair votes for its offbeat. Use
	// this only when several adjacent attacks establish the swing feel;
	// equal triplet subdivisions carry no vote.
	const swingAccent = times.map(() => 0);
	if (skipCosts) {
		for (let i = 0; i + 2 < times.length; i++) {
			const long = times[i + 1] - times[i];
			const short = times[i + 2] - times[i + 1];
			if (tripletEvidence[i] || Math.min(long, short) < 0.24 || Math.max(long, short) > 0.82 ||
				Math.abs(long + short - 1) > 0.15 || Math.abs(long - short) < 0.14) continue;
			swingAccent[i] = 0.30 * (long - short);
		}
		if (swingAccent.filter(Boolean).length < 2) swingAccent.fill(0);
	}
	let best: Path | undefined;
	let bestCost = Infinity;
	let phase = 0;
	let swing = 0.5;
	// Estimate one shared displacement from the scheduled entrance. The automatic
	// search stays bounded in both seconds and beats; at high tempos
	// several attacks can support a delay longer than half a beat.
	for (const feel of SWINGS) {
		const phases: number[] = [];
		if (firstTick !== undefined) {
			// A musician can explicitly place the first attack. Set the clock
			// for the entire phrase; preserve the measured intervals thereafter.
			const nominal = times[0] - applySwingToBeats(firstTick / TICKS, feel);
			for (let step = Math.ceil((nominal - 0.5) * 24); step <= (nominal + 0.5) * 24; step++) {
				phases.push(step / 24);
			}
		} else {
			for (let step = -4; step <= (skipCosts && input.length >= 4 ? 20 : 10); step++) {
				const offset = step / 24;
				if (offset * beatSec >= -0.09 && offset * beatSec <= (skipCosts ? 0.30 : 0.20)) phases.push(offset);
			}
		}
		for (const offset of phases) {
			const path = align(times, input, tripletEvidence, swingAccent, offset, feel, skipCosts, firstTick);
			const offsetCost = skipCosts ? 0.20 * (offset * beatSec - 0.06) ** 2 : 0.14 * offset ** 2;
			const cost = path.cost + offsetCost + 0.015 * (feel - 0.6) ** 2;
			if (cost < bestCost) {
				best = path;
				bestCost = cost;
				phase = offset;
				swing = feel;
			}
		}
	}

	const positions = [];
	for (let path = best; path; path = path.previous) positions.push(path);
	positions.reverse();
	// A click can split the end of a held note. Remove that last boundary
	// after fitting the clock so it cannot shift any preceding attack.
	const terminal = positions.at(-1);
	const preceding = positions.at(-2);
	const joinEnding = endingRelease !== undefined && input.length === detected.length &&
		terminal?.index === input.length - 1 && preceding?.index === input.length - 2 &&
		input[terminal.index].midi === input[preceding.index].midi;
	if (joinEnding) positions.pop();
	const notes: Note[] = [];
	let collisions = 0;
	let previousEnd = 0;
	const fraction = (tick: number) => reduceFraction(tick, 4 * TICKS);
	for (const [position, { tick: start, index: i }] of positions.entries()) {
		const following = positions[position + 1];
		const next = following?.tick ?? END;
		if (next === start) {
			collisions++;
			continue;
		}
		const last = input[(following?.index ?? input.length) - 1];
		const release = (!following && joinEnding ? endingRelease! : last.onsetTime + last.duration) / beatSec;
		const silence = following ? times[following.index] - release : Infinity;
		const end = silence > Math.max(0.32, 0.12 / beatSec)
			? releaseTick(start, next, release, phase, swing) : next;
		if (previousEnd < start) notes.push({ pitch: null, offset: fraction(previousEnd), duration: fraction(start - previousEnd) });
		notes.push({ pitch: input[i].midi, offset: fraction(start), duration: fraction(end - start) });
		previousEnd = end;
	}
	const kept = new Set(positions.map(p => p.index));
	const omittedIndices = input.flatMap((_, i) => kept.has(i) ? [] : [i]);
	return { notes, phaseSeconds: phase * beatSec, collisions, omittedIndices };
}
