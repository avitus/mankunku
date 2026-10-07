/**
 * Research fork of src/lib/scoring/{alignment,scorer}.ts with the candidate
 * rules as options, so every saved take can be rescored under each variant
 * WITHOUT touching src. The rule that wins is then ported to src with tests.
 *
 *   sliverPairing: false  — a detected note shorter than SLIVER_MAX_SECONDS or
 *                           below SLIVER_MIN_CLARITY can never take a slot in
 *                           the DTW; it is appended as an extra (and stays
 *                           free under every gate).
 *   extraGate:  'none'    — extras cost nothing (today)
 *               'thread'  — the adjacent thread's gate: duration >= 0.15 s,
 *                           clarity >= 0.8, not ghost, no same-pitch-class
 *                           neighbour, onset before the line's end
 *               'v2'      — 'thread' plus: onset no earlier than 0.1 s before
 *                           the first expected note (pre-entry click reads),
 *                           and a transition sliver (< 0.25 s, within 2 st of
 *                           a temporally adjacent PAIRED note) is free
 */
import type { Note } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';
import type { AlignmentPair } from '$lib/types/scoring';
import { scorePitch, pitchMatches } from '$lib/scoring/pitch-scoring';
import { scoreRhythm } from '$lib/scoring/rhythm-scoring';
import { scoreToGrade } from '$lib/scoring/grades';
import { fractionToFloat } from '$lib/music/intervals';
import { applySwingToBeats } from '$lib/music/swing';
import { midiToPitchClass } from '$lib/music/intervals';

export const SKIP_COST = 1.5;
const DELAY_PASS_SKIP_COST = 2.0;
export const SLIVER_MAX_SECONDS = 0.1;
export const SLIVER_MIN_CLARITY = 0.6;
export const GATE_MIN_DURATION = 0.15;
export const GATE_MIN_CLARITY = 0.8;
export const GATE_PRE_ENTRY_SECONDS = 0.1;
export const TRANSITION_MAX_SECONDS = 0.25;
export const TRANSITION_MAX_SEMITONES = 2;

export interface VariantOptions {
	sliverPairing: boolean;
	extraGate: 'none' | 'thread' | 'v2';
}

type PitchedNote = Note & { pitch: number };

function pitchDistance(expected: PitchedNote, detected: DetectedNote, octaveInsensitive: boolean): number {
	if (pitchMatches(expected.pitch, detected, octaveInsensitive)) return 0;
	if (octaveInsensitive) {
		const pcDiff = Math.abs(midiToPitchClass(expected.pitch) - midiToPitchClass(detected.midi));
		const cyclic = Math.min(pcDiff, 12 - pcDiff);
		return cyclic === 0 ? 0 : Math.min(1.0, cyclic * 0.5);
	}
	const diff = Math.abs(expected.pitch - detected.midi);
	return diff === 0 ? 0 : Math.min(1.0, diff * 0.5);
}

function noteOnsetSeconds(note: Note, tempo: number, swing: number): number {
	const rawBeats = fractionToFloat(note.offset) * 4;
	return applySwingToBeats(rawBeats, swing) * (60 / tempo);
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const s = [...values].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function alignAt(exp: PitchedNote[], detected: DetectedNote[], tempo: number, swing: number, oi: boolean, skipCost: number, delay: number): AlignmentPair[] {
	const N = exp.length, M = detected.length, beat = 60 / tempo;
	const expOnsets = exp.map((n) => noteOnsetSeconds(n, tempo, swing));
	const matchCost = (i: number, j: number) =>
		pitchDistance(exp[i], detected[j], oi) + Math.min(1.0, Math.abs(expOnsets[i] - (detected[j].onsetTime - delay)) / beat);
	const dp: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0));
	for (let i = 1; i <= N; i++) dp[i][0] = dp[i - 1][0] + skipCost;
	for (let j = 1; j <= M; j++) dp[0][j] = dp[0][j - 1] + skipCost;
	for (let i = 1; i <= N; i++) for (let j = 1; j <= M; j++)
		dp[i][j] = Math.min(dp[i - 1][j - 1] + matchCost(i - 1, j - 1), dp[i - 1][j] + skipCost, dp[i][j - 1] + skipCost);
	const pairs: AlignmentPair[] = [];
	let i = N, j = M;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0) {
			const c = matchCost(i - 1, j - 1);
			if (dp[i][j] === dp[i - 1][j - 1] + c) { pairs.push({ expectedIndex: i - 1, detectedIndex: j - 1, cost: c }); i--; j--; continue; }
		}
		if (i > 0 && dp[i][j] === dp[i - 1][j] + skipCost) { pairs.push({ expectedIndex: i - 1, detectedIndex: null, cost: skipCost }); i--; }
		else { pairs.push({ expectedIndex: null, detectedIndex: j - 1, cost: skipCost }); j--; }
	}
	return pairs.reverse();
}

