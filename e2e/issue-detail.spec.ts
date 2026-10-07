import { test, expect } from './fixtures';
import { openIssueView } from './support/vscode-app';

test('creates a memo, edits its title, labels, and comments in the Issue detail', async ({ workbench }) => {
	const view = await openIssueView(workbench);
	const title = `Issue memo ${Date.now()}`;
	const renamedTitle = `${title} renamed`;
	const description = `Issue description ${Date.now()}`;
	const comment = `Issue comment ${Date.now()}`;

	await view.getByRole('button', { name: '新規メモ' }).click();
	const panel = view.getByRole('region', { name: 'メモを作成' });
	await panel.getByRole('textbox', { name: 'タイトル（必須）' }).fill(title);
	const descriptionEditor = panel.getByRole('textbox', { name: '説明（Markdown）' });
	await expect(panel.getByRole('toolbar', { name: '説明（Markdown） 書式設定' })).toBeVisible();
	await expect(panel.getByRole('button', { name: '太字' })).toBeVisible();
	await descriptionEditor.fill(description);
	await expect(descriptionEditor).toContainText(description);
	await panel.getByRole('button', { name: '作成', exact: true }).click();

	await expect(view.getByRole('heading', { name: title })).toBeVisible();
	await expect(view.locator('.issue-card[aria-label="説明"] .preview')).toContainText(description);
	await expect(view.getByRole('combobox', { name: 'Todo の状態' })).toHaveCount(0);

	await expect(view.getByRole('toolbar', { name: 'コメント（Markdown） 書式設定' })).toBeVisible();
	await view.getByRole('textbox', { name: 'コメント（Markdown）' }).fill(comment);
	await view.getByRole('button', { name: 'コメントを追加' }).click();
	await expect(view.locator('.issue-comment')).toContainText(comment);

	const commentMenu = view.getByRole('button', { name: 'コメントの操作' }).first();
	await commentMenu.focus();
	await commentMenu.press('Enter');
	const editCommentAction = view.getByRole('menuitem', { name: 'コメントを編集' });
	await editCommentAction.focus();
	await editCommentAction.press('Enter');
	const editedComment = `${comment} edited`;
	await view.getByRole('article', { name: 'コメントを編集中' })
		.getByRole('textbox', { name: 'コメント（Markdown）' }).fill(editedComment);
	await view.getByRole('button', { name: '保存' }).click();
	await expect(view.locator('.issue-comment')).toContainText(editedComment);

	const labelMenu = view.getByRole('button', { name: 'ラベルの操作' });
	await labelMenu.focus();
	await labelMenu.press('Enter');
	const addLabelAction = view.getByRole('menuitem', { name: 'ラベルを追加' });
	await addLabelAction.focus();
	await addLabelAction.press('Enter');
	await view.getByRole('textbox', { name: '新しいラベル名' }).fill('priority');
	const addLabel = view.getByRole('button', { name: '追加', exact: true });
	await addLabel.focus();
	await addLabel.press('Enter');
	await view.getByRole('button', { name: '適用' }).click();
	await expect(view.locator('.issue-label-row')).toContainText('priority');

	await view.getByRole('button', { name: 'タイトルの操作' }).click();
	await view.getByRole('menuitem', { name: 'タイトルを編集' }).click();
	await view.getByRole('textbox', { name: 'タイトルを編集' }).fill(renamedTitle);
	await view.getByRole('button', { name: '保存' }).click();
	await expect(view.getByRole('heading', { name: renamedTitle })).toBeVisible();
	await expect(view.locator('.issue-comment')).toContainText(comment);
});

