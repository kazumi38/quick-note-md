# Tasks: ビュー起動と空状態からの作成

**Input**: Design documents from `/specs/008-view-provider-empty-state/`

**Prerequisites**: plan.md and spec.md; research.md, data-model.md, contracts/, quickstart.md

**Organization**: Tasks are grouped by the two P1 user stories. Automated test tasks are included because plan.md and quickstart.md require manifest/provider and empty-state validation.

## Phase 1: Setup

**Purpose**: Use the existing VS Code extension project and dependencies; no initialization or new package dependencies are required.

## Phase 2: Foundational

**Purpose**: Preserve the current extension entry points and shared create commands. Complete the provider lifecycle work in US1 before dependent empty-state UI integration in US2.

---

## Phase 3: User Story 1 - QuickNoteMD のビューを確実に開く (Priority: P1)

**Goal**: All contributed QuickNoteMD views have a matching provider registered before asynchronous data loading, with distinct loading, unavailable, and failure feedback.

**Independent Test**: Activate the extension in a workspace and open each view at first launch and after reload; confirm no provider-not-registered error appears. Simulate unavailable workspace and list failures; confirm they are reported rather than shown as successful empty data.

### Tests for User Story 1

- [X] T001 [P] [US1] Assert in `src/test/sidebar.test.ts` that all three contributed view IDs (`quick-note-md.sidebar`, `quick-note-md.memos`, `quick-note-md.todos`) have matching `onView` activation entries and that the expected create/refresh commands are contributed.
- [X] T002 [P] [US1] Extend `src/test/extension.test.ts` to activate QuickNoteMD and verify the contributed view IDs and registered user commands remain available after activation.

### Implementation for User Story 1

- [X] T003 [US1] Keep provider registration for `quick-note-md.sidebar`, `quick-note-md.memos`, and `quick-note-md.todos` synchronous and unconditional in `src/extension.ts`; ensure registration occurs before watchers or asynchronous refresh work and dispose registrations through `context.subscriptions`.
- [X] T004 [US1] Initialize memo and Todo TreeViews with explicit loading messages, clear stale data on refresh start, then independently set their loaded, unavailable, or failure state in `src/sidebar.ts` without converting read failures into normal empty lists or clearing the other view's valid data.
- [X] T005 [US1] Treat a missing workspace as unavailable rather than empty and retain actionable error text for failed TreeView reads in `src/sidebar.ts`; ensure the existing refresh command in `src/extension.ts` can retry both lists.

**Checkpoint**: Each view has an activated, matching provider before data loading; first-open and reload scenarios show a valid loading/data/error state rather than a provider-registration error.

---

## Phase 4: User Story 2 - 空の一覧からメモや Todo を作成する (Priority: P1)

**Goal**: Users can start creating a memo or Todo directly from each applicable empty view while errors and loading states never offer misleading create actions.

**Independent Test**: With an empty managed directory, create a memo and Todo from their respective TreeView welcome actions and create both from the unified view. Verify the normal lists refresh; cancel each prompt and verify no empty file/item is created. Repeat with data present, no workspace, and list errors.

### Tests for User Story 2

- [X] T006 [P] [US2] Update `src/test/sidebar.test.ts` to verify an empty Todo list returns no empty status-group root items, populated lists retain their populated status groups, and memo/Todo empty-state context is set only after successful empty reads.
- [X] T007 [P] [US2] Extend `src/test/extension.test.ts` to verify the memo and Todo welcome actions target the existing `quick-note-md.newMemo` and `quick-note-md.newTodo` commands and those commands remain registered.

### Implementation for User Story 2

