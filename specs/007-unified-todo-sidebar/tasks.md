# Tasks: Todo 中心の統合メモサイドバー

**Input**: Design documents from `specs/007-unified-todo-sidebar/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: 仕様と quickstart に独立テスト条件、受け入れシナリオ、自動検証が明記されているため、ストーリー別テストタスクを含める。

**Organization**: タスクはユーザーストーリーごとにまとめる。既存の TypeScript/VS Code 拡張の構成と依存関係は `package.json` に存在するため、新規プロジェクト初期化や依存追加は不要。

## Format

- すべての実行タスクは `- [ ] T### [P?] [US#?] 説明とファイルパス` 形式。
- `[P]` は別ファイルで並行実行でき、未完了タスクに依存しない場合だけ付ける。
- Setup/Foundation/Polish にはストーリーラベルを付けず、各ユーザーストーリーのタスクには `[US1]` から `[US4]` を付ける。

## Phase 1: Setup

**Purpose**: 既存プロジェクトの初期化確認

既存の `package.json` に TypeScript、VS Code API、webpack、Mocha、ESLint と各スクリプトが定義済み。初期化・依存追加タスクはない。

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 各ストーリーが共有するデータモデル、文書更新の前提、サイドバー WebviewView の実行基盤を確立する。

- [X] T001 [P] `src\core.ts` に統合 Todo、本文、リプライ、属性、ソース範囲、読み取り専用状態の型を整備し、既存 Todo 状態と識別子を維持する。
- [X] T002 `src\documents.ts` に文書バージョン・Todo 元行・対象範囲・ディスク内容を照合してから更新する共有ガードを整備し、非対象範囲と既存改行形式を保持する。あわせて `package.json`、`src\extension.ts`、`src\sidebarView.ts` に最小の `WebviewViewProvider` と `media\sidebar.js`/`media\sidebar.css` の読み込みを登録し、DocumentStore の Todo 一覧を表示して Todo を選択できるホスト基盤を作る。

**Checkpoint**: 共通モデルと保護付き文書更新がそろった後、ユーザーストーリーを開始できる。

---

## Phase 3: User Story 1 - Todo の内容とリプライをサイドバーで記録する (Priority: P1) 🎯 MVP

**Goal**: Todo の状態とタイトルを保ちながら、本文・時系列リプライを作成、編集、保存、個別削除し、Todo の削除も関連内容と一括で安全に行う。

**Independent Test**: タイトルのみの Todo に本文と複数リプライを追加・編集して明示保存し、再読み込み後も内容・順序・状態・別 Todo が保持されることを確認する。本文内チェックボックスは Todo 件数に加算せず、確認キャンセル・競合・保存失敗では内容を変更しない。

### Tests for User Story 1

- [ ] T003 [P] [US1] `src\test\core.test.ts` に現在の canonical format の解析・直列化、本文・複数リプライの順序、本文内チェックボックスの除外、未対応の旧形式・破損ブロックの読み取り専用条件を検証するテストを追加する。
- [ ] T004 [P] [US1] `src\test\documents.test.ts` に本文・リプライの対象範囲保存、外部変更・バージョン競合、リプライ単独削除、Todo と関連ブロックの一括削除、キャンセル時無変更を検証するテストを追加する。
- [ ] T005 [P] [US1] `src\test\extension.test.ts` と `src\test\drafts.test.ts` に本文・リプライ編集の明示保存、Todo/リプライ削除の確認表示、本文/リプライ/属性 draft の globalStorageUri 下での作成・復元・保存/破棄後削除・失敗時の保持を検証するテストを追加する。

### Implementation for User Story 1

