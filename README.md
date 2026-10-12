# QuickNoteMD

QuickNoteMD は、VS Code の QuickNoteMD サイドバーだけで Issue の一覧、検索、作成、編集、コメントを行う拡張機能です。Issue の説明はヘッダー、コメントは時系列のタイムラインに分けて表示します。Issue のためにエディターや別ウィンドウを開きません。

## 使い方

1. VS Code でワークスペースフォルダーを開き、アクティビティバーの **QuickNoteMD** を選択します。
2. Issue 一覧から選ぶか、**新規Issue** でタイトルと Markdown 本文を入力して作成します。状態とラベルを編集し、説明・コメントもサイドバー内で更新できます。
3. 検索欄と状態フィルターで一覧を絞り込みます。Markdown の編集・プレビュー切り替えでは入力内容が維持されます。

## 保存形式

Issue はワークスペースの `.quick-note-md/issues/issue-000027.md` のような単一 Markdown ファイルに保存します。先頭の HTML comment marker にタイトル・状態・ラベル・日時を、本文に説明を、隠し marker で囲んだ領域にコメントを保存します。`.meta` sidecar やコメント別ファイルは作成しません。`.sequence.md` は削除後も番号を再利用しないための採番台帳です。

marker の欠落、破損、未知 version、外部変更、未保存エディターとの競合を検出した場合は推測修復や上書きをせず、Issue を読み取り専用にして原文・下書きを保持します。Markdown 表示では任意 HTML を実行せず、リンク遷移と外部画像取得も行いません。

## 初回の旧データ削除について

QuickNoteMD の Issue ビューを初めて開く際、旧機能からの移行として次の専用データを確認なしで削除します（旧 Todo・メモ・チャットとその履歴を削除することはユーザーが明示承認済みです）。

- 旧 `quick-note-md.notesDirectory` のフォルダー全体（既定値はワークスペース内の `notes/`。手作業で置かれたファイルも含む）
- extension global storage の `chat-drafts/` と `sidebar-drafts/`

Issue 保存先、Issue 下書き、global storage のその他のデータは削除しません。削除先が Issue 保存先と重複する場合、または symlink・I/O エラーを検出した場合は削除と Issue の読み書きを停止します。旧設定値は移行のために読み取りますが、以後の設定項目としては提供しません。

## 開発と検証

```powershell
npm.cmd ci
npm.cmd run compile-tests
npm.cmd run compile
npm.cmd run lint
npm.cmd test
```

`npm test` は VS Code Extension Host でユニット・統合テストを実行し、その前に TypeScript、Webpack、ESLint を検証します。Windows の Playwright E2E は一時ワークスペースと専用 VS Code プロファイルで実行します。

```powershell
npm.cmd run test:e2e
```
