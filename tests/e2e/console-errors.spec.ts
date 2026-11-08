import { test, expect } from './fixtures/test';

test('console guard collects errors from additional tabs, even after they close', async ({ page, consoleCollector }) => {
	const second = await page.context().newPage();
	await second.evaluate(() => {
		console.error('deliberate second-tab console sentinel');
		setTimeout(() => { throw new Error('deliberate second-tab exception sentinel'); }, 0);
	});
	await expect.poll(() => consoleCollector.errors.join('\n')).toContain('second-tab console sentinel');
	await expect.poll(() => consoleCollector.pageErrors.join('\n')).toContain('second-tab exception sentinel');
	await second.close();
	// Consume only our two intentional probe errors. Any unrelated error still
	// reaches the normal teardown guard and fails this harness regression.
	consoleCollector.errors.splice(consoleCollector.errors.findIndex(value => value.includes('second-tab console sentinel')), 1);
	consoleCollector.pageErrors.splice(consoleCollector.pageErrors.findIndex(value => value.includes('second-tab exception sentinel')), 1);
});
