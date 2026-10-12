# Implementation Plan: Issue サイドバー

**Branch**: `kazumi38-issue-sidebar` | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/013-issue-sidebar/spec.md`

## Summary

旧Todo・メモ・チャットの機能を廃止し、Issue専用のファイルストアとVS Codeサイドバー表示を新設する。一覧、作成、詳細、Issue本文編集、コメント、状態、ラベルの操作はサイドバーから完了し、エディター領域には遷移しない。Issue本文は詳細ヘッダー領域、コメントはその下のタイムラインに表示する。既存のTodo/メモ/チャット用フォルダー内の全ファイルおよび旧チャット下書きを初回移行時に確認なしで削除するという、ユーザーが明示した移行方針を実装する。Issueは一つのMarkdownファイルで管理し、metadataとコメント境界は非表示HTML comment markerに保存する。

## Technical Context

| Context | Decision |
|---|---|
| Language/Version | TypeScript 6、Node.js拡張ホスト、Webview JavaScript/CSS（`package.json`, `tsconfig.json`） |
| Primary Dependencies | VS Code API `^1.138.0`、既存のProseMirror一式、`markdown-it`、Webpack。追加依存なし。 |
| Storage | ワークスペース内の`.quick-note-md/issues`にIssueごとの単一Markdownファイルを保存する。metadata・コメント境界は非表示marker、説明・コメント本文はMarkdown、採番はMarkdown台帳とし、DraftはVS Code global storage上の一時データとする。 |
| Testing | `src/test` のMocha/VS Codeテスト、`e2e` のPlaywright、`npm run lint`、`npm run compile-tests`、Webpackコンパイル、`npm test`。 |
| Target Platform | VS Code Desktop、Windows/macOS/Linux。VS CodeサイドバーのWebviewViewを使用し、外部サービス接続なしで動作する。 |
| Project Type | VS Codeデスクトップ拡張。ワークスペース内MarkdownストアとサイドバーWebviewを持つ。 |
| Performance Goals | 20件以上のIssueから、ユーザーが検索または状態フィルターで30秒以内に目的のIssueを見つけられる（SC-003）。 |
| Constraints | Issueビューはサイドバー内で完結し、WebviewPanelやMarkdownエディターをIssueの表示・編集先にしない。Issue保存先は旧保存先と分離し、旧Todo/メモ/チャット領域との重複を検出してから移行する。Issueは通常のMarkdownとして読めること。保存時に外部変更を検出したら上書きせず、draftを保持する。旧保存領域はユーザー決定に従い無確認で削除する。 |
| Scale/Scope | 1ワークスペースのローカルIssue、0件以上の順序付きコメントとラベル、Open/Closed状態。GitHub同期、複数ユーザー、旧データ変換、チャット・Todo・メモ機能は対象外。 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 計画前ゲート | 設計後ゲート |
|---|---|---|
| I. Markdown First とデータ所有権 | **PASS** — Issue本文とコメントはワークスペース内Markdownを正本とし、VS Code外でも読める形式とする。 | **PASS** — metadata、Issue本文、コメントを単一Markdownに保持し、構造markerは通常表示から隠す。採番情報は再生成可能なMarkdown台帳に置く。 |
| II. VS Code Native Experience とアクセシビリティ | **PASS** — 標準のActivity Bar/WebviewViewを利用し、Issue詳細をエディターに開かない。 | **PASS** — 状態、操作名、キーボード利用、狭いサイドバーでの配置をUI契約に定義する。 |
| III. 単純さと高速な操作 | **PASS** — ローカルIssueの要件に限定し、外部サービスと新規依存を追加しない。 | **PASS** — Issue専用の小さな保存・表示モジュールを設け、旧Todo/メモ/チャットモデルを再利用しない。汎用Markdown編集・安全表示部品は既存のものを再利用する。 |
| IV. データ安全性と明確な責務 | **EXCEPTION APPROVED** — 旧Todo/メモ/チャット保存領域および旧チャットdraftは初回移行時に確認なしで削除する。ユーザーは利用者がまだいないとして明示的に承認した。Issueストアとのパス重複を拒否し、削除範囲・失敗通知・再実行安全性を契約化する。 | **PASS WITH APPROVED EXCEPTION** — 移行削除は一回限りの独立処理として隔離し、Issueストアとの重複を防ぐ。Issue編集は対象ファイル単位で外部変更を検出し、安全に失敗する。 |
| V. 仕様、検証、保守性の優先 | **PASS** — ユーザーが確認した画面配置と削除範囲を要件化し、残るファイル配置・形式をresearchで明示的に決定する。 | **PASS** — データ、Webviewメッセージ、移行、手動確認の契約と検証ガイドを定義する。 |

**Gate result**: ユーザーが明示承認した旧データ削除以外に憲章違反なし。削除操作は旧領域だけに限定し、Issue保存先と交差する構成では開始しない。

## Project Structure

### Documentation (this feature)

```text
specs/013-issue-sidebar/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── issue-sidebar-ui.md
│   ├── issue-markdown-storage.md
│   └── legacy-data-migration.md
├── checklists/
│   └── requirements.md
└── mock/
    └── index.html
