---

description: "入力中に描画する Markdown チャット UI の実装タスク"
---

# Tasks: 入力中に描画する Markdown チャット UI

**Input**: Design documents from `specs/009-realtime-markdown-chat/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Unit・integration tests are included because the quickstart and plan require parser, serializer, persistence, and Webview validation.

**Organization**: Tasks are grouped by user story in specification priority order. Test tasks precede implementation for their story.

## Phase 1: Setup

**Purpose**: Add the Webview build and editor dependencies described by the plan without changing the Extension Host runtime bundle.

- [ ] T001 Add required ProseMirror model, state, view, commands, history, keymap, input-rules, Markdown, and table packages in `package.json` and update `package-lock.json`
- [ ] T002 Add a Webview TypeScript configuration with DOM libraries and strict project settings in `tsconfig.webview.json`
- [ ] T003 Configure separate Extension Host and chat Webview bundle entries and output `media/chat.js` in `webpack.config.js`

---

## Phase 2: Foundational

**Purpose**: Establish the shared chat Markdown model and strict parsing rules required by browsing, composing, and saving.

- [ ] T004 [P] Add parser and serializer contract tests for title, sections, message markers, nested headings, legacy files, ambiguous input, and line endings in `src/test/chatMarkdown.test.ts`
- [ ] T005 Implement chat thread, section, message, parse-state, and source-range types plus strict marker-pair parsing and message serialization in `src/chatMarkdown.ts`
- [ ] T006 Define shared Webview message discriminants and runtime guards for required fields, IDs, revisions, and Markdown input in `src/chatProtocol.ts`
- [ ] T007 Extend the existing document-store API with safe-root, dirty-document, read-only, conflict, and serialized write operations required by chat create, append, and marker-only updates in `src/documents.ts`
- [ ] T008 Configure chat-specific constants, default view registration identifiers, and activation wiring without changing document ownership rules in `src/configuration.ts` and `src/extension.ts`

**Checkpoint**: Chat documents can be parsed and validated without UI or file writes; shared Webview messages and guarded document operations are defined.

---

## Phase 3: User Story 1 - 送信せずに入力結果をチャット内で確認する (Priority: P1) 🎯 MVP

**Goal**: Provide a multiline, directly editable ProseMirror composer that renders Markdown in place while preserving input state and never sending on Enter.

**Independent Test**: Type, edit, paste, undo, and redo headings, emphasis, lists, code, tables, and Japanese text in an unsent composer; verify the composer itself renders the latest content and the chat file remains unchanged.

### Tests for User Story 1

- [ ] T009 [P] [US1] Add tests for Markdown parsing/serialization, task and callout nodes, incomplete syntax, and round-trip content preservation in `src/test/chatComposer.test.ts`

### Implementation for User Story 1

- [ ] T010 [US1] Implement the ProseMirror document schema, markdown-it token mapping, Markdown serializer, and permitted inline/block nodes in `src/webview/chatComposer.ts`
- [ ] T011 [US1] Implement input rules, paste parsing, undo/redo, task state editing, and callout editing in `src/webview/chatComposer.ts`
- [ ] T012 [US1] Implement Enter, Shift+Enter, and Backspace rules for headings, lists, check items, callouts, empty blocks, and paragraph joins in `src/webview/chatComposer.ts`
- [ ] T013 [US1] Preserve selection, caret, focus, and IME composition across transactions; defer structural rendering during composition and reconcile the latest draft on composition end in `src/webview/chatComposer.ts`
- [ ] T014 [US1] Add the composer layout, task/callout visuals, focus indicators, narrow-panel wrapping, and local code/table overflow rules in `media/chat.css`
- [ ] T015 [US1] Implement per-draft editor state and latest-revision rendering in the Webview entry point `src/webview/chat.ts`

**Checkpoint**: The composer edits and renders Markdown locally with no preview pane or file write; the behavior remains stable through composition, selection, history, and keyboard editing.

---

## Phase 4: User Story 2 - チャットを選び、保存済みの会話を読む (Priority: P1)

**Goal**: Replace the old TODO/MEMO sidebar management UI with a chat list, selectable thread, and safe formatted message rendering.

**Independent Test**: Load multiple valid and unsupported Markdown chat files; verify list ordering, selection, sections, message order, safe rendering, empty/unavailable/error states, and source-opening guidance.

### Tests for User Story 2

- [ ] T016 [P] [US2] Add sidebar snapshot, list ordering, selection, empty-state, unsupported-format, and source-opening tests in `src/test/chatView.test.ts`

### Implementation for User Story 2

- [ ] T017 [US2] Implement managed-directory chat discovery, stable update-time ordering, opaque chat IDs, and parse-state summaries in `src/chatView.ts`
- [ ] T018 [US2] Build complete generation-numbered snapshots with selected thread, section order, dirty-source state, and safe Markdown HTML from the existing renderer in `src/chatView.ts`
- [ ] T019 [US2] Implement the Webview chat list, selection, thread sections, message timestamps, status labels, empty/loading/error/unavailable states, and source-open action in `src/webview/chat.ts`
- [ ] T020 [US2] Replace the old TODO/MEMO view providers and contributed view metadata with the chat view registration in `src/extension.ts` and `package.json`
- [ ] T021 [US2] Add list, thread, message, error, accessibility, and responsive styles in `media/chat.css`

**Checkpoint**: Existing Markdown files can be browsed as safe chat threads; unsupported structures remain readable and are never silently rewritten.

---

## Phase 5: User Story 3 - 本文・返信を送信し、ファイルとして残す (Priority: P1)

**Goal**: Create one Markdown file for each new chat and append replies to the correct existing section while preserving the user's Markdown and file content.

**Independent Test**: Create a titled chat with one body message and two replies; verify exactly one file, correct marker pairs and order, and the same rendered thread after reloading.

### Tests for User Story 3

- [ ] T022 [P] [US3] Add tests for new-chat serialization, section append, marker uniqueness, title collisions, empty submissions, duplicate-send prevention, and revision-safe acknowledgements in `src/test/chatPersistence.test.ts`

### Implementation for User Story 3

- [ ] T023 [US3] Implement safe chat file creation, title-to-filename normalization, collision avoidance, and initial body message serialization through guarded document operations in `src/documents.ts`
- [ ] T024 [US3] Implement minimal append of a dated message to an existing or newly created section while preserving unrelated source ranges and LF/CRLF in `src/documents.ts`
- [ ] T025 [US3] Implement explicit send handling with input validation, operation deduplication, Host-generated timestamps/message IDs, current-version revalidation, and revision-aware results in `src/chatView.ts`
- [ ] T026 [US3] Connect the composer send action to the validated Host protocol and clear only the matching successfully saved draft revision in `src/webview/chat.ts`
- [ ] T027 [US3] Implement Markdown-only draft backup storage, fingerprint/version conflict detection, recovery, and explicit restore/discard handling in `src/chatDrafts.ts`
- [ ] T028 [US3] Integrate draft save/acknowledgement, send results, post-send snapshots, and recovery prompts in `src/chatView.ts` and `src/webview/chat.ts`

**Checkpoint**: A successful explicit send persists once and refreshes the selected thread; failed or stale sends retain the editable draft.

---

## Phase 6: User Story 4 - 外部編集と保存失敗でも入力を失わない (Priority: P2)

**Goal**: Reflect file and unsaved-source changes promptly, preserve recoverable drafts, and stop writes whenever the latest source cannot be safely verified.

**Independent Test**: Modify, create, move, or delete a selected file; leave its VS Code editor dirty; and simulate conflict, read-only, and save failure. Verify updated status or explicit errors, blocked writes, and recoverable drafts.

### Tests for User Story 4

- [ ] T029 [P] [US4] Add tests for draft fingerprint conflicts, corrupt/unknown draft versions, orphan recovery, and revision isolation in `src/test/chatDrafts.test.ts`
- [ ] T030 [P] [US4] Add tests for dirty-source snapshots, file change refresh, missing targets, conflict/read-only/save failure, and unchanged drafts in `src/test/chatView.test.ts`

### Implementation for User Story 4

- [ ] T031 [US4] Integrate file create/change/delete/move events and workspace/configuration changes with list and selected-thread refresh in `src/chatView.ts` and `src/extension.ts`
- [ ] T032 [US4] Reflect unsaved TextDocument content and dirty state in chat snapshots, and reject send/toggle operations until save or revert in `src/chatView.ts`
- [ ] T033 [US4] Implement stale fingerprint, missing URI, unsupported parse, and base-version checks for draft restoration and sending in `src/chatDrafts.ts` and `src/chatView.ts`
- [ ] T034 [US4] Return explicit protocol error codes and Japanese recovery guidance while retaining composer text for conflict, dirty document, read-only, invalid target, and save failure in `src/chatView.ts` and `src/webview/chat.ts`

**Checkpoint**: External and unsaved source changes never appear as current without being identified; send failures preserve the draft and never claim success.

---

## Phase 7: User Story 5 - 狭いサイドパネルでも安全に操作する (Priority: P2)

**Goal**: Support accessible keyboard workflows and narrow panels while rendering untrusted Markdown without script execution, navigation, or remote resource loading.

**Independent Test**: At 280px, 400px, and 800px, use keyboard-only workflows on long Japanese text, URLs, code, tables, unsafe links, HTML, and images; verify no panel overflow or unsafe activity.

### Tests for User Story 5

- [ ] T035 [P] [US5] Add tests confirming unsafe HTML is disabled, links remain inactive, images do not fetch, and chat content uses the existing safe renderer in `src/test/chatView.test.ts`
- [ ] T036 [P] [US5] Add keyboard accessibility and responsive Webview smoke scenarios for the chat composer and thread in `specs/009-realtime-markdown-chat/acceptance-tests.md`

### Implementation for User Story 5

- [ ] T037 [US5] Implement Host-side task identity resolution and marker-only guarded toggles with document version, dirty, conflict, and read-only checks in `src/chatView.ts` and `src/documents.ts`
- [ ] T038 [US5] Implement composer and rendered-message task controls with optimistic state rollback on failed toggle results in `src/webview/chat.ts`
- [ ] T039 [US5] Ensure Webview CSP, inactive link presentation, image alt-text rendering, and untrusted HTML handling retain the existing safe Markdown policy in `src/rendering.ts` and `src/chatView.ts`
- [ ] T040 [US5] Add labeled controls, visible focus/status announcements, keyboard navigation, and responsive overflow behavior in `media/chat.css` and `src/webview/chat.ts`

**Checkpoint**: Keyboard and narrow-panel interactions work without weakening rendering security; task changes affect only the intended marker and roll back on failure.

---

## Phase 8: Polish & Cross-Cutting Validation

**Purpose**: Validate the integrated feature against the acceptance scenarios, performance targets, package scripts, and user documentation.

- [ ] T041 [P] Update extension descriptions, chat commands/view labels, and user-facing usage documentation for the new chat workflow in `package.json` and `README.md`
- [ ] T042 Run parser, composer, draft, document-store, and chat-view test suites and resolve regressions in `src/test/`
- [ ] T043 Run `npm run compile-tests`, `npm run compile`, and `npm run lint`; correct TypeScript, Webpack, and ESLint failures in the affected project files
- [ ] T044 Execute acceptance tests AT-01 through AT-26 in an isolated workspace and record OS, VS Code version, viewport widths, and results in `specs/009-realtime-markdown-chat/acceptance-tests.md`
- [ ] T045 Measure 100 composer edits on a 1,000-line, at-most-32,000-character draft and record the latency distribution in `specs/009-realtime-markdown-chat/acceptance-tests.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; must complete before Webview implementation.
- **Foundational (Phase 2)**: Depends on Setup and blocks all user stories.
- **User Stories (Phases 3-7)**: Depend on Foundation and follow the P1/P2 priority order below.
- **Polish (Phase 8)**: Depends on all five stories; run compile, lint, and acceptance validation after integration.

