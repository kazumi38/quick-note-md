# Tasks: テストシナリオ自動化

**Input**: Design documents from `/specs/011-automated-test-scenarios/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/e2e-runner.md, quickstart.md

**Tests**: This feature is itself an end-to-end testing capability; the Playwright scenarios below are required deliverables, not optional test tasks.

**Organization**: Tasks are grouped by user story so each journey can be implemented and validated independently after shared runner setup.

## Format

- Every task uses `- [ ] T### [P] [US#] Description with exact file paths`.
- `[P]` is included only when the task edits a file independent of other in-progress tasks.
- `[US#]` maps to the priority-ordered user stories in `spec.md`.

## Phase 1: Setup

**Purpose**: Add a separate, opt-in Playwright E2E entry point without changing the existing test pipeline.

- [x] T001 Add `@playwright/test` as a development dependency and add the `test:e2e` script to `package.json` and `package-lock.json`; keep `test`, `pretest`, and `vscode-test` behavior unchanged.
- [x] T002 Create `e2e/playwright.config.ts` with the Playwright test discovery rooted only in `e2e/`, a Windows-local default configuration, and failure diagnostics enabled.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build a reusable, isolated VS Code launch and cleanup harness required by every user story.

- [x] T003 Implement scenario environment setup and teardown in `e2e/support/environment.ts`: create unique temporary `workspace`, `user-data`, and `extensions` directories; resolve the pinned VS Code 1.138.0 executable via the existing `@vscode/test-electron`; and launch the repository extension in VS Code without using the developer's active profile or workspace.
- [x] T004 Implement Playwright Electron startup, VS Code workbench readiness, chat view reveal, nested webview frame access, shutdown, and test-only temporary-root cleanup in `e2e/support/vscode-app.ts`; cleanup must run after pass or failure and must not remove paths outside the scenario root.
- [x] T005 Implement shared Playwright fixtures and failure reporting in `e2e/fixtures.ts`, including scenario-scoped environment lifecycle, expected-versus-actual assertion context, and failure trace/screenshot retention outside the temporary workspace.
- [x] T006 Add shared chat locators and saved-Markdown reading/assertion helpers in `e2e/support/chat.ts`; prefer accessible role/name locators for workbench controls and use the chat webview frame for its UI.

**Checkpoint**: The harness can start the pinned VS Code build with an isolated workspace and profile, access the real chat webview, and always close/clean its own environment.

## Phase 3: User Story 1 - チャットの主要操作を自動で確認する (Priority: P1) 🎯 MVP

**Goal**: Automatically create a chat, send a message, and verify the visible and persisted results in an isolated workspace.

**Independent Test**: Run only the new-chat scenario against an empty temporary workspace; confirm the chat appears in the view and its Markdown file contains the sent message. Confirm the scenario leaves no temporary profile/workspace behind on success or failure.

- [x] T007 [US1] Implement the empty-workspace new-chat journey in `e2e/chat-new.spec.ts`: reveal QuickNoteMD chat, start a chat, enter and send a uniquely identifiable message, and assert it appears in the visible conversation.
- [x] T008 [US1] Assert in `e2e/chat-new.spec.ts` that the new chat appears in the list and the isolated workspace's saved Markdown contains the sent message; fail with expected and actual values when either assertion differs.
- [x] T009 [US1] Add an empty-message validation scenario to `e2e/chat-new.spec.ts` and assert that no empty chat is created or persisted.
- [x] T010 [US1] Verify in `e2e/chat-new.spec.ts` that the scenario passes when selected alone using Playwright's test selection and is independent of prior scenario data.

**Checkpoint**: User Story 1 passes by itself using only the temporary environment and proves UI plus Markdown persistence.

## Phase 4: User Story 2 - 保存済みチャットを再開して返信する (Priority: P2)

**Goal**: Reopen a known saved conversation, send a reply, and verify both the old and new content without duplication or loss.

**Independent Test**: Seed one valid chat Markdown fixture in a fresh temporary workspace, run only the reply scenario, then assert the prior message and exactly one new reply are visible and persisted.

- [x] T011 [P] [US2] Add a minimal valid saved-chat fixture with a known message and title in `e2e/fixtures/saved-chat.md`, matching the current chat Markdown format.
- [x] T012 [US2] Implement the saved-chat reopen and reply journey in `e2e/chat-reply.spec.ts`, seed the fixture into the isolated notes directory, select it in the chat list, send a uniquely identifiable reply, and verify both messages remain visible.
- [x] T013 [US2] Assert in `e2e/chat-reply.spec.ts` that the original message is unchanged and the new reply occurs exactly once in the saved Markdown after the UI reports completion.
- [x] T014 [US2] Verify in `e2e/chat-reply.spec.ts` that repeating the scenario from a freshly seeded fixture produces the same visible and persisted result without depending on another scenario.

