# QuickNoteMD

QuickNoteMD は VS Code で Markdown チャットを扱い、メモと Todo を GitHub Issue 風の画面で管理する拡張機能です。
会話・メモ・Todo はワークスペース内の通常の `.md` ファイルとして保存されます。Issue 風 UI の操作は[画像付き手順書](specs/012-github-issue-ui/user-guide.md)を参照してください。

## 使い方

1. VS Code で作業フォルダーを開き、アクティビティバーの **QuickNoteMD** を選びます。
2. **チャット** ビューで **新しいチャット** を選び、タイトルと本文を入力します。
3. 入力欄内で見出し・強調・リスト・引用・コード・表を整形表示し、同じ場所で編集します。Enter は改行で、送信は明示的な **送信** 操作だけで行います。
4. 初回送信で `notes/` 配下にチャット Markdown が作成されます。チャットを選ぶと会話を読み、返信を入力して送信できます。
5. 保存済みメッセージにあるチェック項目は、チャット文書が未保存・競合・読み取り専用でない場合に切り替えられます。**原文を開く** から通常の Markdown エディターで確認できます。

`quick-note-md.notesDirectory` で保存先をワークスペース内の相対フォルダーに変更できます。絶対パス、保存先外への移動、シンボリックリンクを経由した更新は許可しません。

## データ保護

- 送信前の下書きはチャットファイルへ書き込まず、VS Code の global storage にバックアップします。
- 保存時は管理対象の範囲、未保存文書、外部変更、読み取り専用、対象メッセージを再確認します。競合や保存失敗時は下書きを残します。
- Markdown 由来の任意 HTML は実行せず、リンクは遷移不可、画像は外部取得しません。
- 新しいチャット形式は標準 HTML コメントでメッセージ範囲を識別します。本文中の `#`、`##`、`###` は通常の Markdown 見出しとして保持されます。
- 旧形式・破損形式など安全に識別できないファイルは自動変換せず、原文を確認できる状態にします。

## 開発と検証

```powershell
npm.cmd ci
npm.cmd run compile-tests
npm.cmd run compile
npm.cmd run lint
npm.cmd test
```

`npm test` は Extension Host 上でテストを実行し、その前に TypeScript、Extension/Webview bundle、ESLint を検証します。手動シナリオと受入記録は [Task 009 quickstart](specs/009-realtime-markdown-chat/quickstart.md) と [受入テスト](specs/009-realtime-markdown-chat/acceptance-tests.md) を参照してください。

### ローカル E2E テスト

Windows では Playwright で実際の VS Code 上のチャット Webview を操作できます。初回実行時は VS Code 1.138.0 をダウンロードするため、ネットワーク接続が必要です。

```powershell
npm.cmd run test:e2e
npm.cmd run test:e2e -- --grep "new chat"
```

各シナリオは一時ワークスペースと VS Code プロファイルを使用します。既存の `npm.cmd test` は従来どおり Extension Host テストのみを実行します。E2E の実行手順とトラブルシューティングは [E2E quickstart](specs/011-automated-test-scenarios/quickstart.md) を参照してください。
