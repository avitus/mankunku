/** Read staff coordinates from an isolated measure; spelling is resolved by music rules. */
import type Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_TUNE_MODEL } from '$lib/server/anthropic';
import type { Clef, RecognizedBar } from '$lib/tunes/import/pdf-recognition';
import { resolveStaffEvents, type StaffEvent } from '$lib/tunes/import/staff-pitch';
import { barTilingIssues, isRestPitch } from '$lib/tunes/import/system-bar-validation';
import { withRecognitionDeadline } from './request-budget';
import { parseRecognitionJson } from './recognition-json';

export async function reviewPitchBar(
	client: Anthropic,
	input: {
		image: string;
		clef: Clef;
		fifths: number;
		meter: [number, number];
		original: RecognizedBar;
		/** Full notation is reserved for rhythm repair or independently confirmed review. */
		scope?: 'pitch' | 'notation';
		tiedFrom?: string;
	},
	signal: AbortSignal,
	onAttempt?: () => void
): Promise<RecognizedBar> {
	onAttempt?.();
	const data = input.image.replace(/^data:image\/png;base64,/, '');
	const pitchOnly =
		input.scope !== 'notation' &&
		barTilingIssues(input.original.melody, 0, input.meter[0], {
			allowLeadingGap: input.original.pickup
		}).length === 0;
	const noteCount = input.original.melody.filter((n) => !isRestPitch(n[2])).length;
	const response = await withRecognitionDeadline(signal, 120_000, (budgetSignal) =>
		client.messages
			.stream(
				{
					model: ANTHROPIC_TUNE_MODEL,
					thinking: { type: 'adaptive' },
					output_config: { effort: 'high' },
					max_tokens: 8192,
					system: pitchOnly
						? `Read this ONE measure for PITCH ONLY. Any enlarged panels below the measure repeat the same notes, numbered in reading order; use them to locate each center. Preserve the supplied rhythm and ties; this pass reads pitch only. Blue numbers at the left label staff coordinates: 0 bottom line, 2 next line, 8 top line; spaces have odd numbers. Locate the CENTER of each notehead, ignoring stems, beams and ties. Return JSON {"notes":[[position,accidental],...]}, exactly ${noteCount} notes in left-to-right order. Do not include rests or read durations. Position must be an integer coordinate. Accidental is null unless a sign is PRINTED before that note: "sharp", "flat", "natural", "double-sharp", "double-flat". Never apply the key signature or output pitch names.`
						: `Read this ONE measure from the ink. Any enlarged panels below repeat the same notes; transcribe each event only once from the whole measure. Blue numbers at the left calibrate vertical staff coordinates: 0 is the bottom staff line, 2 the next line, 8 the top line; spaces are odd numbers. Read the CENTER of each notehead, not its stem, beam, tie or chord text. Return JSON {"events":[[beat,duration,position,accidental,tied],...]}. Position is an integer staff coordinate, or null for a rest. accidental is null unless an accidental is PRINTED immediately before that note; otherwise one of "sharp","flat","natural","double-sharp","double-flat". Never apply the key signature yourself and never output pitch names. tied is true only for a tie into the next note. Include printed rests.`,
					messages: [
						{
							role: 'user',
							content: [
								{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
								{
									type: 'text',
									text: `Meter ${input.meter.join('/')}. Beat zero starts the measure. ${input.original.pickup ? 'This is a pickup; put notes at their real beats near the END of the measure.' : 'Events must fill the measure.'}`
								}
							]
						}
					]
				},
				{ signal: budgetSignal, timeout: 120_000, maxRetries: 0 }
			)
			.finalMessage()
	);
	if (response.stop_reason === 'max_tokens') throw new Error('Pitch review was truncated');
	const text = response.content
		.filter((b) => b.type === 'text')
		.map((b) => b.text)
		.join('')
		.trim();
	const raw = parseRecognitionJson(text);
	if (!raw || typeof raw !== 'object' || Array.isArray(raw))
		throw new Error('Invalid staff reading');
	const parsed = raw as Record<string, unknown>;
	if (pitchOnly) {
		const notes = parsed.notes;
		if (!Array.isArray(notes) || notes.length !== noteCount)
			throw new Error('Pitch review note count disagrees');
		let index = 0;
		parsed.events = input.original.melody.map((n) => {
			if (isRestPitch(n[2])) return [n[0], n[1], null, null, false];
			const note = notes[index++];
			if (!Array.isArray(note) || note.length !== 2 || note[0] === null)
				throw new Error('Invalid pitch observation');
			return [n[0], n[1], note[0], note[1], n[3] === true];
		});
	}
	if (!Array.isArray(parsed?.events) || parsed.events.length > 128)
		throw new Error('Invalid staff event list');
	const allowed = [null, 'sharp', 'flat', 'natural', 'double-sharp', 'double-flat'];
	const events: StaffEvent[] = parsed.events.map((entry: unknown) => {
		if (
			!Array.isArray(entry) ||
			entry.length < 4 ||
			!Number.isFinite(entry[0]) ||
			!Number.isFinite(entry[1]) ||
			entry[0] < 0 ||
			entry[1] <= 0 ||
			entry[1] > input.meter[0] ||
			(entry[2] !== null && (!Number.isInteger(entry[2]) || Math.abs(entry[2]) > 28)) ||
			!allowed.includes(entry[3])
		)
			throw new Error('Invalid staff event');
		return {
			beat: entry[0],
			duration: entry[1],
			position: entry[2],
			accidental: entry[3],
			tied: entry[4] === true
		};
	});
	return {
		...input.original,
		melody: resolveStaffEvents(events, input.clef, input.fifths, input.tiedFrom)
	};
}
