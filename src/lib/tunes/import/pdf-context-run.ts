/** Context observations are ordered; expensive music recognition can run concurrently. */
import {
	runSystemTranscriptions,
	type RunSystemsOptions,
	type RunSystemsResult
} from './pdf-import-run';
import type { RecognitionContext, SystemRecognitionResult } from './pdf-recognition';
import { inheritContext } from './pdf-recognition-quality';

export async function runContextualTranscriptions(
	options: Omit<RunSystemsOptions<SystemRecognitionResult>, 'transcribe'> & {
		initialContext: RecognitionContext;
		/** Optional cheap header pass. Without it, serialize reads so context cannot race. */
		readContext?: (index: number, signal: AbortSignal) => Promise<SystemRecognitionResult | null>;
		transcribe: (
			index: number,
			context: RecognitionContext,
			signal: AbortSignal
		) => Promise<SystemRecognitionResult | null>;
	}
): Promise<RunSystemsResult<SystemRecognitionResult>> {
	let context = { ...options.initialContext };
	const printed = (result: SystemRecognitionResult): RecognitionContext => ({
		fifths: result.keySignature?.fifths ?? null,
		clef: result.clef ?? null,
		timeSignature: result.timeSignature
	});
	const contexts: RecognitionContext[] = [];
	const uncertainHeaders: boolean[] = [];
	if (options.readContext) {
		const headers = await runSystemTranscriptions({
			...options,
			attempts: 1,
			concurrency: options.concurrency ?? 4,
			transcribe: (index, _attempt, signal) => options.readContext!(index, signal)
		});
		if (headers.aborted) return headers;
		let uncertain = false;
		for (const result of headers.results) {
			if (!result) uncertain = true;
			else {
				context = inheritContext(context, printed(result));
				if (result.keySignature && result.clef) uncertain = false;
			}
			contexts.push({ ...context });
			uncertainHeaders.push(uncertain);
		}
	}
	return runSystemTranscriptions({
		...options,
		concurrency: options.readContext ? (options.concurrency ?? 4) : 1,
		async transcribe(index, _attempt, signal) {
			const result = await options.transcribe(index, contexts[index] ?? { ...context }, signal);
			if (result) {
				if (!options.readContext) context = inheritContext(context, printed(result));
				if (uncertainHeaders[index])
					result.warnings.push(
						'A preceding staff header could not be independently read; verify inherited key and clef.'
					);
				const printedMeter = contexts[index]?.timeSignature;
				const declaredMeter = options.initialContext.timeSignature;
				if (printedMeter && declaredMeter && printedMeter.join('/') !== declaredMeter.join('/')) {
					result.warnings.push(
						`Printed meter ${printedMeter.join('/')} differs from the declared ${declaredMeter.join('/')}; review this line. Mixed meters need manual correction.`
					);
				}
			}
			return result;
		}
	});
}