### User Story Dependencies

- **US1 (P1)**: Starts after Foundation; independent local composer MVP, no persisted chat required.
- **US2 (P1)**: Starts after Foundation; relies on the shared parser and safe renderer, but can be tested with fixture files without US1.
- **US3 (P1)**: Depends on US1 composer and US2 chat selection/snapshot integration to complete the specified end-to-end send workflow.
- **US4 (P2)**: Depends on US2 file snapshots and US3 send/draft persistence paths.
- **US5 (P2)**: Depends on US1 composer, US2 message rendering, and US3/US4 operation results for safe task toggles and recovery.

### Within Each User Story

- Story tests precede the implementation they exercise.
- Tasks touching the same source file are sequential; separate test, style, parser, and view files can be parallel only where no unfinished task is a prerequisite.
- Send, task-toggle, or restore UI must not be marked complete until its Host-side guard and failure behavior are implemented.

### Parallel Opportunities

- **Setup**: T002 can run alongside T001; T003 follows bundle dependency decisions in T001.
- **Foundation**: T004 and T006 can start in parallel; T005 follows parser contract tests; T007 is independent of parser implementation.
- **US1**: T009 can be authored independently; T014 can be implemented independently of the ProseMirror schema; T010-T013 and T015 remain ordered where they share `chatComposer.ts` or `chat.ts`.
- **US2**: T016 is independent test work; T017/T018 share `chatView.ts` and are sequential; T019/T021 can proceed in parallel with Host snapshot work; T020 follows integration.
- **US3**: T022 can be written before persistence work; T023 and T027 touch separate files; T024/T025/T026/T028 follow their documented service/protocol dependencies.
- **US4**: T029 and T030 can be written in parallel; T031/T032/T033/T034 serialize by shared-file dependencies.
- **US5**: T035 and T036 can be prepared in parallel; T037 Host operations and T040 accessibility work can proceed separately, while T038 follows T037.
- **Polish**: T041, test execution T042, and runtime validation T044/T045 are parallelizable once their respective stories are integrated; T043 follows source changes.

