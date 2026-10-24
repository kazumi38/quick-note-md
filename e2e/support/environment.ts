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
	return seedIssueFixtures(environment, Array.from({ length: count }, (_, index) => ({
		title: `Seed issue ${String(index + 1).padStart(2, '0')}`,
		body: `Description for seed ${String(index + 1).padStart(2, '0')}.`,
		state: (index + 1) % 2 === 0 ? 'closed' : 'open',
		labels: ['seed'],
		createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
	})));
}

export interface IssueFixture {
	title: string;
	body: string;
	state?: 'open' | 'closed';
	labels?: string[];
	createdAt?: string;
}

export async function seedIssueFixtures(environment: ScenarioEnvironment, fixtures: IssueFixture[]): Promise<string> {
	const directory = join(environment.workspacePath, '.quick-note-md', 'issues');
	await mkdir(directory, { recursive: true });
	for (const [index, fixture] of fixtures.entries()) {
		const id = index + 1;
		const timestamp = fixture.createdAt ?? new Date(Date.UTC(2026, 0, id)).toISOString();
		const source = [
			`<!-- quick-note-md:issue:v1 ${JSON.stringify({
				id,
				title: fixture.title,
				state: fixture.state ?? (id % 2 === 0 ? 'closed' : 'open'),
				labels: fixture.labels ?? [],
				createdAt: timestamp,
				updatedAt: timestamp,
			})} -->`,
			'',
			fixture.body,
		].join('\n');
		await writeFile(join(directory, `issue-${String(id).padStart(6, '0')}.md`), source, 'utf8');
	}
	await writeFile(join(directory, '.sequence.md'), `<!-- quick-note-md:sequence:v1 ${JSON.stringify({ nextId: fixtures.length + 1 })} -->\n`, 'utf8');
	return directory;
}