**Checkpoint**: User Story 2 runs independently from its fixture and confirms restart/reply persistence.

## Phase 5: User Story 3 - 保存できない状況で下書きを保護する (Priority: P3)

**Goal**: Exercise save failure and external-edit conflict behavior and prove that the draft remains recoverable and the existing Markdown is not silently overwritten.

**Independent Test**: Run each negative scenario from its own fresh workspace. Confirm the failure is visible, the draft remains available, and the original or externally modified Markdown remains intact.

- [x] T015 [P] [US3] Implement a read-only protection scenario in `e2e/chat-save-failure.spec.ts` using an isolated chat made read-only after VS Code opens; assert the list's read-only state, disabled send action, retained draft text, and unchanged saved file contents.
- [x] T016 [P] [US3] Implement an external-edit conflict scenario in `e2e/chat-conflict.spec.ts`: edit the selected chat file outside the webview after loading it, attempt to send a reply, and assert conflict detection, retained draft text, and preservation of the external edit.
- [x] T017 [US3] Ensure `e2e/chat-save-failure.spec.ts` and `e2e/chat-conflict.spec.ts` each run independently, and assert their test environment is cleaned up even when the expected failure is detected.

**Checkpoint**: User Story 3 demonstrates both failure modes without data loss or cross-scenario state.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Make the local workflow discoverable and verify the acceptance conditions across journeys.

- [x] T018 [P] Document Windows prerequisites, first-run VS Code download, `npm run test:e2e`, targeted `--grep` execution, diagnostics, and troubleshooting in `README.md`.
- [x] T019 Run the full E2E suite 10 consecutive times from clean scenario state and record any flaky result or cleanup failure in `specs/011-automated-test-scenarios/quickstart.md`.
- [x] T020 Run `npm test` and `npm run test:e2e` using the steps in `specs/011-automated-test-scenarios/quickstart.md`; confirm existing Extension Host tests remain separate and all E2E scenarios pass.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; creates the runner entry point and its configuration.
- **Foundational (Phase 2)**: Depends on Setup; blocks all story scenarios because each requires safe, real-VS-Code launch and teardown.
- **User Stories (Phase 3+)**: Depend on the completed runner foundation. Stories are otherwise independently runnable and may be implemented in parallel.
- **Polish (Phase 6)**: Depends on the desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Depends on Phase 2 only; delivers the MVP.
- **US2 (P2)**: Depends on Phase 2 only; uses a separate fixture and test file, not US1 state.
- **US3 (P3)**: Depends on Phase 2 only; save-failure and conflict cases use separate test files and isolated environments.

### Parallel Opportunities

- After T001, T002 can be completed independently of the scenario fixture work.
- After Phase 2, T011 (US2 fixture), T015 (US3 save failure), and T016 (US3 conflict) edit separate files and can proceed in parallel.
- US1, US2, and US3 scenario files can be implemented in parallel once the shared runner and chat helpers (T003-T006) are complete.
- T018 README documentation can proceed in parallel with scenario implementation if it documents only the already-decided interface in `contracts/e2e-runner.md`.

## Parallel Example: User Story 3

```text
Task: T015 in e2e/chat-save-failure.spec.ts
Task: T016 in e2e/chat-conflict.spec.ts
```

These tasks are independent because each uses a separate test file and a fresh isolated VS Code environment.

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete T007-T010 for User Story 1.
3. Run the new-chat scenario alone and confirm the visible UI and persisted Markdown.
4. Validate teardown on both successful and deliberately failing assertions.
5. Use the result as the first usable local E2E increment.

### Incremental Delivery

1. Deliver the isolated runner and US1 new-chat scenario.
2. Add US2 saved-chat reply using an independent fixture.
3. Add US3 save-failure and conflict scenarios.
4. Update user documentation and verify repeatability with 10 consecutive clean runs.

## Format Validation

- All task entries use `- [ ]`, sequential `T###` IDs, exact paths, and a story label only in user-story phases.
- `[P]` appears only on tasks with separate target files and no incomplete-task dependency.
- No sample tasks or unresolved placeholders remain.
