import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const vscodeVersion = '1.138.0';

export interface ScenarioEnvironment {
	rootPath: string;
	workspacePath: string;
	userDataPath: string;
	extensionsPath: string;
	vscodeExecutable: string;
}

export async function createScenarioEnvironment(): Promise<ScenarioEnvironment> {
	if (process.platform !== 'win32') {
		throw new Error('Playwright VS Code E2E scenarios currently support Windows only.');
	}

	const rootPath = await mkdtemp(join(tmpdir(), 'quick-note-md-e2e-'));
	try {
		const workspacePath = join(rootPath, 'workspace');
		const userDataPath = join(rootPath, 'user-data');
		const extensionsPath = join(rootPath, 'extensions');
		await Promise.all([
			mkdir(workspacePath),
			mkdir(userDataPath),
			mkdir(extensionsPath)
		]);
		const vscodeExecutable = await downloadAndUnzipVSCode(vscodeVersion);
		return {
			rootPath: resolve(rootPath),
			workspacePath: resolve(workspacePath),
			userDataPath: resolve(userDataPath),
			extensionsPath: resolve(extensionsPath),
			vscodeExecutable: resolve(vscodeExecutable)
		};
	} catch (error) {
		await rm(rootPath, { recursive: true, force: true });
		throw error;
	}
}

export async function cleanupScenarioEnvironment(environment: ScenarioEnvironment): Promise<void> {
	const root = resolve(environment.rootPath);
	const temp = resolve(tmpdir());
	const relativeRoot = relative(temp, root);
	if (!relativeRoot || relativeRoot === '.' || relativeRoot.startsWith(`..${sep}`) ||
		relativeRoot === '..' || isAbsolute(relativeRoot)) {
		throw new Error(`Refusing to remove a path outside the scenario temporary root: ${root}`);
	}
	await rm(root, { recursive: true, force: true });
}

export async function seedIssues(environment: ScenarioEnvironment, count: number): Promise<string> {
	const directory = join(environment.workspacePath, '.quick-note-md', 'issues');
	await mkdir(directory, { recursive: true });
	for (let id = 1; id <= count; id++) {
		const timestamp = new Date(Date.UTC(2026, 0, id)).toISOString();
		const title = `Seed issue ${String(id).padStart(2, '0')}`;
		const state = id % 2 === 0 ? 'closed' : 'open';
		const source = [
			`<!-- quick-note-md:issue:v1 ${JSON.stringify({
				id, title, state, labels: ['seed'], createdAt: timestamp, updatedAt: timestamp,
			})} -->`,
			'',
			`Description for seed ${String(id).padStart(2, '0')}.`,
		].join('\n');
		await writeFile(join(directory, `issue-${String(id).padStart(6, '0')}.md`), source, 'utf8');
	}
	await writeFile(join(directory, '.sequence.md'), `<!-- quick-note-md:sequence:v1 ${JSON.stringify({ nextId: count + 1 })} -->\n`, 'utf8');
	return directory;
}
