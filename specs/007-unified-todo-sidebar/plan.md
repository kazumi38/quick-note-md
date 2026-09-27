# Implementation Plan: Todo 中心の統合メモサイドバー

**Branch**: `007-unified-todo-sidebar` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-unified-todo-sidebar/spec.md`

## Summary

現在の Todo 行を維持したまま、その直後に人が読める本文・リプライ・属性メタデータを置く Markdown
拡張を導入する。`core.ts` の解析・直列化、`documents.ts` の対象範囲更新と競合保護、
`sidebar.ts` のデータ提供、`sidebarView.ts` の単一 WebviewView、`editor.ts` の draft と編集メッセージ、
`drafts.ts` の一時バックアップを段階的に実装する。ファイル一覧、Todo 一覧、詳細編集は同じ
Activity Bar サイドバー内で完結し、中央エディタを切り替えない。既存の DocumentStore、VS Code
WebviewView、markdown-it を再利用し、追加依存は導入しない。旧形式の拡張ブロック互換性は保証しない。

## Technical Context

**Language/Version**: TypeScript 6.0.3、Node.js 型定義 24.x

**Primary Dependencies**: VS Code API 1.138、markdown-it 14.3（HTML 無効）、webpack 5

**Storage**: 設定済みノート配下の UTF-8 Markdown。Todo 行に続く QuickNoteMD の HTML コメント境界と
人が読める Markdown 本文・リプライ、属性メタデータ。ワークスペース共有ラベル色は VS Code の
リソース設定に保存する。未保存 draft は拡張機能の `globalStorageUri` 配下に一時 JSON ファイルとして
保持し、保存完了または明示破棄時に削除する。

**Testing**: Mocha + `@vscode/test-electron` の統合テスト、TypeScript コンパイル、ESLint

**Target Platform**: VS Code 1.138 以上を実行する Windows、macOS、Linux

**Project Type**: VS Code デスクトップ拡張

**Performance Goals**: 入力中にプレビューを更新し、一覧・編集操作を実用上スムーズに保つ。固定の
文書サイズ、応答時間、統計的合格閾値は設けない。

**Constraints**: Markdown First、旧拡張ブロック形式の互換性・自動移行なし、対象 Todo 範囲のみの更新、明示保存、
自動競合統合なし、未知・破損ブロックは読み取り専用、外部スクリプト実行・リモート画像取得なし、
キーボード操作と日本語 IME を維持する。

**Scale/Scope**: 個人用ワークスペース。管理対象 Markdown を再帰走査する。共有、担当者、通知、
依存関係、手動並び替えは対象外。性能・規模の数値閾値は定義しない。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | 設計時の判定 | 根拠 |
|------|-------------|------|
| Markdown First とデータ所有権 | PASS | Todo 行を維持し、本文・リプライは通常 Markdown、機械向け境界は HTML コメントに限定する。別 DB・不可視の専用保存形式は使わない。 |
| VS Code Native Experience とアクセシビリティ | PASS | VS Code WebviewView、設定、コマンドを使う。キーボード操作、フォーカス移動、ラベル・説明・アクセシビリティ名を実装し、状態・期限・ラベル・保存状態を色だけに依存させない。 |
| 単純さと高速な操作 | PASS | 既存の DocumentStore と markdown-it を拡張し、外部 UI・編集依存を追加しない。ファイルごとの最小範囲編集を維持する。 |
| データ安全性と責務分離 | PASS | パーサー/直列化、DocumentStore、サイドバー、編集 UI を分離し、バージョン・範囲・ディスク一致を確認して保存する。競合の自動統合をせず、一時 draft は保存/破棄後に復旧可能な形で削除する。 |
| 仕様・検証・保守性 | PASS | 保存契約、データモデル、UI 契約、回帰・競合・破損ケースを文書化し、コアを VS Code API 非依存でテストする。 |

**Post-design re-check**: PASS。設計は上記ゲートを満たし、憲章違反を正当化する複雑性を導入しない。

## Project Structure

### Documentation (this feature)

```text
specs/007-unified-todo-sidebar/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   ├── markdown-storage-contract.md
│   └── sidebar-editing-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
```text
src/
├── configuration.ts          # managed-root and workspace label-color configuration
├── core.ts                   # Markdown Todo parser, model, validation, serialization
├── documents.ts              # serialized guarded file edits and conflict handling
├── sidebar.ts                # unified sidebar data and accessible Todo presentation
├── editor.ts                 # sidebar draft state and webview message validation
├── sidebarView.ts            # unified WebviewView registration, lifecycle, and message routing
├── drafts.ts                  # temporary draft backup files under extension globalStorageUri
├── rendering.ts              # safe Markdown rendering and editable-span validation
├── extension.ts              # VS Code command registration and feature orchestration
└── test/
    ├── core.test.ts
    ├── documents.test.ts
    ├── sidebar.test.ts
    ├── drafts.test.ts
    ├── rendering.test.ts
    └── extension.test.ts

media/
├── sidebar.js                # sidebar list, Todo details, editor, and accessible interactions
└── sidebar.css
```

**Structure Decision**: `quick-note-md` Activity Bar コンテナーに単一の `WebviewViewProvider` を登録し、
ファイル/メモ、状態別 Todo、展開可能な詳細、編集 UI を一つの Webview に描画する。`sidebar.ts` は
一覧データと状態集計、`sidebarView.ts` は WebviewView の登録・表示ライフサイクルとホスト側の
メッセージ連携、`editor.ts` は入力メッセージ検証と draft 状態、`drafts.ts` は拡張機能の
`globalStorageUri` への一時ファイル保存・復元・削除を担当する。`rendering.ts` は HTML 無効の安全な
Markdown 描画を担う。Webview が非表示または再生成された際も draft は一時ファイルから復元し、
同一セッションでは文書 version、再起動後は保存済みの Todo 元行と対象ブロックのテキストで対象を
再特定・再検証する。本文、リプライに加えてラベル・対応日も draft snapshot の編集対象に含める。
タスクの構造化表示と操作は意味的な HTML、明示的な
フォーカス状態、キーボード操作、スクリーンリーダー用ラベルで提供する。テストは責務ごとに
`src/test/` へ置く。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| なし | - | - |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
