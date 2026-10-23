import { mkdir } from 'fs/promises';
import { join } from 'path';
import { expect, test } from './fixtures';

const guideDirectory = process.env.QUICK_NOTE_GUIDE_DIR ?? join(process.cwd(), 'test-results', 'e2e', 'guide-assets');

async function captureGuideStep(page: import('@playwright/test').Page, name: string): Promise<void> {
	await mkdir(guideDirectory, { recursive: true });
	await page.screenshot({ path: join(guideDirectory, `${name}.png`), fullPage: true });
}

test('@guide create, edit, search, comment on, and close an Issue', async ({ issues, workbench }) => {
	await expect(issues.getByRole('heading', { name: 'Issues' })).toBeVisible();
	await captureGuideStep(workbench, '01-issue-list');

	await issues.getByRole('button', { name: '新規Issue' }).click();
	await issues.getByRole('textbox', { name: 'Issueタイトル' }).fill('手順書サンプル');
	await issues.getByRole('textbox', { name: 'Issue本文（Markdown）' }).fill('アプリの操作手順をここに記録します。');
	await captureGuideStep(workbench, '02-create-issue');
	await issues.getByRole('button', { name: 'Issueを作成' }).click();
	await expect(issues.getByRole('heading', { name: '手順書サンプル' })).toBeVisible();

	await issues.getByRole('button', { name: 'タイトルを編集' }).click();
	await issues.getByRole('textbox', { name: 'Issueタイトルを編集' }).fill('更新した手順書サンプル');
	await issues.getByRole('button', { name: '保存' }).click();
	await expect(issues.getByRole('heading', { name: '更新した手順書サンプル' })).toBeVisible();
	await captureGuideStep(workbench, '03-edit-issue');

	await issues.getByRole('textbox', { name: 'コメントをMarkdownで入力' }).fill('手順を確認しました。');
	await issues.getByRole('button', { name: 'コメントする' }).click();
	await expect(issues.locator('.issue-comment')).toContainText('手順を確認しました。');
	await captureGuideStep(workbench, '04-add-comment');

	await issues.getByRole('button', { name: '一覧へ戻る' }).click();
	await issues.getByRole('searchbox', { name: 'Issueを検索' }).fill('更新した手順書');
	await expect(issues.locator('.issue-list-row')).toHaveCount(1);
	await captureGuideStep(workbench, '05-search-issue');

	await issues.locator('.issue-list-row').click();
	await issues.getByRole('combobox', { name: 'Issue状態' }).selectOption('closed');
	await expect(issues.locator('.issue-context')).toContainText('Closed');
	await captureGuideStep(workbench, '06-close-issue');
});