test('creates a Todo with a side panel and keeps Memo status controls absent', async ({ workbench }) => {
	const view = await openIssueView(workbench);
	const title = `Issue Todo ${Date.now()}`;

	await view.getByRole('button', { name: '新規 Todo' }).click();
	const panel = view.getByRole('region', { name: 'Todoを作成' });
	await panel.getByRole('textbox', { name: 'タイトル（必須）' }).fill(title);
	await panel.getByRole('button', { name: '作成', exact: true }).click();

	await expect(view.getByRole('heading', { name: title })).toBeVisible();
	const status = view.getByRole('combobox', { name: 'Todo の状態' });
	await expect(status).toBeVisible();
	await expect(status).toHaveCSS('color', 'rgb(63, 185, 80)');
	await status.selectOption('done');
	await expect(status).toHaveValue('done');
	await expect(status).toHaveCSS('color', 'rgb(210, 168, 255)');
	await expect(view.getByRole('heading', { name: title })).toBeVisible();
});

test('selects newly created duplicate-title memos and keeps selection after renaming', async ({ workbench }) => {
	const view = await openIssueView(workbench);
	const title = `Duplicate memo ${Date.now()}`;

	for (const expectedTitle of [title, `${title}-2`]) {
		await view.getByRole('button', { name: '新規メモ' }).click();
		const panel = view.getByRole('region', { name: 'メモを作成' });
		await panel.getByRole('textbox', { name: 'タイトル（必須）' }).fill(title);
		await panel.getByRole('button', { name: '作成', exact: true }).click();
		await expect(view.getByRole('heading', { name: expectedTitle, exact: true })).toBeVisible();
	}

	const comment = `Selected duplicate ${Date.now()}`;
	await view.getByRole('textbox', { name: 'コメント（Markdown）' }).fill(comment);
	await view.getByRole('button', { name: 'コメントを追加' }).click();
	await expect(view.locator('.issue-comment')).toContainText(comment);
	await view.getByRole('button', { name: 'タイトルの操作' }).click();
	await view.getByRole('menuitem', { name: 'タイトルを編集' }).click();
	const renamedTitle = `${title}-2 renamed`;
	await view.getByRole('textbox', { name: 'タイトルを編集' }).fill(renamedTitle);
	await view.getByRole('button', { name: '保存' }).click();
	await expect(view.getByRole('heading', { name: renamedTitle, exact: true })).toBeVisible();
	await expect(view.locator('.issue-comment')).toContainText(comment);
});

test('applies checklist formatting to every selected paragraph', async ({ workbench }) => {
	const view = await openIssueView(workbench);
	const title = `Checklist memo ${Date.now()}`;

	await view.getByRole('button', { name: '新規メモ' }).click();
	const panel = view.getByRole('region', { name: 'メモを作成' });
	await panel.getByRole('textbox', { name: 'タイトル（必須）' }).fill(title);
	await panel.getByRole('button', { name: '作成', exact: true }).click();

	await view.getByRole('button', { name: '説明の操作' }).click();
	await view.getByRole('menuitem', { name: '説明を編集' }).click();
	const editor = view.getByRole('textbox', { name: '説明（Markdown）' });
	await editor.fill('first item\nsecond item\nthird item');
	await editor.press('Control+a');
	await view.getByRole('article', { name: '説明を編集中' }).getByRole('button', { name: 'チェックリスト' }).click();
	await expect(editor.locator('li[data-task-status="open"]')).toHaveCount(3);
	await view.getByRole('button', { name: '保存' }).click();
	const previewItems = view.locator('.issue-card[aria-label="説明"] .preview li');
	await expect(previewItems).toHaveCount(3);
	await expect(previewItems).toContainText(['[ ] first item', '[ ] second item', '[ ] third item']);
});

