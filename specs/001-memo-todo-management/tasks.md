# Tasks: メモ & Todo 管理（サイドバー統合）

**Input**: Design documents from `/specs/001-memo-todo-management/`

**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: 仕様の「User Scenarios & Testing」「品質基準」「quickstart.md の Test Commands」に基づき、各ユーザーストーリーで自動テストを実施する。

**Organization**: すべてのタスクをユーザーストーリー単位で独立実装・独立検証できるように整理する。

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 既存拡張のビルド・検証導線と仕様成果物の前提を揃える。

- [ ] T001 既存検証コマンド（`npm run lint && npm run compile && npm test`）の実行手順を `specs/001-memo-todo-management/quickstart.md` に沿って確認し、結果を `/home/runner/work/quick-note-md/quick-note-md/specs/001-memo-todo-management/plan.md` の作業メモ節に追記する
- [ ] T002 ノート管理対象パス契約（`quick-note-md.notesDirectory` 配下のみ）を反映するため `src/configuration.ts` の設定読み取り・正規化の責務を整理する
- [ ] T003 [P] Sidebar コマンド契約との差分確認観点（newMemo/appendMemo/newTodo/complete/reopen/delete/showSource）を `specs/001-memo-todo-management/contracts/sidebar-commands.md` に基づいて `src/extension.ts` へ対応表として追記する
- [ ] T004 [P] Markdown ストレージ契約（末尾追記・行単位更新・外部変更再同期）の確認観点を `specs/001-memo-todo-management/contracts/markdown-storage-contract.md` から抽出し `src/test/documents.test.ts` のテストケース一覧コメントへ反映する

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: すべてのユーザーストーリーで共有される安全更新・識別・監視基盤を完成させる。

**⚠️ CRITICAL**: このフェーズ完了前にユーザーストーリー実装へ進まない。

- [ ] T005 `src/documents.ts` の DocumentStore 更新経路を統一し、同一 URI 書き込み直列化・version/source 検証・WorkspaceEdit の対象範囲更新を共通経路に固定する
- [ ] T006 [P] `src/core.ts` の Todo 解析器に標準記法 `- [ ]` / `- [x]` / `- [X]` と unknown 判定を実装し、`src/test/core.test.ts` に対応ユニットテストを追加する
- [ ] T007 [P] `src/documents.ts` に Todo 一意識別（`file path + line position`）検証を実装し、同文複数 Todo の誤更新防止テストを `src/test/documents.test.ts` に追加する
- [ ] T008 `src/sidebar.ts` に未完了/完了の分離表示と未完了件数表示を実装し、表示更新テストを `src/test/sidebar.test.ts` に追加する
- [ ] T009 [P] `src/extension.ts` にファイル作成/変更/削除/リネーム監視イベントの**共通基盤再同期フロー**（イベント購読・再描画トリガ）を実装し、監視イベントで一覧が更新されるテストを `src/test/extension.test.ts` に追加する
- [ ] T010 `src/documents.ts` に読み取り専用・削除済み・移動済み検知時の**共通失敗経路**（書き込み中止・非破壊・基本エラー文言）を実装し、失敗時非破壊を `src/test/documents.test.ts` で検証する

**Checkpoint**: 安全な Markdown 更新、Todo 識別、一覧再同期、エラー処理の土台が揃い、各ストーリーを独立実装可能。

---

## Phase 3: User Story 1 - サイドバーからメモを素早く作成する (Priority: P1) 🎯 MVP

**Goal**: サイドバーからタイトル入力だけで安全な `.md` メモを作成し、一覧へ即時反映する。

**Independent Test**: 「新規メモ」実行→タイトル確定のみで `notes/` 配下に `.md` が作成され一覧表示される。

### Tests for User Story 1

