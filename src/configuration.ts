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
