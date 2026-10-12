import { withRecognitionDeadline } from './request-budget';
import { parseRecognitionJson } from './recognition-json';
/** Anthropic adapter for the provider-neutral system recognition contract. */
import { error } from '@sveltejs/kit';
import type { Anthropic } from '@anthropic-ai/sdk';
import {
	getAnthropicClient,
	ANTHROPIC_MODEL,
	ANTHROPIC_TUNE_MODEL,
	ANTHROPIC_TUNE_MAX_TOKENS
} from '$lib/server/anthropic';
import { isRestPitch } from '$lib/tunes/import/system-bar-validation';
import type {
	SystemRecognitionInput,
	SystemRecognitionResult,
	SystemRecognizer,
	Clef
} from '$lib/tunes/import/pdf-recognition';
import {
	evidenceIssues,
	signatureIssues,
	pitchReviewAccidentalIssues
} from '$lib/tunes/import/pdf-recognition-quality';
import { screenSystemBars, systemBarIssues } from '$lib/tunes/import/pdf-system-reading';
import type { RecognizedBar as SystemBar } from '$lib/tunes/import/pdf-recognition';
import { reviewPitchBar } from './anthropic-pitch-review';
import { notationReviewNeeded } from '$lib/tunes/import/pdf-notation-review';
import { reviewRecognizedBar } from '$lib/tunes/import/pdf-bar-review';
import {
	pitchReviewAgreesWithHeads,
	retainDisputedAccidentals
} from '$lib/tunes/import/pdf-pitch-reconciliation';
import { readPrintedContext } from './anthropic-context';
import { readHarmony } from './anthropic-harmony';
import { reviewPrintedAccidentals } from './anthropic-accidentals';
type SystemRequestBody = { system: SystemRecognitionInput };
interface WorkTick {
	attempt: number;
}

const FABLE_THINKING = {
	thinking: { type: 'adaptive' },
	output_config: { effort: 'high' }
} as const satisfies {
	thinking: Anthropic.ThinkingConfigParam;
	output_config: Anthropic.OutputConfig;
};

const SYSTEM_MODE_PROMPT = `You are a music COPYIST. The attached image is ONE SYSTEM (one printed line)
of a lead sheet. The bar count is known and given — your only job is to transcribe what is printed
inside each bar. You may recognize the tune; that knowledge is a trap — the ONLY authority is the ink.
Return ONLY a JSON object — no prose, no markdown fences — with this exact shape:
{
  "keySignature": { "fifths": number } | null, // only a PRINTED signature; omitted means null, explicit cancellation to naturals means 0
  "clef": "treble" | "bass" | "alto" | "tenor" | null, // printed clef, null if omitted
  "timeSignature": [number, number] | null, // the printed meter, when this system shows one at its start
  "bars": [
    {
      "startRepeat": boolean,   // |: printed at the START of this bar (winged or plain)
      "endRepeat": boolean,     // :| printed at the END of this bar
      "ending": 1 | 2 | null,   // this bar lies UNDER a printed 1st/2nd volta bracket
      "pickup": boolean,        // partial pickup bar (fewer beats printed than the meter)
      "melody": [ [beat, durationBeats, "pitch"], ... ]  // notes AND rests in reading order; a rest uses pitch "rest"; append true as a 4th element when a note TIES into the next
    }
  ]
}
Rules:
- The bars array must contain EXACTLY the given number of entries, in reading order.
- beat is 0-based within the bar in units of the meter denominator; fractional allowed (0.5 = eighth offset).
- CONTEXT: when clef, key signature, or meter is omitted, inherit the supplied context. Never interpret an omitted signature as C major. Report any printed change explicitly.
- PITCH: scientific notation as PRINTED (middle C = C4), respecting key signature and accidentals.
  NEVER transpose or shift octaves — the app handles instrument transposition.
- RHYTHM: notes and rests fill each bar exactly; a note tied across a barline appears in BOTH bars,
  the first part carrying the tie flag.
- A pickup bar's notes sit at their real beats near the END of the bar (a one-beat pickup in 4/4
  starts at beat 3).
- IGNORE chord symbols, lyrics, colored highlighting, and text — melody notes and structural
  markings only.
- melody lists notes AND rests in reading order (pitch "rest" for rests). Each bar's notes and
  rests must tile the meter EXACTLY — this is mechanically checked. A pickup bar may omit its
  unprinted leading silence.
- If a passage is truly illegible, omit its notes rather than inventing them.`;

interface TranscribeSystemArgs {
	system: SystemRequestBody['system'];
	/** Validated base64 PNG payload, data-URL prefix already stripped. */
	data: string;
	meter: [number, number];
	beats: number;
	client: NonNullable<ReturnType<typeof getAnthropicClient>>;
	clientSignal: AbortSignal;
	tick: WorkTick;
}

