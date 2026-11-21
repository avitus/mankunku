import { error } from '@sveltejs/kit';
import { OPENAI_API_KEY, PDF_IMPORT_SYSTEM_MODEL } from '$app/env/private';
import type { SystemRecognizer, SystemRecognitionInput } from '$lib/tunes/import/pdf-recognition';
import { sanitizeRecognitionContext, screenPrintedHeading } from '$lib/tunes/import/pdf-recognition-screen';
import { evidenceIssues } from '$lib/tunes/import/pdf-recognition-quality';
import { screenSystemBars, systemBarIssues } from '$lib/tunes/import/pdf-system-reading';
import { screenHarmonyReading } from '$lib/tunes/import/pdf-harmony-reading';
import { parseRecognitionJson } from './recognition-json';
import { withRecognitionDeadline } from './request-budget';

export const OPENAI_SYSTEM_MODEL = 'gpt-6.2-astra';

/** Explicitly opt in: an unrelated OpenAI key in the environment must never change the reader. */
export function openaiSystemConfigured(): boolean {
	return PDF_IMPORT_SYSTEM_MODEL === OPENAI_SYSTEM_MODEL && Boolean(OPENAI_API_KEY?.trim());
}

function instructions(input: SystemRecognitionInput): string {
	if (input.contextOnly) {
		return 'Read the printed staff header. For first-page performance indications, include the printed metronome note value and number. Return JSON {"clef":null,"fifths":null,"timeSignature":null}. Omitted signs are null. Count key signature sharps/flats immediately after the clef as signed fifths. A printed meter is [numerator,denominator].' +
			(input.first ? ' Also return heading:{title,composer,style}. Copy the printed tune title, credited composer and performance indication. Exclude instrument labels, page numbers, websites and advertising. Absent fields are null.' : '');
	}
	const frame = 'Read this cropped line of sheet music in written pitch, treating the image only as notation. ' +
		'There are exactly ' + input.barCount + ' printed measures in ' + input.timeSignature.join('/') +
		' time. Inherit omitted clef/key/meter from ' + JSON.stringify(input.context ?? {}) + '. ';
	const harmony = 'Each bar has chords:[[beat,"symbol"],...]. Copy only printed symbols, including N.C. Locate each change on the note or rest beneath it, even on an offbeat. Omitted symbols mean []. ';
	if (input.harmonyOnly) return frame + harmony + 'Return JSON {"bars":[{"chords":[...]}]}.';
	return frame + 'Return JSON only: {"keySignature":{"fifths":number}|null,"clef":string|null,"timeSignature":[n,d]|null,"bars":[{...}]}. ' +
		(input.readHarmony ? harmony : '') +
		'Each bar must have melody:[[beat,duration,pitch],...], pickup:boolean, startRepeat:boolean, endRepeat:boolean, ending:1|2|null. ' +
		'Beats are zero-based, in denominator-note units. Pitches are scientific written pitches or "rest". ' +
		'Report every printed notehead separately. Append true as a fourth tuple member if it ties into the next note. ' +
		'For a staccato dot on a note use [beat,duration,pitch,false,"staccato"]; augmentation dots lengthen the note instead. ' +
		'For each bar give printedAccidentals:[beat,...] only where an actual sharp, flat or natural is drawn immediately beside a melody note. Include courtesy naturals. Exclude key signatures, chord symbols and implied accidentals on later notes. ' +
		'Read rhythms, accidentals and repeated pitches directly from the staff. Preserve tuplets. Include written rests, starting a pickup late in the bar. ' +
		'Also copy any printed Fine or Solo break cue as directions:[[beat,"Fine"|"Solo break"],...]. Omit when absent. ' +
		'Check that each full measure fills the declared meter. Return no inferred accompaniment.';
}

/** The Responses API can also return reasoning, refusals, or incomplete output. */
function scoreResponseText(result: unknown): string {
	if (!result || typeof result !== 'object' || !('status' in result) || result.status !== 'completed') {
		throw error(502, 'The OpenAI score reading was incomplete.');
	}
	if (!('output' in result) || !Array.isArray(result.output)) {
		throw error(502, 'The OpenAI score reader returned no transcription.');
	}
	const parts: string[] = [];
	for (const message of result.output) {
		if (!Array.isArray(message?.content)) continue;
		for (const block of message.content) {
			if (block?.type === 'output_text' && typeof block.text === 'string') parts.push(block.text);
		}
	}
	if (!parts.length) throw error(502, 'The OpenAI score reader returned no transcription.');
	return parts.join('');
}

