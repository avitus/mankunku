import type { Note } from '$lib/types/music';
import { reduceFraction } from '$lib/music/intervals';
import { applySwingToBeats, MAX_SWING } from '$lib/music/swing';
import { articulationGapBeats, tripletAttackEvidence } from '$lib/music/rhythm-evidence';

/** Beat-domain input: callers own conversion from recorded seconds. */
export interface RhythmEvent {
  pitch: number;
  at: number;
  release: number;
}

/** Optional source notation, used as evidence rather than as performed timing. */
export interface RhythmHint {
  at: number;
  duration: number;
  fixed?: boolean;
}

export interface RhythmFitOptions {
  endBeat: number;
  beatSeconds: number;
  ticksPerBeat?: number;
  slots?: readonly number[];
  phases?: readonly number[];
  skipCosts?: number[];
  firstTick?: number;
  endingRelease?: number;
  hints?: RhythmHint[];
}

interface Grid {
  ticks: number;
  end: number;
  slots: readonly number[];
  hints?: RhythmHint[];
}
const SWINGS = [0.5, 0.6, 2 / 3, 0.75, MAX_SWING];
/** Whether a tick falls on the second or third triplet partial of its beat. */
const isTriplet = (tick: number, grid: Grid) => tick % grid.ticks === grid.ticks / 3 || tick % grid.ticks === 2 * grid.ticks / 3;

/** Reject straight and triplet offbeats occupying the same quarter-note beat. */
function mixesSubdivisions(from: number, to: number, grid: Grid) {
	return Math.floor(from / grid.ticks) === Math.floor(to / grid.ticks) &&
		from % grid.ticks !== 0 && isTriplet(from, grid) !== isTriplet(to, grid);
}

interface Path {
	tick: number;
	index: number;
	cost: number;
	previous?: Path;
}

/** Cost a candidate interval against elapsed beats, allowing penalized collisions. */
function transition(from: number, to: number, elapsed: number, swing: number, pitchChanged: boolean, grid: Grid): number {
	const length = to - from;
	if (length < 0) return Infinity;
	// Subdivision collisions are possible at the detector's resolution. Cost
	// them explicitly; prefer retaining a real articulation on a plausible slot.
	if (length === 0) return (pitchChanged ? 0.25 : 0.10) + elapsed * elapsed;
	if (mixesSubdivisions(from, to, grid) && !grid.hints) return Infinity;
	const interval = applySwingToBeats(to / grid.ticks, swing) - applySwingToBeats(from / grid.ticks, swing);
	const shapeCost = 0.6 * (elapsed - interval) ** 2 +
		// Source-clock attacks need evidence before adding a gap or a new
		// short subdivision inside an otherwise continuous eighth-note line.
		(grid.hints && length >= grid.ticks && elapsed < 0.9 ? 0.18 : 0) +
		(grid.hints && length < grid.ticks / 2 && elapsed > 0.4 ? 0.10 : 0);
	if (length % (grid.ticks / 2) === 0) return shapeCost; // eighths, quarters and their ties
	if (length === grid.ticks / 3 || length === 2 * grid.ticks / 3) return shapeCost + 0.006;
	return shapeCost + 0.055; // irregular spans between rhythmic figures
}

/** Keep the cheapest history ending at each slot so later attacks can resolve
 * earlier ambiguity, including across a barline. */
