import { test, expect, setE2EAuthCookie } from './fixtures/auth';
import { seedOnboardedAnonymous, seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import type { Page } from '@playwright/test';

/**
 * Auth flows — exercises the anonymous sign-in form and the password-reset
 * round trip. Route-level rendering of /auth is covered by smoke.spec.ts;
 * this spec asserts the form's credential fields actually mount.
 */

test.describe('auth — anonymous', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('renders the sign-in form and toggles to sign-up', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/auth');
		await expect(page.locator('main')).toBeVisible();
		// The credential fields are labelled, and the submit reads Sign In.
		await expect(page.getByLabel('Email')).toBeVisible();
		await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
		const submit = page.locator('button[type="submit"]');
		await expect(submit).toHaveAccessibleName('Sign in');

		const password = page.getByLabel('Password', { exact: true });
		await password.fill('preview-password');
		await expect(password).toHaveAttribute('autocomplete', 'current-password');
		await page.getByRole('button', { name: 'Show password', exact: true }).click();
		await expect(password).toHaveAttribute('type', 'text');
		await expect(password).toHaveValue('preview-password');
		await page.getByRole('button', { name: 'Hide password', exact: true }).click();
		await expect(password).toHaveAttribute('type', 'password');

		// The mode toggle swaps the form into sign-up (the submit re-labels)
		// and back again.
		await page.getByRole('button', { name: 'Create account', exact: true }).click();
		await expect(submit).toHaveAccessibleName('Create account');
		await expect(page.locator('main form')).toHaveAttribute('action', '?/register');
		await expect(password).toHaveAttribute('autocomplete', 'new-password');
		await expect(password).toHaveAttribute('minlength', '6');
		await expect(password).toHaveAccessibleDescription('At least 6 characters.');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(submit).toHaveAccessibleName('Sign in');
		await expect(page.locator('main form')).toHaveAttribute('action', '?/login');
		await expect(password).not.toHaveAttribute('minlength');
	});

	// avitus+sop, 2026-10-05: a dead confirmation link used to land on
	// "Authentication failed. Please try again." with no way to a new link.
	test('an expired confirmation link offers a new one, and the resend button posts to ?/resend', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/auth?error=link_expired');
		await expect(page.locator('main').getByRole('alert')).toContainText('expired or was already used');
		const resend = page.locator('main').getByRole('button', { name: 'Email me a new confirmation link' });
		await expect(resend).toBeVisible();

		// formnovalidate lets it submit without a password; with no email the
		// resend action answers before contacting Supabase, which proves the
		// button reached ?/resend rather than the login action.
		await resend.click();
		await expect(page.locator('main').getByRole('alert')).toHaveText(
			'Enter your email address to get a new confirmation link.'
		);
		await expect(resend).toBeVisible();
	});

	test('a link confirmed in another browser says the email is confirmed', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/auth?notice=email_confirmed');
		await expect(page.locator('main').getByRole('status')).toHaveText('Your email is confirmed. Sign in to continue.');
		await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Email me a new confirmation link' })
		).toHaveCount(0);
	});

	test("an expired reset link lands on the reset page's expired message, not the sign-in form", async ({
		page
	}) => {
		// The redirect Supabase's /verify sends for an expired or already-used
		// recovery link: error params on the redirectTo, no code.
		await page.goto(
			'/auth/callback?type=recovery&error=access_denied&error_code=otp_expired' +
				'&error_description=Email+link+is+invalid+or+has+expired'
		);

		await expect(page).toHaveURL(/\/auth\/reset-password\?link=expired$/);
		const problem = page.getByTestId('reset-password-problem');
		await expect(problem).toHaveAttribute('data-status', 'expired');
		await expect(problem).toContainText('expired');
		await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
		// Signed out, so the way forward is signing in first.
		await expect(
			page.locator('main').getByRole('link', { name: 'Sign in', exact: true })
		).toBeVisible();
	});
});

/**
 * Wait until the sign-in form is hydrated, using the password toggle as the
 * probe: it only works once client code runs. A submit clicked before
 * `use:enhance` attaches posts the form natively, and a mocked action
 * response then replaces the page instead of updating the form.
 */
async function waitForAuthFormHydration(page: Page): Promise<void> {
	await expect(async () => {
		await page.getByRole('button', { name: 'Show password', exact: true }).click();
		await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
	}).toPass();
}

