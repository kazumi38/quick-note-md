import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: '.',
	testMatch: '**/*.spec.ts',
	outputDir: '../test-results/e2e',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 90_000,
	expect: { timeout: 10_000 },
	reporter: 'list',
	use: {
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	}
});