- [X] T006 [US1] `src\core.ts` に現在の Todo 行・本文・リプライ境界の厳密な解析と直列化を実装し、認識できない旧形式や破損構造を自動変換せず読み取り専用で返す。
- [X] T007 [US1] `src\documents.ts` に Todo 本文・リプライの作成、編集、追加を対象範囲だけ置換する明示保存操作として実装し、保存失敗・競合時に書き込まず理由を返す。
- [X] T008 [US1] `src\documents.ts` に Reply ID で指定したリプライだけを削除する操作と、Todo 行・属性・本文・全リプライを一括削除する操作を実装し、書き込み前に確認後の参照・範囲を再検証する。
- [ ] T009 [US1] `src\editor.ts` と `src\drafts.ts` に Todo 本文・リプライ・属性用の draft、dirty/saving/conflict/failed 状態、および `globalStorageUri` 下の一時 JSON バックアップ作成・復元・削除を実装する。属性 draft はラベルと対応日の編集値を保存し、ストレージ失敗時もメモリ上の入力を保持してエラーを通知する。
- [ ] T010 [US1] `media\sidebar.js` と `media\sidebar.css` に複数行の本文・リプライ編集欄、リプライ追加・編集・削除操作、保存状態表示、生 Markdown へのサイドバー内導線を実装する。
- [X] T011 [US1] `src\extension.ts` と `package.json` に本文・リプライ編集およびリプライ/Todo 削除コマンドを登録し、削除確認には対象と削除される関連内容を明記してキャンセル時は保存しない。

**Checkpoint**: Todo の記録・明示保存・確認付き削除を、他の Todo と状態を変更せず単独で検証できる。

---

## Phase 4: User Story 2 - 折りたたみ一覧から Todo を把握・整理する (Priority: P2)

**Goal**: ファイル設定群と Todo を同じサイドバー内で扱い、折りたたみ一覧から状態・タイトル・ラベル・対応日を確認し、必要な Todo だけを展開する。

**Independent Test**: 通常メモと複数状態・ラベル・対応日を持つ Todo のある文書で単一サイドバーを開く。状態・タイトル・ラベル名・対応日の意味を色なしでも識別し、Todo の展開・折りたたみ後も他項目の表示と編集中 draft を失わないことを確認する。

### Tests for User Story 2

- [ ] T012 [P] [US2] `src\test\sidebar.test.ts` と `src\test\extension.test.ts` に WebviewView の単一ファイル/Todo 階層、状態別集計、ラベルと期限のアクセシビリティ表示、キーボード操作、フォーカス維持、展開状態の保持を検証するテストを追加する。

### Implementation for User Story 2

- [ ] T013 [US2] `src\sidebar.ts` と `src\sidebarView.ts` にファイル設定/メモ一覧と状態別 Todo のデータ/表示階層を実装し、既存の最小 WebviewView を単一の統合サイドバーへ拡張する。
- [ ] T014 [US2] `src\sidebarView.ts` に Webview との型・種別検証付きメッセージ連携を実装し、`media\sidebar.js` からの編集、保存、削除、属性操作を接続する。`src\sidebar.ts` の Todo identity ごとの安定した項目 ID と展開状態を保ち、更新後も他項目の展開を維持する。
- [ ] T015 [US2] `media\sidebar.js` と `media\sidebar.css` にキーボードのみでの一覧移動、展開/折りたたみ、編集、保存、切替を実装し、意味的な HTML、可視フォーカス、適切な `aria-label`/`aria-expanded`/`role=status` と文字による状態説明を付ける。

**Checkpoint**: 既存のファイル操作を残したまま、ひとつのサイドバーから Todo の概要と詳細へ移動できる。

---

## Phase 5: User Story 3 - Markdown を連続入力しながら内容を確認する (Priority: P3)

**Goal**: Todo 本文・リプライを同じ編集面で連続入力し、表示可能な Markdown の整形結果をライブ確認し、生 Markdown 編集へ切り替えられるようにする。

**Independent Test**: 本文とリプライへ複数段落・見出し・箇条書き・リンクを入力し、入力中にプレビューを確認する。IME、貼り付け、選択置換、生 Markdown 切替、Todo/ファイル切替、サイドバー非表示・再表示、VS Code 再起動後に未保存入力を復元できること、保存・明示破棄後にバックアップファイルが削除されることを確認する。

### Tests for User Story 3

- [ ] T016 [P] [US3] `src\test\rendering.test.ts`、`src\test\extension.test.ts`、`src\test\drafts.test.ts` に連続複数段落編集、表示可能な Markdown の安全な描画、未知構造の直接編集拒否、IME/キーボード/本文・リプライ・属性 draft のサイドバー非表示・再生成・再起動後復元を検証する。再起動後は Todo の元行と対象ブロックの保存時スナップショットで照合し、session-local な文書 version の一致を要求しない。

### Implementation for User Story 3

