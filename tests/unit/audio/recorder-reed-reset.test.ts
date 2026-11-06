import { beforeEach, expect, it, vi } from 'vitest';
import { transcribeTakeWithKey } from '$lib/audio/record-transcription';
import type { PitchReading } from '$lib/audio/pitch-frame';

const evidence = vi.hoisted(() => ({ reset: 0.82 }));
vi.mock('$lib/audio/note-segmenter', async importOriginal => ({
	...await importOriginal<typeof import('$lib/audio/note-segmenter')>(),
	// Two detector tiers can report one tongue at slightly different times.
	// The segmenter retains the earlier boundary after deduplication.
	findReArticulations: (_: unknown, __: unknown, ___: unknown, onReset: (time: number) => void) => {
		onReset(evidence.reset);
		return [0.82];
	},
	segmentNotes: () => [
		{ midi: 65, onsetTime: 0.06, duration: 0.22, cents: 0, clarity: 0.99 },
		{ midi: 67, onsetTime: 0.28, duration: 0.26, cents: 0, clarity: 0.99 },
		{ midi: 69, onsetTime: 0.54, duration: 0.28, cents: 0, clarity: 0.99 },
		{ midi: 69, onsetTime: 0.82, duration: 0.30, cents: 0, clarity: 0.99 }
	]
}));
vi.mock('$lib/audio/recorder-ending', () => ({
	// By the reported boundary the reed has recovered: the ending detector
	// sees continuous tone, but earlier tongue evidence must take precedence.
	ringingRelease: () => 1.03
}));

beforeEach(() => { evidence.reset = 0.82; });

function transcribe() {
	const readings: PitchReading[] = [{ time: 1.1, midi: 69, midiFloat: 69,
		frequency: 440, cents: 0, clarity: 0.99, rms: 0.1 }];
	return transcribeTakeWithKey({ readings, workletOnsets: [], anchorOffset: 0, tempo: 120,
		pcm: { samples: new Float32Array(32), sampleRate: 16000 } });
}

it.each([0, 0.02, -0.02, 0.074])('preserves a tongued ending when its reset is offset by %s seconds', offset => {
	evidence.reset += offset;
	expect(transcribe()?.performedNotes.filter(n => n.pitch !== null).map(n => n.pitch)).toEqual([65, 67, 69, 69]);
});

it.each([-0.1, 0.076])('does not protect a continuous ending with a reset %s seconds away', offset => {
	evidence.reset += offset;
	expect(transcribe()?.performedNotes.filter(n => n.pitch !== null).map(n => n.pitch)).toEqual([65, 67, 69]);
});
