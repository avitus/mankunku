# Triad-Pair Alternate Playing Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triad-pair trick scoring accepts three playing styles (standard cell, alternating eighth-note triplets, four-eighths-per-triad) best-of, and round previews rotate through them.

**Architecture:** A new engine-level `scoreConformanceAgainstSpecs` in `src/lib/tricks/conformance.ts` scores an attempt against several named slot specs and keeps the best `patternScore` (ties → earliest), tagging the result with the winner's `style`. The triad-pairs device builds three specs from shared triad-derivation helpers and submits them in canonical order `['cell', 'triplets', 'four-eighths']`. `generateExample` switches on a new optional `TrickContext.exampleStyle` hint; the practice session rotates the hint per round via `Trick.exampleStyles`, and `scoreFluency` re-uses the hint to generate expected notes for the style actually played.

**Tech Stack:** TypeScript strict, Vitest (Node, no browser), existing DTW conformance engine. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-05-triad-pair-styles-design.md`

## Global Constraints

- Style must NEVER enter `TrickParameters` — parameters feed `normalizeParameterSignature`, which forms the progress variant key. One variant key covers all three styles.
- Canonical style order everywhere: `['cell', 'triplets', 'four-eighths']` (scoring variant order AND preview rotation order).
- `beatPlacement` applies to the cell spec only; triplet and four-eighths specs always sit on the beat.
- Enclosures behavior must not change (single spec, no `style` tag, no `exampleStyles`).
- TDD: failing test first, then minimal implementation, per task. Conventional Commits.
- All commands run from the repo root `/Users/avitus/Projects/mankunku`.
- Working tree contains unrelated uncommitted changes (`CLAUDIUS/SESSIONS.md`, `documentation/README.md`, untracked `documentation/architecture/trick-scoring.md`). `git add` ONLY the files each task names — never `git add -A`.

---

### Task 1: Engine multi-spec API

**Files:**
- Modify: `src/lib/types/tricks.ts` (the `ConformanceResult` interface, around line 93)
- Modify: `src/lib/tricks/conformance.ts` (append after `scoreConformanceAgainstSpec`, which ends around line 264)
- Test: `tests/unit/tricks/conformance.test.ts`

**Interfaces:**
- Consumes: existing `scoreConformanceAgainstSpec(played, slots, context): ConformanceResult` (unchanged).
- Produces: `interface ConformanceSpecVariant { style: string; slots: TrickSlotSpec[] }` and `scoreConformanceAgainstSpecs(played: DetectedNote[], variants: ConformanceSpecVariant[], context: TrickContext): ConformanceResult`, plus optional field `ConformanceResult.style?: string`. Task 3 and Task 6 depend on these exact names.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/tricks/conformance.test.ts`, change the import line to include the new function:

```ts
import {
	scoreConformanceAgainstSpec,
	scoreConformanceAgainstSpecs,
	playedDegreeLabel
} from '$lib/tricks/conformance';
```

Append a new describe block at the end of the file (after the `playedDegreeLabel` describe). It reuses the file's existing `makeSlot`, `makeDetected`, `arpSlots`, `perfectPlayed`, and `context` fixtures:

```ts
describe('scoreConformanceAgainstSpecs', () => {
	// Second spec: D F A C on the same eighth grid — pc-disjoint from the
	// C E G B arp on three of four slots, so winners are unambiguous.
	const dfacSlots: TrickSlotSpec[] = [
		makeSlot([0, 1], [2], [5, 9, 0]),
		makeSlot([1, 8], [5], [2, 9, 0]),
		makeSlot([2, 8], [9], [2, 5, 0]),
		makeSlot([3, 8], [0], [2, 5, 9])
	];
	const variants = [
		{ style: 'x', slots: arpSlots },
		{ style: 'y', slots: dfacSlots }
	];

	it('returns the variant with the higher patternScore, tagged with its style', () => {
		const xWins = scoreConformanceAgainstSpecs(perfectPlayed, variants, context);
		expect(xWins.style).toBe('x');
		expect(xWins.patternScore).toBe(1);
		expect(xWins.slots).toHaveLength(4);

		const dfacPlayed = [
			makeDetected(62, 0),
			makeDetected(65, 0.25),
			makeDetected(69, 0.5),
			makeDetected(72, 0.75)
		];
		const yWins = scoreConformanceAgainstSpecs(dfacPlayed, variants, context);
		expect(yWins.style).toBe('y');
		expect(yWins.patternScore).toBe(1);
	});

	it('breaks patternScore ties toward the earliest variant', () => {
		const tied = scoreConformanceAgainstSpecs(
			perfectPlayed,
			[
				{ style: 'first', slots: arpSlots },
				{ style: 'second', slots: [...arpSlots] }
			],
			context
		);
		expect(tied.style).toBe('first');
	});

	it('handles an empty variants list gracefully (no style, all extras)', () => {
		const result = scoreConformanceAgainstSpecs(perfectPlayed, [], context);
		expect(result.style).toBeUndefined();
		expect(result.slots).toHaveLength(0);
		expect(result.patternScore).toBe(0);
		expect(result.extraCount).toBe(4);
	});

	it('leaves the single-spec result untagged', () => {
		const result = scoreConformanceAgainstSpec(perfectPlayed, arpSlots, context);
		expect(result.style).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/tricks/conformance.test.ts`
