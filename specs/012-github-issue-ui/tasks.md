# Tasks: GitHub Issue風UI

**Input**: Design documents from `specs/012-github-issue-ui/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Organization**: Tasks are grouped by user story so creation and detail/comment workflows can be delivered and validated independently.

## Phase 1: Setup

**Purpose**: Wire the existing memo/Todo webview into the VS Code UI without changing the chat view.

- [X] T001 [P] Contribute the QuickNoteMD Issue editor-panel command and activation in `package.json`
- [X] T002 [P] Add localized labels and aria helper styles for the issue detail surface in `media/sidebar.css`

## Phase 2: Foundational Markdown Storage and UI Model

**Purpose**: Provide safe memo metadata/comment parsing and host-side item snapshots required by both stories.

- [X] T003 [P] Add unit cases for Memo footer extension parsing, malformed markers, labels, comments, and unchanged legacy text in `src/test/core.test.ts`
- [X] T004 [P] Add DocumentStore cases for guarded memo body, labels, comments, title rename, EOL, conflicts, and save failure in `src/test/documents.test.ts`
- [X] T005 Implement a strict parser and serializer for Memo footer metadata/comment blocks in `src/core.ts`
- [X] T006 Implement guarded Memo read/update/rename operations that preserve body, due dates, EOL, and unrelated text in `src/documents.ts`
- [X] T007 Add Memo/Todo issue snapshot types, host-side identity resolution, exact Webview message validation, revisions, and operation results in `src/sidebarView.ts`
- [X] T008 Add foundational editor-panel Webview initialization, accessible item selector, detail shell, and snapshot handling in `media/sidebar.js`
- [X] T009 Wire Memo/Todo refresh notifications and current item selection through the existing extension lifecycle in `src/extension.ts`

## Phase 3: User Story 1 - Create Memo or Todo in a Side Panel (Priority: P1)

**Goal**: Create a titled Memo or Todo with an optional Markdown description using a side panel, with live formatting and recoverable failures.

**Independent Test**: Create each item kind from the sidebar without a popup, verify title and multi-paragraph Markdown after reopening, then cancel and force validation/save failures to verify that no unintended file is created and the input remains available.

- [ ] T010 [P] [US1] Add sidebar creation UI tests for item kind selection, side panel, validation, cancel, and retained input in `src/test/sidebar.test.ts`
- [ ] T011 [P] [US1] Add Memo and Todo creation Extension Host journeys, including duplicate-title and save-failure outcomes, in `e2e/issue-create.spec.ts`
- [X] T012 [US1] Implement Memo and Todo creation operations accepting title plus optional Markdown description in `src/documents.ts`
- [X] T013 [US1] Implement a responsive in-view creation side panel with title, description, explicit Create/Cancel, and failure retention in `media/sidebar.js` and `media/sidebar.css`
- [X] T014 [US1] Route validated create, cancel, and draft messages to Markdown operations and return revision-bound results in `src/sidebarView.ts`
- [X] T015 [US1] Reuse the ProseMirror Markdown editor for create descriptions with the required shared toolbar, live rendering, selection, IME, and undo behavior in `src/webview/issueComposer.ts`
- [X] T016 [US1] Integrate the issue composer bundle and accessible toolbar assets into the webview build in `webpack.config.js` and `media/sidebar.js`

## Phase 4: User Story 2 - View and Edit Issue Details, Comments, and Labels (Priority: P2)

**Goal**: Present Memo and Todo in a shared Issue-style detail view, with item-local labels, title editing, inline description/comment editing, and existing Todo status behavior.

**Independent Test**: For both item kinds, verify title, description, ordered comments, and labels; edit/cancel/save each relevant field; confirm only the chosen field changes, Todo status remains independent, Memo has no status, and every change survives a refresh.

- [ ] T017 [P] [US2] Add tests for shared Memo/Todo snapshots, Todo-only status, labels beside status, title edits, and inline description/comment editing in `src/test/sidebar.test.ts`
- [X] T018 [P] [US2] Add persistence tests for Memo and Todo comment ordering, label validation, exact-range edits, cancellation, conflict, and retry draft behavior in `src/test/documents.test.ts`
- [ ] T019 [P] [US2] Add end-to-end detail, label menu, inline comment editor, status, and failure-retention flows in `e2e/issue-detail.spec.ts`
- [X] T020 [US2] Render the common Issue-style detail view and label/status row, omitting all status controls for Memo in `media/sidebar.js` and `media/sidebar.css`
- [X] T021 [US2] Implement independent title editing, using safe in-root rename for Memo and an exact Todo row update for Todo in `src/documents.ts`
- [X] T022 [US2] Implement add, rename, remove, apply, cancel, whitespace trimming, and case-sensitive duplicate validation for item-local labels in `media/sidebar.js` and `src/sidebarView.ts`
- [X] T023 [US2] Implement Todo title editing and retain existing status and due date while updating Todo labels in `src/documents.ts`
- [X] T024 [US2] Implement Memo description and ordered comment append/edit/delete using only a validated tail extension block in `src/documents.ts`
- [X] T025 [US2] Expose validated Memo and Todo description/comment/status mutations through revision-checked Webview messages in `src/sidebarView.ts`
- [X] T026 [US2] Add per-card ellipsis menus and inline editors for description and existing comments with save/cancel and failure retention in `media/sidebar.js` and `media/sidebar.css`
- [X] T027 [US2] Add comment composition to the shared live Markdown editor and expose required heading, emphasis, quote, code, link, list, checklist, undo, and redo commands in `src/webview/issueComposer.ts`
- [ ] T028 [US2] Persist and reconcile title, description, labels, and comment drafts without clearing them on failed saves in `src/drafts.ts` and `src/draftManager.ts`
- [X] T029 [US2] Verify title, label, comment, and status actions update only the selected item and refresh the detail snapshot in `src/sidebarView.ts`

## Phase 5: Polish and Cross-Cutting Validation

**Purpose**: Verify accessibility, Markdown compatibility, safety, and existing chat/Todo behavior.

- [ ] T030 [P] Add keyboard and accessible-name coverage for side panel, ellipsis menus, label editor, and Markdown toolbar in `e2e/issue-detail.spec.ts`
- [X] T031 [P] Add regression cases for existing Todo markers, memo filename titles, comments in Markdown, malformed extension blocks, and EOL preservation in `src/test/core.test.ts` and `src/test/documents.test.ts`
- [X] T032 Run `npm run compile`, `npm run lint`, `npm test`, and `npm run test:e2e`; resolve feature regressions in the changed source/test files
- [ ] T033 Complete the manual walkthrough in `specs/012-github-issue-ui/quickstart.md` and record any unmet criteria in that guide

## Dependencies & Execution Order

### Phase dependencies

- Setup (Phase 1) has no code prerequisites.
- Foundational (Phase 2) depends on setup and blocks both stories.
- US1 depends on the Memo/Todo snapshots, safe Markdown operations, and sidebar shell from Phase 2.
- US2 depends on Phase 2 and should follow US1 where the creation UI and composer assets are shared.
- Polish depends on both stories.

### User story dependencies

- US1 (P1) depends on Phase 2 and is independently testable.
- US2 (P2) depends on Phase 2; it reuses the shared editor and host snapshot built for US1, and is independently testable for pre-existing Memo/Todo files.

### Parallel opportunities

- T001 and T002 are independent setup changes.
- T003 and T004 can be written in parallel because they affect separate test files.
- In US1, T010, T011, and composer implementation T015 can be developed in parallel after foundational types are agreed; T013 is separate from host-side T014.
- In US2, T017, T018, and T019 target separate tests; T020 and persistence task T024 can proceed in parallel after Phase 2, while host and Webview tasks should be sequenced where they share a file.
- T030 and T031 can run in parallel after both stories.

## Implementation Strategy

1. Complete Setup and Foundational work; validate strict parsing and safe Memo extension edits before any UI writes.
2. Deliver US1 as the MVP: create Memo/Todo from the side panel with recoverable, live-formatted Markdown.
3. Deliver US2: shared detail, labels and independent title edits, then card-level description/comment edits.
4. Complete regression, accessibility, build, unit, and E2E validation before marking tasks complete.

## Notes

- Every task is a single executable checkbox with sequential ID and exact repository-relative paths.
- `[P]` is used only for work in independent files that can proceed without an unfinished prerequisite.
- Automated test tasks are included because feature success criteria and validation scenarios explicitly require test coverage for these behaviors.
