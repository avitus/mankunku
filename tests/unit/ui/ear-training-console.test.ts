import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import EarTrainingConsole from '$lib/components/practice/EarTrainingConsole.svelte';
import { scoreToGrade } from '$lib/scoring/grades';
import type { Score } from '$lib/types/scoring';

const base = {
	writtenKey: 'D', scaleName: 'Major pentatonic', scaleNoteCount: 5,
	elapsedMs: 84_000, practising: false, phase: 'paused' as const,
	disabled: false, onToggle: (): void => {}, score: null,
	quote: '“What we play is life.” — Louis Armstrong'
};

function score(overall: number): Score {
	return {
		overall, grade: scoreToGrade(overall), pitchAccuracy: .97, rhythmAccuracy: .45,
		noteResults: [], notesHit: 4, notesTotal: 5,
		timing: {meanOffsetMs: 0, medianOffsetMs: 0, stdDevMs: 0, latencyCorrectionMs: 0, perNoteOffsetMs: []}
	};
}

describe('Ear Training console', () => {
	it.each(['listen', 'play', 'next'] as const)('keeps the quote out of the live %s phase', (phase) => {
		const { body } = render(EarTrainingConsole, {props: {...base, practising: true, phase, score: score(.89)}});
		expect(body).not.toContain('What we play is life');
		expect(body).not.toContain('Louis Armstrong');
		expect(body).toContain('data-testid="practice-quote"');
		expect(body).toContain('aria-label="Pause practice"');
		expect(body).toContain('89<');
	});

	it.each(['listen', 'play', 'next'] as const)('keeps the sharp/flat cue on screen through the live %s phase', (phase) => {
		// 2026-10-15: a 52-take F Lydian run centred 14 ¢ sharp earned the cue on
		// 18 takes, five of them the last five, and the player saw none of it. The
		// Studio Console (2026-10-12) had carried the one-line reminder into the
		// paused-only tuning region beside the fader bank, so it rendered only on
		// pause. The reminder is the tuning feedback meant for live play; only the
		// fader bank's interpretation waits for a pause.
		const { body } = render(EarTrainingConsole, {props: {...base, practising: true, phase, tuningAlert: {direction: 'sharp', cents: 13}}});
		expect(body).toContain('Consistently sharp · check your tuning');
	});

	it('reserves the cue line while the run is in tune, so the controls never move', () => {
		const { body } = render(EarTrainingConsole, {props: {...base, practising: true, phase: 'play', tuningAlert: null}});
		expect(body).toContain('data-testid="tuning-cue"');
		expect(body).not.toContain('check your tuning');
	});

	it('keeps the latest verdict on the paused screen', () => {
		const { body } = render(EarTrainingConsole, {props: {...base, tuningAlert: {direction: 'flat', cents: -14}}});
		expect(body).toContain('Consistently flat · check your tuning');
	});

	it('restores the existing caption and separates its final attribution when paused', () => {
		const { body } = render(EarTrainingConsole, {props: base});
		expect(body).toContain('“What we play is life.”');
		expect(body).toMatch(/<figcaption[^>]*>— Louis Armstrong/);
		expect(body).toContain('aria-label="Start practice"');
	});

	it('keeps an unattributed liner note intact', () => {
		const { body } = render(EarTrainingConsole, {props: {...base, quote: 'Right in the pocket.'}});
		expect(body).toContain('Right in the pocket.');
		expect(body).not.toContain('<figcaption');
	});

	it.each([
		[.95, 'gold', 'Perfect'], [.94, 'silver', 'Great'], [.85, 'silver', 'Great'],
		[.84, 'bronze', 'Good'], [.70, 'bronze', 'Good'], [.69, 'teal', 'Fair'],
		[.55, 'teal', 'Fair'], [.54, 'deep', 'Try Again'], [0, 'deep', 'Try Again']
	] as const)('preserves the %s scoring tier without a visible badge', (overall, tier, grade) => {
		const { body } = render(EarTrainingConsole, {props: {...base, score: score(overall)}});
		expect(body).toMatch(new RegExp(`class="overall[^\"]*"[^>]*color: var\\(--accuracy-${tier}\\)`));
		expect(body).toContain(`${Math.round(overall * 100)}<`);
		expect(body).toContain(`<span class="sr-only">${grade}</span>`);
		expect(body).not.toContain('et-medal');
		// Pitch and rhythm carry their own actual tier, not the overall colour.
		expect(body).toContain('color: var(--accuracy-gold)');
		expect(body).toContain('color: var(--accuracy-deep)');
	});

	it('does not fabricate scores or a practice timer before the first take', () => {
		const { body } = render(EarTrainingConsole, {props: {...base, elapsedMs: 0, phase: 'ready', quote: ''}});
		expect(body).not.toContain('role="timer"');
		expect(body).not.toContain('Last take');
		expect(body).toContain('Score after your first take.');
		expect(body).not.toContain('89');
	});

	it('keeps an unavailable practice action disabled and explains the reason', () => {
		const { body } = render(EarTrainingConsole, {props: {...base, phase: 'error', disabled: true, message: 'Audio unavailable'}});
		expect(body).toMatch(/<button[^>]*disabled/);
		expect(body).toContain('Audio unavailable');
	});
});