test('account switching keeps sign-in feedback visible until the destination loads', async ({
	signedInPage: page,
	baseURL
}) => {
	await seedOnboardedAnonymous(page);
	await stubRest(page);
	await page.goto('/settings');
	await page.locator('nav details summary').click();
	await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
	await expect(page).toHaveURL(/\/auth$/);
	// Sign-out re-homes storage with a reload before hydrating the form.
	await waitForAuthFormHydration(page);

	let releaseLogin!: () => void;
	const loginGate = new Promise<void>((resolve) => { releaseLogin = resolve; });
	let releaseNavigation!: () => void;
	const navigationGate = new Promise<void>((resolve) => { releaseNavigation = resolve; });
	let navigationStarted!: () => void;
	const navigating = new Promise<void>((resolve) => { navigationStarted = resolve; });
	const intermediateRequests: string[] = [];
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (request.method() === 'GET' &&
			(url.pathname === '/auth' || url.pathname.endsWith('/__data.json'))) {
			intermediateRequests.push(url.pathname);
			if (request.isNavigationRequest()) navigationStarted();
		}
	});
	await page.route('**/auth?/login', async (route) => {
		await loginGate;
		await setE2EAuthCookie(page, {
			id: '00000000-0000-0000-0000-000000000002',
			email: 'second-user@example.com'
		}, baseURL);
		await route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({ type: 'redirect', status: 303, location: '/' })
		});
	});
	// Let route-data loads and any /auth reload run. Hold only the destination
	// document: pausing __data.json hid the later account-switch reload bug.
	await page.route((url) => url.pathname === '/', async (route) => {
		navigationStarted();
		await navigationGate;
		await route.continue();
	});
	await page.getByLabel('Email').fill('second-user@example.com');
	await page.getByLabel('Password', { exact: true }).fill('test-password');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	const submit = page.locator('main button[type="submit"]').first();
	try {
		await expect(submit).toHaveAccessibleName('Signing in…');
		await expect(submit).toBeDisabled();
		const formStates: string[] = [];
		await page.exposeFunction('recordSignInState', (state: string) => { formStates.push(state); });
		await page.evaluate(() => {
			const form = document.querySelector('main form')!;
			const record = (): void => {
				void (window as typeof window & { recordSignInState: (state: string) => Promise<void> })
					.recordSignInState(JSON.stringify({
						label: form.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent!.trim(),
						disabled: form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,
						busy: form.getAttribute('aria-busy'),
						emailDisabled: form.querySelector<HTMLInputElement>('[name="email"]')!.disabled
					}));
			};
			new MutationObserver(record).observe(form, { subtree: true, attributes: true, childList: true, characterData: true });
			window.addEventListener('beforeunload', record);
			record();
		});
		await expect.poll(() => formStates.length).toBeGreaterThan(0);
		releaseLogin();
		await navigating;
		// A successful sign-in must go straight to the destination document,
		// without a client route load that reloads the still-current /auth URL.
		expect(intermediateRequests).toEqual([]);
		// Chromium suspends evaluation in a document navigating away. Record
		// changes and beforeunload from inside it instead of querying it here.
		await expect.poll(() => formStates.length).toBeGreaterThan(1);
		for (const state of formStates) {
			expect(JSON.parse(state)).toEqual({ label: 'Signing in…', disabled: true, busy: 'true', emailDisabled: true });
		}
	} finally {
		releaseLogin();
		releaseNavigation();
	}
	await expect(page).toHaveURL(new URL('/', baseURL!).href);
});

test('failed sign-in restores the form for retry', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await page.goto('/auth');
	await page.route('**/auth?/login', async (route) => {
		await route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				type: 'failure', status: 400,
				data: '[{"error":1,"email":2},"Invalid login credentials","second-user@example.com"]'
			})
		});
	});
	await waitForAuthFormHydration(page);
	await page.getByLabel('Email').fill('second-user@example.com');
	await page.getByLabel('Password', { exact: true }).fill('test-password');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.locator('main').getByRole('alert')).toHaveText('Invalid login credentials');
	await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
	await expect(page.locator('main form')).toHaveAttribute('aria-busy', 'false');
	await expect(page.getByLabel('Email')).toBeEnabled();
});

