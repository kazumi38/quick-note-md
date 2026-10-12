---
description: "Issueサイドバーの実装・検証タスク"
---

# Tasks: Issue サイドバー

**Input**: `specs/013-issue-sidebar/` の `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`

**Prerequisites**: `plan.md`、`spec.md`、`contracts/issue-markdown-storage.md`、`contracts/legacy-data-migration.md`

**Organization**: Setup、Foundational、User Story、Polishの順。実装と検証の状態を個別に管理する。

## Phase 1: Setup

**Purpose**: Issue用ビルドとテストの土台を整え、再利用するMarkdown編集部品を旧Chat機能から切り離す。

- [X] T001 `src/webview/issueComposer.ts`と`src/webview/markdownComposer*.ts`を分離し、汎用編集部品とテストを`src/test/markdownComposer.test.ts`へ移す。
- [X] T002 `webpack.config.js`、`package.json`、`tsconfig.webview.json`をIssue Webview entryに合わせ、`src/webview/issue.ts`から`media/issue.js`を生成する。
- [X] T003 `e2e/fixtures.ts`、`e2e/support/environment.ts`、`e2e/support/vscode-app.ts`に一時workspace・Issue用テスト環境を用意し、テストデータで実ユーザーデータを変更しない。

## Phase 2: Foundational

**Purpose**: Issue形式、厳格なMarkdown解析、安全な保存、Draft、Webview messageの共通基盤を実装する。

- [X] T004 `src/issueMetadata.ts`にIssue、Comment、Label、Draftの型とschema検証を実装する。Issue IDはworkspace内で一意、titleはtrim後に空でない、stateは`open | closed`、labelsはtrim後に空文字・完全一致重複なし、bodyは空可とする。
- [X] T005 [P] `src/test/issueMetadata.test.ts`と`src/test/issueMarkdown.test.ts`に正常・空本文・LF/CRLF・日本語・重複ID・不正JSON・未知version・marker境界のテストを追加する。
- [X] T006 [P] `src/test/issueStore.test.ts`にdirty/deleted document、workspace外・symlink拒否、temp検証、外部変更、破損ファイル保持、`.meta`非生成のテストを追加する。
- [X] T007 `src/issueMarkdown.ts`に単一Markdownの厳密なparse/serializeを実装し、metadata、説明、順序付きコメントを明示markerで分離する。marker不正時は推測せずread-only結果を返す。
- [X] T008 `src/configuration.ts`と`src/issueStore.ts`に`.quick-note-md/issues`のworkspace内解決、symlink確認、ID・ファイル名一致検証を実装する。
- [X] T009 `src/issueStore.ts`にIssue単位の安全な読み書きを実装する。一時ファイルを検証後、元内容とrevisionを再確認して置換し、dirty文書・外部変更・保存失敗では入力を保持する。
- [X] T010 `src/issueDrafts.ts`と`src/test/issueDrafts.test.ts`にworkspace単位のDraft保存を実装する。`title | body | labels | comment | state`を扱い、保存成功または明示キャンセル時のみ該当Draftを削除する。
- [X] T011 `src/issueView.ts`に型付きWebview message、snapshot、operation result、preview契約を実装し、ID・field・revision・payloadサイズ・重複operationを検証する。
- [X] T012 `src/rendering.ts`と`src/test/rendering.test.ts`の安全なMarkdown表示をIssue本文・コメントに適用し、scriptと外部コンテンツの自動取得を防ぐ。

## Phase 3: US1 — Issue一覧と詳細 (Priority: P1)

**Goal**: Issueを一覧・検索・絞り込みし、本文とコメントをサイドバー内で分けて閲覧する。

**Independent Test**: 20件以上のIssueを用意し、一覧、検索、Open/Closed filter、詳細、一覧復帰と条件保持を確認する。本文が詳細ヘッダーに一度だけ表示され、コメントのみがtimelineに並び、editor tabが増えないことを確認する。

### Tests

- [X] T013 [P] [US1] `src/test/legacyMigration.test.ts`に旧notes/draft削除範囲、無関係データ保持、再実行、権限失敗、workspace root・workspace外・symlink・パス重複拒否のテストを追加する。
- [X] T014 [P] [US1] `src/test/issueView.test.ts`、`src/test/extension.test.ts`、`e2e/issue-sidebar.spec.ts`に一覧・検索・filter・詳細・復帰・本文/comment分離・editor tab不変の検証を追加する。

