# Task 009 クイックスタート・検証手順

この資料は実装後の検証手順であり、現時点で本体機能が動作することを示すものではない。網羅的なケースは [受入テスト](acceptance-tests.md)、保存形式は [Markdown 契約](contracts/chat-markdown.md)、Webview 境界は [protocol](contracts/webview-protocol.md) を参照。

## 前提

- Node.js と npm が利用できること。
- VS Code Test が起動できる環境であること。
- Windows PowerShell では npm の実行ポリシーに応じ `npm.cmd` を使うこと。
- データ損失試験は実ノートで行わず、隔離した一時ワークスペースを使うこと。

## ビルドと自動テスト

リポジトリ root で依存を復元し、テストを実行する。

```powershell
npm.cmd ci
npm.cmd test
```

macOS / Linux では同じ script を `npm ci`、`npm test` で実行する。`npm test` の pretest は現行 package script に従い TypeScript test compile、Extension/Webview bundle、ESLint を実行してから VS Code test を起動する。

最低限、次を個別の unit / integration test で検証する。

```powershell
npm.cmd run compile-tests
npm.cmd run compile
npm.cmd run lint
```

期待結果: chat parser/serializer、コメント境界、本文見出し、タスク marker 対象更新、draft conflict が pass する。失敗時は修正を続け、成功に見せる fallback を追加しない。

## 手動シナリオ

1. `F5` で Extension Development Host を起動し、`notes` を持たない一時ワークスペースを開く。
2. QuickNoteMD の Chat view で「新しいチャット」を選び、タイトルと本文へ見出し・強調・リスト・チェック・INFO/WARN・コード・表を入力する。
3. 別プレビューを開かず、同じ composer で整形表示、キャレット、IME、Undo/Redo、Enter / Shift+Enter を確認する。送信前の `.md` ファイル数と内容が変わらないことを確認する。
4. 送信し、ファイルが1つだけ作成されること、一覧へ2秒以内に反映されること、marker コメントとタイトル・section・timestamp の Markdown 形式を確認する。
5. 本文に通常の `#`、`##`、`###` 見出しを含め、送信・閉じる・再表示する。すべて本文の見出しとして同じ意味を保ち、message boundary に変換されないことを確認する。
6. 返信を追加し、同時刻相当でもファイル順序と message ID が区別されることを確認する。
7. 入力欄の check を変更して下書きのみ更新されること、送信済みメッセージの check を変更して marker だけが変更されることを確認する。
8. 原文エディターを未保存のままにし、dirty 表示と send/toggle 停止を確認する。保存後に再試行する。
9. 外部変更・読み取り専用・保存失敗を隔離 workspace で試し、下書きが保持され、成功表示されず、再読み込み後に結果が再現することを確認する。
10. 幅280px、400px、800pxで長い日本語、長い URL、コード、表を確認する。パネル全体の横 overflow がなく、コード・表のスクロールはそれぞれの領域内に留まることを確認する。

## 受入の判定

- [受入テスト](acceptance-tests.md) の AT-01〜AT-26 を対象 OS と VS Code version とともに記録する。モックの pass は本体の受入に流用しない。
- SC-001 の100操作測定は1,000行・32,000文字以下で行い、各変更操作から画面反映までの実測値を記録する。95件以上が500ms以内であること。
- すべての保存失敗・競合ケースで、本文、他メッセージ、他のチェック、返信下書きが保持されること。
- スクリーンショットは `acceptance-tests.md` の実施記録へ場所・OS・幅を記録する。