function align(times: number[], input: RhythmEvent[], tripletEvidence: boolean[], swingAccent: number[], phase: number, swing: number, skipCosts: number[] | undefined, firstTick: number | undefined, grid: Grid): Path | undefined {
	let previous: Path[] = [];
	for (const [i, time] of times.entries()) {
		const beat = Math.max(0, Math.min(Math.ceil(grid.end / grid.ticks) - 1,
			Math.floor(grid.hints?.[i]?.at ?? time - phase)));
		const next: Path[] = [];

		for (let b = Math.max(0, beat - 1); b <= Math.min(Math.ceil(grid.end / grid.ticks) - 1, beat + 1); b++) {
			for (const slot of grid.slots) {
				const tick = b * grid.ticks + slot;
				if (tick >= grid.end) continue;
				const hint = grid.hints?.[i];
				if (hint && (hint.fixed || Number.isInteger(hint.at * 2)
					? Math.abs(tick / grid.ticks - hint.at) > 1e-8
					: Math.abs(tick / grid.ticks - hint.at) > 0.25 + 1e-8)) continue;
				if (i === 0 && firstTick !== undefined && tick !== firstTick) continue;
				const error = time - phase - applySwingToBeats(tick / grid.ticks, swing);
				// A lone ambiguous triplet subdivision is weaker evidence than a
				// complete figure. Prefer the simpler entrance when both fit.
				const tupletCost = hint ? 0.12 : skipCosts ? 0.060 : 0.031;
				const entranceCost = skipCosts && i === 0 && !tripletEvidence[i] && slot !== 0
					? (slot === grid.ticks / 2 ? 0.025 : 0.08) : 0;
				const contrast = swingAccent[i];
				const accentCost = contrast > 0 && slot !== 0 ? contrast : contrast < 0 && slot !== grid.ticks / 2 ? -contrast : 0;
				const sixteenthCost = hint && !hint.fixed && slot % (grid.ticks / 2) !== 0 && !isTriplet(tick, grid) ? 0.08 : 0;
				const local = error * error + accentCost + entranceCost + sixteenthCost +
					(isTriplet(tick, grid) && (hint ? !hint.fixed : !tripletEvidence[i]) ? tupletCost : 0);
				let best = previous.length ? Infinity : 0;
				let parent: Path | undefined;
				for (const path of previous) {
					const prior = grid.hints?.[path.index];
					if (prior?.fixed && tick < path.tick + prior.duration * grid.ticks - 1e-8) continue;
					const cost = path.cost + transition(path.tick, tick, time - times[path.index], swing, input[i].pitch !== input[path.index].pitch, grid);
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
		if (!previous.length) return;
	}
	return previous.length ? previous.reduce((a, b) => a.cost <= b.cost ? a : b) : undefined;
}

/** Fit a release to a conventional duration without crossing the next attack. */
function releaseTick(start: number, limit: number, releaseBeat: number, phase: number, swing: number, grid: Grid) {
	let bestEnd = limit;
	let bestCost = Infinity;
	for (let end = start + 1; end <= limit; end++) {
		if (!grid.slots.some(slot => slot === end % grid.ticks)) continue;
		if (mixesSubdivisions(start, end, grid)) continue;
		const length = end - start;
		const error = applySwingToBeats(end / grid.ticks, swing) + phase - releaseBeat;
		// Prefer conventional lengths and metrically strong endings; allow
		// ties (including a 5/8 sustain) when the release supports them.
		const conventional = [0.5, 1, 2, 4].includes(length / grid.ticks);
		const complexity = conventional ? 0 : length % (grid.ticks / 2) === 0 ? 0.025 : 0.07;
		const cost = error * error + complexity + (isTriplet(end, grid) ? 0.035 : 0);
		if (cost < bestCost) {
			bestCost = cost;
			bestEnd = end;
		}
	}
	return bestEnd;
}

/** Jointly fit phrase attacks, swing, clock phase and written releases.
 * Recorder and annotated-corpus callers supply their own clock and grid policy. */
export function fitPhraseRhythm(detected: RhythmEvent[], options: RhythmFitOptions) {
  const { skipCosts, firstTick, endingRelease } = options;
  const beatSec = options.beatSeconds;
  const ticks = options.ticksPerBeat ?? 6;
  const grid: Grid = { ticks, end: options.endBeat * ticks,
    slots: options.slots ?? [0, ticks / 3, ticks / 2, 2 * ticks / 3], hints: options.hints };
  const input = detected.filter(n => n.at < options.endBeat);
  if (!input.length) return { notes: [], phaseSeconds: 0, collisions: 0, omittedIndices: [] as number[] };
  const times = input.map(n => Math.max(0, n.at));
	// Three near-equal attacks spaced by a third or two-thirds of a beat
	// support a true tuplet. A long–short swung pair alone never qualifies.
	const tripletEvidence = tripletAttackEvidence(times);
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
		if (options.phases) {
      phases.push(...options.phases);
    } else if (firstTick !== undefined) {
			// A musician can explicitly place the first attack. Set the clock
			// for the entire phrase; preserve the measured intervals thereafter.
			const nominal = times[0] - applySwingToBeats(firstTick / grid.ticks, feel);
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
			const path = align(times, input, tripletEvidence, swingAccent, offset, feel, skipCosts, firstTick, grid);
      if (!path) continue;
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

	if (!best) throw new RangeError('No rhythm fits the supplied clock and notation constraints');
	const positions = [];
	for (let path: Path | undefined = best; path; path = path.previous) positions.push(path);
	positions.reverse();
	// A click can split the end of a held note. Remove that last boundary
	// after fitting the clock so it cannot shift any preceding attack.
	const terminal = positions.at(-1);
	const preceding = positions.at(-2);
	const joinEnding = endingRelease !== undefined && input.length === detected.length &&
		terminal?.index === input.length - 1 && preceding?.index === input.length - 2 &&
		input[terminal.index].pitch === input[preceding.index].pitch;
	if (joinEnding) positions.pop();
	const notes: Note[] = [];
	let collisions = 0;
	let previousEnd = 0;
	/** A tick count as a reduced whole-note fraction on this grid. */
	const fraction = (tick: number) => reduceFraction(tick, 4 * grid.ticks);
	for (const [position, { tick: start, index: i }] of positions.entries()) {
		const following = positions[position + 1];
		const next = following?.tick ?? grid.end;
		if (next === start) {
			collisions++;
			continue;
		}
		const last = input[(following?.index ?? input.length) - 1];
		const release = (!following && joinEnding ? endingRelease! : last.release);
		const silence = following ? times[following.index] - release : Infinity;
		let end = silence > articulationGapBeats(60 / beatSec)
			? releaseTick(start, next, release, phase, swing, grid) : next;
		const hint = grid.hints?.[i];
		if (hint?.fixed) end = Math.min(next, start + Math.round(hint.duration * grid.ticks));
		else if (hint) {
			// Short on-beat quarters are articulated, not eighths plus rests.
			// An adjacent eighth gives the phrase-level evidence for an eighth ending.
			const previous = positions[position - 1];
			const eighthContext = next - start === grid.ticks / 2 ||
				(previous && start - previous.tick === grid.ticks / 2);
			const sounded = input[i].release - input[i].at;
			if (!eighthContext && start % grid.ticks === 0 && sounded >= 1 / 3 && sounded <= 5 / 6 && next - start >= grid.ticks)
				end = Math.max(end, start + grid.ticks);
		}
		// Source annotations can contain coincident attacks. Report a collision
		// instead of handing a zero-length note to notation or the editor.
		if (end <= start) {
			collisions++;
			continue;
		}
		if (previousEnd < start) notes.push({ pitch: null, offset: fraction(previousEnd), duration: fraction(start - previousEnd) });
		notes.push({ pitch: input[i].pitch, offset: fraction(start), duration: fraction(end - start) });
		previousEnd = end;
	}
	const kept = new Set(positions.map(p => p.index));
	const omittedIndices = input.flatMap((_, i) => kept.has(i) ? [] : [i]);
	return { notes, phaseSeconds: phase * beatSec, collisions, omittedIndices };
}