test('matches mock button, toolbar, timeline, and side-panel styling', async ({ application, workbench }, testInfo) => {
	await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 1100));
	const view = await openIssueView(workbench);
	await view.getByRole('button', { name: '新規メモ' }).click();
	const panel = view.getByRole('region', { name: 'メモを作成' });
	await panel.getByRole('textbox', { name: 'タイトル（必須）' }).fill('モックと同じ Issue UI');
	await panel.getByRole('textbox', { name: '説明（Markdown）' }).fill('説明とコメントを中心に、同じ編集面で Markdown を記入します。');
	await expect(panel.getByRole('button', { name: '作成', exact: true })).toHaveCSS('background-color', 'rgb(35, 134, 54)');
	await expect(panel).toHaveCSS('position', 'sticky');
	await expect(panel).toHaveCSS('box-shadow', 'none');
	const pageBounds = await view.locator('.issue-page').boundingBox();
	const panelBounds = await panel.boundingBox();
	expect(pageBounds).not.toBeNull();
	expect(panelBounds).not.toBeNull();
	if (!pageBounds || !panelBounds) { throw new Error('Detail page and side panel must both be visible.'); }
	expect(pageBounds.width).toBeGreaterThan(0);
	expect(panelBounds.width).toBeGreaterThanOrEqual(390);
	expect(Math.abs(pageBounds.x + pageBounds.width - panelBounds.x)).toBeLessThanOrEqual(1);
	const creationScreenshot = testInfo.outputPath('issue-create.png');
	await view.locator('.issue-workspace').screenshot({ path: creationScreenshot });
	await testInfo.attach('Issue creation layout', { path: creationScreenshot, contentType: 'image/png' });
	const fullCreationScreenshot = testInfo.outputPath('vscode-issue-create.png');
	await workbench.screenshot({ path: fullCreationScreenshot });
	await testInfo.attach('VS Code Issue creation', { path: fullCreationScreenshot, contentType: 'image/png' });
	await panel.getByRole('button', { name: '作成', exact: true }).click();

	await expect(view.getByRole('heading', { name: 'モックと同じ Issue UI' })).toBeVisible();
	await expect(view.locator('body')).toHaveCSS('background-color', 'rgb(13, 17, 23)');
	await expect(view.getByRole('button', { name: '新規メモ' })).toHaveCSS('border-radius', '6px');
	await expect(view.getByRole('button', { name: '新規メモ' })).toHaveCSS('background-color', 'rgb(33, 38, 45)');
	await expect(view.getByRole('button', { name: '太字' })).toHaveText('B');
	await expect(view.getByRole('button', { name: '太字' })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
	await expect(view.locator('.issue-timeline-item').first()).toHaveCSS('padding-left', '42px');
	await expect(view.locator('.issue-avatar').first()).toHaveCSS('width', '32px');
	await expect(view.locator('.issue-card > header').first()).toHaveCSS('background-color', 'rgb(22, 27, 34)');
	const commentEditor = view.getByRole('textbox', { name: 'コメント（Markdown）' });
	await commentEditor.fill('ボタン、カード、タイムラインの表示を確認しました。');
	await commentEditor.press('Control+a');
	await view.getByRole('button', { name: '太字' }).click();
	await expect(commentEditor.locator('strong')).toContainText('ボタン、カード、タイムライン');
	await view.getByRole('button', { name: '元に戻す' }).click();
	await expect(commentEditor.locator('strong')).toHaveCount(0);
	await view.getByRole('button', { name: 'やり直す' }).click();
	await expect(commentEditor.locator('strong')).toContainText('ボタン、カード、タイムライン');
	await view.getByRole('button', { name: 'コメントを追加' }).click();
	await expect(view.locator('.issue-comment')).toContainText('ボタン、カード、タイムライン');
	await expect(view.locator('.issue-comment .preview strong')).toContainText('ボタン、カード、タイムライン');
	const detailScreenshot = testInfo.outputPath('issue-detail.png');
	await view.locator('.issue-workspace').screenshot({ path: detailScreenshot });
	await testInfo.attach('Issue detail layout', { path: detailScreenshot, contentType: 'image/png' });
	const fullDetailScreenshot = testInfo.outputPath('vscode-issue-detail.png');
	await workbench.screenshot({ path: fullDetailScreenshot });
	await testInfo.attach('VS Code Issue detail', { path: fullDetailScreenshot, contentType: 'image/png' });

	await view.getByRole('button', { name: '新規メモ' }).click();
	await workbench.setViewportSize({ width: 1000, height: 850 });
	await expect(view.locator('.issue-page')).toBeHidden();
	await expect(panel).toBeVisible();
	await panel.getByRole('button', { name: '作成パネルを閉じる' }).click();
	await expect(view.locator('.issue-page')).toBeVisible();
});
