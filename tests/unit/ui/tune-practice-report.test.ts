import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TunePracticeReport from '$lib/components/tune-practice/TunePracticeReport.svelte';
import { INSTRUMENTS } from '$lib/types/instruments';
import { point, phrase, result } from '../../helpers/tune-practice-report';
import { sheet } from '../../helpers/tune-fixtures';

const base = {
	onexit: () => {}, tune: sheet({ title: 'Report colors', style: 'Medium swing' }), phrase: phrase(),
	plan: [point('first', 4), point('second', 8)], picked: {},
	instrument: INSTRUMENTS.piano, tempo: 120, elapsed: '0:32',
	clock: { barTicks: 1920, countInTicks: 1920 }, onretry: (): void => {}
};

/** Inspect actual server-rendered insertion buttons, excluding summary controls. */
function take(html: string, id: string): string {
	return html.match(new RegExp(`<button[^>]*data-insertion-id="${id}"[^>]*>[\\s\\S]*?</button>`))?.[0] ?? '';
}

describe('Tune report score treatments', () => {
	it.each([
		[98, 'gold', 'Excellence', '✓'], [90, 'silver', 'Very good', '✓'],
		[76, 'bronze', 'Decent', '✓'], [62, 'teal', 'Needs work', '✓'],
		[48, 'deep', 'Rough', '×'], [0, 'deep', 'Rough', '×']
	] as const)('renders %s%% with its accuracy tier and retains its outcome', (percent, tier, label, symbol) => {
		const { body } = render(TunePracticeReport, { props: { ...base, results: [result('first', percent)] } });
		const button = take(body, 'first');
		expect(button).toContain(`data-accuracy-tier="${tier}"`);
		expect(button).toContain(`${percent}%, ${label}`);
		expect(button).toContain(`aria-hidden="true">${symbol}</span>`);
		if (['gold', 'silver', 'bronze'].includes(tier)) {
			expect(button).toContain(`lp-medal-chip lp-chip-${tier}`);
		} else {
			expect(button).toContain('flat-score');
			expect(button).not.toContain('lp-medal-chip');
		}
	});

	it.each([[94.9, 'silver'], [84.9, 'bronze'], [69.9, 'teal'], [54.9, 'deep']] as const)(
		'keeps %s%% in %s before display rounding', (percent, tier) => {
			const { body } = render(TunePracticeReport, { props: { ...base, results: [result('first', percent)] } });
			expect(take(body, 'first')).toContain(`data-accuracy-tier="${tier}"`);
			expect(take(body, 'first')).toContain(`${Math.round(percent)}%`);
		}
	);

	it('compares the same spot with independent tiers in each chorus and in the selected readout', () => {
		const { body } = render(TunePracticeReport, { props: { ...base, results: [result('first', 48), result('second', 90)] } });
		expect(take(body, 'first')).toContain('data-accuracy-tier="deep"');
		expect(take(body, 'second')).toContain('data-accuracy-tier="silver"');
		const detail = body.split('class="tr-selected-scores"')[1].split('</strong>');
		expect(detail[0]).toContain('var(--accuracy-deep)');
		expect(detail[0]).toContain('Rough');
		expect(detail[1]).toContain('var(--accuracy-silver)');
		expect(detail[1]).toContain('Very good');
		expect(take(body, 'second')).toContain('Recovered');
	});

	it('leaves missed openings, unreached takes and unavailable licks neutral', () => {
		const { body } = render(TunePracticeReport, { props: {
			...base, plan: [...base.plan, point('unavailable', 6, { suggestions: [] })],
			results: [result('first', null), result('unavailable', null)]
		} });
		for (const id of ['first', 'second', 'unavailable']) {
			expect(take(body, id)).not.toContain('data-accuracy-tier');
			expect(take(body, id)).not.toContain('lp-medal-chip');
			expect(take(body, id)).not.toContain('flat-score');
		}
		expect(take(body, 'first')).toContain('○');
		expect(take(body, 'second')).toContain('No take');
		expect(take(body, 'unavailable')).toContain('No matching lick');
	});
});
