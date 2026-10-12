import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { expect, test } from './fixtures';
import { seedIssues } from './support/environment';
import { openIssueView } from './support/vscode-app';

test('create, view, comment on, and close an Issue entirely inside the sidebar', async ({ issues, environment, workbench }) => {
	await expect(issues.getByRole('heading', { name: 'Issues' })).toBeVisible();
	const editorTabsBefore = await workbench.locator('.tabs-container .tab').count();
	await issues.getByRole('button', { name: '新規Issue' }).click();
	await issues.getByRole('textbox', { name: 'Issueタイトル' }).fill('Sidebar-only Issue');
	await issues.getByRole('textbox', { name: 'Issue本文（Markdown）' }).fill('説明は本文に一度だけ保存される。');
	await issues.getByRole('button', { name: 'プレビュー' }).click();
	await expect(issues.locator('.issue-markdown-preview')).toContainText('説明は本文に一度だけ保存される。');
	await issues.getByRole('button', { name: 'プレビュー' }).click();
	await issues.getByRole('button', { name: 'Issueを作成' }).click();
	await expect(issues.getByRole('heading', { name: 'Sidebar-only Issue' })).toBeVisible();
	await expect(issues.locator('.detail-head')).toContainText('説明は本文に一度だけ保存される。');
	await expect(issues.locator('.issue-timeline')).not.toContainText('説明は本文に一度だけ保存される。');

	await issues.getByRole('textbox', { name: '追加するラベル' }).fill('bug');
	await issues.locator('#label-form').getByRole('button', { name: '追加' }).click();
	await expect.poll(() => readFile(join(environment.workspacePath, '.quick-note-md', 'issues', 'issue-000001.md'), 'utf8')).toContain('bug');
	await expect(issues.locator('.issue-label-list')).toContainText('bug');

	const newComment = issues.getByRole('textbox', { name: 'コメントをMarkdownで入力' });
	await newComment.fill('Confirmed from the sidebar.');
	await expect(newComment).toContainText('Confirmed from the sidebar.');
	await issues.getByRole('button', { name: 'コメントする' }).click();
	await expect(issues.locator('.issue-comment')).toContainText('Confirmed from the sidebar.');

	await issues.getByRole('combobox', { name: 'Issue状態' }).selectOption('closed');
	await expect(issues.locator('.issue-context')).toContainText('Closed');
	await issues.getByRole('button', { name: 'bugラベルを削除' }).click();
	await expect(issues.locator('.issue-label-list')).not.toContainText('bug');

	const directory = join(environment.workspacePath, '.quick-note-md', 'issues');
	const files = await readdir(directory);
	expect(files.filter(file => /^issue-\d+\.md$/.test(file))).toHaveLength(1);
	expect(files.some(file => file.endsWith('.meta'))).toBe(false);
	const source = await readFile(join(directory, 'issue-000001.md'), 'utf8');
	expect(source).toContain('quick-note-md:issue:v1');
	expect(source).toContain('quick-note-md:comment:v1');
	expect(source).toContain('Confirmed from the sidebar.');
	expect(await workbench.locator('.tabs-container .tab').count()).toBe(editorTabsBefore);
});

test('finds one of twenty Issues with search and preserves the filter after returning from detail', async ({
	workbench, environment,
}) => {
	await seedIssues(environment, 20);
	const started = Date.now();
	const editorTabsBefore = await workbench.locator('.tabs-container .tab').count();
	const issues = await openIssueView(workbench);
	await expect(issues.locator('.issue-list-row')).toHaveCount(20);
	await issues.getByRole('searchbox', { name: 'Issueを検索' }).fill('Seed issue 18');
	await expect(issues.locator('.issue-list-row')).toHaveCount(1);
	await expect(issues.locator('.issue-list-row')).toContainText('Seed issue 18');
	const issueRow = issues.locator('.issue-list-row');
	await issueRow.focus();
	await issueRow.press('Enter');
	await expect(issues.getByRole('heading', { name: 'Seed issue 18' })).toBeVisible();
	await issues.getByRole('button', { name: '一覧へ戻る' }).click();
	await expect(issues.locator('.issue-list-row')).toHaveCount(1);
	expect(Date.now() - started).toBeLessThan(30_000);
	expect(await workbench.locator('.tabs-container .tab').count()).toBe(editorTabsBefore);
});

