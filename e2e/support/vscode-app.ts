import { _electron as electron, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { resolve } from 'path';
import type { ScenarioEnvironment } from './environment';

export async function launchVSCode(environment: ScenarioEnvironment): Promise<ElectronApplication> {
	const extensionPath = resolve(__dirname, '..', '..');
	return electron.launch({
		executablePath: environment.vscodeExecutable,
		cwd: environment.workspacePath,
		timeout: 60_000,
		args: [
			environment.workspacePath,
			`--extensionDevelopmentPath=${extensionPath}`,
			`--user-data-dir=${environment.userDataPath}`,
			`--extensions-dir=${environment.extensionsPath}`,
			'--disable-workspace-trust',
			'--disable-extensions',
			'--skip-welcome',
			'--skip-release-notes',
			'--disable-updates',
			'--disable-gpu',
			'--no-sandbox'
		]
	});
}

export async function openChatView(page: Page): Promise<Frame> {
	await page.getByRole('tab', { name: 'QuickNoteMD' }).click();

	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		for (const frame of page.frames()) {
			try {
				if (await frame.locator('main[aria-label="QuickNoteMD チャット"]').count()) {
					return frame;
				}
			} catch (error) {
				if (!(error instanceof Error) || !/Frame was detached/.test(error.message)) {
					throw error;
				}
			}
		}
		await page.waitForTimeout(100);
	}
	throw new Error(`QuickNoteMD chat webview did not become available. Frames: ${
		page.frames().map(frame => frame.url()).join(', ')
	}`);
}

export async function closeVSCode(application: ElectronApplication): Promise<void> {
	if (application.windows().length) {
		await application.close();
	}
}