function alignNotes(exp: PitchedNote[], detected: DetectedNote[], tempo: number, swing: number, oi: boolean): AlignmentPair[] {
	if (exp.length === 0) return [];
	if (detected.length === 0) return exp.map((_, i) => ({ expectedIndex: i, detectedIndex: null, cost: SKIP_COST }));
	const first = alignAt(exp, detected, tempo, swing, oi, DELAY_PASS_SKIP_COST, 0);
	const anchors = first.filter((p) => p.expectedIndex !== null && p.detectedIndex !== null && pitchMatches(exp[p.expectedIndex].pitch, detected[p.detectedIndex], oi));
	if (anchors.length === 0) return first.map((p) => (p.expectedIndex === null || p.detectedIndex === null ? { ...p, cost: SKIP_COST } : p));
	const delay = median(anchors.map((p) => detected[p.detectedIndex!].onsetTime - noteOnsetSeconds(exp[p.expectedIndex!], tempo, swing)));
	return alignAt(exp, detected, tempo, swing, oi, SKIP_COST, delay);
}

export const isSliver = (d: DetectedNote) => d.duration < SLIVER_MAX_SECONDS || d.clarity < SLIVER_MIN_CLARITY;

export interface VariantScore {
	pitchAccuracy: number; rhythmAccuracy: number; overall: number; grade: string;
	notesHit: number; notesTotal: number; extras: number; charged: number; wrongPairs: number;
}

export function scoreVariant(expected: Note[], detectedAll: DetectedNote[], tempo: number, swing: number, oi: boolean, opts: VariantOptions): VariantScore {
	const exp = expected.filter((n): n is PitchedNote => n.pitch !== null);
	const slivers = opts.sliverPairing ? [] : detectedAll.filter(isSliver);
	const detected = opts.sliverPairing ? detectedAll : detectedAll.filter((d) => !isSliver(d));
	const pairs = alignNotes(exp, detected, tempo, swing, oi);
	const offsets: number[] = [];
	for (const p of pairs) if (p.expectedIndex !== null && p.detectedIndex !== null)
		offsets.push(detected[p.detectedIndex].onsetTime - noteOnsetSeconds(exp[p.expectedIndex], tempo, swing));
	const latency = median(offsets);
	const corrected = detected.map((d) => ({ ...d, onsetTime: d.onsetTime - latency }));
	let pitchSum = 0, rhythmSum = 0, notesHit = 0, scored = 0, wrongPairs = 0;
	const pairedIdx = new Set<number>();
	const extraIdx: number[] = [];
	for (const p of pairs) {
		if (p.expectedIndex !== null && p.detectedIndex !== null) {
			const e = exp[p.expectedIndex], d = corrected[p.detectedIndex];
			const pitch = Math.min(1, scorePitch(e, d, oi));
			if (pitchMatches(e.pitch, d, oi)) notesHit++; else wrongPairs++;
			pitchSum += pitch; rhythmSum += scoreRhythm(e, d, tempo, swing); scored++;
			pairedIdx.add(p.detectedIndex);
		} else if (p.expectedIndex !== null) scored++;
		else if (p.detectedIndex !== null) extraIdx.push(p.detectedIndex);
	}
	// the gate
	const lineStart = Math.min(...exp.map((n) => noteOnsetSeconds(n, tempo, swing)));
	const lineEnd = Math.max(...exp.map((n) => noteOnsetSeconds(n, tempo, swing) + fractionToFloat(n.duration) * 4 * (60 / tempo)));
	const byTime = corrected.map((d, idx) => ({ d, idx })).sort((a, b) => a.d.onsetTime - b.d.onsetTime);
	const pos = new Map(byTime.map((x, k) => [x.idx, k]));
	let charged = 0;
	if (opts.extraGate !== 'none') {
		for (const idx of extraIdx) {
			const d = corrected[idx];
			if (d.ghost || d.duration < GATE_MIN_DURATION || d.clarity < GATE_MIN_CLARITY) continue;
			if (d.onsetTime >= lineEnd) continue;
			const k = pos.get(idx)!;
			const neighbours = [byTime[k - 1], byTime[k + 1]].filter(Boolean);
			if (neighbours.some((n) => midiToPitchClass(n.d.midi) === midiToPitchClass(d.midi))) continue;
			if (opts.extraGate === 'v2') {
				if (d.onsetTime < lineStart - GATE_PRE_ENTRY_SECONDS) continue;
				const pairedNeighbour = neighbours.some((n) => pairedIdx.has(n.idx) && Math.abs(n.d.midi - d.midi) <= TRANSITION_MAX_SEMITONES);
				if (d.duration < TRANSITION_MAX_SECONDS && pairedNeighbour) continue;
			}
			charged++;
		}
	}
	const denom = scored + charged;
	const pitchAccuracy = denom ? pitchSum / denom : 0, rhythmAccuracy = denom ? rhythmSum / denom : 0;
	const overall = pitchAccuracy * 0.6 + rhythmAccuracy * 0.4;
	return { pitchAccuracy, rhythmAccuracy, overall, grade: scoreToGrade(overall), notesHit, notesTotal: exp.length, extras: extraIdx.length + slivers.length, charged, wrongPairs };
}

export const VARIANTS: Record<string, VariantOptions> = {
	current: { sliverPairing: true, extraGate: 'none' },
	gate_thread: { sliverPairing: true, extraGate: 'thread' },
	gate_v2: { sliverPairing: true, extraGate: 'v2' },
	sliver_only: { sliverPairing: false, extraGate: 'none' },
	sliver_gate_thread: { sliverPairing: false, extraGate: 'thread' },
	sliver_gate_v2: { sliverPairing: false, extraGate: 'v2' }
};
