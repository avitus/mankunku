import { withRecognitionDeadline } from './request-budget';
import { parseRecognitionJson } from './recognition-json';
/** Small header-only pass lets expensive melody reads run concurrently with inherited context. */
import type Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_MODEL } from '$lib/server/anthropic';
import { sanitizeRecognitionContext } from '$lib/tunes/import/pdf-recognition-screen';
import type { SystemRecognitionResult } from '$lib/tunes/import/pdf-recognition';

export async function readPrintedContext(
	client: Anthropic,
	data: string,
	signal: AbortSignal,
	onAttempt?: () => void
): Promise<SystemRecognitionResult> {
	onAttempt?.();
	const response = await withRecognitionDeadline(signal, 60_000, (budgetSignal) =>
		client.messages
			.stream(
				{
					model: ANTHROPIC_MODEL,
					max_tokens: 1024,
					system: `Read only the staff HEADER in this crop. Return JSON {"fifths": integer|null, "clef":"treble"|"bass"|"alto"|"tenor"|null, "timeSignature":[numerator,denominator]|null}. Count only key-signature sharps/flats immediately following the clef, never accidentals before melody notes. Omitted key signature is null, NOT zero. Explicit cancellation naturals mean zero. No printed clef/meter means null. Do not transcribe notes or chords.`,
					messages: [
						{
							role: 'user',
							content: [
								{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }
							]
						}
					]
				},
				{ signal: budgetSignal, timeout: 60_000, maxRetries: 0 }
			)
			.finalMessage()
	);
	if (response.stop_reason === 'max_tokens') throw new Error('Header reading was truncated');
	const text = response.content
		.filter((b) => b.type === 'text')
		.map((b) => b.text)
		.join('')
		.trim();
	const context = sanitizeRecognitionContext(parseRecognitionJson(text));
	return {
		keySignature: context.fifths === null ? null : { fifths: context.fifths },
		clef: context.clef,
		timeSignature: context.timeSignature,
		bars: [],
		warnings: []
	};
}
