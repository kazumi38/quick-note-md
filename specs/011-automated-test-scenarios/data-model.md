# Data Model: テストシナリオ自動化

この機能では製品の永続データモデルを追加しない。以下はテスト実行中だけ存在するデータである。

## Entities

### Test Scenario

1つの独立して実行可能な利用者ジャーニー。

| Field | Description | Validation |
|---|---|---|
| `scenarioId` | Stable identifier for the scenario | Unique within the E2E suite |
| `initialState` | Empty workspace or named Markdown fixture | Fully defined before the app launches |
| `actions` | User-visible operations performed in VS Code and the chat webview | No dependence on another scenario's state |
| `expectations` | Visible UI and persisted Markdown outcomes | All expectations must be asserted before pass |
| `cleanup` | Shutdown and temporary-data cleanup behavior | Runs after pass or failure |

### Isolated Test Environment

Disposable resources allocated to a single scenario execution.

| Field | Description | Validation |
|---|---|---|
| `rootPath` | Unique temporary root created for this execution | Created under a test-controlled temporary directory; never derived from a user workspace path |
| `workspacePath` | Scenario workspace containing the notes directory and optional fixture files | All extension writes are limited to this workspace |
| `userDataPath` | Dedicated VS Code user profile | Unique and empty for each scenario |
| `extensionsPath` | Dedicated VS Code extension directory | Does not read the developer's active extension installation |
| `vscodeExecutable` | Downloaded VS Code build used by this run | Version is pinned to 1.138.0, the minimum compatible release in `engines.vscode: ^1.138.0` |
| `lifecycle` | `creating`, `ready`, `running`, `closing`, or `removed` | State only advances after the corresponding operation succeeds |

### Scenario Result

Outcome and diagnostic record for one scenario execution.

| Field | Description | Validation |
|---|---|---|
| `scenarioId` | Scenario that produced this result | Must reference a defined scenario |
| `status` | `passed` or `failed` | Pass only after all UI, persistence, and cleanup expectations succeed |
| `expected` | Concise expected user-visible or file result | Present for each failed assertion |
| `actual` | Observed value or failure message | Present for each failed assertion |
| `diagnosticsPath` | Optional retained Playwright trace/screenshot location | Outside the disposable workspace and test data |

## Relationships and Lifecycle

- One **Test Scenario** execution owns exactly one **Isolated Test Environment** and produces exactly one **Scenario Result**.
- A scenario prepares its initial workspace, launches VS Code with isolated paths, performs UI actions, verifies UI and saved Markdown, closes VS Code, then removes its temporary root.
- Cleanup runs regardless of assertion outcome. Cleanup errors are reported as test failures; they must not turn a failed run into a passing result.
- Failure diagnostics may persist under the test-results location after the temporary environment is removed. They contain only synthetic test data.

## Data Safety Invariants

- Never use the active VS Code user's `user-data`, `extensions`, or workspace directories.
- Every writable chat fixture belongs to that scenario's temporary workspace.
- A new run starts with a clean workspace and profile; no previous scenario output is used as input.
- Saved Markdown is read from the test workspace to verify actual persistence.
- Only paths created by the current scenario are eligible for recursive cleanup.
