# Implementation Plan: メモ & Todo 管理（サイドバー統合）

**Branch**: `001-memo-todo-management` | **Date**: 2026-09-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-memo-todo-management/spec.md`

## Summary

Primary Sidebar から Markdown ファイルを直接データソースとして扱い、メモ作成・追記・一覧表示と Todo の作成/完了/再開/削除/参照を、既存データを壊さずに高速に実行できる構成を実装する。ファイル操作は対象行のみを更新し、外部変更を監視してサイドバー表示を再同期する。

## Technical Context

**Language/Version**: TypeScript 6.x / Node.js runtime (VS Code Extension Host)

**Primary Dependencies**: VS Code Extension API, markdown-it

**Storage**: Workspace 内 `notes/`（設定変更可）配下の Markdown ファイル

**Testing**: Mocha + @vscode/test-electron + TypeScript test files (`src/test/*.test.ts`)

**Target Platform**: VS Code 1.138+ on Windows/macOS/Linux

**Project Type**: VS Code desktop extension

**Performance Goals**: 通常操作で UI 応答開始 300ms 未満（体感即時）

**Constraints**: Markdown First、標準 API 優先、対象外行を改変しない、同一ファイル更新の順序保証、読み取り専用/不在時は安全に失敗

**Scale/Scope**: 個人利用（数十ファイル、各数百〜数千行、連続追記 10 回で欠落なし）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Markdown First とデータ所有権**: PASS（保存先は標準 `.md`、拡張なしで可読）
- **II. VS Code Native Experience とアクセシビリティ**: PASS（TreeView/Command/Workspace API 前提）
- **III. 単純さと高速な操作**: PASS（既定保存先集約 + 最小操作）
- **IV. データ安全性と明確な責務**: PASS（対象行限定更新、失敗時中断、責務分離）
- **V. 仕様、検証、保守性の優先**: PASS（仕様→調査→設計→検証の順を維持）

Phase 1 設計後の再確認: **PASS**（生成成果物に憲章違反なし）

## Project Structure

### Documentation (this feature)

```text
specs/001-memo-todo-management/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── sidebar-commands.md
│   └── markdown-storage-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── extension.ts        # コマンド登録、監視、エラーハンドリング
├── sidebar.ts          # メモ/Todo の表示モデル
├── documents.ts        # Markdown 読み書きと安全更新
├── core.ts             # Todo 記法・識別・状態定義
├── configuration.ts    # notesDirectory / defaultView 設定
└── test/
   ├── extension.test.ts
   ├── documents.test.ts
   ├── sidebar.test.ts
   └── core.test.ts
```

**Structure Decision**: 既存の単一 VS Code 拡張構成（`src/*` + `src/test/*`）を維持し、ファイル操作・UI・設定・パースを分離したまま機能拡張する。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| なし | - | - |

## 作業メモ

- 2026-09-20: `npm ci` を実行し、既存依存関係をローカル検証用に導入した。
- 2026-09-20: `npm run lint` と `npm run compile` は成功した。
- 2026-09-20: `npm test` は `vscode-test` 実行時に `update.code.visualstudio.com` の名前解決ができず失敗した（`getaddrinfo ENOTFOUND`）。pretest の `compile-tests` / `compile` / `lint` までは成功している。
