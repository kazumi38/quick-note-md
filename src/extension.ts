import * as vscode from 'vscode';
import { IssueView } from './issueView';

export function activate(context: vscode.ExtensionContext): void {
	const issueView = new IssueView(context);
	const workspace = vscode.workspace.workspaceFolders?.[0];
	const watcher = workspace ? vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(workspace, '.quick-note-md/issues/*.md')
	) : undefined;
	context.subscriptions.push(
		issueView,
		vscode.window.registerWebviewViewProvider('quick-note-md.issues', issueView, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.commands.registerCommand('quick-note-md.newIssue', async () => {
			try {
				await vscode.commands.executeCommand('workbench.view.extension.quick-note-md');
				await vscode.commands.executeCommand('quick-note-md.issues.focus');
				await issueView.startCreate();
			} catch (error) {
				await vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Issueを作成できませんでした。');
			}
		}),
		vscode.commands.registerCommand('quick-note-md.refresh', () => issueView.refreshView()),
		vscode.workspace.onDidCreateFiles(() => { void issueView.refreshView(); }),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document.uri.path.includes('/.quick-note-md/issues/')) {
				void issueView.refreshView();
			}
		}),
		vscode.workspace.onDidDeleteFiles(() => { void issueView.refreshView(); }),
		vscode.workspace.onDidRenameFiles(() => { void issueView.refreshView(); }),
		...(watcher ? [
			watcher,
			watcher.onDidCreate(() => { void issueView.refreshView(); }),
			watcher.onDidChange(() => { void issueView.refreshView(); }),
			watcher.onDidDelete(() => { void issueView.refreshView(); }),
		] : []),
	);
}

export function deactivate(): void {}
