# Implementation Plan: Todo 中心の統合メモサイドバー

**Branch**: `007-unified-todo-sidebar` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-unified-todo-sidebar/spec.md`

## Summary

既存 Todo 行を維持したまま、その直後に人が読める本文・リプライ・属性メタデータを置く Markdown
拡張を導入する。`core.ts` の純粋な解析・直列化ロジック、`documents.ts` の対象範囲更新と競合保護、
`sidebar.ts` の単一 TreeView、`editor.ts` の手動保存型ライブ編集を段階的に拡張する。既存の
DocumentStore、VS Code TreeView、CustomTextEditor、markdown-it を再利用し、追加依存や別の保存
ファイルは導入しない。

## Technical Context

**Language/Version**: TypeScript 6.0.3、Node.js 型定義 24.x

**Primary Dependencies**: VS Code API 1.138、markdown-it 14.3（HTML 無効）、webpack 5

**Storage**: 設定済みノート配下の UTF-8 Markdown。Todo 行に続く QuickNoteMD の HTML コメント境界と
人が読める Markdown 本文・リプライ、属性メタデータ。ワークスペース共有ラベル色は VS Code の
リソース設定に保存する。

**Testing**: Mocha + `@vscode/test-electron` の統合テスト、TypeScript コンパイル、ESLint

**Target Platform**: VS Code 1.138 以上を実行する Windows、macOS、Linux

**Project Type**: VS Code デスクトップ拡張

**Performance Goals**: 1,000 行以内の統合 Markdown 文書で、表示可能な Markdown 入力の 95% を
500 ミリ秒以内に同一編集面へ反映する。20 件以上の Todo 一覧の属性を色なしでも判別できる。

**Constraints**: Markdown First、既存形式の一括変換なし、対象 Todo 範囲のみの更新、明示保存、
自動競合統合なし、未知・破損ブロックは読み取り専用、外部スクリプト実行・リモート画像取得なし、
キーボード操作と日本語 IME を維持する。

**Scale/Scope**: 個人用ワークスペース。管理対象 Markdown を再帰走査し、1,000 行の文書と 20 件以上の
Todo を主要な検証規模とする。共有、担当者、通知、依存関係、手動並び替えは対象外。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | 設計時の判定 | 根拠 |
|------|-------------|------|
| Markdown First とデータ所有権 | PASS | Todo 行を維持し、本文・リプライは通常 Markdown、機械向け境界は HTML コメントに限定する。別 DB・不可視の専用保存形式は使わない。 |
| VS Code Native Experience とアクセシビリティ | PASS | VS Code TreeView、設定、コマンド、CustomTextEditor を使う。状態・期限・ラベル・保存状態は文字でも表現する。 |
| 単純さと高速な操作 | PASS | 既存の DocumentStore と markdown-it を拡張し、外部 UI・編集依存を追加しない。ファイルごとの最小範囲編集を維持する。 |
| データ安全性と責務分離 | PASS | パーサー/直列化、DocumentStore、サイドバー、編集 UI を分離し、バージョン・範囲・ディスク一致を確認して保存する。競合の自動統合をしない。 |
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
├── sidebar.ts                # unified tree data provider and accessible Todo presentation
├── editor.ts                 # custom editor/webview message validation and manual-save drafts
├── rendering.ts              # safe Markdown rendering and editable-span validation
├── extension.ts              # VS Code command registration and feature orchestration
└── test/
    ├── core.test.ts
    ├── documents.test.ts
    ├── sidebar.test.ts
    ├── rendering.test.ts
    └── extension.test.ts

media/
├── editor.js                 # webview draft, live rendering, save/conflict interactions
└── editor.css
```

**Structure Decision**: 単一の VS Code 拡張として既存の `src/` 構成を保持する。パースと直列化を
`core.ts`、ファイル更新を `documents.ts`、表示を `sidebar.ts`、Webview の入力処理を
`editor.ts`/`rendering.ts` に閉じ込める。テストは同じ責務ごとに `src/test/` へ置く。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| なし | - | - |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
