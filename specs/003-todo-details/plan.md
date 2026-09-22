# Implementation Plan: Todo に課題と対応方針を残す

**Branch**: `003-todo-details` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-todo-details/spec.md`

## Summary

既存の Markdown ベース Todo を壊さず、各 Todo に複数行 Markdown のコメント群を持たせて背景・調査内容・対応方針を残せるようにする。保存形式は従来どおりの `.md` ファイルを維持し、コメント追加・修正・削除は対象 Todo とそのコメント群にのみ適用する。状態変更はコメント操作と切り離し、完了・Skip・Warn などの状態でもメモを残せる。

コメント群は対象 Todo の直後に、`<!-- quick-note-md:comments -->` と `<!-- quick-note-md:end-comments -->` で囲んで保存する。各コメントは `<!-- quick-note-md:comment -->` と `<!-- quick-note-md:end-comment -->` の間に通常の複数行 Markdown として置き、マーカーの欠落・重複・順序違反・対象 Todo から分離した記法は読み取り専用として扱う。

## Technical Context

**Language/Version**: TypeScript 6.x / Node.js runtime (VS Code Extension Host)

**Primary Dependencies**: VS Code Extension API, markdown-it

**Storage**: 既存のワークスペース内 Markdown ファイル（主に `notes/` 配下の `.md`）

**Testing**: Mocha + @vscode/test-electron + TypeScript test files (`src/test/*.test.ts`)

**Target Platform**: VS Code 1.138+ on Windows/macOS/Linux

**Project Type**: VS Code desktop extension

**Performance Goals**: Todo 一覧の更新が 200ms 以内に開始し、100 件程度のファイルでも追記・編集が体感的に遅延しない

**Constraints**: Markdown First, ファイル外の独自データ保存を避ける, 不要な対象行の改変禁止, 6 状態維持, 読み取り専用や競合時は安全に失敗

**Scale/Scope**: 個人利用、数十〜数百の Todo を含む Markdown ファイル群、同一ターゲットの重複タイトルは行位置で識別

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Markdown First とデータ所有権**: PASS（保存先は標準 `.md`、既存ファイルを拡張機能のみの DB に変えない）
- **II. VS Code Native Experience とアクセシビリティ**: PASS（TreeView / Command / Workspace API と通常エディタ連携を前提）
- **III. 単純さと高速な操作**: PASS（Todo 1件に対しコメント群を追加し、必要最小限の更新範囲で処理する）
- **IV. データ安全性と明確な責務**: PASS（対象 Todo とコメントだけを更新し、競合時は失敗してユーザーに再試行を案内する）
- **V. 仕様、検証、保守性の優先**: PASS（要件と境界条件を明文化し、コアロジックと UI の分離を維持する）

Phase 1 設計後の再確認: **PASS**（生成成果物に憲章違反はない）

## Project Structure

### Documentation (this feature)

```text
specs/003-todo-details/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   ├── todo-comment-contract.md
│   └── markdown-storage-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── core.ts             # Todo パース、ステータス定義、識別ロジック
├── documents.ts        # Markdown 読み込み・保存・安全な差分更新
├── sidebar.ts          # Todo / メモ一覧モデルと表示順
├── rendering.ts        # Markdown 表示と安全な直接編集
├── editor.ts           # custom editor / source 表示切替の制御
├── configuration.ts    # notesDirectory / defaultView 設定管理
├── extension.ts        # コマンド登録、イベント、競合ハンドリング
└── test/
    ├── core.test.ts
    ├── documents.test.ts
    ├── sidebar.test.ts
    └── extension.test.ts
```

**Structure Decision**: 既存の単一 VS Code 拡張構成 (`src/*` + `src/test/*`) を維持し、コメント解析・Markdown 保存・UI 表示の責務を既存モジュールに組み込む。外部 DB や別保存先は導入せず、Markdown を唯一の真実源とする。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| なし | - | - |

## 作業メモ

- 2026-09-22: 003-todo-details の設計と調査を実施し、Markdown ベースのコメント保持方式と安全な更新境界を確定した。
- 2026-09-22: 既存の 6 状態と Title-only Todo を維持しつつ、コメント編集は状態変更と切り離す設計とした。
- 2026-09-22: 競合・削除確認・曖昧なコメント境界の扱いを spec に合わせて明示し、データ安全性を優先した。
