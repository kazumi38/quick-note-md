# QuickNoteMD 利用手順書

この手順書は、Playwright E2E シナリオで取得した画面を使って、Issue の基本操作を説明します。

## 事前準備

1. VS Code でワークスペースフォルダーを開きます。
2. アクティビティバーの **QuickNoteMD** を選択します。

## Issue の一覧を表示する

Issue 一覧には、保存済みの Issue が表示されます。

![Issue 一覧](guide-assets/01-issue-list.png)

## Issue を作成する

1. **新規Issue** をクリックします。
2. タイトルと Markdown 本文を入力します。
3. **Issueを作成** をクリックします。

![Issue 作成](guide-assets/02-create-issue.png)

## Issue を編集する

詳細画面で **タイトルを編集** または本文の **編集** をクリックし、変更を **保存** します。

![Issue 編集](guide-assets/03-edit-issue.png)

## コメントを追加する

コメント欄に Markdown を入力し、**コメントする** をクリックします。

![コメント追加](guide-assets/04-add-comment.png)

## Issue を検索する

一覧画面の検索欄にタイトルや本文の一部を入力すると、該当する Issue に絞り込めます。

![Issue 検索](guide-assets/05-search-issue.png)

## Issue をクローズする

詳細画面の **Issue状態** で `Closed` を選択します。

![Issue クローズ](guide-assets/06-close-issue.png)

## 手順書用の画像を再生成する

E2E 実行環境を準備した Windows 環境で、次のコマンドを実行します。

```powershell
$env:QUICK_NOTE_GUIDE_DIR = "docs/guide-assets"
npm.cmd run test:e2e:guide
```

通常の E2E 実行では、画像は `test-results/e2e/guide-assets` に出力され、ドキュメント用ファイルは変更されません。
