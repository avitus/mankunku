import { test, expect } from './fixtures/test';
import { createStubCloud, installStubCloud, type Row } from './fixtures/stub-cloud';

const USER = { id: 'cccccccc-0000-4000-8000-000000000abc', email: 'settings@e2e.dev' };

function settingsRow(overrides: Row = {}): Row {
	return {
		user_id: USER.id,
		instrument_id: 'soprano-sax',
		default_tempo: 100,
		master_volume: 0.8,
		metronome_enabled: true,
		metronome_volume: 0.5,
		backing_track_enabled: false,
		backing_instrument: 'piano',
		backing_track_volume: 0.6,
		swing: 0.62,
		theme: 'dark',
		onboarding_complete: true,
		highest_note: null,
		...overrides
	};
}

test('fresh browser loads soprano and swing despite an edit while cloud settings are arriving', async ({ page, baseURL }) => {
	const cloud = createStubCloud();
	cloud.seedRow('user_profiles', { id: USER.id, display_name: 'Settings Test' });
	cloud.seedRow('user_settings', settingsRow());
	await installStubCloud(page.context(), cloud, USER, baseURL!);
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	await page.route('**/rest/v1/user_settings?*', async (route) => {
		const request = route.request();
		if (request.method() === 'GET' && new URL(request.url()).searchParams.get('select') === '*') await gate;
		await route.fallback();
	});
	try {
		await page.goto('/settings');
		await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Light' }).click();
		release();
		await expect(page.getByRole('radio', { name: /Soprano Saxophone/ })).toHaveAttribute('aria-checked', 'true');
		await expect(page.getByRole('slider', { name: 'Swing feel' })).toHaveAttribute('aria-valuetext', '62%');
		await expect.poll(() => cloud.rows('user_settings')[0]).toMatchObject({
			instrument_id: 'soprano-sax', swing: 0.62, theme: 'light'
		});
		// Let the remaining hydration/auth requests settle before tearing down
		// the document; WebKit reports an aborted auth fetch as a page error.
		await page.waitForLoadState('networkidle');
		await page.reload();
		await expect(page.getByRole('radio', { name: /Soprano Saxophone/ })).toHaveAttribute('aria-checked', 'true');
		await expect(page.locator('html')).toHaveClass(/light/);
		await page.waitForLoadState('networkidle');
	} finally {
		release();
	}
});

test('a stale browser changing volume cannot overwrite another device’s instrument and swing', async ({ page, browser, baseURL }) => {
	const cloud = createStubCloud();
	cloud.seedRow('user_profiles', { id: USER.id, display_name: 'Settings Test' });
	cloud.seedRow('user_settings', settingsRow({ instrument_id: 'tenor-sax', swing: 0.5 }));
	await installStubCloud(page.context(), cloud, USER, baseURL!);
	await page.goto('/settings');
	await expect(page.getByRole('slider', { name: 'Swing feel' })).toHaveAttribute('aria-valuetext', '50%');
	await page.waitForLoadState('networkidle');

	// Another device has now saved the correct choices. This open browser still
	// has the earlier snapshot and must send only the setting it actually edits.
	Object.assign(cloud.rows('user_settings')[0], { instrument_id: 'soprano-sax', swing: 0.62 });
	await page.getByRole('slider', { name: 'Master volume', exact: true }).press('ArrowDown');
	await expect.poll(() => cloud.rows('user_settings')[0].master_volume).toBe(0.75);
	expect(cloud.rows('user_settings')[0]).toMatchObject({ instrument_id: 'soprano-sax', swing: 0.62 });

	const fresh = await browser.newContext({ baseURL });
	try {
		await installStubCloud(fresh, cloud, USER, baseURL!);
		const newPage = await fresh.newPage();
		const errors: string[] = [];
		newPage.on('pageerror', (error) => errors.push(error.message));
		newPage.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
		await newPage.goto('/settings');
		await expect(newPage.getByRole('radio', { name: /Soprano Saxophone/ })).toHaveAttribute('aria-checked', 'true');
		await expect(newPage.getByRole('slider', { name: 'Swing feel' })).toHaveAttribute('aria-valuetext', '62%');
		await expect(newPage.getByRole('slider', { name: 'Master volume', exact: true })).toHaveAttribute('aria-valuetext', '75%');
		await newPage.waitForLoadState('networkidle');
		expect(errors).toEqual([]);
	} finally {
		await fresh.close();
	}
});