/**
 * Answer every PostgREST call empty. Settings and the root layout's cloud
 * hydration query Supabase from the browser; with only the e2e cookie there
 * is no real session, and WebKit surfaces the resulting 406s as errors (see
 * account.spec.ts).
 */
async function stubRest(page: Page): Promise<void> {
	await page.route('**/rest/v1/**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'content-range': '0-0/0' },
			body: '[]'
		});
	});
}

test.describe('password reset (authed)', () => {
	test.beforeEach(async ({ signedInPage }) => {
		await seedOnboardedAnonymous(signedInPage);
		await stubRest(signedInPage);
	});

	test("Settings' Change asks Supabase to send the link back through the recovery callback", async ({
		signedInPage
	}) => {
		// Before the fix this was `<origin>/auth`, a page that exchanges no
		// codes — so the link never reached a new-password form.
		await signedInPage.route('**/auth/v1/recover**', async (route) => {
			await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
		});
		await signedInPage.goto('/settings');
		const origin = new URL(signedInPage.url()).origin;

		const recover = signedInPage.waitForRequest((req) =>
			new URL(req.url()).pathname.endsWith('/auth/v1/recover')
		);
		// Accept the confirmation alert the moment it opens. Awaiting a
		// waitForEvent('dialog') after the click deadlocks whenever the alert
		// opens while click() is still settling: the open dialog blocks the
		// page, and nothing accepts it until click() returns.
		const alertMessage = new Promise<string>((resolve) => {
			signedInPage.once('dialog', async (dialog) => {
				resolve(dialog.message());
				await dialog.accept();
			});
		});
		await signedInPage.getByRole('button', { name: 'Change', exact: true }).click();

		const request = await recover;
		expect(new URL(request.url()).searchParams.get('redirect_to')).toBe(
			`${origin}/auth/callback?type=recovery`
		);
		expect(JSON.parse(request.postData() ?? '{}').email).toBe('e2e-test@mankunku.dev');
		expect(await alertMessage).toMatch(/open the link in this browser/i);
	});

	test('a recovery session sets a new password on the reset page', async ({ signedInPage }) => {
		await signedInPage.goto('/auth/reset-password');
		await expect(
			signedInPage.getByRole('heading', { name: 'Choose a New Password' })
		).toBeVisible();
		await expect(signedInPage.getByText('For e2e-test@mankunku.dev')).toBeVisible();

		const password = signedInPage.getByLabel('New password', { exact: true });
		const confirm = signedInPage.getByLabel('Confirm new password');
		const submit = signedInPage.getByRole('button', { name: 'Set New Password' });

		// A mismatch is refused by the action and keeps the form up.
		await password.fill('new-secret-1');
		await confirm.fill('new-secret-2');
		await submit.click();
		await expect(signedInPage.getByText('Passwords do not match.')).toBeVisible();

		await password.fill('new-secret-1');
		await confirm.fill('new-secret-1');
		await submit.click();
		await expect(signedInPage.getByTestId('reset-password-success')).toBeVisible();
		await expect(signedInPage.getByRole('heading', { name: 'Password Updated' })).toBeVisible();
		await expect(password).toHaveCount(0);
	});
});

for (const theme of ['dark', 'light']) {
	test(`${theme} sign-in panel fits phones and desktops, including long notices`, async ({ page }, testInfo) => {
		await seedStorage(page, { settings: { ...SETTINGS_ONBOARDED, theme }, 'tour-state': TOUR_DISMISSED });
		await page.goto('/auth?error=link_expired');
		const panel = page.getByRole('region', { name: 'Welcome back' });
		for (const width of [1440, 900, 390, 320]) {
			await page.setViewportSize({ width, height: 900 });
			await expect(panel).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
			for (const control of [page.getByLabel('Email'), page.getByLabel('Password', { exact: true }), panel.getByRole('button', { name: 'Sign in', exact: true }), panel.getByRole('button', { name: 'Email me a new confirmation link' })]) {
				const bounds = await control.boundingBox();
				expect(bounds).not.toBeNull();
				expect(bounds!.x).toBeGreaterThanOrEqual(0);
				expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
				expect(bounds!.height).toBeGreaterThanOrEqual(44);
			}
			await page.screenshot({ path: testInfo.outputPath(`auth-${theme}-${width}.png`), fullPage: true });
		}
	});
}
