import { withRecognitionDeadline } from './request-budget';
import { parseRecognitionJson } from './recognition-json';
/** Harmony has its own prompt and output: reading chords must not perturb melody. */
import type Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_MODEL } from '$lib/server/anthropic';
import { screenHarmonyReading, type HarmonyReading } from '$lib/tunes/import/pdf-harmony-reading';
import type { Harmony, SystemRecognitionInput } from '$lib/tunes/import/pdf-recognition';

async function readHarmonyOnce(
	client: Anthropic,
	input: SystemRecognitionInput,
	data: string,
	signal: AbortSignal,
	onAttempt?: () => void
): Promise<HarmonyReading> {
	onAttempt?.();
	const response = await withRecognitionDeadline(signal, 120_000, (budgetSignal) =>
		client.messages
			.stream(
				{
					model: ANTHROPIC_MODEL,
					max_tokens: 4096,
					system: `Copy only the chord symbols printed above this single staff system. Never infer harmony from the tune or melody. Return JSON {"bars":[[[beat,"symbol"],...],...]}, one array per printed measure including any pickup. Beats are zero-based in the declared meter. Preserve roots, slash basses and alterations. No chord printed means []. Do not transcribe melody. Do not count an opening staff border as a measure.`,
					messages: [
						{
							role: 'user',
							content: [
								{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
								{
									type: 'text',
									text: `There are ${input.barCount} measures in ${input.timeSignature.join('/')} time. ${input.first ? 'The first measure may be a pickup.' : ''}`
								}
							]
						}
					]
				},
				{ signal: budgetSignal, timeout: 120_000, maxRetries: 0 }
			)
			.finalMessage()
	);
	if (response.stop_reason === 'max_tokens') throw new Error('harmony output was truncated');
	const text = response.content
		.filter((b) => b.type === 'text')
		.map((b) => b.text)
		.join('')
		.trim();
	const raw = parseRecognitionJson(text);
	return screenHarmonyReading(raw, input.barCount, input.timeSignature[0]);
}

/** Recover failed measures from their own source images, with bounded work. */
export async function readHarmony(
	client: Anthropic,
	input: SystemRecognitionInput,
	data: string,
	signal: AbortSignal,
	onAttempt?: () => void
): Promise<{ bars: Harmony; warnings: string[] }> {
	let reading: HarmonyReading;
	let failed = false;
	try {
		reading = await readHarmonyOnce(client, input, data, signal, onAttempt);
	} catch (err) {
		if (signal.aborted) throw err;
		failed = true;
		reading = {
			bars: Array.from({ length: input.barCount }, () => []),
			issues: Array.from({ length: input.barCount }, () => [
				'chord symbols could not be read; check harmony against the PDF'
			])
		};
	}
	const suspect = reading.issues
		.flatMap((issues, i) => (issues.length && input.harmonyImages?.[i] ? [i] : []))
		.slice(0, 8);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(2, suspect.length) }, async () => {
			while (next < suspect.length) {
				if (signal.aborted) throw signal.reason ?? new Error('Harmony recovery cancelled');
				const i = suspect[next++];
				try {
					const single = await readHarmonyOnce(
						client,
						{ ...input, barCount: 1, first: false, harmonyImages: undefined },
						input.harmonyImages![i].replace(/^data:image\/png;base64,/, ''),
						signal,
						onAttempt
					);
					if (!single.issues[0].length) {
						reading.bars[i] = single.bars[0];
						reading.issues[i] = [];
					}
				} catch (err) {
					if (signal.aborted) throw err;
				}
			}
		})
	);
	return {
		bars: reading.bars,
		warnings:
			failed && !suspect.length
				? ['Chord symbols could not be read; check harmony against the PDF.']
				: reading.issues.flatMap((issues, i) =>
						[...new Set(issues)].map((issue) => `bar ${i + 1}: ${issue}`)
					)
	};
}