Expected: FAIL — `scoreConformanceAgainstSpecs` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/types/tricks.ts`, add one optional field to `ConformanceResult` (after `latencyCorrectionMs`):

```ts
	/** Winning spec-variant name when judged best-of several styles (multi-spec devices only) */
	style?: string;
```

In `src/lib/tricks/conformance.ts`, append after `scoreConformanceAgainstSpec`:

```ts
/** One named slot spec submitted to best-of multi-spec judging. */
export interface ConformanceSpecVariant {
	style: string;
	slots: TrickSlotSpec[];
}

/**
 * Judge a played attempt against several spec variants (playing styles) and
 * return the best result — highest patternScore, ties resolved toward the
 * earliest variant, so callers list the canonical style first. The winner's
 * name is reported as `style`. An empty variants list degrades to the
 * single-spec empty-slots result (everything played is extra, no style).
 */
export function scoreConformanceAgainstSpecs(
	played: DetectedNote[],
	variants: ConformanceSpecVariant[],
	context: TrickContext
): ConformanceResult {
	if (variants.length === 0) {
		return scoreConformanceAgainstSpec(played, [], context);
	}
	let best: ConformanceResult | null = null;
	let bestStyle = variants[0].style;
	for (const variant of variants) {
		const result = scoreConformanceAgainstSpec(played, variant.slots, context);
		if (best === null || result.patternScore > best.patternScore) {
			best = result;
			bestStyle = variant.style;
		}
	}
	return { ...(best as ConformanceResult), style: bestStyle };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/tricks/conformance.test.ts`
Expected: PASS (all pre-existing tests in the file too).

- [ ] **Step 5: Type-check and commit**

Run: `npm run check` — expect no new errors.

```bash
git add src/lib/types/tricks.ts src/lib/tricks/conformance.ts tests/unit/tricks/conformance.test.ts
git commit -m "feat(tricks): multi-spec conformance API with winning-style tag"
```

---

### Task 2: Triplet and four-eighths slot builders

**Files:**
- Modify: `src/lib/tricks/devices/triad-pairs.ts` (refactor `buildTriadPairSlots` lines 71-105 into shared helpers + two new builders)
- Test: `tests/unit/tricks/devices.test.ts`

**Interfaces:**
- Consumes: existing module-private helpers `pick`, `reduceFraction`, `scaleDegreePcs`, `triadOnDegree`; existing `buildTriadPairSlots` (name, signature, and output must stay byte-for-byte compatible — the existing describe blocks pin its roles, generatePcs, and offsets).
- Produces: `buildTripletSlots(parameters: TrickParameters, context: TrickContext): TrickSlotSpec[]` (12 slots) and `buildFourEighthsSlots(parameters: TrickParameters, context: TrickContext): TrickSlotSpec[]` (8 slots), both exported. Tasks 3-4 depend on these exact names.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/tricks/devices.test.ts`, extend the triad-pairs import:

```ts
import {
	buildFourEighthsSlots,
	buildTriadPairSlots,
	buildTripletSlots,
	triadPairsTrick
} from '$lib/tricks/devices/triad-pairs';
```

Insert two describe blocks after the existing `describe('buildTriadPairSlots', ...)` block (which ends around line 204). They reuse the file's `baseContext`, `TRIAD_LADDER`, `cMajorTriad`, `fractionToFloat`, and `assertValidSlots` fixtures:

```ts
describe('buildTripletSlots', () => {
	it.each(TRIAD_LADDER)('produces valid slots for %s', (_name, params) => {
		assertValidSlots(buildTripletSlots(params, baseContext));
	});

	it.each(TRIAD_LADDER)(
		'%s: four beat-aligned triplet groups alternating triads per order',
		(_name, params) => {
			const slots = buildTripletSlots(params, baseContext);
			expect(slots).toHaveLength(12);

			const [lowDeg, highDeg] = params.pair.split('+').map(Number);
			const low = cMajorTriad(lowDeg);
			const high = cMajorTriad(highDeg);
			const [triadA, triadB] = params.order === 'low-first' ? [low, high] : [high, low];

			slots.forEach((slot, i) => {
				expect(fractionToFloat(slot.offset)).toBeCloseTo(i / 12, 9);
				expect(fractionToFloat(slot.duration)).toBeCloseTo(1 / 12, 9);
				const group = Math.floor(i / 3);
				const own = group % 2 === 0 ? triadA : triadB;
				const other = group % 2 === 0 ? triadB : triadA;
				expect(slot.role).toBe(group % 2 === 0 ? 'triad-a' : 'triad-b');
				expect(new Set(slot.exactPcs)).toEqual(new Set(own));
				expect(new Set(slot.patternPcs)).toEqual(new Set(other));
				expect(slot.generatePc).toBe(own[i % 3]);
			});
		}
	);

	it('ignores beatPlacement: offbeat variants keep triplets on the beat', () => {
		const down = buildTripletSlots(TRIAD_LADDER[0][1], baseContext); // downbeat
		const off = buildTripletSlots(TRIAD_LADDER[4][1], baseContext); // offbeat
		expect(off.map((s) => fractionToFloat(s.offset))).toEqual(
			down.map((s) => fractionToFloat(s.offset))
		);
	});
});

describe('buildFourEighthsSlots', () => {
	it.each(TRIAD_LADDER)('produces valid slots for %s', (_name, params) => {
		assertValidSlots(buildFourEighthsSlots(params, baseContext));
	});

	it.each(TRIAD_LADDER)(
		'%s: four eighths of triad A then four of triad B, contour root-3rd-5th-3rd',
		(_name, params) => {
			const slots = buildFourEighthsSlots(params, baseContext);
			expect(slots).toHaveLength(8);

			const [lowDeg, highDeg] = params.pair.split('+').map(Number);
			const low = cMajorTriad(lowDeg);
			const high = cMajorTriad(highDeg);
			const [triadA, triadB] = params.order === 'low-first' ? [low, high] : [high, low];
			const contour = [0, 1, 2, 1];

			slots.forEach((slot, i) => {
				expect(fractionToFloat(slot.offset)).toBeCloseTo(i / 8, 9);
				expect(fractionToFloat(slot.duration)).toBeCloseTo(1 / 8, 9);
				const own = i < 4 ? triadA : triadB;
				const other = i < 4 ? triadB : triadA;
				expect(slot.role).toBe(i < 4 ? 'triad-a' : 'triad-b');
				expect(new Set(slot.exactPcs)).toEqual(new Set(own));
				expect(new Set(slot.patternPcs)).toEqual(new Set(other));
				expect(slot.generatePc).toBe(own[contour[i % 4]]);
			});
		}
	);

	it('ignores beatPlacement: offbeat variants keep the eighths on the beat', () => {
		const down = buildFourEighthsSlots(TRIAD_LADDER[0][1], baseContext);
		const off = buildFourEighthsSlots(TRIAD_LADDER[4][1], baseContext);
		expect(off.map((s) => fractionToFloat(s.offset))).toEqual(
			down.map((s) => fractionToFloat(s.offset))
		);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/tricks/devices.test.ts`
Expected: FAIL — `buildTripletSlots` / `buildFourEighthsSlots` are not exported. Every pre-existing test must still pass.

- [ ] **Step 3: Implement**

In `src/lib/tricks/devices/triad-pairs.ts`, replace the body of `buildTriadPairSlots` (lines 71-105) with shared helpers plus three builders. The cell builder keeps the exported name `buildTriadPairSlots` and identical output:

```ts
interface TriadPair {
	triadA: number[];
	triadB: number[];
}

/** Resolve the pair/order parameters to concrete triad pcs (A starts). */
function derivePair(parameters: TrickParameters, context: TrickContext): TriadPair {
	const pair = pick(parameters, 'pair', PAIRS, '4+5');
	const order = pick(parameters, 'order', ORDERS, 'low-first');
	const scalePcs = scaleDegreePcs(context);
	const [lowDegree, highDegree] = (pair as Pair).split('+').map(Number);
	const lowTriad = triadOnDegree(scalePcs, lowDegree);
	const highTriad = triadOnDegree(scalePcs, highDegree);
	const [triadA, triadB] = order === 'low-first' ? [lowTriad, highTriad] : [highTriad, lowTriad];
	return { triadA, triadB };
}

/** One spec slot: exact = own triad (specific pc first), pattern = the other triad. */
function buildSlot(
	step: { pc: number; triad: 'a' | 'b' },
	offset: Fraction,
	duration: Fraction,
	pair: TriadPair
): TrickSlotSpec {
	const own = step.triad === 'a' ? pair.triadA : pair.triadB;
	const other = step.triad === 'a' ? pair.triadB : pair.triadA;
	const exactPcs = [step.pc, ...own.filter((pc) => pc !== step.pc)];
	return {
		offset,
		duration,
		exactPcs,
		patternPcs: other.filter((pc) => !exactPcs.includes(pc)),
		generatePc: step.pc,
		role: step.triad === 'a' ? 'triad-a' : 'triad-b'
	};
}

export function buildTriadPairSlots(
	parameters: TrickParameters,
	context: TrickContext
): TrickSlotSpec[] {
	const beatPlacement = pick(parameters, 'beatPlacement', BEAT_PLACEMENTS, 'downbeat');
	const pair = derivePair(parameters, context);
	const { triadA, triadB } = pair;

	// Standard alternating cell: A ascending, B ascending, first two of A again.
	const cell: { pc: number; triad: 'a' | 'b' }[] = [
		...triadA.map((pc) => ({ pc, triad: 'a' as const })),
		...triadB.map((pc) => ({ pc, triad: 'b' as const })),
		{ pc: triadA[0], triad: 'a' as const },
		{ pc: triadA[1 % triadA.length], triad: 'a' as const }
	];

	const shift = beatPlacement === 'offbeat' ? 1 : 0;
	return cell.map((step, i) =>
		buildSlot(step, reduceFraction(i + shift, 8), [1, 8], pair)
	);
}

/**
 * Alternating-triplet style: four eighth-note-triplet groups, one per beat,
 * A-B-A-B. Always on the beat — beatPlacement has no natural triplet form.
 */
export function buildTripletSlots(
	parameters: TrickParameters,
	context: TrickContext
): TrickSlotSpec[] {
	const pair = derivePair(parameters, context);
	const slots: TrickSlotSpec[] = [];
	for (let group = 0; group < 4; group++) {
		const triad = group % 2 === 0 ? ('a' as const) : ('b' as const);
		const own = triad === 'a' ? pair.triadA : pair.triadB;
		for (let k = 0; k < 3; k++) {
			slots.push(
				buildSlot(
					{ pc: own[k % own.length], triad },
					reduceFraction(group * 3 + k, 12),
					[1, 12],
					pair
				)
			);
		}
	}
	return slots;
}

/**
 * Four-eighths style: four eighths of triad A then four of triad B, canonical
 * contour root-3rd-5th-3rd (C-E-G-E, D-F#-A-F#). Always on the beat.
 */
export function buildFourEighthsSlots(
	parameters: TrickParameters,
	context: TrickContext
): TrickSlotSpec[] {
	const pair = derivePair(parameters, context);
	const contour = [0, 1, 2, 1];
	const slots: TrickSlotSpec[] = [];
	for (let half = 0; half < 2; half++) {
		const triad = half === 0 ? ('a' as const) : ('b' as const);
		const own = triad === 'a' ? pair.triadA : pair.triadB;
		for (let k = 0; k < 4; k++) {
			slots.push(
				buildSlot(
					{ pc: own[contour[k] % own.length], triad },
					reduceFraction(half * 4 + k, 8),
					[1, 8],
					pair
				)
			);
		}
	}
	return slots;
}
```

In the module-header comment (lines 1-22), after the cell-design paragraph, add:

```
 * Two further styles are accepted best-of at scoring time (see the trick's
 * scoreConformance): alternating eighth-note-triplet groups (A-B-A-B, one
 * per beat) and four eighths per triad (A×4 then B×4). Both always sit on
 * the beat — beatPlacement shapes only the cell.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/tricks/devices.test.ts`
Expected: PASS — including all pre-existing `buildTriadPairSlots` tests (the refactor must not change cell output).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tricks/devices/triad-pairs.ts tests/unit/tricks/devices.test.ts
git commit -m "feat(tricks): triplet and four-eighths triad-pair slot builders"
```

---

### Task 3: Best-of scoring in the triad-pairs device

**Files:**
- Modify: `src/lib/types/tricks.ts` (the `Trick` interface, around line 104)
- Modify: `src/lib/tricks/devices/triad-pairs.ts` (`scoreConformance` in the `triadPairsTrick` object, plus new constants)
- Test: `tests/unit/tricks/devices.test.ts`

**Interfaces:**
- Consumes: `scoreConformanceAgainstSpecs` + `ConformanceSpecVariant` (Task 1); the three builders (Task 2).
- Produces: `TRIAD_PAIR_STYLES` (`['cell', 'triplets', 'four-eighths'] as const`, exported from the device) and `Trick.exampleStyles?: readonly string[]`. Task 4 uses `TRIAD_PAIR_STYLES`; Task 5 uses `exampleStyles`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/tricks/devices.test.ts`, extend imports:

```ts
import { trickVariantKey } from '$lib/types/tricks';
```

and add `TRIAD_PAIR_STYLES` to the triad-pairs import. Add this describe block after `describe('buildFourEighthsSlots', ...)`:

```ts
describe('triad-pairs best-of style scoring', () => {
	const params = TRIAD_LADDER[0][1]; // 4+5, low-first, downbeat
	const offParams = TRIAD_LADDER[4][1]; // 4+5, low-first, offbeat

	/** Play a spec's canonical pcs near middle C at each slot's onset. */
	function playSpec(slots: TrickSlotSpec[]): DetectedNote[] {
		return slots.map((slot) => makeDetected(60 + slot.generatePc!, slotOnsetSeconds(slot)));
	}

	it('declares the three styles in canonical order', () => {
		expect(TRIAD_PAIR_STYLES).toEqual(['cell', 'triplets', 'four-eighths']);
		expect(triadPairsTrick.exampleStyles).toEqual(['cell', 'triplets', 'four-eighths']);
		expect(enclosuresTrick.exampleStyles).toBeUndefined();
	});

	it('a perfect cell performance wins as "cell" with patternScore 1', () => {
		const result = triadPairsTrick.scoreConformance(
			playSpec(buildTriadPairSlots(params, baseContext)),
			params,
			baseContext
		);
		expect(result.style).toBe('cell');
		expect(result.patternScore).toBe(1);
		expect(result.slots).toHaveLength(8);
	});

	it('a perfect alternating-triplet performance wins as "triplets" with patternScore 1', () => {
		const result = triadPairsTrick.scoreConformance(
			playSpec(buildTripletSlots(params, baseContext)),
			params,
			baseContext
		);
		expect(result.style).toBe('triplets');
		expect(result.patternScore).toBe(1);
		expect(result.slots).toHaveLength(12);
		expect(result.extraCount).toBe(0);
	});

	it('the motivating C-E-G-E / D-F#-A-F# line scores 1 as "four-eighths" (4+5 in G)', () => {
		const gContext: TrickContext = { ...baseContext, chordRoot: 'G', key: 'G' };
		const played = [60, 64, 67, 64, 62, 66, 69, 66].map((midi, i) =>
			makeDetected(midi, i * 0.25)
		);
		const result = triadPairsTrick.scoreConformance(played, params, gContext);
		expect(result.style).toBe('four-eighths');
		expect(result.patternScore).toBe(1);
	});

	it('any inversion/combination within each four-eighths half still scores 1', () => {
		const gContext: TrickContext = { ...baseContext, chordRoot: 'G', key: 'G' };
		const played = [64, 67, 60, 67, 66, 69, 62, 69].map((midi, i) =>
			makeDetected(midi, i * 0.25)
		);
		const result = triadPairsTrick.scoreConformance(played, params, gContext);
		expect(result.style).toBe('four-eighths');
		expect(result.patternScore).toBe(1);
	});

	it('offbeat variants accept the shifted cell AND on-beat alternates', () => {
		const shiftedCell = triadPairsTrick.scoreConformance(
			playSpec(buildTriadPairSlots(offParams, baseContext)),
			offParams,
			baseContext
		);
		expect(shiftedCell.style).toBe('cell');
		expect(shiftedCell.patternScore).toBe(1);

		const onBeatTriplets = triadPairsTrick.scoreConformance(
			playSpec(buildTripletSlots(offParams, baseContext)),
			offParams,
			baseContext
		);
		expect(onBeatTriplets.style).toBe('triplets');
		expect(onBeatTriplets.patternScore).toBe(1);
	});

	it('eight eighths all from triad A earn only partial credit', () => {
		const slots = buildFourEighthsSlots(params, baseContext);
		const aOnly = slots.map((slot, i) =>
			makeDetected(60 + slots[i % 4].generatePc!, slotOnsetSeconds(slot))
		);
		const result = triadPairsTrick.scoreConformance(aOnly, params, baseContext);
		expect(result.patternScore).toBeLessThan(0.9);
	});

	it('style never enters the variant key', () => {
		expect(trickVariantKey('triad-pairs', params)).toBe(
			'triad-pairs:beatPlacement=downbeat,order=low-first,pair=4+5'
		);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/tricks/devices.test.ts`
Expected: FAIL — `TRIAD_PAIR_STYLES` not exported; the triplet/four-eighths performances score `style: undefined` and patternScore < 1.

- [ ] **Step 3: Implement**

In `src/lib/types/tricks.ts`, add to the `Trick` interface (after `parameters`):

```ts
	/**
	 * Demo styles in preview rotation order, when the device accepts several
	 * playing styles. Absent for single-style devices. Values are hints for
	 * TrickContext.exampleStyle; they are NOT parameters and never enter the
	 * variant key.
	 */
	exampleStyles?: readonly string[];
```

In `src/lib/tricks/devices/triad-pairs.ts`:

1. Change the conformance import to `import { scoreConformanceAgainstSpecs } from '../conformance';` (the single-spec import is no longer used).
2. Add below the builders:

```ts
/** Accepted playing styles, canonical (tie-break + rotation) order. */
export const TRIAD_PAIR_STYLES = ['cell', 'triplets', 'four-eighths'] as const;
export type TriadPairStyle = (typeof TRIAD_PAIR_STYLES)[number];

const STYLE_BUILDERS: Record<
	TriadPairStyle,
	(parameters: TrickParameters, context: TrickContext) => TrickSlotSpec[]
> = {
	cell: buildTriadPairSlots,
	triplets: buildTripletSlots,
	'four-eighths': buildFourEighthsSlots
};
```

3. In the `triadPairsTrick` object, add `exampleStyles: TRIAD_PAIR_STYLES,` (after `parameters`) and replace `scoreConformance` with:

```ts
	scoreConformance(played, parameters, context) {
		return scoreConformanceAgainstSpecs(
			played,
			TRIAD_PAIR_STYLES.map((style) => ({
				style,
				slots: STYLE_BUILDERS[style](parameters, context)
			})),
			context
		);
	},
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/tricks/devices.test.ts`
Expected: PASS. Pay attention to the pre-existing `'%s: a perfect performance scores ≥ 0.99, scrambled < 0.6'` case — the perfect leg still wins as the cell (score 1), and the tritone-scrambled leg must stay < 0.6 under best-of (all three specs score it low). If the scrambled leg fails, report the actual value — do not loosen the threshold without discussion.

- [ ] **Step 5: Type-check and commit**

Run: `npm run check` — expect no new errors.

```bash
git add src/lib/types/tricks.ts src/lib/tricks/devices/triad-pairs.ts tests/unit/tricks/devices.test.ts
git commit -m "feat(tricks): triad pairs accept three playing styles via best-of scoring"
```

---

### Task 4: Style-aware example generation

**Files:**
- Modify: `src/lib/types/tricks.ts` (the `TrickContext` interface, around line 37)
- Modify: `src/lib/tricks/devices/triad-pairs.ts` (`generateExample` + `description` in `triadPairsTrick`)
- Modify: `src/lib/tricks/example-generator.ts` (the `validatePhrase` options, around line 204)
- Test: `tests/unit/tricks/devices.test.ts`

**Interfaces:**
- Consumes: `TRIAD_PAIR_STYLES`, `STYLE_BUILDERS` (Task 3).
- Produces: `TrickContext.exampleStyle?: string` — Task 5 (session) and Task 6 (fluency) set it.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/tricks/devices.test.ts`, after the best-of describe block:

```ts
describe('triad-pairs generateExample styles', () => {
	const params = TRIAD_LADDER[0][1];

	it('honors exampleStyle "triplets": 12 notes on the triplet grid', () => {
		const phrase = triadPairsTrick.generateExample(params, {
			...baseContext,
			exampleStyle: 'triplets'
		});
		expect(phrase).not.toBeNull();
		expect(phrase!.notes).toHaveLength(12);
		const slots = buildTripletSlots(params, baseContext);
		phrase!.notes.forEach((note, i) => {
			expect(fractionToFloat(note.offset)).toBeCloseTo(i / 12, 9);
			expect(fractionToFloat(note.duration)).toBeCloseTo(1 / 12, 9);
			expect(((note.pitch! % 12) + 12) % 12).toBe(slots[i].generatePc);
		});
	});

	it('honors exampleStyle "four-eighths" with the root-3rd-5th-3rd contour', () => {
		const phrase = triadPairsTrick.generateExample(params, {
			...baseContext,
			exampleStyle: 'four-eighths'
		});
		expect(phrase).not.toBeNull();
		expect(phrase!.notes).toHaveLength(8);
		const slots = buildFourEighthsSlots(params, baseContext);
		phrase!.notes.forEach((note, i) => {
			expect(fractionToFloat(note.offset)).toBeCloseTo(i / 8, 9);
			expect(((note.pitch! % 12) + 12) % 12).toBe(slots[i].generatePc);
		});
	});

	it('defaults to the cell when exampleStyle is absent or unknown', () => {
		const absent = triadPairsTrick.generateExample(params, baseContext);
		const unknown = triadPairsTrick.generateExample(params, {
			...baseContext,
			exampleStyle: 'nope'
		});
		const cellSlots = buildTriadPairSlots(params, baseContext);
		for (const phrase of [absent, unknown]) {
			expect(phrase).not.toBeNull();
			expect(phrase!.notes).toHaveLength(8);
			// Cell slot 3 is triad B's root — distinct from four-eighths' slot 3
			// (triad A's 3rd), so this pins the cell shape specifically.
			expect(((phrase!.notes[3].pitch! % 12) + 12) % 12).toBe(cellSlots[3].generatePc);
		}
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/tricks/devices.test.ts`
Expected: FAIL — `exampleStyle` is not a `TrickContext` property (TS error) and/or the triplet phrase comes back with 8 notes.

- [ ] **Step 3: Implement**

In `src/lib/types/tricks.ts`, add to `TrickContext` (after `swing`):

```ts
	/**
	 * Which playing style generateExample should demonstrate, from the trick's
	 * exampleStyles. Device-interpreted; unknown or absent ⇒ device default.
	 * Scoring ignores it (all styles are always accepted).
	 */
	exampleStyle?: string;
```

In `src/lib/tricks/devices/triad-pairs.ts`, replace `generateExample` in `triadPairsTrick`:

```ts
	generateExample(parameters, context) {
		const hinted = context.exampleStyle ?? '';
		const style: TriadPairStyle = (TRIAD_PAIR_STYLES as readonly string[]).includes(hinted)
			? (hinted as TriadPairStyle)
			: 'cell';
		const pair = pick(parameters, 'pair', PAIRS, '4+5');
		return realizeTrickExample({
			trickId: 'triad-pairs',
			name: `Triad pair ${pair} over ${context.chordRoot}${context.chordQuality}`,
			category: 'triad-pairs',
			tags: ['trick', 'triad-pair'],
			slots: STYLE_BUILDERS[style](parameters, context),
			parameters,
			context
		});
	}
```

Update the trick's `description` to:

```ts
	description:
		'Alternate two neighbouring diatonic triads to build angular, modern-sounding lines from just six notes. Answer in the demo cell, alternating triplets, or four eighths per triad — every style scores.',
```

In `src/lib/tricks/example-generator.ts`, the validation call caps consecutive leaps at 8, but a 12-note triplet realization is wall-to-wall arpeggio intervals (leap = > 2 semitones ⇒ up to 11 consecutive). Change the option and its comment:

```ts
		maxConsecutiveLeaps: 12,
```

and replace the last sentence of the preceding comment ("Keep only the safety rails: instrument range and a sane cap on any single interval.") with:

```
 * examples by design. Keep only the safety rails: instrument range and a
 * sane cap on any single interval. The consecutive-leap cap sits at 12
 * because the longest device shape — the 12-note alternating-triplet
 * triad-pair spec — is wall-to-wall leaps (11 in a row); the rail guards
 * runaway generation, not legitimate device shapes.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/tricks/devices.test.ts tests/unit/tricks/example-generator.test.ts`
Expected: PASS (example-generator suite guards the shared generator against regression).

- [ ] **Step 5: Type-check and commit**

Run: `npm run check` — expect no new errors.

```bash
git add src/lib/types/tricks.ts src/lib/tricks/devices/triad-pairs.ts src/lib/tricks/example-generator.ts tests/unit/tricks/devices.test.ts
git commit -m "feat(tricks): style-aware triad-pair example generation"
```

---

### Task 5: Preview rotation in the practice session

**Files:**
- Modify: `src/lib/tricks/index.ts` (add helper)
- Modify: `src/lib/state/lick-practice.svelte.ts` (line 79 import; `startTrickSession` around line 724; `advanceSingleLickRound` regeneration block around lines 1537-1546)
- Test: `tests/unit/tricks/devices.test.ts`

**Interfaces:**
- Consumes: `Trick.exampleStyles` (Task 3), `TrickContext.exampleStyle` (Task 4).
- Produces: `exampleStyleForRound(trick: Trick, roundNumber: number): string | undefined` exported from `$lib/tricks`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/tricks/devices.test.ts`, extend the `$lib/tricks` import (line 7) to `import { exampleStyleForRound, getTrickById, TRICKS } from '$lib/tricks';` and add inside the existing `describe('trick catalog', ...)` block:

```ts
	it('exampleStyleForRound rotates triad-pair styles and cycles', () => {
		expect(exampleStyleForRound(triadPairsTrick, 1)).toBe('cell');
		expect(exampleStyleForRound(triadPairsTrick, 2)).toBe('triplets');
		expect(exampleStyleForRound(triadPairsTrick, 3)).toBe('four-eighths');
		expect(exampleStyleForRound(triadPairsTrick, 4)).toBe('cell');
		expect(exampleStyleForRound(triadPairsTrick, 7)).toBe('cell');
	});

	it('exampleStyleForRound is undefined for single-style tricks and bad rounds', () => {
		expect(exampleStyleForRound(enclosuresTrick, 1)).toBeUndefined();
		expect(exampleStyleForRound(triadPairsTrick, 0)).toBe('cell');
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/tricks/devices.test.ts`
Expected: FAIL — `exampleStyleForRound` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/tricks/index.ts`, append:

```ts
/**
 * Demo style for a practice round: rotates through the trick's exampleStyles
 * (round 1 = the first, canonical style), cycling. Undefined when the trick
 * declares no styles — generateExample then uses its default.
 */
export function exampleStyleForRound(trick: Trick, roundNumber: number): string | undefined {
	const styles = trick.exampleStyles;
	if (!styles || styles.length === 0) return undefined;
	return styles[(Math.max(1, roundNumber) - 1) % styles.length];
}
```

In `src/lib/state/lick-practice.svelte.ts`:

1. Line 79: `import { exampleStyleForRound, getTrickById } from '$lib/tricks';`
2. In `startTrickSession` (line 724), change the generation call to:

```ts
	const phrase = trick.generateExample(trickParameters, {
		...cContext,
		exampleStyle: exampleStyleForRound(trick, 1)
	});
```

(`cContext` itself stays clean — it is stored on the plan item and the per-round hint must not be baked into it.)

3. In `advanceSingleLickRound`, the trick-regeneration block (lines 1537-1546) runs BEFORE `lickPractice.roundNumber += 1`, and the regenerated phrase belongs to the round being entered, so pass the incoming round number:

```ts
	if (item.kind === 'trick' && item.trickId && item.trickParameters && item.trickContext) {
		const trick = getTrickById(item.trickId);
		if (trick) {
			item.phrase =
				trick.generateExample(item.trickParameters, {
					...item.trickContext,
					tempo: lickPractice.currentTempo,
					exampleStyle: exampleStyleForRound(trick, lickPractice.roundNumber + 1)
				}) ?? item.phrase;
		}
	}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/tricks/devices.test.ts && npm run check`
Expected: PASS, no new type errors (the state module is exercised by svelte-check, not unit tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tricks/index.ts src/lib/state/lick-practice.svelte.ts tests/unit/tricks/devices.test.ts
git commit -m "feat(tricks): rotate triad-pair demo styles per practice round"
```

---

### Task 6: Fluency expected notes follow the winning style

**Files:**
- Modify: `src/lib/scoring/fluency.ts` (the `generateExample` call, around line 156)
- Test: `tests/unit/scoring/fluency.test.ts`

**Interfaces:**
- Consumes: `ConformanceResult.style` (Task 1), `TrickContext.exampleStyle` (Task 4), `scoreConformanceAgainstSpecs` (Task 1).
- Produces: nothing new — behavior change only.

- [ ] **Step 1: Write the failing test**

In `tests/unit/scoring/fluency.test.ts`, add to the imports:

```ts
import {
	scoreConformanceAgainstSpec,
	scoreConformanceAgainstSpecs
} from '$lib/tricks/conformance';
```

(replacing the existing single-import line 8). Append inside `describe('scoreFluency', ...)`:

```ts
	it('generates expected notes for the winning style, not the demo style', () => {
		// Two-style trick: 'demo' expects D F A on quarters; 'alt' is the C E G B
		// eighth arp. generateExample yields a real phrase ONLY when asked for
		// 'alt' — exactly how a device realizes the style it is hinted with.
		const demoSlots: TrickSlotSpec[] = [
			{ offset: [0, 1], duration: [1, 4], exactPcs: [2], role: 'target' },
			{ offset: [1, 4], duration: [1, 4], exactPcs: [5], role: 'target' },
			{ offset: [2, 4], duration: [1, 4], exactPcs: [9], role: 'target' }
		];
		const altNotes: Note[] = [
			{ pitch: 60, offset: [0, 1], duration: [1, 8] },
			{ pitch: 64, offset: [1, 8], duration: [1, 8] },
			{ pitch: 67, offset: [2, 8], duration: [1, 8] },
			{ pitch: 71, offset: [3, 8], duration: [1, 8] }
		];
		const altPhrase: Phrase = {
			id: 'alt-style-example',
			name: 'Alt Style Example',
			timeSignature: [4, 4],
			key: 'C',
			notes: altNotes,
			harmony: [
				{
					chord: { root: 'C', quality: 'maj7' },
					scaleId: 'major.ionian',
					startOffset: [0, 1],
					duration: [1, 1]
				}
			],
			difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
			category: 'triad-pairs',
			tags: ['trick'],
			source: 'generated'
		};
		const trick: Trick = {
			...makeTrick(arpSlots),
			exampleStyles: ['demo', 'alt'],
			scoreConformance: (played, _parameters, ctx) =>
				scoreConformanceAgainstSpecs(
					played,
					[
						{ style: 'demo', slots: demoSlots },
						{ style: 'alt', slots: arpSlots }
					],
					ctx
				),
			generateExample: (_parameters, ctx) => (ctx.exampleStyle === 'alt' ? altPhrase : null)
		};
		const score = scoreFluency({ played: perfectPlayed, trick, parameters: {}, context });
		expect(score.conformance.style).toBe('alt');
		// Real example offsets — NOT the [0,1]-pinned fallback placeholders that
		// a demo-style (null) example would force.
		expect(score.noteResults.map((r) => r.expected.offset)).toEqual(
			altNotes.map((n) => n.offset)
		);
		expect(score.noteResults.map((r) => r.expected.pitch)).toEqual([60, 64, 67, 71]);
		expect(score.overall).toBeCloseTo(1, 5);
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/scoring/fluency.test.ts`
Expected: FAIL — expected offsets come back as the fallback `[0, 1]` placeholders because `generateExample` was called without the winning style and returned null.

- [ ] **Step 3: Implement**

In `src/lib/scoring/fluency.ts`, replace the example call (around line 156):

```ts
	// Prefer an example realized for the style the player actually used —
	// multi-style tricks report the best-of winner on conformance.style.
	const example = trick.generateExample(parameters, {
		...context,
		exampleStyle: conformance.style ?? context.exampleStyle
	});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/scoring/fluency.test.ts`
Expected: PASS — including all pre-existing cases (single-style tricks have `conformance.style === undefined`, so the context passes through unchanged).

- [ ] **Step 5: Full suite, type-check, commit**

Run: `npx vitest run && npm run check`
Expected: full unit/integration suite green, no new type errors.

```bash
git add src/lib/scoring/fluency.ts tests/unit/scoring/fluency.test.ts
git commit -m "feat(scoring): fluency expected notes follow the winning conformance style"
```

---

### Task 7: Documentation

**Files:**
- Modify: `documentation/architecture/trick-scoring.md`

**Interfaces:** none — prose only.

- [ ] **Step 1: Add the styles section**

In `documentation/architecture/trick-scoring.md`, after the "Layer 1: Conformance (the pitch dimension)" section's tier/credit material (read the file first to place it cleanly), add:

```markdown
## Multiple accepted playing styles (spec variants)

A device may accept several rhythmic *styles* of the same formula. Triad
pairs accept three, judged best-of via
`scoreConformanceAgainstSpecs(played, variants, context)`:

| Style | Structure | Slots |
|---|---|---|
| `cell` | A asc + B asc + first two of A (the classic cell; respects off-beat placement) | 8 |
| `triplets` | four eighth-note-triplet groups per bar, alternating A-B-A-B (always on the beat) | 12 |
| `four-eighths` | four eighths of A then four of B, e.g. C-E-G-E, D-F#-A-F# (always on the beat) | 8 |

The engine scores the attempt against every variant with the ordinary
single-spec path and keeps the highest `patternScore`; ties resolve to the
earliest variant, so devices list the canonical style first. The winner's
name is reported as `ConformanceResult.style`, which `scoreFluency` feeds
back into `generateExample` (via `TrickContext.exampleStyle`) so the
report's expected notes match the style the player actually used.

Styles are deliberately NOT trick parameters: they never enter the variant
key, so one progress record covers all styles of a variant. Practice-session
previews rotate through `Trick.exampleStyles` round by round
(`exampleStyleForRound`), teaching the styles by demonstration.
```

- [ ] **Step 2: Verify rendering assumptions**

Run: `npx vitest run tests/unit/tricks/ tests/unit/scoring/fluency.test.ts`
Expected: PASS (no code changed; guard against accidental edits).

- [ ] **Step 3: Commit**

NOTE: this file is currently **untracked** — it was authored in a previous session and staging it commits its full pre-existing content, which is intended (it documents the very engine this feature extends). Mention this in the commit body.

```bash
git add documentation/architecture/trick-scoring.md
git commit -m "docs(architecture): document multi-spec trick scoring styles

Includes the pre-existing (previously uncommitted) trick-scoring doc this
section extends."
```

---

## Verification checklist (after all tasks)

- [ ] `npx vitest run` — full suite green.
- [ ] `npm run check` — no type errors.
- [ ] Manual smoke (optional, needs `npm run dev`): start a Tricks session on Triad Pairs; round 1 demos the cell, round 2 demos triplets (rendered as triplet notation), round 3 demos four-eighths; answering any round with `C-E-G-E, D-F#-A-F#`-style playing (in the session key) grades as exact-tier, not in-pattern.
