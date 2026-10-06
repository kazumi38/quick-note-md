# Tasks: 空状態からのチャット作成

**Input**: 設計資料 `/specs/010-empty-chat-creation/`

**Prerequisites**: `plan.md` と `spec.md`。実装判断は `research.md`、`data-model.md`、`contracts/new-chat-entry.md`、検証シナリオは `quickstart.md` を参照。

**Tests**: 仕様でユーザー可視の受け入れシナリオが定義され、計画でも自動回帰検証が必要なため、manifest 契約テストと ChatView draft 開始テストを含める。

**Organization**: P1 の User Story 1 を独立して実装・検証する。

## Phase 1: Setup

**Purpose**: 追加のプロジェクト初期化は不要。既存の VS Code 拡張機能、Webview、テスト構成を使用する。

## Phase 2: Foundational

**Purpose**: 共通基盤の変更は不要。すべての作業は既存のチャット view と command 登録上で実施する。

---

## Phase 3: User Story 1 - 空状態からチャットを開始する (Priority: P1) 🎯 MVP

**Goal**: チャットがまだないユーザーが、空状態から明確な操作を選んで既存の新規チャット composer を開始できる。

**Independent Test**: チャットのない状態で「新しいチャット」操作を選び、本文 draft が composer に表示されることを確認する。操作だけでは Markdown ファイルが作成されず、既存チャットがある状態では一覧表示が維持されることも確認する。

### Tests for User Story 1

- [X] T001 [P] [US1] 空状態の `viewsWelcome` が `quick-note-md.newChat` への明確なリンクを含み、チャット view のタイトルメニューが同じ command を提供することを `src/test/sidebar.test.ts` で検証する
- [X] T002 [P] [US1] `ChatView.startNewChat()` が `本文` 対象の空 draft snapshot を公開し、チャットファイルを開始時に作成しないことを `src/test/chatView.integration.test.ts` で検証する
- [X] T003 [P] [US1] `quick-note-md.newChat` が VS Code に登録されていることを `src/test/extension.test.ts` で検証する

### Implementation for User Story 1

- [X] T004 [US1] `package.json` に `quick-note-md.newChat` command、`viewsWelcome` の実行可能な「新しいチャット」リンク、およびチャット `view/title` の同 command を追加する
- [X] T005 [US1] 新規 draft 初期化と公開を `src/chatView.ts` の `startNewChat()` に集約し、Webview の既存 `newChat` メッセージもこの処理を呼ぶようにする
- [X] T006 [US1] `src/extension.ts` で `quick-note-md.newChat` を `chatView.startNewChat()` に接続し、エラー時は VS Code のエラー通知を表示して既存一覧更新 command の処理を誤って実行しないようにする

**Checkpoint**: 空状態リンク、ビュータイトル操作、既存 Webview ボタンのいずれからも同じ本文 composer draft が始まり、送信前のファイル未作成と既存一覧表示が保たれる。

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: P1 の実装と回帰検証を完了する。

- [X] T007 `specs/010-empty-chat-creation/quickstart.md` に記載した自動検証を実行し、結果を同ファイルへ記録する。VS Code GUI を用いる手動シナリオは、実装後の利用者確認用に記載したままとする
- [X] T008 `package.json`、`src/test/sidebar.test.ts`、`src/test/chatView.integration.test.ts`、`src/test/extension.test.ts` の変更に対して `npm test` を実行し、型チェック、bundle、lint、拡張機能テストが通ることを確認する

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 既存プロジェクトを使うため作業なし。
- **Foundational (Phase 2)**: 共通基盤変更がないため作業なし。
- **User Story 1 (Phase 3)**: 前提となる基盤タスクなしで開始可能。
- **Polish (Phase 4)**: User Story 1 の実装後に実行する。

### User Story Dependencies

- **User Story 1 (P1)**: 他のストーリーに依存しない。機能全体の MVP。

### Within User Story 1

- T001、T002、T003 は別々のテストファイルを扱うため並列可能。実装 T004〜T006 の前に失敗を確認する。
- T004（manifest）と T005（ChatView の draft 処理）は異なるファイル群のため、テスト作成後は並列実行可能。
- T006 は T005 の `startNewChat()` が用意された後に実行する。
- T007、T008 は実装完了後に実行する。T008 は最終検証。GUI を伴う手動確認はローカル IDE が使える環境で行う。

### Parallel Opportunities

```text
並列テスト作成: T001 + T002 + T003
テスト後の並列実装: T004 + T005
逐次実装: T006（T005 完了後）
最終検証: T007 -> T008
```

---

## Parallel Example: User Story 1

```text
Task: "viewsWelcome と view/title の作成 command を検証する — src/test/sidebar.test.ts"
Task: "本文 draft 開始と送信前の非永続化を検証する — src/test/chatView.integration.test.ts"
Task: "新規チャット command 登録を検証する — src/test/extension.test.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001〜T003 で新しい契約と draft 開始のテストを追加し、未実装状態で失敗することを確認する。
2. T004 と T005 を実装して manifest 操作と既存 Webview の開始処理を揃える。
3. T006 で VS Code command を同じ draft 処理へ接続する。
4. T007〜T008 で quickstart とプロジェクト標準検証を実施する。
5. 空状態からの開始、既存一覧との共存、失敗時の既存動作を確認して MVP を完了する。

### Incremental Delivery

- この仕様にユーザーストーリーは1つだけのため、User Story 1 完了を機能全体の提供可能な最小単位とする。

---

## Notes

- `[P]` は互いに異なるファイルを変更し、先行実装に依存しないタスクだけに付与。
- 全タスクはチェックボックス、連番 ID、必要なストーリーラベル、対象ファイルパスを含む。
- 作成操作は既存 `ChatView` の draft フローを再利用し、送信まで Markdown ファイルを作らない。