/**
 * The model half of system mode: ask, validate the rhythm, re-read the bars
 * that disagree (budget permitting), merge per bar. Throws a 502 only when
 * there is no transcription at all.
 */
async function transcribeSystem({
	system,
	data,
	meter,
	beats,
	client,
	clientSignal,
	tick
}: TranscribeSystemArgs): Promise<SystemRecognitionResult> {
	let lastFailure = 'unknown';
	const ask = async (
		feedback: string | null,
		model: string
	): Promise<{
		fifths: number | null;
		clef: Clef | null;
		timeSignature: [number, number] | null;
		bars: SystemBar[];
		issues: { global: string[]; perBar: string[][] };
	} | null> => {
		let responseText: string;
		tick.attempt += 1;
		try {
			const response = await withRecognitionDeadline(
				clientSignal,
				feedback ? 120_000 : 360_000,
				(budgetSignal) =>
					client.messages
						.stream(
							{
								model,
								max_tokens: ANTHROPIC_TUNE_MAX_TOKENS,
								// Fable thinks adaptively; high effort buys transcription
								// accuracy, and the 32k ceiling keeps dense-system JSON
								// clear of truncation under the thinking tokens.
								...(model === ANTHROPIC_TUNE_MODEL ? FABLE_THINKING : {}),
								system: SYSTEM_MODE_PROMPT,
								messages: [
									{
										role: 'user',
										content: [
											{
												type: 'image',
												source: { type: 'base64', media_type: 'image/png', data }
											},
											{
												type: 'text',
												text:
													`This system contains exactly ${system.barCount} bars in ${beats}/${meter[1]} time. ` +
													`Transcribe it as JSON per the schema. Inherited context (use only for omitted signs): ${JSON.stringify(system.context ?? {})}. ` +
													`Read the clef first. Calibrate noteheads against all five staff lines; for treble the bottom line is E4 and top line F5. Count spaces and ledger lines before applying accidentals. ` +
													(system.first === true
														? ' This is the FIRST system of the chart: check carefully whether the notes before the first full bar form a partial PICKUP bar (pickup: true, notes at their real beats near the END of the bar).'
														: '') +
													(feedback
														? ` Your previous attempt had problems — re-read the image carefully: ${feedback}`
														: '')
											}
										]
									}
								]
							},
							// See the whole-PDF path: an abandoned request must not leave
							// a model call running behind it.
							{ signal: budgetSignal, timeout: feedback ? 120_000 : 360_000, maxRetries: 0 }
						)
						.finalMessage()
			);
			if (response.stop_reason === 'max_tokens') {
				lastFailure = 'truncated model output';
				return null;
			}
			responseText = response.content
				.filter((block) => block.type === 'text')
				.map((block) => (block as { text: string }).text)
				.join('');
		} catch (err) {
			if (clientSignal.aborted) throw err;
			console.error('[tune-parse] system-mode extraction failed:', err);
			lastFailure = `api: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`;
			return null;
		}
		let parsed: unknown;
		try {
			parsed = parseRecognitionJson(responseText);
		} catch {
			lastFailure = `non-json output (${responseText.length} chars): ${responseText.slice(0, 120)}`;
			return null;
		}
		const screened = screenSystemBars(parsed);
		if (!screened) {
			lastFailure = 'malformed bars structure';
			return null;
		}
		return { ...screened, issues: systemBarIssues(screened.bars, system.barCount, beats) };
	};

	const flatIssues = (a: { issues: { global: string[]; perBar: string[][] } }): string[] => [
		...a.issues.global,
		...a.issues.perBar.flat()
	];

	// Fable first for accuracy; its stricter output filter sometimes blocks
	// transcription of well-known tunes — as an explicit API error OR as a
	// silently EMPTY response — so any total first-attempt failure falls
	// back to the baseline model. Failing bars then get ONE retry with
	// their exact rhythm deltas fed back (the Audiveris rhythm-QA loop),
	// and the answer is merged PER BAR so a clean first-attempt bar can
	// never regress.
	let model = ANTHROPIC_TUNE_MODEL;
	let first = await ask(null, model);
	if (!first && model !== ANTHROPIC_MODEL) {
		model = ANTHROPIC_MODEL;
		first = await ask(null, model);
	}
	const evidence = Array.isArray(system.barEvidence) ? system.barEvidence : [];
	const evidenceDisagreements = (bars: SystemBar[]): string[] =>
		// Pixel evidence currently uses treble staff coordinates. Never apply
		// those letter names to a bass or C-clef reading.
		(first?.clef ?? system.context?.clef ?? 'treble') !== 'treble'
			? []
			: bars.flatMap((bar, i) => evidenceIssues(bar, evidence[i], i));

	let result = first;
	let bars = first?.bars ?? [];
	let warnings = first ? flatIssues(first) : [];
	const firstEvidenceIssues = first ? evidenceDisagreements(first.bars) : [];
	const signatureDisagreements = (candidateBars: SystemBar[]) =>
		candidateBars.flatMap((bar, i) =>
			signatureIssues(bar, first?.fifths ?? system.context?.fifths, i)
		);
	const firstSignatureIssues = first ? signatureDisagreements(first.bars) : [];
	const confirmedAccidentals = new Set<number>();
	const accidentalReviewWarnings: string[] = [];
	const notationSuspects =
		first?.bars.map(
			(bar, i) =>
				!!system.barImages?.[i] &&
				(first.clef ?? system.context?.clef) === 'treble' &&
				notationReviewNeeded(bar, evidence[i])
		) ?? [];
	const wantsReread =
		!first ||
		warnings.length > 0 ||
		firstEvidenceIssues.length > 0 ||
		firstSignatureIssues.length > 0 ||
		notationSuspects.some(Boolean);
	// One independent, bounded quality pass remains available even when the
	// first reading was slow. Elapsed time is not evidence of correctness.
	const clef = first?.clef ?? system.context?.clef;
	const fifths = first?.fifths ?? system.context?.fifths;
	if (
		wantsReread &&
		first &&
		first.bars.length === system.barCount &&
		system.barImages?.some(Boolean) &&
		clef &&
		fifths != null
	) {
		const suspect = first.bars.flatMap((bar, i) =>
			(first.issues.perBar[i].length ||
				notationSuspects[i] ||
				signatureIssues(bar, fifths, i).length ||
				(clef === 'treble' && evidenceIssues(bar, evidence[i], i).length)) &&
			system.barImages?.[i]
				? [i]
				: []
		);
		// Four isolated measures per system bounds both spend and concurrency.
		const reviewed = await Promise.allSettled(
			suspect.slice(0, 4).map(async (i) => {
				const previous = first.bars[i - 1]?.melody.at(-1);
				const notation = notationSuspects[i] && !first.issues.perBar[i].length;
				const reviewed = await reviewRecognizedBar(
					{ original: first.bars[i], evidence: evidence[i], clef, beats, index: i, notation },
					() =>
						reviewPitchBar(
							client,
							{
								image: system.barImages![i],
								clef,
								fifths,
								meter,
								original: first.bars[i],
								scope: notation ? 'notation' : undefined,
								tiedFrom: previous?.[3] ? previous[2] : undefined
							},
							clientSignal,
							() => {
								tick.attempt += 1;
							}
						),
					clientSignal
				);
				bars[i] = reviewed.bar;
				accidentalReviewWarnings.push(...reviewed.warnings);
				if (reviewed.confirmedAccidentals) confirmedAccidentals.add(i);
				return i;
			})
		);
		warnings = [
			...systemBarIssues(bars, system.barCount, beats).global,
			...systemBarIssues(bars, system.barCount, beats).perBar.flat()
		];
		reviewed.forEach((r, k) => {
			if (r.status === 'rejected')
				warnings.push(
					`bar ${suspect[k] + 1}: focused pitch review failed; original reading retained`
				);
		});
		if (suspect.length > 4)
			warnings.push('Some measures still need review; the focused reread budget was reached.');
	} else if (wantsReread) {
		const second = await ask(
			first ? [...warnings, ...firstEvidenceIssues, ...firstSignatureIssues].join('; ') : null,
			first ? ANTHROPIC_MODEL : model
		);
		if (second && !first) {
			result = second;
			bars = second.bars;
			warnings = flatIssues(second);
		} else if (
			second &&
			first &&
			first.bars.length !== system.barCount &&
			second.bars.length === system.barCount
		) {
			result = second;
			bars = second.bars;
			warnings = flatIssues(second);
		} else if (
			second &&
			first &&
			first.bars.length === system.barCount &&
			second.bars.length === system.barCount
		) {
			// Per-bar merge: prefer clean bars, and among clean bars prefer
			// the one agreeing with the notehead evidence.
			const agreesWithEvidence = (bar: SystemBar | undefined, i: number): boolean => {
				const ev = evidence[i];
				if (!bar || !ev || typeof ev.count !== 'number') return false;
				return (
					(first.clef ?? system.context?.clef ?? 'treble') === 'treble' &&
					pitchReviewAgreesWithHeads(bar, ev)
				);
			};
			const merged: SystemBar[] = [];
			// The only global issue systemBarIssues emits is the bar-count
			// line, and the merge can FIX the count — recompute it below
			// instead of carrying the first attempt's stale copy.
			const survivors: string[] = first.issues.global.filter(
				(msg) => !/^expected \d+ bars/.test(msg)
			);
			const count = Math.max(first.bars.length, second.bars.length);
			for (let i = 0; i < count; i++) {
				const firstClean = first.bars[i] && (first.issues.perBar[i] ?? []).length === 0;
				const secondClean = second.bars[i] && (second.issues.perBar[i] ?? []).length === 0;
				if (
					firstClean &&
					secondClean &&
					!agreesWithEvidence(first.bars[i], i) &&
					agreesWithEvidence(second.bars[i], i)
				) {
					accidentalReviewWarnings.push(
						...pitchReviewAccidentalIssues(first.bars[i], second.bars[i], i)
					);
					merged.push(retainDisputedAccidentals(first.bars[i], second.bars[i]));
				} else if (firstClean) {
					merged.push(first.bars[i]);
				} else if (secondClean) {
					merged.push(second.bars[i]);
				} else if (first.bars[i]) {
					merged.push(first.bars[i]);
					survivors.push(...(first.issues.perBar[i] ?? []));
				} else if (second.bars[i]) {
					merged.push(second.bars[i]);
					survivors.push(...(second.issues.perBar[i] ?? []));
				}
			}
			if (merged.length !== system.barCount) {
				survivors.unshift(
					`expected ${system.barCount} bars but the transcription returned ${merged.length}`
				);
			}
			bars = merged;
			warnings = survivors;
		}
	}
	if (!result) {
		throw error(502, `The system image could not be transcribed (${lastFailure}). Try again.`);
	}
	if (bars.length !== system.barCount)
		throw error(422, 'The measure count could not be reconciled with the layout.');
	warnings.push(...accidentalReviewWarnings, ...evidenceDisagreements(bars));
	warnings.push(
		...bars.flatMap((bar, i) =>
			confirmedAccidentals.has(i)
				? []
				: signatureIssues(bar, result.fifths ?? system.context?.fifths, i)
		)
	);
	if (
		result.fifths != null &&
		system.context?.fifths != null &&
		result.fifths !== system.context.fifths
	)
		warnings.push('Header and melody key readings disagree; verify the printed signature.');
	if (result.clef && system.context?.clef && result.clef !== system.context.clef)
		warnings.push('Header and melody clef readings disagree; verify pitches against the PDF.');
	if (result.fifths === null && system.context?.fifths == null)
		warnings.push('Key signature is uncertain; check pitches against the PDF.');
	// Rests were only needed for validation — the importer works with notes.
	const stripped = bars.map((bar) => ({
		...bar,
		melody: bar.melody.filter((note) => !isRestPitch(note[2]))
	}));
	return {
		keySignature:
			(result.fifths ?? system.context?.fifths) == null
				? null
				: { fifths: (result.fifths ?? system.context?.fifths)! },
		clef: result.clef ?? system.context?.clef ?? null,
		timeSignature: result.timeSignature,
		bars: stripped,
		warnings: [...new Set(warnings)]
	};
}

