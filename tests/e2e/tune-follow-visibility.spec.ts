import { setTuneTempo } from './fixtures/tune-setup';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import { stubCdnInstrumentSamples } from './fixtures/audio';

for (const width of [1280, 390]) for (const melody of [true, false]) for (const keyCenters of [true, false]) {
	test(`${melody ? 'staff' : 'chord'} playback keeps the last bar readable at ${width}px with key centers ${keyCenters ? 'on' : 'off'}`, async ({ page, browserName }) => {
		test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Linux Firefox has no audio device for Tone.start');
		test.setTimeout(60_000);
		await page.setViewportSize({ width, height: 640 });
		await seedOnboardedAnonymous(page);
		await seedTunes(page, [{
			id: 'follow-visibility', title: 'Follow Visibility', key: 'C', timeSignature: [4, 4], source: 'user', tags: [],
			sections: [{ label: 'A', bars: 16,
				notes: melody ? Array.from({ length: 16 }, (_, bar) => ({ pitch: 60, offset: [bar, 1], duration: [1, 1] })) : [],
				harmony: Array.from({ length: 16 }, (_, bar) => ({ chord: { root: ['C', 'F', 'C', 'G'][bar % 4], quality: 'maj6' },
					scaleId: 'major.ionian', startOffset: [bar, 1], duration: [1, 1] }))
			}]
		}]);
		await stubCdnInstrumentSamples(page);
		await page.goto('/tunes/follow-visibility');


		await setTuneTempo(page, 240);

		const toggle = page.getByRole('switch', { name: 'Show key centers', exact: true });
		await expect(toggle).toHaveAttribute('aria-checked', 'true');
		if (!keyCenters) await toggle.click();
		if (keyCenters) await expect(page.locator('[data-key-center]').first()).toBeVisible();
		else await expect(page.locator('[data-key-center]')).toHaveCount(0);
		await page.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 20_000 });
		// Sample actual rendered chord ink every frame, through two complete
		// desktop lines (four phone lines). Checking just the next downbeat
		// misses chords that disappeared during the preceding bar.
		const result = await page.evaluate(async () => {
			const samples: Record<number, { frames: number; minTop: number; maxBottom: number }> = {};
			const deadline = performance.now() + 20_000;
			while (performance.now() < deadline) {
				await new Promise(requestAnimationFrame);
				const bar = Number(document.querySelector('.td-status strong')?.textContent?.match(/Bar (\d+)/)?.[1] ?? 0) - 1;
				if (bar >= 8) return { completed: true, samples };
				if (bar < 0) continue;
				const viewport = document.querySelector('[data-testid="chart-scroll-viewport"].following, [data-testid="tune-chord-chart"]');
				const row = viewport?.querySelector('.playhead-beat-line')?.closest('.abcjs-staff-wrapper')
					?? viewport?.querySelector('.tcc-bar.active');
				const chords = row?.querySelectorAll('.abcjs-chord, .chord-symbol');
				if (!viewport || !chords?.length) continue;
				const clip = viewport.getBoundingClientRect();
				const bounds = [...chords].map(chord => chord.getBoundingClientRect());
				const sample = samples[bar] ??= { frames: 0, minTop: Infinity, maxBottom: -Infinity };
				sample.frames++;
				sample.minTop = Math.min(sample.minTop, ...bounds.map(box => box.top - clip.top));
				sample.maxBottom = Math.max(sample.maxBottom, ...bounds.map(box => box.bottom - clip.bottom));
			}
			return { completed: false, samples };
		});
		await page.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(result.completed).toBe(true);
		for (const bar of width < 600 ? [1, 3, 5, 7] : [3, 7]) {
			const sample = result.samples[bar];
			expect(sample, `last bar ${bar + 1} was sampled`).toBeDefined();
			expect(sample.frames).toBeGreaterThan(5);
			expect(sample.minTop, `chords in bar ${bar + 1} stay below the clip top`).toBeGreaterThanOrEqual(0);
			expect(sample.maxBottom, `chords in bar ${bar + 1} stay above the clip bottom`).toBeLessThanOrEqual(0);
		}
	});
}
