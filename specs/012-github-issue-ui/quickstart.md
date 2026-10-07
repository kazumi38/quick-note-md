# Quickstart: GitHub Issue風UI

## Prerequisites

- Windows/macOS/Linux上のVS Code Desktop
- Node.js/npmのバージョンはリポジトリ設定に従う
- リポジトリの依存が利用可能であること。未導入ならリポジトリ標準の `npm ci` を実行する
- VS Code Extension Development Hostで開くワークスペースと管理対象Markdownフォルダー

## Automated validation

リポジトリrootから実行する:

```sh
npm run compile
npm run lint
npm test
npm run test:e2e
```

期待結果:

- WebpackがExtensionとWebview資産をコンパイルする。
- ESLintとTypeScript/VS Codeテストが成功する。
- Playwright E2EでMemo/Todoのサイドパネル作成、説明・コメントのMarkdown入力、タイトル・ラベル・Todo状態の編集を検証する。既存チャットの保存失敗・競合シナリオも引き続き検証する。
- Markdown parser/store testsで既存Todo形式、Memoのfooter extension、改行、部分更新と壊れたmarkerの保護を検証する。
- `e2e/issue-detail.spec.ts` ではモックの配色・角丸・書式ボタン・タイムラインの寸法と、作成パネルが詳細を覆わず横に並ぶことを検証する。`issue-create.png` と `issue-detail.png` をテスト結果へ保存し、実装画面を目視比較できる。狭い画面への切替と、太字・Undo/Redo・保存後の書式も確認する。

## Manual acceptance walkthrough

1. Extension Development Hostでワークスペースを開き、コマンドパレットから「QuickNoteMD: メモと Todo を開く」を実行する。Issue詳細がエディター領域の十分な幅で開き、既存Chat viewも引き続き利用可能であることを確認する。
2. 作成を開始し、ポップアップではなく同じビュー内の横サイドパネルが開くことを確認する。MemoとTodoをそれぞれ選び、タイトルと複数行説明を作成して保存する。キャンセルと不正タイトルでもファイルが作成されず入力が失われないことを確認する。
3. 説明とコメントの入力／編集をそれぞれ行い、見出し、太字、斜体、引用、コード、リンク、箇条書き、番号付きリスト、チェックリストを使う。文字入力中に同じ編集面が更新され、選択範囲、IME、日本語入力、Undo/Redoが保たれることを確認する。
4. TodoとMemoの詳細でラベルを追加、名前変更、取り外し、適用、キャンセルする。空白のみと重複表記は拒否されることを確認する。Todoではstatusの横にlabelsが表示され、status変更を維持する。Memoにstatusが表示されないことを確認する。
5. タイトルメニューからMemo titleを変更し、filenameだけが変更され、descriptionとcommentsが維持されることを確認する。Todo titleを編集し、対象task rowだけが変わることを確認する。
6. 説明と各コメントの `…` から対象カード内編集を行う。保存後、再表示して変更が持続し、他カード・status・labels・comment順が変わらないことを確認する。
7. 対象Markdownを外部で編集またはreadonlyにし、古いWebviewから保存する。競合／保存失敗が明示され、古い内容で上書きされず、編集中draftが保持されることを確認する。
8. 保存されたMarkdownを拡張機能なしで開き、Memo本文・Todo行・metadata・コメントが読めることを確認する。既存文書の対象外行とEOLが変更されていないこともdiffで確認する。
9. ビューを狭くして作成・編集し、全幅panelへ適切に切り替わること、キーボードのみで主要操作を完了できること、状態や保存結果が色以外でも識別できることを確認する。

## Coverage map

- UI interaction and host/Webview payloads: [contracts/issue-detail-ui.md](contracts/issue-detail-ui.md)
- Canonical item, label, comment, and draft semantics: [data-model.md](data-model.md)
- Markdown extension blocks, safe updates, conflicts, and recovery: [contracts/markdown-storage-contract.md](contracts/markdown-storage-contract.md)
- User-visible requirements and measurable outcomes: [spec.md](spec.md)

## Relevant existing test areas

- `src/test/core.test.ts`, `src/test/documents.test.ts`: parsing, serialization, exact range updates, EOL, conflicts, and malformed Markdown.
- `src/test/sidebar.test.ts`: Todo/Webview presentation and user operations.
- `src/test/chatComposer.test.ts`: ProseMirror Markdown editing, history, toolbar command behavior, and serializer compatibility.
- `e2e/`: VS Code Extension Host and Playwright workflows; add feature 012 scenarios alongside the existing tests.
