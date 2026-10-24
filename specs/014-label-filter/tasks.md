# Tasks: Issue 一覧のラベル絞り込み

**Input**: Design documents from `/specs/014-label-filter/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/label-filter-ui.md`, `quickstart.md`

**Tests**: Unit and E2E tasks are included because the feature requirements and validation guide define testable user journeys and E2E scenarios. Add tests before implementation within each story.

**Organization**: Tasks are grouped by user story. Complete each story's tests and implementation before moving to the next priority.

## Phase 1: Setup

**Purpose**: Prepare reusable test data for story-level end-to-end validation.

- [x] T001 Add a typed Issue fixture-seeding helper that accepts labels, state, title, and body while retaining `seedIssues` compatibility in `e2e/support/environment.ts`

---

## Phase 2: Foundational

**Purpose**: No additional shared production infrastructure is needed. The existing Issue store, sidebar message flow, and test commands are reused. T001 is required only before fixture-based E2E tasks; unit-test tasks can proceed independently.

---

## Phase 3: User Story 1 - ラベルで Issue を絞り込む (Priority: P1) 🎯 MVP

**Goal**: Select one existing label to show only matching Issues, and clear the label condition.

**Independent Test**: Seed Issues with different labels and no labels, select one label, verify only matching Issues appear, then clear the condition and verify the complete list returns.

### Tests for User Story 1

- [x] T002 [P] [US1] Add IssueStore tests for exact label filtering, deduplicated stable candidates from all valid Issues, and exclusion of unlabeled Issues in `src/test/issueStore.test.ts`
- [x] T003 [P] [US1] Add message-validation tests for an optional bounded label filter value and rejection of invalid values or unknown keys in `src/test/issueView.test.ts`
- [x] T004 [P] [US1] Add the P1 sidebar E2E case for selecting and clearing a label, including a no-results message distinct from an empty workspace, in `e2e/issue-sidebar.spec.ts`

### Implementation for User Story 1

- [x] T005 [US1] Add the optional exact-match label condition and stable candidate-label collection from all valid Issues to `IssueSearchOptions` and `IssueStore.list()` in `src/issueStore.ts`
- [x] T006 [US1] Add selected-label state, validate label-filter messages, pass the condition to IssueStore, and include candidates and selected value in list snapshots in `src/issueView.ts`
- [x] T007 [US1] Add an accessible single-label selector, clear option, selected-condition indication, and filter-aware empty state to the Issue list in `src/webview/issue.ts`

**Checkpoint**: The label selector independently filters and clears the Issue list without modifying Issue Markdown.

---

## Phase 4: User Story 2 - 他の一覧条件と組み合わせる (Priority: P2)

**Goal**: Combine label filtering with text search and Open/Closed state, preserving the other conditions when one condition changes.

**Independent Test**: Seed Issues with varied text, state, labels, and an unlabeled Issue; verify only Issues matching all active conditions appear and clearing the label leaves the query and state intact.

### Tests for User Story 2

- [x] T008 [P] [US2] Add IssueStore tests for AND-combination of query, state, and label, case-sensitive label matching, and unchanged Issue records in `src/test/issueStore.test.ts`
- [x] T009 [P] [US2] Add the P2 sidebar E2E case for combined conditions, label-only clearing, case differences, and unchanged Markdown contents and `updatedAt` in `e2e/issue-sidebar.spec.ts`

### Implementation for User Story 2

- [x] T010 [P] [US2] Preserve the selected label when validating and applying query or state changes, and verify all conditions are passed together to IssueStore in `src/issueView.ts`
- [x] T011 [P] [US2] Include the current label value in search and state filter messages, and preserve query and state when selecting or clearing the label in `src/webview/issue.ts`

**Checkpoint**: Query, state, and label conditions compose without resetting one another or writing to Issue files.

---

## Phase 5: User Story 3 - 詳細を確認して一覧に戻る (Priority: P3)

**Goal**: Preserve the active label and other list conditions while opening an Issue detail and returning to the list.

**Independent Test**: Apply a label and another list condition, open a matching Issue, return to the list, and verify the same selection and result set remain.

### Tests for User Story 3

- [x] T012 [P] [US3] Add the P3 E2E case that opens an Issue from a filtered list and verifies the selected label, query/state, and result set after returning in `e2e/issue-sidebar.spec.ts`
- [x] T013 [P] [US3] Add IssueView coverage that selecting an Issue and handling `backToList` retains the current label and other filter state in `src/test/issueView.test.ts`

### Implementation for User Story 3

- [x] T014 [US3] Preserve the selected label and all other list conditions across Issue selection, refresh, and `backToList` snapshots in `src/issueView.ts`

**Checkpoint**: Returning from detail restores the same active filters and visible Issues.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate the complete feature and record actual results.

- [x] T015 Run `npm test`, `npm run test:e2e`, and `npm run lint`; record actual commands, outcomes, and any environment limitation in `specs/014-label-filter/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 enables fixture-based E2E cases. Unit tests and production work do not depend on it.
- **Foundational (Phase 2)**: No additional foundational code is required.
- **User Stories (Phase 3+)**: Implement in priority order. US2 validates and completes the behavior introduced in US1; US3 validates state persistence across detail navigation after filter state exists.
- **Polish (Phase 6)**: Depends on the desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Starts immediately; the recommended MVP and independent value increment.
- **US2 (P2)**: Builds on the label condition from US1 to verify that existing query and state controls preserve and combine it.
- **US3 (P3)**: Builds on the label state from US1 and combined conditions from US2 to verify navigation persistence.

### Within Each User Story

- Complete its tests before its production implementation.
- In US1, implement IssueStore behavior before wiring host state, then implement the Webview selector against the snapshot contract.
- In US2, host and Webview condition-preservation changes touch different files and may proceed in parallel after tests are added.
- In US3, keep navigation-state changes in the host and verify them through both View and E2E coverage.

## Parallel Opportunities

- **Setup**: T001 is a small shared fixture change; it can run alongside unit-test authoring.
- **US1 tests**: T002, T003, and T004 touch distinct files and can be prepared in parallel; T004 requires T001.
- **US2 tests**: T008 and T009 touch distinct files and can be prepared in parallel after US1.
- **US2 implementation**: T010 and T011 touch distinct files and can proceed in parallel after US2 tests.
- **US3 tests**: T012 and T013 touch distinct files and can be prepared in parallel after US1/US2.

## Parallel Example: User Story 1

```text
After T001 is complete, author these tests in parallel:
Task: T002 in src/test/issueStore.test.ts
Task: T003 in src/test/issueView.test.ts
Task: T004 in e2e/issue-sidebar.spec.ts
Then implement T005, T006, and T007 in dependency order.
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete T001 so the E2E environment can seed varied Issue labels.
2. Complete US1 tests and implementation (T002–T007).
3. **Stop and validate** the independent US1 test criteria.
4. Deliver the basic single-label filter before adding combined filters and navigation verification.

### Incremental Delivery

1. Add US1: choose, apply, and clear one label.
2. Add US2: combine label, text, and state while preserving other conditions.
3. Add US3: preserve all conditions across detail navigation.
4. Run all validations and record actual outcomes in `quickstart.md`.

## Notes

- `[P]` means tasks touch distinct files and have no dependency on incomplete tasks.
- `[US1]`, `[US2]`, and `[US3]` map directly to the feature specification.
- Every task includes a repository-relative target path.
- Tests were added before production changes in each story. Automated test execution remains subject to the environment limitations recorded in `quickstart.md`.