```

### Source Code (repository root)

```text
src/
├── extension.ts                 # Issueビュー登録と旧機能登録の廃止
├── issueStore.ts                # Issue Markdownの一覧・作成・更新・競合保護
├── issueView.ts                 # WebviewView、message検証、snapshot/draft調整
├── issueMetadata.ts             # metadata JSONのschema parse/serialize/validation
├── issueMarkdown.ts             # 単一Markdownとコメント境界のparse/serialize
├── legacyMigration.ts           # 旧保存領域だけの初回削除・パス検査
├── rendering.ts                 # 安全なMarkdown表示（既存の汎用機能を再利用）
├── issueDrafts.ts               # workspace単位のIssue draft保存
├── webview/
│   ├── issueComposer.ts         # 既存ProseMirror Markdown composer wrapperを再利用
│   ├── markdownComposer.ts      # 汎用ProseMirror編集エンジン
│   ├── markdownComposerModel.ts # 汎用Markdown schema
│   └── markdownComposerCommands.ts # 汎用Markdown編集コマンド
└── test/
    ├── issueMetadata.test.ts
    ├── issueMarkdown.test.ts
    ├── issueStore.test.ts
    ├── issueView.test.ts
    └── legacyMigration.test.ts
media/
├── issue.css                    # Issue専用・狭幅対応スタイル
├── issue.js                     # Issue一覧/詳細/作成Webview entry
└── issueComposer.js             # 既存ProseMirror composer bundle
e2e/
└── issue-sidebar.spec.ts        # VS Codeサイドバーの受け入れシナリオ
```

`media/issue.js`は`src/webview/issue.ts`からWebpackで生成する。生成済みbundleを手編集せず、旧chat entryを置き換える。

**Structure Decision**: IssueはActivity BarのQuickNoteMDコンテナ内にある専用WebviewViewとして実装し、現在のIssue風エディター領域WebviewPanel設計は採用しない。`issueStore.ts`と`issueMetadata.ts`をTodo/メモの`DocumentStore`や既存マーカーparserから独立させる。各Issueを一つのMarkdownファイルとし、metadata marker、説明本文、comment markerとコメント本文をシリアライズする。共通のProseMirror編集部品と`renderSafeMarkdown`は低レベルのMarkdown機能として再利用し、旧チャット形式・旧メモ/Todoデータモデル・旧コマンド/UIは登録しない。チャット下書き等の旧永続状態も移行処理の対象とする。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| 旧保存データを無確認で削除 | ユーザーが利用者不在を理由に、旧Todo/メモ用フォルダーとチャット履歴を含む旧保存データの削除を明示承認した。 | 確認ダイアログやバックアップはユーザーが不要と決定した。安全性は削除先の限定、Issue保存先との重複拒否、移行完了記録、エラー明示で担保する。 |