---

## Parallel Examples

```text
# Foundation: independent contract and protocol work
T004 parser/serializer contract tests in src/test/chatMarkdown.test.ts
T006 Webview protocol guards in src/chatProtocol.ts
T007 guarded document operations in src/documents.ts

# US2: separate Host and Webview surfaces after the parser contract is stable
T017-T018 chat snapshots in src/chatView.ts
T019 chat list/thread rendering in src/webview/chat.ts
T021 presentation and responsive styles in media/chat.css

# US4: independent draft and snapshot failure test files
T029 draft recovery tests in src/test/chatDrafts.test.ts
T030 chat operation failure tests in src/test/chatView.test.ts
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Setup and Foundation.
2. Complete US1: real-time in-place Markdown composer with editing, selection, IME, and keyboard semantics.
3. Validate the independent composer test and confirm unsent edits never modify a chat file.

### Incremental Delivery

1. Add US2 to browse and safely render existing chat files.
2. Add US3 to create chats, append replies, and recover drafts.
3. Add US4 to protect data through source changes, external edits, and failed writes.
4. Add US5 task toggles, accessibility, responsive layout, and security validation.
5. Run the complete acceptance and performance suites.

### Independent Test Criteria

- **US1**: Composer itself renders current Markdown during typing, selection/editing, paste, undo/redo, and IME; Enter never sends; no file changes before send.
- **US2**: Fixture files produce the correct ordered list and thread; safe formatting and all empty/error/unsupported states are distinguishable.
- **US3**: One new chat with one body and two replies creates exactly one readable Markdown file and survives reload with matching order and content.
- **US4**: Dirty, externally changed, missing, read-only, and failed-save states block unsafe writes and retain recoverable drafts.
- **US5**: Keyboard-only operation at 280px, 400px, and 800px remains usable and untrusted Markdown causes no execution, navigation, or external fetch.

**MVP scope**: User Story 1, after shared Setup and Foundation.
