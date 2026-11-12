import { defineConfig } from '@playwright/test';
import config from './playwright.config';

// Explicit artifact producers, excluded from CI test discovery. The imported
// config enforces the same browser-isolation boundary as the regression suite.
export default defineConfig({
	...config,
	testMatch: '**/*.diagnostic.ts',
	// All engines remain selectable explicitly (for example --project=webkit).
	projects: config.projects,
	retries: 0,
	workers: 1,
	fullyParallel: false
});
