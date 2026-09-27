# Implementation Plan: ビュー起動と空状態からの作成

**Branch**: `kazumi38-data-provider-setup` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-view-provider-empty-state/spec.md`

## Summary

ビュー表示時のプロバイダー未登録エラーを避けるため、拡張機能の起動時に3つのビュー ID と各 provider 登録が一致することを検証し、非同期のワークスペース読み込みより先に登録を完了させる。メモ・Todo の TreeView は正常な空状態で VS Code 標準の `viewsWelcome` から既存の作成コマンドを実行できるようにする。統合 WebviewView には同等の作成ボタンを追加する。読み込み中・空・ワークスペース未選択・読み込み失敗を別状態として扱い、障害を空データに見せない。メモと Todo の一覧取得は状態を独立して扱い、一方の取得失敗で他方の正常な一覧を消さない。既存の Markdown 保存形式、作成コマンド、DocumentStore を再利用し、新しい依存や永続データ形式は導入しない。

## Technical Context

**Language/Version**: TypeScript 6.0.3、Node.js 24.x 型定義

**Primary Dependencies**: VS Code Extension API 1.138 以上、webpack 5、markdown-it 14.3（既存依存のみ）

**Storage**: 既存のワークスペース内 `notesDirectory` にある Markdown。ビュー状態・空状態コンテキストは実行時のみで、追加の永続ストレージはない。

**Testing**: Mocha、`@vscode/test-electron`、TypeScript コンパイル、ESLint。package manifest と provider/view ID の整合を自動検証し、初回表示と失敗状態は拡張機能ホストおよび手動シナリオで確認する。

**Target Platform**: VS Code 1.138 以上の Windows、macOS、Linux

**Project Type**: VS Code デスクトップ拡張機能

**Performance Goals**: 既存の非同期一覧更新を維持し、provider 登録は同期的に完了して初回表示までに遅延・再試行を要求しない。数値性能目標は追加しない。

**Constraints**: provider/view ID の一致、Markdown First、読み込み失敗を空状態と混同しない、書き込みは既存コマンドと DocumentStore を通す、コマンドキャンセルでファイルを作らない、追加の依存・保存形式なし、キーボード操作と日本語 UI を維持。

**Scale/Scope**: 既存の3ビュー（統合 WebviewView、メモ TreeView、Todo TreeView）と初回起動・再読み込み・空一覧・ワークスペースなし・一覧エラーの UX。個人用ワークスペースと既存の Markdown 一覧規模を前提とし、新しい同期・共有・バックグラウンド処理は追加しない。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | 設計時の判定 | 根拠 |
|------|-------------|------|
| Markdown First とデータ所有権 | PASS | 作成は既存のメモ/Todo コマンドと Markdown 保存規則を使用し、空状態用の独自データを永続化しない。 |
| VS Code Native Experience とアクセシビリティ | PASS | TreeView には標準 `viewsWelcome` のコマンドリンク、統合ビューには意味のあるボタンとアクセシブルな名前を使う。 |
| 単純さと高速な操作 | PASS | 既存コマンドを再利用し、追加依存・新規保存形式・作成専用サービスを導入しない。 |
| データ安全性と責務分離 | PASS | 読み込み中・正常な空・ワークスペースなし・読み込み失敗を分け、作成結果は既存の guarded DocumentStore 経由で保存する。 |
| 仕様・検証・保守性 | PASS | manifest の view ID、activation event、登録処理、空状態リンクの対応を契約化してテストする。初回起動/再読み込みと失敗パスを検証する。 |

**Post-design re-check**: PASS。設計は既存 API と既存コマンドを再利用し、未登録エラーの表面化、誤った空状態表示、誤作成を回帰テストで検出可能にする。憲章違反を正当化する複雑性はない。

## Project Structure

### Documentation (this feature)

```text
specs/008-view-provider-empty-state/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── view-lifecycle-contract.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
package.json                 # contributed view IDs, activation events, viewsWelcome
src/
├── extension.ts             # provider registration order and existing create commands
├── sidebar.ts               # TreeDataProviders, empty/error messages, view state
├── sidebarView.ts           # unified WebviewView state and create action routing
├── test/
│   ├── extension.test.ts    # manifest, activation, command integration
│   └── sidebar.test.ts      # TreeDataProvider empty/populated behavior
media/
├── sidebar.js               # unified view loading, empty, error, and button rendering
└── sidebar.css              # accessible empty-state layout
```

**Structure Decision**: 現在の VS Code 拡張機能構造を保つ。`package.json` はビュー宣言と TreeView 向け welcome actions、`extension.ts` は provider と既存 create command の登録、`sidebar.ts` はツリー状態、`sidebarView.ts` は統合ビューのデータ状態・コマンド中継、`media/sidebar.js` は Webview の画面状態を担当する。モデル層や保存層は新設しない。

## Complexity Tracking

> Constitution Check に違反はないため、追加の複雑性はない。