### Implementation

- [X] T015 [US1] `src/legacyMigration.ts`に旧`notesDirectory`、`chat-drafts`、`sidebar-drafts`だけを対象とする初回削除を実装する。path overlapとsymlinkを削除前に拒否し、全削除成功後のみworkspace単位で完了を記録する。
- [X] T016 [US1] `src/issueStore.ts`にIssue一覧snapshot、title/body検索、Open/Closed filter、状態別件数、更新日時順の並び替え、補助ファイル除外を実装する。
- [X] T017 [US1] `src/issueView.ts`にready/refresh/selectIssue/setFilterの遷移を実装し、一覧条件を保持して最新snapshotを配信する。
- [X] T018 [US1] `src/webview/issue.ts`に一覧・検索・state filter・件数・詳細・一覧復帰を実装し、本文をdetail header、コメントのみをtimelineに表示する。
- [X] T019 [P] [US1] `media/issue.css`にVS Code theme、狭幅レイアウト、focus表示、状態文字、accessible操作名に対応するIssue専用スタイルを実装する。
- [X] T020 [US1] `src/extension.ts`と`package.json`にIssue専用WebviewViewとrefresh操作を登録し、旧Todo/Memo/Chat view、command、editor/menu contributionを削除する。
- [X] T021 [US1] 旧domain/UIの`src/core.ts`、`src/documents.ts`、`src/sidebar*.ts`、`src/editor.ts`、`src/chat*.ts`、`src/webview/chat*.ts`、旧media、関連旧テスト・E2Eを削除し、汎用Markdown部品は残す。

## Phase 4: US2 — Issue起票 (Priority: P1)

**Goal**: サイドバー内でtitleと任意のMarkdown本文を入力・previewし、Issueを一度だけ作成する。

**Independent Test**: 有効titleで作成し、一覧・詳細・Markdownファイルを照合する。空白title、キャンセル、preview切替、連続submitを確認する。

### Tests

- [X] T022 [P] [US2] `src/test/issueStore.test.ts`に連番競合・既存最大ID・削除後の番号非再利用・空白title拒否・`.sequence.md`と単一`.md`の保存・`.meta`非生成を検証する作成テストを追加する。
- [X] T023 [P] [US2] `e2e/issue-sidebar.spec.ts`に一覧/詳細からの作成、Markdown preview復帰、キャンセル、空白title、連続submit防止、作成後表示、editor tab不変を検証する。

### Implementation

- [X] T024 [US2] `src/issueStore.ts`に`.sequence.md`のversion照合、排他的ID採番、既存ID最大値確認、安全な復旧または作成停止を実装する。
- [X] T025 [US2] `src/issueStore.ts`にtitle/bodyを検証した新規Issue作成を実装し、open state・空labels/comments・RFC 3339 timestampsで初期化して単一Markdownを排他的に保存する。
- [X] T026 [P] [US2] `src/webview/issueComposer.ts`にIssue作成用composer mount/preview切替/disposeを接続し、日本語IME・選択範囲・Undo/Redoとmarker非表示を維持する。
- [X] T027 [US2] `src/issueView.ts`にstartCreate/draftChanged/createIssue/cancelDraft/previewを接続し、成功時のみDraftを消して作成Issueの詳細へ移動する。失敗時は入力を保持する。
- [X] T028 [US2] `src/webview/issue.ts`と`media/issue.css`に作成フォーム、必須title、任意body、preview、cancel、失敗表示を実装する。preview操作がform submitを起こさないようにする。

## Phase 5: US3 — Issue更新とコメント (Priority: P2)

**Goal**: title/body編集、コメント追加、state/label変更を安全に保存し、競合時にはDraftを保持する。

**Independent Test**: Issue本文を編集して保存し、コメント追加、Open/Closed切替、label追加・削除後に再読込して内容を確認する。競合時は保存停止とDraft保持を確認する。

### Tests

- [X] T029 [P] [US3] `src/test/issueStore.test.ts`にtitle/body単独更新、createdAtとID不変、updatedAt更新、label検証、空白comment拒否、comment ID/timestamp保持、対象外Issue不変を検証する。
- [X] T030 [P] [US3] `e2e/issue-sidebar.spec.ts`にtitle/body/comment編集のpreview・cancel、キーボード操作、保存失敗・外部変更後のDraft保持と再読込/退避を検証するシナリオを追加する。