- [ ] T011 [P] [US1] 新規メモ作成成功・空タイトル拒否・同名衝突時一意化を検証するテストを `src/test/extension.test.ts` に追加する
- [ ] T012 [P] [US1] `Memo` 制約「拡張子は `.md`（大文字小文字差異を許容）」「`path` は管理対象ディレクトリ配下のみ（親ディレクトリ遡り不可）」「同名衝突時は保存時に一意名へ解決（FR-004）」を検証するテストを `src/test/documents.test.ts` に追加する

### Implementation for User Story 1

- [ ] T013 [US1] タイトル入力バリデーションと safe file name 解決を `src/extension.ts` の `quick-note-md.newMemo` フローへ実装する
- [ ] T014 [US1] 衝突時連番付与を含むメモ作成処理を `src/documents.ts` の `createMemo` に実装する
- [ ] T015 [P] [US1] 新規メモ作成直後の一覧反映を `src/sidebar.ts` のメモ取得・再描画処理で実装する
- [ ] T016 [US1] 新規作成メモを標準/既定表示モードで開く動作を `src/extension.ts` の open 処理に統合する

**Checkpoint**: US1 単体で新規メモ作成と一覧反映を検証可能。

---

## Phase 4: User Story 2 - 既存メモへの追記 (Priority: P1)

**Goal**: 既存本文を破壊せずに末尾へ 1 行追記し、連続追記でも順序と内容を保証する。

**Independent Test**: メモ選択→追記入力のみで末尾に 1 行追加され、既存内容不変・順序維持を確認できる。

### Tests for User Story 2

- [ ] T017 [P] [US2] 改行あり/改行なし/空ファイルの追記結果を検証するテストを `src/test/documents.test.ts` に追加する
- [ ] T018 [P] [US2] 同一メモへの 10 回連続追記で欠落・重複・順序入替なしを検証するテストを `src/test/documents.test.ts` に追加する
- [ ] T019 [P] [US2] 追記コマンドが非管理対象・未選択時に安全に失敗することを検証するテストを `src/test/extension.test.ts` に追加する

### Implementation for User Story 2

- [ ] T020 [US2] 1 行入力（改行禁止）と対象メモ解決を `src/extension.ts` の `quick-note-md.appendMemo` へ実装する
- [ ] T021 [US2] 末尾追記の改行補正（末尾改行なし時は改行補完、空ファイルは先頭空行なし）を `src/core.ts` の追記ヘルパーへ実装する
- [ ] T022 [US2] 既存本文不変で末尾のみ更新する処理を `src/documents.ts` の `append` / `appendNow` に実装する
- [ ] T023 [US2] 追記後のサイドバー再同期（直接編集内容を次操作で最新扱い）を `src/sidebar.ts` と `src/extension.ts` の更新起点で統合する

**Checkpoint**: US2 単体で追記安全性と連続追記整合性を検証可能。

---

## Phase 5: User Story 3 - Todo の作成・完了・再開 (Priority: P1)

**Goal**: Todo を迅速に追加し、1 操作で完了/再開を切り替え、未完了件数を可視化する。

**Independent Test**: 新規 Todo 入力で作成後、一覧操作のみで完了/未完了を往復できる。

### Tests for User Story 3

- [ ] T024 [P] [US3] 新規 Todo 作成時の `- [ ]` 形式保存・未完了表示を検証するテストを `src/test/extension.test.ts` に追加する
- [ ] T025 [P] [US3] 状態変更がチェック記号のみ変更し本文不変であることを検証するテストを `src/test/documents.test.ts` に追加する
- [ ] T026 [P] [US3] 未完了件数表示と完了/未完了セクション遷移を検証するテストを `src/test/sidebar.test.ts` に追加する
- [ ] T027 [P] [US3] `TodoItem` 制約「標準認識対象: `- [ ]` / `- [x]`（`[X]` も完了として許容）」「非標準・壊れた行は `unknown` として読み取り専用（FR-025）」「一意性は `uri + line` で担保（FR-026）」を検証するテストを `src/test/core.test.ts` に追加する

