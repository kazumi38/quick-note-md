import * as vscode from 'vscode';

export function notesRoot(): vscode.Uri {
	const workspace = vscode.workspace.workspaceFolders?.[0];
	if (!workspace) {
		throw new Error('フォルダーを開いてからメモを作成してください。');
	}
	const directory = vscode.workspace.getConfiguration('quick-note-md', workspace.uri)
		.get<string>('notesDirectory', 'notes');
	return vscode.Uri.joinPath(workspace.uri, ...directorySegments(directory));
}

export function directorySegments(directory: string): string[] {
	const segments = directory.replace(/\\/g, '/').split('/');
	if (!directory.trim() || segments.some(part => part === '..' || part === '.' || !part)
		|| /[:\0]/.test(directory)) {
		throw new Error('ノート保存先には、ワークスペース内の相対フォルダー名を指定してください。');
	}
	return segments;
}

export function defaultView(): 'rendered' | 'source' {
	const workspace = vscode.workspace.workspaceFolders?.[0];
	return vscode.workspace.getConfiguration('quick-note-md', workspace?.uri)
		.get<string>('defaultView', 'rendered') === 'source' ? 'source' : 'rendered';
}

export function isManaged(uri: vscode.Uri): boolean {
	const root = notesRoot();
	return uri.scheme === root.scheme && uri.authority === root.authority
		&& uri.path.startsWith(`${root.path.replace(/\/$/, '')}/`) && /\.md$/i.test(uri.path);
}

// Fixed VS Code chart theme colors: stable across themes and distinguishable without relying on color alone,
// since every label also renders its name as text (FR-709).
export const labelPalette = ['charts.red', 'charts.orange', 'charts.yellow', 'charts.green', 'charts.blue', 'charts.purple'] as const;
export type LabelColor = typeof labelPalette[number];

function hashLabel(name: string): number {
	let hash = 0;
	for (let index = 0; index < name.length; index++) { hash = (hash * 31 + name.charCodeAt(index)) >>> 0; }
	return hash;
}

/** Same label name always resolves to the same shared color across every managed Markdown file. */
export function labelColor(name: string): LabelColor {
	const map = vscode.workspace.getConfiguration('quick-note-md').get<Record<string, string>>('labelColors', {});
	const existing = map[name];
	if (existing && (labelPalette as readonly string[]).includes(existing)) { return existing as LabelColor; }
	return labelPalette[hashLabel(name) % labelPalette.length];
}

export async function setLabelColor(name: string, color: LabelColor): Promise<void> {
	if (!(labelPalette as readonly string[]).includes(color)) { throw new Error('未対応の色です。'); }
	const config = vscode.workspace.getConfiguration('quick-note-md');
	const map = { ...config.get<Record<string, string>>('labelColors', {}) };
	map[name] = color;
	await config.update('labelColors', map, vscode.ConfigurationTarget.Workspace);
}