### Implementation

- [X] T031 [US3] `src/issueStore.ts`にtitle/bodyの単独更新を実装し、ID・ファイル名・createdAt・コメント履歴を保持して対象Issueだけを保存する。
- [X] T032 [US3] `src/issueStore.ts`にOpen/Closed切替とlabel追加・削除を実装する。trim後の空labelと完全一致重複を拒否し、stateとlabelを独立して扱う。
- [X] T033 [US3] `src/issueStore.ts`にcomment追加・編集を実装する。IDはhost生成、空白のみの新規commentを拒否、既存ID/createdAtを保持し、同一operationの二重投稿を防ぐ。
- [X] T034 [US3] `src/issueView.ts`にsaveFieldのtitle/body/state/labels/comment処理、対象field/commentId/baseRevision検証、重複operation拒否、保存成功後のDraft消去とsnapshot更新を実装する。
- [X] T035 [US3] `src/webview/issue.ts`、`src/webview/issueComposer.ts`、`media/issue.css`にtitle/body/comment編集、Open/Closed、label操作を実装し、detail headerとcomment timelineを維持する。
- [X] T036 [US3] `src/issueView.ts`と`src/webview/issue.ts`に外部変更・削除・破損・保存失敗の状態、再読込またはDraft退避を実装し、失敗時に入力を破棄・推測修復しない。

## Phase 6: Polish & Cross-Cutting

**Purpose**: ドキュメント、回帰検証、アクセシビリティと未実施確認の記録を仕上げる。

- [X] T037 [P] `README.md`と`package.json`をIssue専用機能へ更新し、単一Markdown形式、初回移行の削除範囲、競合時の挙動を説明する。
- [X] T038 [P] `src/test/issueStore.test.ts`に作成・編集・comment投稿100ケース相当の重複/対象外変更検証と、破損marker・temp中断時のデータ保持検証を追加する。
- [X] T039 [P] `e2e/issue-sidebar.spec.ts`と`specs/013-issue-sidebar/quickstart.md`で30秒以内の発見時間、キーボードのみ、狭幅/テーマ、日本語IMEを手動評価し、環境と結果を記録する。自動テスト実行時間をユーザーの発見時間として扱わない。手動確認はユーザーがOKと確認。
- [X] T040 `package.json`、`webpack.config.js`、`src/extension.ts`、`src/`、`media/`、`e2e/`を確認し、旧domain登録・import・bundle・専用テストの残存を削除する。汎用composer/renderingと移行用旧設定読取は維持する。
- [X] T041 `specs/013-issue-sidebar/quickstart.md`にcompile-tests、compile、lint、unit test、Playwright、packageの実行結果と未実施の手動確認を記録し、FR-001〜FR-021とSC-001〜SC-010への適合を確認する。

## Dependencies & Execution Order

- Setup (T001–T003) precedes Foundational (T004–T012); T001 precedes T002.
- Foundational precedes US1. T013/T014 tests may run in parallel; migration, store, view, UI, and registration follow their dependencies.
- US2 and US3 follow US1. T022/T023 and T029/T030 are independent test tasks; changes to shared store/view/UI files remain sequential.
- Polish follows implementation. T038–T039 are independent validation tasks; T040–T041 finalize removal and recorded verification.

## Parallel Opportunities

Parallelizable tasks: T003, T005, T006, T010, T011, T012, T013, T014, T019, T022, T023, T026, T029, T030, T037, T038, T039 (17 tasks). Tasks sharing a source file must still be serialized.

## Independent Test Criteria

- **US1**: 20+ seeded Issues support list/search/filter/detail/back navigation; body and comments are separate; no editor tab opens.
- **US2**: Create/cancel/validation/preview are sidebar-only; a successful create yields one numbered Markdown file and one list entry.
- **US3**: Edits, comments, state, labels survive reload; stale revisions or write failures preserve source and unsaved input.

## Implementation Strategy

1. Complete Setup and Foundation, then validate parsing, storage safety, and migration in tests.
2. Deliver US1 as the read-only list/detail MVP, using isolated seeded data.
3. Add US2 creation, then US3 editing/comment/state/labels without changing the established single-file format.
4. Run unit, build, lint, E2E, and package checks; record manual-only discovery-time, narrow-width/theme, keyboard, and IME checks separately from automated results.