/** Composition root: callers can replace this factory without changing import assembly. */
export function createAnthropicSystemRecognizer(providedClient?: Anthropic): SystemRecognizer {
	return {
		id: `anthropic:${ANTHROPIC_TUNE_MODEL}`,
		async recognize(system, signal, onAttempt) {
			const client = providedClient ?? getAnthropicClient();
			if (!client) throw error(503, 'PDF import is not configured.');
			let attempt = 0;
			const tick = {
				get attempt() {
					return attempt;
				},
				set attempt(value: number) {
					attempt = value;
					onAttempt?.();
				}
			};
			const data = system.image.replace(/^data:image\/png;base64,/, '').replace(/\s/g, '');
			if (system.contextOnly) return readPrintedContext(client, data, signal, onAttempt);
			const melodyWork = system.harmonyOnly
				? Promise.resolve<SystemRecognitionResult>({
						keySignature: null,
						timeSignature: null,
						bars: [],
						warnings: []
					})
				: transcribeSystem({
						system,
						data,
						meter: system.timeSignature,
						beats: system.timeSignature[0],
						client,
						clientSignal: signal,
						tick
					});
			const harmonyWork =
				system.readHarmony || system.harmonyOnly
					? readHarmony(client, system, data, signal, onAttempt)
					: Promise.resolve(null);
			const [initialMelody, harmony] = await Promise.all([melodyWork, harmonyWork]);
			const melody = await reviewPrintedAccidentals(
				client,
				system,
				initialMelody,
				signal,
				onAttempt
			);
			return {
				...melody,
				...(harmony ? { harmony: harmony.bars } : {}),
				warnings: [...melody.warnings, ...(harmony?.warnings ?? [])]
			};
		}
	};
}