### Implementation for User Story 3

- [ ] T028 [US3] 新規 Todo 入力と作成コマンドを `src/extension.ts` の `quick-note-md.newTodo` フローへ実装する
- [ ] T029 [US3] 既定 `notes/todo.md` 自動作成を含む Todo 追記を `src/documents.ts` の `createTodo` に実装する
- [ ] T030 [US3] 完了/再開コマンドの状態遷移（`open -> done`, `done -> open`）を `src/documents.ts` の `setStatus` と `src/extension.ts` へ実装する
- [ ] T031 [US3] Todo 一覧の未完了/完了表示と件数表示更新を `src/sidebar.ts` に実装する

**Checkpoint**: US3 単体で Todo 作成・完了・再開・件数表示を検証可能。

---

## Phase 6: User Story 4 - Todo の削除と参照元 Markdown を開く (Priority: P2)

**Goal**: 対象 Todo のみ安全に削除し、元ファイルの該当行へ移動できるようにする。

**Independent Test**: Todo 選択→削除で対象 1 行のみ消えること、および showSource で該当行へ移動することを確認できる。

### Tests for User Story 4

- [ ] T032 [P] [US4] 削除確認ダイアログ承認/キャンセル時の挙動と 1 行限定削除を検証するテストを `src/test/extension.test.ts` に追加する
- [ ] T033 [P] [US4] showSource 実行時に対象ファイル・対象行へ遷移するテストを `src/test/extension.test.ts` に追加する

### Implementation for User Story 4

- [ ] T034 [US4] 削除前確認と unknown Todo 拒否を `src/extension.ts` の `quick-note-md.deleteTodo` に実装する
- [ ] T035 [US4] 対象 1 行のみを除去する削除処理を `src/documents.ts` の `deleteTodo` に実装する
- [ ] T036 [US4] Todo 参照元を標準エディタで開いて該当行選択する処理を `src/extension.ts` の `quick-note-md.showSource` に実装する

**Checkpoint**: US4 単体で削除安全性とソース参照を検証可能。

---

## Phase 7: User Story 5 - 既存メモの一覧表示とエディタでの通常編集 (Priority: P2)

**Goal**: ノート配下の既存 `.md` を一覧表示し、標準エディタ編集結果を次操作へ正しく反映する。

**Independent Test**: メモ一覧から任意ファイルを開いて直接編集・保存後、次回表示/追記が最新内容を基準に動作する。

### Tests for User Story 5

- [ ] T037 [P] [US5] ノート配下の既存 `.md`（外部作成含む）が一覧表示されることを検証するテストを `src/test/sidebar.test.ts` に追加する
- [ ] T038 [P] [US5] 標準エディタでの直接編集保存後に次操作で最新内容を読むことを検証するテストを `src/test/documents.test.ts` に追加する

### Implementation for User Story 5

- [ ] T039 [US5] ノートディレクトリ再帰走査と `.md` 一覧化を `src/documents.ts` の `list` に実装する
- [ ] T040 [US5] メモ選択時に標準 VS Code テキストエディタを開く動作を `src/extension.ts` の `quick-note-md.openMemo` に実装する
- [ ] T041 [US5] T009 の共通基盤を利用し、US5 向けに**直接編集後の次回表示反映**（`src/sidebar.ts` の memo refresh と `src/extension.ts` のメモ表示導線連携）を実装する

**Checkpoint**: US5 単体で一覧表示と通常編集反映を検証可能。

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 全ストーリー横断の品質・安全性・運用性を仕上げる。

