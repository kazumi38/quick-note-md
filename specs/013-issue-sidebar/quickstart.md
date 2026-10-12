# Quickstart: Issue サイドバー検証

## Prerequisites

- Node.jsとnpmが利用できる。
- VS Codeのテストランタイムがプロジェクト依存関係で利用可能。
- ワークスペースを開いた状態で拡張機能を起動できる。

## Build and test

リポジトリルートで実行:

```powershell
npm ci
npm run compile-tests
npm run compile
npm run lint
npm test
npm run test:e2e
```

変更したテストに応じ、最低限Issue Markdown parser/store/view単体テスト、移行テスト、IssueサイドバーE2Eを実行する。`npm ci`はlockfileに基づく依存復元であり、依存を変更する作業ではない。

## End-to-end scenarios

1. **初回移行**: 使い捨てワークスペースに旧`notes`内容（Markdown、手作業ファイル、サブフォルダー）とglobal storageの旧chat/sidebar draftsを準備する。拡張機能を起動し、確認を求めず旧領域だけが消え、Issue専用WebviewViewが表示されることを確認する。
2. **安全な衝突停止**: 旧保存先とIssue保存先のパスが交差するテスト設定を使う。移行が削除前に停止し、旧ファイルが残り、エラーが表示されることを確認する。
3. **一覧と詳細**: Issueを複数作成し、Open/Closed filter、title/body検索、検索条件維持、更新日時順、一覧から詳細への切替を確認する。VS Code Editor tabが新しく開かれないことを確認する。
4. **本文とコメントの分離**: Issue詳細で本文がタイトル・状態・ラベルと同じheader領域に表示され、コメントだけが下のtimelineに現れることを確認する。コメント数はコメントのみ数える。
5. **作成と状態変更**: 必須titleを検証し、Markdown本文を作成・再表示する。stateをOpen/Closedで切り替え、一覧と詳細に同じ状態が表示されることを確認する。
6. **Markdown編集**: Issue本文・コメントで見出し、リンク、リスト、code、日本語IME、選択範囲、Undo/Redoを試す。保存して再読込後に内容が維持され、安全でない外部リソースをロードしない。コメントmarkerは通常Markdown表示には現れず、サイドバーでは説明とコメントが分かれて表示されることを確認する。
7. **破損・競合・失敗**: 先頭metadata JSONを不正にし、Issueが破損状態として通知されて元Markdownが保持されることを確認する。次にcomment markerの終端を欠落させ、Issue全体を推測分割せず読み取り専用にすることを確認する。Issueを編集し、外部から対象ファイルを変更してから保存した場合は保存が止まり、draftを保持して再読込/退避の手段とエラーを表示する。
8. **移行再実行**: 完了後にIssueを作成して拡張を再起動する。旧migrationは繰り返し実行されず、IssueファイルとIssue draftsが保持される。

## Expected outcomes

- Issue一覧・作成・詳細・コメントはWebviewViewだけで完了し、Editor/WebviewPanelを開かない。
- Issue本文、コメント、title/state/labelsなどは各Issue Markdown単体から復元できる。`.meta` sidecarは作成しない。旧Todo/メモ/チャットデータは読込・変換されない。
- 旧データの全削除、パス衝突、ファイル競合、保存失敗はそれぞれ明示的に検証でき、失敗時にIssueデータを破壊しない。
- 詳細画面はIssue本文をheaderに一度だけ表示し、コメントは独立タイムラインに表示する。

## Execution record

Validation performed on Windows:

- `npm.cmd test`: 33 passing; compile-tests, Webpack development build, and ESLint passed. VS Code test host: 1.141.0.
- `npm.cmd run test:e2e`: 3 passing on VS Code 1.138.0. Covered sidebar creation/Markdown preview, comment, state and label add/remove, keyboard activation, 20-Issue search, filter restoration, title/body/comment editing and cancellation, conflict draft retention/reload/discard, and unchanged editor-tab count.
- `npm.cmd run package`: production Webpack build passed. Webpack reported its standard size warning for the 354 KiB ProseMirror composer bundle.

The automated 20-Issue test confirms the search flow but its runtime is not treated as a user's discovery-time measurement. The user confirmed the manual checks are OK: Issue discovery within 30 seconds, keyboard-only operation, narrow sidebar/theme combinations, Japanese IME, and the destructive-migration walkthrough.
