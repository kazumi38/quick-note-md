# 調査結果: 空状態からのチャット作成

**対象**: [仕様](spec.md) の空状態から新規チャットを開始する操作
**調査日**: 2026-10-07

## 決定: 空状態の案内とビュータイトルから、同じ新規チャット command を呼ぶ

**決定**: `quick-note-md.newChat` を VS Code command として登録する。`package.json` のチャット `viewsWelcome` にこの command への明確な日本語リンクを表示し、`view/title` にも追加アイコン付きの同じ command を表示する。既存 Webview の「新しいチャット」ボタンも、同じ `ChatView` の draft 開始処理を呼び出す。

**根拠**:

- issue が報告する空状態案内は `package.json` の `viewsWelcome.contents` と一致するが、現在の案内は作成可能と説明するだけで、実行可能なリンクではない。
- `src/webview/chat.ts` の「新しいチャット」ボタンは Webview の画面が描画された後に使える。見えている VS Code 標準の welcome 状態から直接開始できる操作ではない。
- `src/chatView.ts` は `newChat` メッセージを受けると、本文セクションを対象とする新しい `ComposerDraft` を作り、snapshot で公開する。新しい command から同じ処理へ委譲すれば、既存の下書き・送信・復旧処理を維持できる。
- `package.json` には既に `view/title` refresh action があるため、同じビューの作成操作を追加するのは既存の VS Code UI 構成に沿う。
- Task 008 の調査・設計も、VS Code 標準のビュー welcome と既存 command を利用し、Webview 専用の作成ロジックを重複させない方針を採用している。

**検討した代替案**:

| 案 | 判断 |
|---|---|
| welcome 案内文だけを維持する | 却下。issue が報告した問題を解消せず、案内どおりの操作が見つからない。 |
| Webview 内ボタンだけに依存する | 却下。既存ボタンは有用だが、Webview が描画される前に表示される標準 welcome から操作できない。 |
| VS Code command の独自ハンドラーで draft を別実装する | 却下。作成処理が二重化し、入口によって挙動が分かれる。 |
| チャットファイルを開始時点で作成する | 却下。既存仕様では送信までファイルを作らず、空ファイルやキャンセル時の残骸を避ける。 |

## 決定: 開始操作では永続データを変更しない

**決定**: 新規チャット操作は既存の `ComposerDraft` を作成し、ユーザーが入力・送信する既存フローへ入る。Markdown ファイルは初回送信時に限り作成される。

**根拠**: `src/chatView.ts` の `newChat` 処理が既にこの状態遷移を実装し、`chatView.integration.test.ts` が入力不足・送信・ファイル作成・保存失敗を検証している。issue の修正は新しい到達経路を用意するもので、保存意味論を変更する必要はない。

**参考資料**:

- リポジトリ: `package.json` — 現在の `viewsWelcome` と `view/title` contribution
- リポジトリ: `src/webview/chat.ts` — 既存 Webview の新規チャットボタンと `newChat` メッセージ
- リポジトリ: `src/chatView.ts` — `newChat` メッセージから composer draft を生成
- リポジトリ: `src/test/chatView.integration.test.ts` — draft・保存・失敗処理の統合テスト
- リポジトリ: `specs/008-view-provider-empty-state/research.md` — 標準 welcome 操作と既存 command の再利用方針
