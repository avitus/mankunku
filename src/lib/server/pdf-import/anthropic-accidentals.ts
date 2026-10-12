/** Independent symbol-only source readings; musical acceptance is provider-neutral. */
import type Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_TUNE_MODEL } from '$lib/server/anthropic';
import type {
	SystemRecognitionInput,
	SystemRecognitionResult
} from '$lib/tunes/import/pdf-recognition';
import { hasCompleteHeadEvidence } from '$lib/tunes/import/pdf-pitch-reconciliation';
import {
	comparePrintedAccidentals,
	screenAccidentalReading
} from '$lib/tunes/import/pdf-accidental-review';
import { parseRecognitionJson } from './recognition-json';
import { withRecognitionDeadline } from './request-budget';

export async function reviewPrintedAccidentals(
	client: Anthropic,
	input: SystemRecognitionInput,
	melody: SystemRecognitionResult,
	signal: AbortSignal,
	onAttempt?: () => void
): Promise<SystemRecognitionResult> {
	if (
		!input.readAccidentals ||
		input.harmonyOnly ||
		melody.clef !== 'treble' ||
		!input.barEvidence?.some(hasCompleteHeadEvidence)
	)
		return melody;
	const read = async () => {
		onAttempt?.();
		const response = await withRecognitionDeadline(signal, 60_000, (budgetSignal) =>
			client.messages
				.stream(
					{
						model: ANTHROPIC_TUNE_MODEL,
						thinking: { type: 'adaptive' },
						output_config: { effort: 'high' },
						max_tokens: 8192,
						system: `Identify only explicit accidental symbols printed immediately before melody notes in this ONE staff system. Ignore chord symbols, the key signature, and accidentals merely implied by earlier notes. Independently count pitched noteheads in each measure, excluding rests. Return JSON {"bars":[{"notes":3,"signs":[[2,"sharp"]]}]}, one object per printed measure including any pickup. Each sign is [one-based pitched-note index, accidental]. Allowed accidentals: sharp, flat, natural, double-sharp, double-flat. No printed sign means signs:[]. Never output pitch names or infer symbols from the tune.`,
						messages: [
							{
								role: 'user',
								content: [
									{
										type: 'image',
										source: {
											type: 'base64',
											media_type: 'image/png',
											data: input.image.replace(/^data:image\/png;base64,/, '').replace(/\s/g, '')
										}
									},
									{
										type: 'text',
										text: `This line has ${input.barCount} measures. ${input.first ? 'Include the opening pickup if printed.' : ''} Copy only explicit melody accidental signs and independently count the noteheads.`
									}
								]
							}
						]
					},
					{ signal: budgetSignal, timeout: 60_000, maxRetries: 0 }
				)
				.finalMessage()
		);
		if (response.stop_reason === 'max_tokens') throw new Error('Accidental reading was truncated');
		const text = response.content
			.filter((b) => b.type === 'text')
			.map((b) => b.text)
			.join('')
			.trim();
		return screenAccidentalReading(parseRecognitionJson(text), input.barCount);
	};
	const readings = await Promise.allSettled([read(), read()]);
	if (signal.aborted) throw signal.reason ?? new Error('Accidental review cancelled');
	if (readings[0].status !== 'fulfilled' || readings[1].status !== 'fulfilled')
		return {
			...melody,
			warnings: [
				...melody.warnings,
				'Printed accidental review was incomplete; check signs against the PDF.'
			]
		};
	const result = comparePrintedAccidentals(
		melody.bars,
		input.barEvidence,
		readings[0].value,
		readings[1].value
	);
	return {
		...melody,
		warnings: [...new Set([...melody.warnings, ...result.warnings])]
	};
}
