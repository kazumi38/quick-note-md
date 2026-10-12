import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Issue sidebar extension contributions', () => {
	test('registers only the Issue view and Issue commands', async () => {
		const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'quick-note-md');
		assert.ok(extension);
		await extension.activate();
		const packageJson = extension.packageJSON;
		const views = packageJson.contributes.views['quick-note-md'].map((view: { id: string }) => view.id);
		assert.deepStrictEqual(views, ['quick-note-md.issues']);
		assert.strictEqual(packageJson.contributes.customEditors, undefined);
		const commands = packageJson.contributes.commands.map((command: { command: string }) => command.command);
		assert.deepStrictEqual(commands, ['quick-note-md.newIssue', 'quick-note-md.refresh']);
		assert.strictEqual(packageJson.contributes.configuration, undefined);
		const registered = await vscode.commands.getCommands(true);
		assert.ok(registered.includes('quick-note-md.newIssue'));
		assert.ok(registered.includes('quick-note-md.refresh'));
		for (const removed of [
			'quick-note-md.newMemo', 'quick-note-md.newTodo', 'quick-note-md.newChat',
			'quick-note-md.openIssues', 'quick-note-md.completeTodo', 'quick-note-md.toggleView',
		]) {
			assert.ok(!registered.includes(removed), `${removed} must be removed`);
		}
	});
});
