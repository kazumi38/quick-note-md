---

description: "Todo コメント機能の実装タスク"
---

# Tasks: Todo に課題と対応方針を残す

**Input**: Design documents from `/specs/003-todo-details/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: `spec.md` と `quickstart.md` がコア解析・保存テストと主要 UI/E2E シナリオを要求するため、対象ストーリーのテストタスクを含める。

**Implementation scope**: 既存の `src/*` 構成、VS Code API、TypeScript、Markdown ファイルを維持し、JSON ファイルや外部 DB は追加しない。

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 既存拡張の構成と検証コマンドを、コメント機能の実装対象として確定する。

- [ ] T001 [P] `specs/003-todo-details/plan.md` の構成に合わせて `src/core.ts`、`src/documents.ts`、`src/sidebar.ts`、`src/rendering.ts`、`src/editor.ts`、`src/extension.ts`、`src/test/` の責務と既存 API を確認する
- [ ] T002 [P] `package.json` の `compile`、`compile-tests`、`lint`、`test` スクリプトを実装・検証手順として確定し、追加依存を導入しないことを確認する
- [ ] T003 [P] `specs/003-todo-details/quickstart.md` の手動シナリオを実装後の受入チェック項目として整理する

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: すべてのコメント操作が共有する型、Markdown 境界、競合検証、安全な更新基盤を整える。

**⚠️ CRITICAL**: このフェーズ完了までユーザーストーリーの実装を開始しない。

- [ ] T004 `src/core.ts` に `TodoEntry`、`TodoComment`、`TodoCommentSet`、`DraftInput`、既存 6 状態の型と、`filePath + lineNumber + originalText` による Todo 識別・再検証ヘルパーを追加する
- [ ] T005 `src/core.ts` に `<!-- quick-note-md:comments -->`、`<!-- quick-note-md:comment -->`、`<!-- quick-note-md:end-comment -->`、`<!-- quick-note-md:end-comments -->` の確定境界を使う Markdown 解析・シリアライズを実装し、コメント内のチェックボックスを Todo として二重計上せず、マーカーの欠落・重複・順序違反や未知の記法を読み取り専用情報として返す
- [ ] T006 `src/documents.ts` に対象範囲だけを置換する差分更新、LF/CRLF・末尾改行の保持、管理対象パス検証、読み取り専用・削除・移動・保存失敗の明示的エラーを実装する
- [ ] T007 `src/documents.ts` に読み込み時バージョンまたは全文再検証による外部変更・競合検出を実装し、競合時に古い内容を上書きせず未保存入力を退避可能な状態で返す
- [ ] T008 [P] `src/test/core.test.ts` に Todo/comment 内部モデル、6 状態互換、コメント順、曖昧境界、チェックボックス二重計上防止の単体テストを追加する
- [ ] T009 [P] `src/test/documents.test.ts` に対象範囲限定更新、同名 Todo の行位置識別、改行保持、管理対象外パス、外部変更、読み取り専用、保存失敗のテストを追加する

**Checkpoint**: Markdown を壊さずに Todo とコメントを解析・再検証・安全更新できる基盤が完成していること。

---

## Phase 3: User Story 1 - Todo に課題と対応方針を残す (Priority: 未決定、暫定MVP)

**Goal**: Todo ごとに 0 件以上の独立した複数行 Markdown コメントを古い順に表示し、任意の状態を維持したまま追加・編集・削除できるようにする。

**Independent Test**: タイトルのみの既存 Todo、複数コメント、同名 Todo、完了/Skip/Warn/IMP を含む Todo を用意し、コメント追加・既存コメント編集・再起動後の再表示・削除確認・生 Markdown 切替を実行する。優先度、サイドパネル編集、ライブ編集がなくても、タイトル・状態・所属・順序・対象外本文が維持されることを確認する。

### Tests for User Story 1

- [ ] T010 [P] [US1] `src/test/core.test.ts` にタイトルのみ、複数コメントの古い順表示、見出し・段落・箇条書き・リンク、空コメント、コメント境界、未知記法の読み取り専用シナリオを追加する
- [ ] T011 [P] [US1] `src/test/documents.test.ts` に新規コメント末尾追加、既存コメント単独編集、他 Todo/タイトル/状態の不変性、同名 Todo の単独更新、任意状態の保持を検証するテストを追加する
- [ ] T012 [P] [US1] `src/test/sidebar.test.ts` にコメント件数・古い順表示、タイトルとの区別、認識不能 Todo の表示名、色に依存しない状態名の表示を検証するテストを追加する
- [ ] T013 [P] [US1] `src/test/extension.test.ts` にコメント追加・編集・削除確認・キャンセル・生 Markdown 表示のコマンド契約と失敗時通知を検証するテストを追加する

### Implementation for User Story 1

- [ ] T014 [US1] `src/documents.ts` に Todo コメントの Markdown 保存形式を実装し、既存本文・隣接 Todo・改行形式を変更せず、再起動時に Markdown からコメント集合を再構築する
- [ ] T015 [US1] `src/sidebar.ts` に Todo のコメント一覧/件数をタイトルと区別して表示し、古いコメントから新しいコメントの順、認識不能 Todo の読み取り専用表示、キーボード操作可能なラベルと状態名を追加する
- [ ] T016 [US1] `src/rendering.ts` と `src/editor.ts` にコメント一覧、複数行 Markdown の追加・既存コメント編集、保存状態表示、生 Markdown への切替を実装する。Markdown 内の外部スクリプト実行とリモート画像自動取得は行わない
- [ ] T017 [US1] `src/extension.ts` に `quick-note-md.addTodoComment` と `quick-note-md.editTodoComment` を登録し、Todo の状態を変更せずに対象コメントだけを再検証して保存する。競合・不在・読み取り専用・保存失敗時は未保存入力を保持し、再読込/再試行を案内する
- [ ] T018 [US1] `src/extension.ts` に `quick-note-md.deleteTodo` のコメント連動確認を実装し、承認時だけ対象 Todo と全コメントを削除し、キャンセル・曖昧な所属・競合時は何も変更しない
- [ ] T019 [US1] `package.json` にコメント追加・編集コマンド、Todo の全状態から利用できるメニュー、削除確認、生 Markdown 表示のコマンド/メニュー定義を追加し、キーボードのみで到達可能にする
- [ ] T020 [US1] `src/test/core.test.ts`、`src/test/documents.test.ts`、`src/test/sidebar.test.ts`、`src/test/extension.test.ts` と `specs/003-todo-details/quickstart.md` のシナリオを実行し、10件の混在 Todo で SC-301〜SC-304 の受入結果を記録する

**Checkpoint**: User Story 1 が単独で完成し、コメント追加・編集・削除確認・生 Markdown 切替と、既存 Todo/6 状態/データ安全性の回帰が検証できること。

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: 仕様・品質基準・既存機能との整合性を最終確認する。

- [ ] T021 [P] `src/test/core.test.ts` と `src/test/documents.test.ts` の境界ケースを補強し、空ファイル、末尾改行なし、日本語、LF/CRLF、外部削除/移動、曖昧なコメント所属で入力消失と対象外変更がないことを確認する
- [ ] T022 [P] `src/test/extension.test.ts` と `src/test/sidebar.test.ts` で既存メモ、タイトルのみ Todo、6状態、未解決件数、既存並び順、生 Markdown 切替の回帰を確認する
- [ ] T023 [P] `specs/003-todo-details/data-model.md`、`specs/003-todo-details/contracts/todo-comment-contract.md`、`specs/003-todo-details/contracts/markdown-storage-contract.md` に確定した Markdown 区切り（`quick-note-md:comments` / `comment` / `end-comment` / `end-comments`）と失敗時 UX を反映する
- [ ] T024 [P] `src/test/sidebar.test.ts` と `src/test/documents.test.ts` で100件程度の Markdown ファイル群を使い、Todo 一覧更新が200ms以内に開始される性能目標を確認する
- [ ] T025 [P] `src/test/core.test.ts`、`src/test/sidebar.test.ts`、`src/test/documents.test.ts` で担当者属性を生成・表示・保存せず、個人用 Todo のまま維持されることを検証する
- [ ] T026 `package.json` の `npm run lint`、`npm run compile`、`npm test` を実行し、TypeScript 型検査・Lint・拡張ホストテストを通過させる

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 依存なし。T001〜T003 は相互に独立して実行できる。
- **Foundational (Phase 2)**: Phase 1 完了後。T004〜T007 が T008〜T009 と全ストーリーをブロックする。
- **User Story 1 (Phase 3)**: Phase 2 完了後。テスト T010〜T013 を先に作成し、T014〜T019 を実装し、T020 で独立検証する。
- **Polish (Phase 4)**: User Story 1 完了後。T021〜T026 は最終的な回帰・性能・文書・品質確認。

### User Story Dependencies

- **User Story 1 (優先度未決定、暫定MVP)**: Foundational 完了後に開始でき、他の 004〜006 の提供には依存しない。004〜006との比較で全体優先度が確定するまでは、独立して価値を届けられる最小提供範囲としてMVP扱いする。004 の優先度/ラベルが後から追加されても、コメント保存がそれらを失わないことだけを確認する。

### Within User Story 1

- T010〜T013 のテストは異なる責務のため並列実行可能だが、実装前に失敗することを確認する。
- T014 は T004〜T007 に依存し、T015〜T018 は共有モデル/保存基盤後に実装する。
- T019 は T017〜T018 のコマンド ID と UI 条件に依存する。
- T020 は T014〜T019 完了後に実行する。

### Parallel Opportunities

- **Setup**: T001、T002、T003。
- **Foundational**: T008 と T009（T004〜T007 の対象 API が確定した後）。
- **US1 tests**: T010、T011、T012、T013。
- **US1 implementation**: T015（表示）と T016（編集 UI）は T014 の保存形式確定後に並列化可能。T017 と T018 は異なるコマンド責務として並列化可能。
- **Polish**: T021、T022、T023、T024、T025 は T026 の総合コマンド実行前に並列化可能。

## Parallel Example: User Story 1

```text
# 共有モデルと更新 API を定義した後に基盤テストを実行する
Task: "src/test/core.test.ts にコア解析・モデルのテストを追加する"
Task: "src/test/documents.test.ts に安全な文書更新のテストを追加する"

# ストーリーのテストは実装前に独立して作成できる
Task: "src/test/core.test.ts にコメント解析・表示順のテストを追加する"
Task: "src/test/documents.test.ts にコメント保存・対象分離のテストを追加する"
Task: "src/test/sidebar.test.ts にサイドバー表示・アクセシビリティのテストを追加する"
Task: "src/test/extension.test.ts にコマンド・確認ダイアログのテストを追加する"
```

## Implementation Strategy

### MVP First

1. 完了条件を T001〜T003 で確認する。
2. T004〜T009 で Markdown 解析、型、対象範囲更新、競合安全性を完成させる。
3. T010〜T020 で User Story 1 のコメント追加・編集・削除確認・表示・生 Markdown 切替を完成させる。
4. T020 と `specs/003-todo-details/quickstart.md` の全シナリオで MVP を検証する。
5. T024〜T026 で性能、個人用データ制約、Lint/compile/test を確認する。

### Incremental Delivery

1. 基盤（Phase 1〜2）を完成し、既存 Todo の解析・保存回帰を確認する。
2. コメントの追加・古い順表示を届け、タイトルのみ Todo と共存させる。
3. 既存コメント編集、任意状態での編集、同名 Todo 分離を届ける。
4. 削除確認、競合・曖昧境界の安全な失敗、生 Markdown 切替を届ける。
5. Phase 4 で回帰、文書、Lint/compile/test を完了する。

## Notes

- `[P]` は異なるファイルまたは独立責務で、未完了タスクへの依存がないタスクを示す。
- `[US1]` は `spec.md` の User Story 1 への追跡ラベルである。Setup、Foundational、Polish タスクには付けない。
- コメントの手動並び替え、担当者属性、優先度/ラベル、サイドパネル編集、ライブ編集はこの機能のタスクに含めない。
- すべての実装タスクは、既存 Markdown を正本とし、対象外本文を変更せず、失敗時に入力を黙って破棄しない原則を維持する。
