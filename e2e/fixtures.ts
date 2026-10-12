import { test as base, expect, type ElectronApplication, type Frame, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { cleanupScenarioEnvironment, createScenarioEnvironment, type ScenarioEnvironment } from './support/environment';
import { closeVSCode, launchVSCode, openIssueView } from './support/vscode-app';

interface E2EFixtures {
	environment: ScenarioEnvironment;
	application: ElectronApplication;
	workbench: Page;
	issues: Frame;
}

export const test = base.extend<E2EFixtures>({
	environment: async ({}, use) => {
		const environment = await createScenarioEnvironment();
		try {
			await use(environment);
		} finally {
			await cleanupScenarioEnvironment(environment);
		}
	},
	application: async ({ environment }, use) => {
		const application = await launchVSCode(environment);
		await application.context().tracing.start({ screenshots: true, snapshots: true });
		try {
			await use(application);
		} finally {
			await closeVSCode(application);
		}
	},
	workbench: async ({ application }, use, testInfo) => {
		const page = await application.firstWindow();
		await use(page);
		await captureFailureArtifacts(page, application, testInfo);
	},
	issues: async ({ workbench }, use) => {
		await use(await openIssueView(workbench));
	}
});

async function captureFailureArtifacts(page: Page, application: ElectronApplication, testInfo: TestInfo): Promise<void> {
	if (testInfo.status === testInfo.expectedStatus) { return; }
	const screenshotPath = testInfo.outputPath('failure.png');
	const tracePath = testInfo.outputPath('trace.zip');
	await mkdir(dirname(screenshotPath), { recursive: true });
	try {
		await page.screenshot({ path: screenshotPath, fullPage: true });
		await testInfo.attach('failure screenshot', { path: screenshotPath, contentType: 'image/png' });
	} catch (error) {
		console.error('Failed to capture or attach the VS Code failure screenshot.', error);
	}
	try {
		await application.context().tracing.stop({ path: tracePath });
		await testInfo.attach('Playwright trace', { path: tracePath, contentType: 'application/zip' });
	} catch (error) {
		console.error('Failed to capture or attach the Playwright trace.', error);
	}
}

export { expect };
