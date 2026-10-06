import { test as base, expect, type ElectronApplication, type Frame, type Page, type TestInfo } from '@playwright/test';
import { copyFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { cleanupScenarioEnvironment, createScenarioEnvironment, seedNotesDirectory, type ScenarioEnvironment } from './support/environment';
import { closeVSCode, launchVSCode, openChatView } from './support/vscode-app';

interface E2EFixtures {
	fixtureChat: 'saved-chat' | undefined;
	environment: ScenarioEnvironment;
	application: ElectronApplication;
	workbench: Page;
	chat: Frame;
}

export const test = base.extend<E2EFixtures>({
	fixtureChat: [undefined, { option: true }],
	environment: async ({ fixtureChat }, use) => {
		const environment = await createScenarioEnvironment();
		try {
			if (fixtureChat === 'saved-chat') {
				const notesPath = await seedNotesDirectory(environment);
				await copyFile(join(__dirname, 'fixtures', 'saved-chat.md'), join(notesPath, 'Saved E2E Chat.md'));
			}
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
	chat: async ({ workbench }, use) => {
		await use(await openChatView(workbench));
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