- [ ] T042 [P] 失敗時メッセージをユーザー向け表現へ統一し、部分更新なしを担保する実装を `src/extension.ts` と `src/documents.ts` で見直す
- [ ] T043 [P] T010 の共通失敗経路を前提に、`TodoSourceFile` 制約「新規 Todo 追加時に既定ファイルが無ければ自動作成（FR-027）」「削除・移動・権限不足を検知した場合は書き込みせず失敗を返す（FR-021）」の**Todo 固有ケース**を `src/test/documents.test.ts` で網羅する
- [ ] T044 [P] quickstart 検証シナリオに合わせて手動確認項目を更新し `specs/001-memo-todo-management/quickstart.md` を最終化する
- [ ] T045 `npm run lint && npm run compile && npm test` を実行し、結果を `specs/001-memo-todo-management/quickstart.md` の検証ログ節に反映する
- [ ] T046 README の利用説明を仕様 001 の確定挙動へ合わせて更新し `/home/runner/work/quick-note-md/quick-note-md/README.md` に反映する
- [ ] T047 [P] SC-005 検証として 1,000 行規模 Markdown fixture を用いた操作応答（メモを開く・追記する・Todo を完了する）の回帰テストを `src/test/documents.test.ts` と `src/test/extension.test.ts` に追加する
- [ ] T048 [P] FR-022/SC-006 検証として拡張無効状態でも Markdown が可読・編集可能である手動検証手順を `specs/001-memo-todo-management/quickstart.md` に追加し、README 参照を `/home/runner/work/quick-note-md/quick-note-md/README.md` に追記する

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 依存なし
- **Phase 2 (Foundational)**: Phase 1 完了後に着手（全 US のブロッカー）
- **Phase 3-7 (User Stories)**: Phase 2 完了後に着手可能
  - 優先順: US1 (P1) → US2 (P1) → US3 (P1) → US4 (P2) → US5 (P2)
  - 実装は優先順推奨だが、独立性を保つ範囲で並行実装可
- **Phase 8 (Polish)**: すべての対象 US 完了後

### User Story Dependencies

- **US1**: Foundational のみ依存
- **US2**: Foundational + US1 のメモ作成導線に依存
- **US3**: Foundational のみ依存
- **US4**: Foundational + US3 の Todo 一覧/識別に依存
- **US5**: Foundational + US1/US2 のメモ一覧・追記更新経路に依存

### Within Each User Story

- まずテスト追加（該当 story の失敗を確認）
- 次にコア実装（モデル/解析/サービス）
- 最後に統合（コマンド接続、UI 更新、エラーハンドリング）

---

## Parallel Opportunities

- **Setup**: T003, T004
- **Foundational**: T006, T007, T009
- **US1**: T011, T012, T015
- **US2**: T017, T018, T019
- **US3**: T024, T025, T026, T027
- **US4**: T032, T033
- **US5**: T037, T038
- **Polish**: T042, T043, T044, T047, T048

---

## Parallel Example: User Story 3

```bash
Task: "Add Todo creation behavior test in src/test/extension.test.ts"
Task: "Add checkbox-only mutation test in src/test/documents.test.ts"
Task: "Add Todo parse constraints test in src/test/core.test.ts"
Task: "Add Todo section/count rendering test in src/test/sidebar.test.ts"
```

---

## Implementation Strategy

### MVP First (US1)

1. Phase 1-2 を完了して安全更新基盤を固定
2. Phase 3 (US1) のみ実装
3. US1 の independent test を実施し MVP 判定

### Incremental Delivery

1. MVP (US1) 後に US2, US3 を順次追加
2. P2 の US4, US5 を追加
3. 最後に Phase 8 で横断品質を仕上げる

### Parallel Team Strategy

1. 1名が Foundational（T005-T010）を担当
2. 以降は US ごとに担当分離（例: A=US1/US2, B=US3/US4, C=US5）
3. 各 US 完了時点で lint/compile/test を通して統合

---

## Notes

- 全タスクは `- [ ] Txxx ...` 形式を厳守
- ユーザーストーリー phase の全タスクには `[USx]` を付与
- `[P]` は独立ファイルかつ未完了依存がないもののみ付与
- 各タスクは必ず対象ファイルパスを明記