test('edits title, body, and comments in the sidebar and preserves a draft on conflict', async ({
	workbench, environment,
}) => {
	await seedIssues(environment, 1);
	const issues = await openIssueView(workbench);
	const issuePath = join(environment.workspacePath, '.quick-note-md', 'issues', 'issue-000001.md');
	const editorTabsBefore = await workbench.locator('.tabs-container .tab').count();
	await issues.locator('.issue-list-row').click();
	await expect(issues.getByRole('heading', { name: 'Seed issue 01' })).toBeVisible();

	await issues.getByRole('button', { name: 'タイトルを編集' }).click();
	await issues.getByRole('textbox', { name: 'Issueタイトルを編集' }).fill('Discarded title');
	await issues.getByRole('button', { name: 'キャンセル' }).click();
	await expect(issues.getByRole('heading', { name: 'Seed issue 01' })).toBeVisible();

	await issues.getByRole('button', { name: 'タイトルを編集' }).click();
	await issues.getByRole('textbox', { name: 'Issueタイトルを編集' }).fill('Updated title');
	await issues.getByRole('button', { name: '保存' }).click();
	await expect(issues.getByRole('heading', { name: 'Updated title' })).toBeVisible();

	await issues.locator('.detail-head').getByRole('button', { name: '編集' }).click();
	await issues.getByRole('textbox', { name: 'Issue本文を編集' }).fill('Updated description.');
	await issues.locator('[data-action="preview"][data-field="edit-body"]').click();
	await expect(issues.locator('[data-preview="edit-body"]')).toContainText('Updated description.');
	await issues.locator('[data-action="preview"][data-field="edit-body"]').click();
	await issues.getByRole('button', { name: '保存' }).click();
	await expect(issues.locator('.detail-head')).toContainText('Updated description.');
	await expect.poll(() => readFile(issuePath, 'utf8')).toContain('Updated description.');
	await issues.getByRole('button', { name: '再読み込み' }).click();
	await expect(issues.locator('.detail-head')).toContainText('Updated description.');

	await issues.getByRole('textbox', { name: 'コメントをMarkdownで入力' }).fill('Original comment.');
	await issues.getByRole('button', { name: 'コメントする' }).click();
	const comment = issues.locator('.issue-comment').first();
	await expect(comment).toContainText('Original comment.');
	await comment.getByRole('button', { name: '編集' }).click();
	await issues.getByRole('textbox', { name: 'コメントを編集' }).fill('Edited comment.');
	await comment.getByRole('button', { name: '保存' }).click();
	await expect(comment).toContainText('Edited comment.');
	await expect.poll(() => readFile(issuePath, 'utf8')).toContain('Edited comment.');

	const currentSource = await readFile(issuePath, 'utf8');
	expect(currentSource).toContain('Updated description.');
	expect(currentSource).toContain('Edited comment.');
	expect(currentSource).not.toContain('Original comment.');

	await issues.locator('.detail-head').getByRole('button', { name: '編集' }).click();
	const bodyEditor = issues.getByRole('textbox', { name: 'Issue本文を編集' });
	await bodyEditor.fill('Draft kept after conflict.');
	const externalSource = currentSource.replace('Updated description.', 'External update.');
	await writeFile(issuePath, externalSource, 'utf8');
	await issues.getByRole('button', { name: '保存' }).click();
	await expect(issues.getByText(/未保存の入力は保持されています/)).toBeVisible();
	await expect(bodyEditor).toContainText('Draft kept after conflict.');
	expect(await readFile(issuePath, 'utf8')).toBe(externalSource);
	await issues.getByRole('button', { name: '再読み込み' }).click();
	await expect(issues.getByText('保存開始後にIssueが変更されました。未保存の入力は保持されています。')).toBeVisible();
	await expect(bodyEditor).toContainText('Draft kept after conflict.');
	await issues.getByRole('button', { name: '下書きを破棄して最新を表示' }).click();
	await expect(issues.locator('.detail-head')).toContainText('External update.');
	await expect(issues.locator('.detail-head')).not.toContainText('Draft kept after conflict.');
	expect(await workbench.locator('.tabs-container .tab').count()).toBe(editorTabsBefore);
});