- [ ] T017 [US3] `src\rendering.ts` に本文・リプライの Markdown 描画と直接編集可能範囲の検証を実装し、HTML とリンク遷移を無効にして画像を代替説明として扱う。複雑・未知構造は同じサイドバー内で対象 Todo ブロックの生 Markdown を編集できる表示に切り替え、対象範囲を確認できない場合は編集を拒否する。
- [ ] T018 [US3] `media\sidebar.js` と `media\sidebar.css` の本文・リプライ入力を連続複数行編集と同一編集面のライブ表示に対応させ、Enter、貼り付け、段落をまたぐ選択・置換、日本語 IME のキャレット・選択・フォーカスを保持する。
- [ ] T019 [US3] `src\sidebarView.ts`、`src\editor.ts`、`src\drafts.ts`、`media\sidebar.js` に本文/リプライ/属性 draft の change/save/discard/restore/conflict メッセージ連携を実装する。再起動後は保存済み Todo 元行を一意に再特定し、永続化した Todo 元行・対象ブロックの baseSource と現在の内容を比較する。`baseVersion` は同一セッション中だけ使い、再起動後の照合には使わない。一致しない、または Todo が一意に特定できない場合はバックアップを競合として残し、自動適用しない。

**Checkpoint**: ライブ編集から明示保存まで連続操作でき、危険または未知の Markdown は変更されない。

---

## Phase 6: User Story 4 - ラベルと対応日で Todo を分類する (Priority: P4)

**Goal**: 状態・優先度とは独立して複数ラベルと任意の暦日を設定し、各ラベルの固定パレット色をワークスペース内で共有する。

**Independent Test**: Todo に複数ラベルと `YYYY-MM-DD` の対応日を設定し、ラベルの追加・削除、日付の変更・解除、Todo 状態変更後も他属性が保持されることを確認する。同名ラベルは別ファイル間で同色になり、空/重複ラベルと無効日付は作成・書き込みされず、完了済み Todo は期限切れ扱いされない。

### Tests for User Story 4

- [ ] T020 [P] [US4] `src\test\core.test.ts`、`src\test\documents.test.ts`、`src\test\sidebar.test.ts` に属性制約、メタデータのみの範囲更新、別ファイル間ラベル色共有、ローカル暦日の期限判定を検証するテストを追加する。

### Implementation for User Story 4

- [X] T021 [US4] `src\core.ts` に属性の解析・直列化・入力検証を実装し、data-model.md の制約「`labels` と `due` だけを受け付ける」「ラベルは前後空白を除き、空値・同一表記の重複を除外する」「`YYYY-MM-DD` または未設定」を適用し、無効日付を読み取り専用にする。
- [ ] T022 [US4] `src\documents.ts` にラベル・対応日だけを更新する競合保護付き保存操作を追加し、Todo 行、本文、リプライ、状態、他 Todo を変更しない。
- [ ] T023 [US4] `src\extension.ts`、`src\sidebar.ts`、`src\configuration.ts`、`package.json` に複数ラベルの追加/削除、固定パレット色選択、対応日の設定/変更/解除を実装し、リソース設定へワークスペース共有色を保存する。
- [ ] T024 [US4] `src\sidebar.ts` にローカル暦日で期限切れ/期限内/未設定を判定し、完了済み Todo は期限切れ強調しない表示を実装する。

**Checkpoint**: ラベル・対応日を独立して編集でき、一覧の説明は色を使わない場合にも正しく判別できる。

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 全ストーリーの UX、データ安全性、パフォーマンスとドキュメントを仕上げる。

- [ ] T025 `specs\007-unified-todo-sidebar\quickstart.md` を実装済みのコマンド、明示保存、競合・削除確認、手動シナリオと一致させ、変更範囲と回帰確認手順を記載する。
- [ ] T026 `package.json` の `lint`、`compile-tests`、`compile`、`test` スクリプトを実行し、通常規模の文書における表示と編集の実用性、改行・破損・競合・保存失敗・draft 復元・キーボード/アクセシビリティ操作の quickstart 条件を検証して失敗を修正する。性能の数値閾値は設けない。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 既存構成を使用するため変更タスクなし。
- **Foundational (Phase 2)**: T001 は独立して着手可能。T002 が保護付き文書更新と最小 Todo 選択可能な WebviewView を準備する。T001/T002 完了後にユーザーストーリーを開始する。
- **User Stories (Phase 3+)**: 優先順位は US1 → US2 → US3 → US4。共通ファイルの競合を避ける既定の実行順序であり、独立作業は各ストーリー内の [P] タスクに限定する。
- **Polish (Phase 7)**: US1〜US4 の実装完了後に実施する。

