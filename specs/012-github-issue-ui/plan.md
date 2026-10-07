# Implementation Plan: GitHub Issue風UI

**Branch**: `kazumi38-github-issue-style-ui` | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/012-github-issue-ui/spec.md`

## Summary

メモとTodoを同じIssue風詳細画面で扱い、エディター領域の `WebviewPanel` に表示する。HTMLモックに合わせた十分な横幅を確保し、サイドパネルでの作成、本文・コメントのインライン編集、ラベル管理を提供する。Todoの既存状態は維持し、メモには状態を追加しない。表示層は既存の `SidebarView` の操作ロジックとWebview資産を拡張し、保存は既存の `DocumentStore` とMarkdown形式を正本として継続する。入力・編集には既存のProseMirrorと安全なWebviewメッセージ処理を再利用する。決定の根拠と代替案は [research.md](research.md) に記録する。

## Technical Context

| Context | Decision |
|---|---|
| Language/Version | TypeScript 6、Node.js拡張ホスト、Webview JavaScript/CSS |
| Primary Dependencies | VS Code API `^1.138.0`、既存のProseMirror一式、`markdown-it`、Webpack。依存追加なし。 |
| Storage | ワークスペースの管理対象ディレクトリにあるMarkdownファイル。Todo本文・状態・ラベル・コメントは既存のTodo行と `quick-note-md` コメントマーカーに保存する。メモは本文Markdownを維持し、ラベルとコメントは既存マーカー形式の末尾拡張ブロックに保存する。未確定入力は既存のDraftStore/extension global storageを使い、正本にはしない。 |
| Testing | `src/test` のMocha/VS Codeテスト、Playwright E2E、`npm run lint`、Webpack/TypeScriptコンパイル。 |
| Target Platform | VS Code Desktop、Windows/macOS/Linux。WebviewはローカルHTML/JS/CSSのみで構成する。 |
| Project Type | VS Codeデスクトップ拡張。既存Webview Sidebar、カスタムMarkdownエディター、ファイルストアの拡張。 |
| Performance Goals | FR-013/SC-004に従い、書式入力の95%以上を500ms以内に同じ編集面へ反映する。通常の項目選択・保存で目立つ応答遅延を生じさせない。 |
| Constraints | Markdownを拡張機能なしで読める正本とする。対象範囲外の文字列・改行・他項目を保持する。ファイルバージョンと更新前テキストを検証し、競合時に黙って上書きしない。外部スクリプトを実行せず、リモート画像を自動取得しない。メモに状態、通知、プロジェクト、担当者、GitHub同期を追加しない。 |
| Scale/Scope | 1ワークスペース内の既存メモとTodo、項目単位のラベル、複数の順序付きコメント。チャット機能、共有・同期、全項目一括ラベル管理は対象外。 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 計画前ゲート | 設計後ゲート |
|---|---|---|
| I. Markdown First とデータ所有権 | **PASS** — 既存Markdownを正本とし、独自DBや読めないメタデータを追加しない。 | **PASS** — 保存契約は既存のMarkdownメタデータ／コメントマーカーを再利用し、旧ファイルを一括変換しない。 |
| II. VS Code Native Experience とアクセシビリティ | **PASS** — 既存のVS Code Webviewとコマンドを使用する。 | **PASS** — 既存Webviewに機能ビューを追加し、意味名・キーボード操作・色に依存しない状態表示を契約化する。 |
| III. 単純さと高速な操作 | **PASS** — 既存依存とUI基盤を再利用し、通知・プロジェクト等を追加しない。 | **PASS** — 保存形式、コンポーザー、下書き機構を共有し、別バックエンドや外部依存を導入しない。 |
| IV. データ安全性と明確な責務 | **PASS** — Markdownの局所更新と競合保護を前提とする。 | **PASS** — View、Webviewメッセージ検証、DocumentStore、Markdown parser/serializerを分離し、曖昧な領域は安全に編集不可とする。 |
| V. 仕様、検証、保守性の優先 | **PASS** — Clarify済みの適用範囲を設計判断へ反映する。 | **PASS** — 保存・UI契約と自動／手動の検証手順を定義する。 |

**Gate result**: 既知の憲章違反なし。追加の複雑性は、Issue風の対話的な詳細・コメントUIと、入力中のMarkdown書式を保つ既存ProseMirrorを再利用するために必要な範囲に限定する。

## Project Structure

### Documentation (this feature)

```text
specs/012-github-issue-ui/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── issue-detail-ui.md
│   └── markdown-storage-contract.md
├── checklists/
│   └── requirements.md
└── mock/
    └── index.html
```

### Source Code (repository root)

```text
src/
├── extension.ts                 # コマンドとWebview providerの登録
├── sidebarView.ts               # メモ/Todo一覧・詳細のWebview連携
├── documents.ts                 # Markdown読み取りと対象範囲の安全な更新
├── core.ts                      # Todo/メタデータ/コメントのparse・serialize
├── drafts.ts                    # 未確定入力の永続化
├── draftManager.ts              # 下書きの照合・復旧
├── rendering.ts                 # 安全なMarkdownレンダリング
├── webview/
│   ├── chatComposer.ts          # ProseMirror編集基盤の再利用候補
│   └── chatComposerModel.ts     # Markdown schema/parser/serializer
└── test/                        # core, documents, sidebar, composer等のテスト
media/
├── sidebar.js                   # 機能WebviewのUI
└── sidebar.css                  # 機能Webviewのスタイル
e2e/
└── *.spec.ts                    # VS Code/Playwright統合シナリオ
```

**Structure Decision**: 外部フロントエンドやサービス層は追加しない。既存の `SidebarView` の操作ロジックを `openIssues` コマンドから開くエディター領域のWebviewPanelで使用し、既存のチャットビューは維持する。ビューのDOM・レスポンシブな作成サイドパネルは `media/sidebar.js` / `media/sidebar.css`、メッセージ検証とスナップショットは `src/sidebarView.ts`、Markdownのパースと局所更新は `src/core.ts` / `src/documents.ts` に置く。ProseMirrorの共通編集部品は `src/webview/chatComposer.ts` と既存ビルド構成に沿って再利用または抽出する。テストは既存の `src/test` と `e2e` に機能ごとに追加する。

## Complexity Tracking

憲章違反なし。新しい永続化レイヤー、依存関係、サービスプロセスは追加しない。
