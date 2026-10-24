# Implementation Plan: Issue 一覧のラベル絞り込み

**Branch**: `014-label-filter` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/014-label-filter/spec.md`

## Summary

Issue 一覧に単一ラベルの絞り込み条件を追加し、既存の検索語・Open／Closed 条件と AND で組み合わせる。候補は検索条件に左右されず有効な Issue 全体から得て、条件変更や詳細との往復で保持する。ユーザーストーリー単位でコアの絞り込み、条件の合成、一覧往復の順に実装・検証する。データ形式や Issue 保存内容は変更しない。

## Technical Context

**Language/Version**: TypeScript 6.0.3  
**Primary Dependencies**: VS Code Extension API、既存のWebview UI、Node.js標準ライブラリ（新規依存なし）  
**Storage**: ワークスペース内の既存 Issue Markdown。絞り込み状態は現在の IssueView セッション内だけで保持し永続化しない  
**Testing**: `npm test`（VS Code内ユニットテスト）、`npm run test:e2e`（Playwright / VS Code）  
**Target Platform**: VS Code 1.138.0以降、Windows・macOS・Linux  
**Project Type**: VS Code デスクトップ拡張機能  
**Performance Goals**: 現行一覧と同様に即時利用できること。ラベル候補取得で一覧を絞った際に候補が消えないこと  
**Constraints**: 大文字小文字を区別し、保存済みラベルの前後空白を除いた既存ルールに従う。ラベル候補は有効 Issue の全件を対象にし、一覧閲覧では Issue ファイルを書き換えない  
**Scale/Scope**: 既存 Issue 一覧の検索・状態フィルターへ単一ラベル条件を追加。複数選択、候補永続化、ラベル編集は対象外

## Constitution Check

| 原則 | Gate | 適合性 |
|---|---|---|
| I. Markdown First とデータ所有権 | PASS | Issue の Markdown 保存形式を変更せず、絞り込み条件も保存データに追加しない。 |
| II. VS Code Native Experience とアクセシビリティ | PASS | 既存サイドバー UI に絞り込みを追加し、名前付き操作とキーボード操作を検証する。 |
| III. 単純さと高速な操作 | PASS | 単一選択と既存一覧条件の再利用に限定し、依存関係・設定・データモデルを増やさない。 |
| IV. データ安全性と明確な責務 | PASS | 読み取り専用の条件変更であり、Issue 保存経路へ更新を発生させない。Store／View／Webview の各責務で検証する。 |
| V. 仕様、検証、保守性の優先 | PASS | 要件・受入シナリオ・E2E手順を定義し、単体とE2Eでユーザーに見える挙動を確認する。 |

**Gate result**: すべてPASS。例外・複雑性追跡事項はない。

## Project Structure

### Documentation (this feature)

```text
specs/014-label-filter/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── label-filter-ui.md
```

### Source Code

```text
src/
├── issueStore.ts                 # Issue検索条件とラベル候補の取得
├── issueView.ts                  # 条件状態、メッセージ検証、Snapshot
├── webview/issue.ts              # 一覧のラベル絞り込みUI
└── test/
    ├── issueStore.test.ts        # 絞り込み・候補・表記規則
    └── issueView.test.ts         # メッセージ検証とSnapshot関連挙動
e2e/
└── issue-sidebar.spec.ts         # ユーザーストーリー単位のサイドバーE2E
```

**Structure Decision**: VS Code拡張の既存構造を維持する。ラベル条件は Store の Issue 検索、View の状態・protocol、Webview の選択操作へ通しで加える。既存 E2E spec を拡張し、保存形式や新しい永続層は導入しない。

## Story-oriented implementation and validation procedure

1. **P1 — ラベル絞り込み**: 有効 Issue 全体から重複のない候補を得る。1ラベル選択・解除、該当なし表示、表記規則を実装し、Store単体テストとE2Eで確認する。
2. **P2 — 条件の組み合わせ**: 検索語・状態・単一ラベルをAND適用し、他条件を保ったままラベルだけを解除できるようにする。組み合わせ・大文字小文字・ラベルなしのテストを実行する。
3. **P3 — 詳細との往復**: 選択した条件をViewの状態とSnapshotに保持し、詳細を開いて一覧へ戻っても復元する。E2Eで確認する。
4. 全ストーリーの後に `npm test`、`npm run test:e2e`、`npm run lint` を実行し、絞り込み前後の Markdown と更新日時に差がないことを確認する。

## Complexity Tracking

該当なし。