### User Story Dependencies

- **US1 (P1)**: T001/T002 後に開始。Foundation が Todo を選択するサイドバー面を提供するため、MVP として動作を検証できる。
- **US2 (P2)**: T001/T002 後に開始できる。US1 の保存操作を統合ビューの詳細編集へ接続し、ファイル/メモ階層や状態別表示を追加する。
- **US3 (P3)**: T001/T002 と US1 の draft/保存操作、US2 の WebviewView を前提とし、同じ編集面へライブ Markdown と切替・競合 UX を追加する。
- **US4 (P4)**: T001/T002 と US2 の一覧/色表示を前提とし、属性編集・永続化・期限判定を追加する。

### Within Each User Story

- テストタスクは対象実装より先に追加し、実装が満たすべき振る舞いを検証する。
- US1 は `core.ts` の解析/直列化と `documents.ts` の範囲更新を先行し、その後 editor と command wiring を統合する。
- US2 は Foundation の最小 WebviewView を拡張し、ファイル/メモ階層、状態別表示、メッセージ連携、キーボード/アクセシビリティ対応の順で統合する。
- US3 は安全な描画/編集範囲検証と Webview 入力を実装してからファイル退避・復元を含む draft 切替・競合 UX を統合する。
- US4 は属性検証/直列化、対象限定保存、UI 操作、期限表示の順で統合する。

## Parallel Opportunities

- **Foundation**: T001 (`src\core.ts`) は独立して着手可能。T002 は guarded document update と最小 WebviewView ホストを準備し、ユーザーストーリー開始前に完了する。
- **US1**: T003、T004、T005 は別々のテストファイルなので並行可能。テスト追加後は core 側の T006 と DocumentStore 側の T007 を並行できる。
- **US2**: T012 のテスト作成後、T013 のファイル/メモ階層、T014 の編集メッセージ連携、T015 の Webview UI は共通ファイルを順次編集する。並行実装は推奨しない。
- **US3**: T016 のテスト作成後、`src\rendering.ts` の T017 と `media\sidebar.js`/`media\sidebar.css` の T018 は並行可能。T019 は provider・draft store・Webview 間のメッセージ契約に統合する。
- **US4**: T020 のテスト作成後、`src\core.ts` の T021 と `src\documents.ts` の T022 は並行可能。UI の T023 は双方の契約確定後に行う。

## Parallel Example: User Story 1

```text
並行: T003 (`src\test\core.test.ts`)
並行: T004 (`src\test\documents.test.ts`)
並行: T005 (`src\test\extension.test.ts` と `src\test\drafts.test.ts`)
その後並行: T006 (`src\core.ts`) と T007 (`src\documents.ts`)
順次: T008 → T009 → T010 → T011
```

US2 の WebviewView 拡張は、同じ provider・階層・Webview ファイルを変更するため順次実行する:

```text
T013 (ファイル/メモ階層と状態別 Todo) → T014 (編集メッセージ連携) → T015 (キーボード/アクセシビリティ UI)
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001/T002 で共通モデル、保護付き更新、最小の Todo 選択可能な WebviewView ホストを整える。
2. T003〜T011 で Todo の本文・リプライを明示保存できるようにする。
3. US1 の独立テスト条件を検証し、本文内チェックボックス・競合・削除キャンセルでデータが変化しないことを確認する。
4. **MVP 範囲**: US1 の Todo 記録、リプライ、明示保存と確認付き削除。

### Incremental Delivery

1. Foundation + US1 → 記録 MVP。
2. US2 → 単一サイドバーで一覧と展開詳細を確認。
3. US3 → 同じ編集面でライブ Markdown と安全な切替を追加。
4. US4 → ラベル色と対応日の編集・一覧分類を追加。
5. T025/T026 → quickstart、実用上の操作性、回帰、クロスプラットフォーム条件を確認。

## Format Validation

- すべての実行タスクは `- [ ] T###` で始まり、ID は T001〜T026 の連番。
- ユーザーストーリータスクには `[US1]`〜`[US4]` があり、Setup/Foundation/Polish タスクにはストーリーラベルがない。
- `[P]` は異なるファイルで独立して進められるタスクだけに付与。
- 各タスクの説明には変更対象の具体的なファイルパスを記載。