- [X] T008 [US2] Add separate `quick-note-md.memosEmpty` and `quick-note-md.todosEmpty` context keys and `contributes.viewsWelcome` command actions for `quick-note-md.memos` and `quick-note-md.todos` in `package.json`; gate each action on its own successfully loaded empty state.
- [X] T009 [US2] Update `src/sidebar.ts` so `TodoProvider` exposes only status groups containing Todos; set each empty-state context independently after successful reads, and clear it during loading, unavailable, and error states while leaving the TreeView message unset for normal empty views.
- [X] T010 [US2] Extend `src/sidebarView.ts` to send explicit loading, ready, empty, unavailable, and error snapshots for the unified WebviewView; keep memo and Todo read outcomes independent, route `newMemo` and `newTodo` through existing commands, and route `refresh` through the shared refresh command path in `src/extension.ts` so both the TreeViews and WebviewView are refreshed; never treat rejected reads as empty data.
- [X] T011 [US2] Update `media/sidebar.js` to render a loading state, distinguish an entirely empty collection from partial data, show accessible “新規メモ” and “新規 Todo” buttons only when both lists loaded successfully and are empty, and show retry/unavailable/error guidance without create buttons.
- [X] T012 [US2] Style unified empty/loading/error messages and keyboard-focusable action buttons in `media/sidebar.css` using existing VS Code theme variables and visible focus treatment.

**Checkpoint**: The two TreeViews use native welcome actions; the unified view has equivalent accessible actions. All routes reuse existing create commands and cancel/error without creating partial data.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Keep user guidance and end-to-end validation aligned with the implemented behavior.

- [X] T013 [P] Update the empty-state usage and provider troubleshooting guidance in `README.md` to describe all three creation entry points and distinguish empty data from a missing workspace or failed load.
- [X] T014 Run the automated validation commands in `specs/008-view-provider-empty-state/quickstart.md` and record any required corrections in the affected implementation or test files.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No setup task is needed; dependencies and test infrastructure already exist.
- **Foundational (Phase 2)**: No separate shared infrastructure is needed; US1 provider lifecycle is the prerequisite for rendering its empty states.
- **User Story 1 (Phase 3)**: Can begin immediately; establishes and verifies provider registration and state reporting.
- **User Story 2 (Phase 4)**: Depends on US1 provider lifecycle and state reporting; then implements the creation actions independently per view.
- **Polish (Phase 5)**: Depends on the desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Independent; must complete before US2 so views have reliable providers and load states.
- **US2 (P1)**: Depends on US1 view lifecycle and read-state handling; reuses its existing commands and refresh path.

### Within Each User Story

- Test tasks can be authored in parallel before implementation.
- Provider/data-state work precedes the empty-state UI that consumes it.
- Package manifest and TreeView behavior changes share the US2 story but target different files and can proceed in parallel after US1.
- Unified Webview host snapshot routing precedes the Webview rendering and styling integration.

## Parallel Opportunities

- **US1**: T001 and T002 can run in parallel because they touch different test files. T004 and documentation of provider registration in T003 affect different modules, though T003 must be in place before initial-view verification.
- **US2**: T006, T007, and T008 can be developed in parallel after US1. T009 updates TreeView data/context; T010 updates the Webview host; these can proceed in parallel after US1. T011 depends on T010's snapshot/message contract; T012 can proceed alongside T011 after its UI classes are agreed.
- **Polish**: T013 can run in parallel with code integration. T014 runs after all implementation and documentation changes.

## Parallel Example: User Story 2

```text
After US1 is complete:
Task: T006 TreeView empty data/context tests in src/test/sidebar.test.ts
Task: T007 command/manifest tests in src/test/extension.test.ts
Task: T008 welcome actions in package.json
Task: T010 unified Webview host states and message routing in src/sidebarView.ts
```

## Implementation Strategy

### MVP First

1. Complete US1 provider lifecycle and state reporting (T001–T005).
2. **Stop and validate US1 independently** using the first-open/reload and failure-state criteria.
3. Complete US2 native TreeView and unified-view create actions (T006–T012).
4. Validate all empty, partial, cancelled, unavailable, and failed states with the quickstart scenarios.

### Incremental Delivery

1. US1 removes the provider-registration failure mode and accurately reports view loading/errors.
2. US2 adds direct empty-state creation for memo, Todo, and combined views.
3. Polish documentation and execute the complete validation guide.

## Notes

- Every task has a checkbox, sequential ID, story label for user-story phases, and concrete repository path(s).
- Existing commands and `DocumentStore` remain the sole creation and persistence path.
- No setup, database, dependency installation, or new persistent data task is required.