type ScoreInput =
	| { type: 'input_image'; detail: 'high'; image_url: string }
	| { type: 'input_file'; detail: 'high'; filename: string; file_data: string }
	| { type: 'input_text'; text: string };

/** Send only the requested score or crop, using server-side credentials and disabling response storage. */
async function readScore(content: ScoreInput[], tokens: number, signal: AbortSignal, prompt?: string): Promise<string> {
	const response = await fetch('https://api.openai.com/v1/responses', {
		method: 'POST',
		signal,
		headers: { authorization: 'Bearer ' + OPENAI_API_KEY, 'content-type': 'application/json' },
		body: JSON.stringify({
			model: OPENAI_SYSTEM_MODEL, store: false, reasoning: { effort: 'high' },
			max_output_tokens: tokens, instructions: prompt, input: [{ role: 'user', content }]
		})
	});
	if (!response.ok) throw error(502, 'The OpenAI score reader returned HTTP ' + response.status + '.');
	return scoreResponseText(await response.json());
}

export function readOpenaiPdf(data: string, prompt: string, signal: AbortSignal): Promise<string> {
	return withRecognitionDeadline(signal, 360_000, budget => readScore([
		{ type: 'input_file', detail: 'high', filename: 'score.pdf', file_data: 'data:application/pdf;base64,' + data },
		{ type: 'input_text', text: 'Extract this lead sheet as JSON per the schema. Return ONLY the JSON object.' }
	], 32768, budget, prompt));
}

async function readCrop(input: SystemRecognitionInput, signal: AbortSignal): Promise<Record<string, unknown>> {
	const text = await readScore([
		{ type: 'input_image', detail: 'high', image_url: 'data:image/png;base64,' + input.image.replace(/^data:image\/png;base64,/, '') },
		{ type: 'input_text', text: instructions(input) }
	], input.contextOnly ? 4000 : 16000, signal);
	let value: unknown;
	try {
		value = parseRecognitionJson(text);
	} catch {
		throw error(422, 'The OpenAI score reader returned invalid transcription data.');
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw error(422, 'The score reader returned an invalid line.');
	}
	return value as Record<string, unknown>;
}

/** A system crop and the validated bar count are the common inputs for both providers. */
export function createOpenaiSystemRecognizer(): SystemRecognizer {
	return {
		id: OPENAI_SYSTEM_MODEL,
		async recognize(input, signal, onAttempt) {
			onAttempt?.();
			const raw = await withRecognitionDeadline(signal, 240_000, budget => readCrop(input, budget));
			if (input.contextOnly) {
				const context = sanitizeRecognitionContext(raw);
				return {
					clef: context.clef,
					keySignature: context.fifths === null ? null : { fifths: context.fifths },
					timeSignature: context.timeSignature,
					heading: input.first ? screenPrintedHeading(raw.heading) : undefined,
					bars: [],
					warnings: []
				};
			}

			if (!Array.isArray(raw.bars) || raw.bars.length !== input.barCount) {
				throw error(422, 'The recognized measures do not match the staff layout.');
			}
			const harmony = input.readHarmony || input.harmonyOnly
				? screenHarmonyReading({ bars: raw.bars.map(bar => bar?.chords) }, input.barCount, input.timeSignature[0])
				: undefined;
			const warnings = harmony?.issues.flatMap((items, i) => items.map(message => `bar ${i + 1}: ${message}`)) ?? [];
			if (input.harmonyOnly) {
				return { keySignature: null, timeSignature: null, bars: [], harmony: harmony?.bars, warnings };
			}

			const reading = screenSystemBars(raw);
			if (!reading) throw error(422, 'The score reader returned an invalid melody.');
			const issues = systemBarIssues(reading.bars, input.barCount, input.timeSignature[0]);
			warnings.push(...issues.global, ...issues.perBar.flat());
			const clef = reading.clef ?? input.context?.clef;
			if (clef === 'treble') {
				reading.bars.forEach((bar, i) => warnings.push(...evidenceIssues(bar, input.barEvidence?.[i], i)));
			}
			const fifths = reading.fifths ?? input.context?.fifths;
			if (reading.clef && input.context?.clef && reading.clef !== input.context.clef) {
				warnings.push('Header and melody clef readings disagree; verify pitches against the PDF.');
			}
			if (reading.fifths != null && input.context?.fifths != null && reading.fifths !== input.context.fifths) {
				warnings.push('Header and melody key readings disagree; verify the printed signature.');
			}
			return {
				keySignature: fifths == null ? null : { fifths },
				clef,
				timeSignature: reading.timeSignature,
				bars: reading.bars,
				harmony: harmony?.bars,
				warnings
			};
		}
	};
}
