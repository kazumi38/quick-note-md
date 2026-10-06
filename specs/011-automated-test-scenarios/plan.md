# Implementation Plan: テストシナリオ自動化

**Branch**: `kazumi38-playwright-e2e-testing` | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/011-automated-test-scenarios/spec.md`

## Summary

QuickNoteMD の実際の VS Code 拡張機能とチャット Webview を Playwright で操作し、画面と Markdown 保存結果を検証するローカル E2E テストを追加する。Windows 上での開発者ローカル実行に限定し、既存の Mocha/VS Code Extension Host テストは維持する。シナリオごとに一時ワークスペースと VS Code プロファイルを分離して再現性とデータ保護を確保する。

## Technical Context

**Language/Version**: TypeScript 6.x。Playwright runner uses the locally installed Node.js supported by repository dependencies; VS Code extension code runs in the VS Code Extension Host. The repository currently uses `@types/node` 24.x.

**Primary Dependencies**: `@playwright/test` を開発依存として追加し、既存の `@vscode/test-electron` (`^3.0.0`) を VS Code バイナリの取得に再利用する。VS Code 1.138.0 を固定し、VS Code の Electron アプリは Playwright Electron 経由で操作する。

**Storage**: テストごとに作成する一時ワークスペース内の Markdown 会話ファイルと、一時 VS Code user-data/extensions ディレクトリ。永続的な製品データモデルの変更はない。

**Testing**: 新設する独立した Playwright E2E テスト群。`npm run test:e2e` first compiles the extension and webview bundles, then runs the Playwright suite. Existing `npm test` / `vscode-test`, TypeScript compilation, Webpack, and ESLint remain unchanged.

**Target Platform**: Windows デスクトップ上の VS Code Extension Development Host。

**Project Type**: TypeScript 製 VS Code デスクトップ拡張機能。チャット UI は VS Code Webview View。

**Performance Goals**: 各シナリオを独立・再実行可能にし、主要シナリオ一式を同一初期状態で 10 回実行して毎回同じ判定結果にする。テスト実行時間の製品向け目標は設定しない。

**Constraints**: 実際の拡張機能と Webview を操作し、モック画面は使わない。初期提供は Windows ローカル実行のみで CI と macOS/Linux は対象外。ユーザーの既存 VS Code プロファイル、拡張、ワークスペース、ノートを使用または変更しない。失敗時はシナリオ名、期待値・実測値、および診断用成果物を特定可能にする。

**Scale/Scope**: チャットの新規作成・送信、保存済み会話への返信、保存失敗・競合時の下書き保護の 3 ジャーニー。メモ・Todo と他の UI 機能は含めない。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | Gate | 適合性 |
|---|---|---|
| I. Markdown First とデータ所有権 | Pass | テストでは製品と同じ Markdown 会話を確認し、製品の保存形式を変更しない。データはシナリオ専用の一時ワークスペースに隔離する。 |
| II. VS Code Native Experience とアクセシビリティ | Pass | 模擬画面ではなく実際の VS Code とチャット Webview を検証する。アクセシブルなロール・ラベルを優先した UI 操作を行う。 |
| III. 単純さと高速な操作 | Pass with documented tradeoff | Playwright をテスト時のみの開発依存として追加する。実画面のユーザー操作を自動確認するという明示要件を満たし、製品ランタイム依存にはしない。既存テスト基盤は置き換えない。 |
| IV. データ安全性と明確な責務 | Pass | VS Code の一時 profile、extension directory、workspace を各実行で分離し、終了時にテスト専用領域のみを削除する。 |
| V. 仕様、検証、保守性の優先 | Pass | 対象と実行 OS を仕様で限定し、既存の API/統合テストを保持したうえで E2E 検証を独立して追加する。 |

**Pre-Phase 0 Gate**: Pass. Windows-only は E2E 開発実行環境の初期スコープであり、拡張機能本体の Windows/macOS/Linux 対応を変更しない。Playwright と実 VS Code 操作に伴うテスト依存・保守コストは、ユーザー操作を実画面上で検証する必要性に対する限定的なトレードオフとして記録する。

## Project Structure

### Documentation (this feature)

```text
specs/011-automated-test-scenarios/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── e2e-runner.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── extension.ts
├── chatView.ts
├── documents.ts
└── test/                    # Existing Mocha / Extension Host tests; keep unchanged

media/
└── chat.js                   # Existing bundled Webview entry point

e2e/
├── playwright.config.ts      # Separate Playwright runner configuration
├── fixtures/                 # Minimal Markdown fixture data, if needed
└── chat.spec.ts              # Isolated end-to-end chat user journeys

package.json                  # Add dev dependency and opt-in test:e2e command
```

**Structure Decision**: Place Playwright configuration and scenarios in a root-level `e2e/` directory, separate from `src/test/` so the existing TypeScript Extension Host runner does not discover browser/Electron tests. Keep user-facing scenario-runner behavior in one contract and test-only workspace/profile lifecycle in test support code; do not change production extension modules unless E2E validation exposes a concrete behavior defect.

## Phase 0: Research

Research decisions and sources are recorded in [research.md](research.md). The recommended approach is the Playwright Electron API against the VS Code 1.138.0 executable, retrieved by the already-present `@vscode/test-electron`, with fresh temporary folders.

## Phase 1: Design & Contracts

- [Data model](data-model.md): transient scenario, isolated execution environment, and result/artifact lifecycles.
- [Runner contract](contracts/e2e-runner.md): local command, scope, isolation and reporting guarantees.
- [Quickstart](quickstart.md): Windows prerequisites, first run, targeted scenario run, and expected results.

## Constitution Check (post-design)

| 原則 | 結果 | 設計上の確認 |
|---|---|---|
| I. Markdown First とデータ所有権 | Pass | 既存の会話形式の一時 fixture を使い、保存内容を検証する。実ユーザーデータには触れない。 |
| II. VS Code Native Experience とアクセシビリティ | Pass | 実アプリのチャット view と Webview を対象にし、画面要素は可能な限り role/name で特定する。 |
| III. 単純さと高速な操作 | Pass with documented tradeoff | E2E 依存は dev-only。既存 Mocha suite から隔離し、Playwright と VS Code の既存テスト手段を重複採用しない。 |
| IV. データ安全性と明確な責務 | Pass | profile/workspace/extensions を分離し、ライフサイクル cleanup と保存結果確認を一体で設計する。 |
| V. 仕様、検証、保守性の優先 | Pass | 小規模なチャットシナリオに限定し、安定したアクセシブル locator と失敗診断を契約化する。 |

**Post-Phase 1 Gate**: Pass. No production data or runtime dependencies are added. The only added complexity is an opt-in, local test layer required to validate actual VS Code UI behavior.

## Complexity Tracking

| Added complexity | Why needed | Simpler alternative rejected because |
|---|---|---|
| `@playwright/test` development dependency and a separate `e2e/` runner | User-requested Playwright scenarios must interact with the actual VS Code extension UI and webview, not just API-level behavior. | Existing Mocha tests run in the Extension Host and cannot exercise rendered webview interactions; a browser mock would not validate the real extension UI. |
| Disposable VS Code profile and workspace per scenario | Prevent leakage from or mutation of a developer's active VS Code profile and notes; make scenarios repeatable. | Reusing the current profile/workspace violates the data-isolation requirement and makes results dependent on local state. |
