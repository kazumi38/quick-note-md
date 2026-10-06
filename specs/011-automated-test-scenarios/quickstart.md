# Quickstart: ローカルチャット E2E テスト

## Prerequisites

- Windows desktop environment.
- Node.js/npm version supported by the repository's installed dependencies.
- Network access on first run so `@vscode/test-electron` can download the pinned VS Code build.
- Enough local disk space to cache the VS Code build and Playwright failure artifacts.

## Setup and Run

From the repository root in PowerShell:

```powershell
npm.cmd ci
npm.cmd run test:e2e
```

The first E2E run downloads or resolves VS Code 1.138.0, creates isolated temporary workspaces and profiles, and launches the extension for each scenario. Subsequent runs reuse the VS Code binary cache but start each scenario from clean temporary state.

The E2E command compiles the extension and chat webview bundles before launching VS Code.

Failure traces and screenshots are written under `test-results/e2e/`.

Run one named scenario:

```powershell
npm.cmd run test:e2e -- --grep "new chat"
```

Continue to run the existing Extension Host tests separately:

```powershell
npm.cmd test
```

## Expected Results

- The E2E command exits successfully only after the selected scenarios pass and temporary environments are closed and cleaned up.
- New-chat and reply scenarios verify both visible chat content and the corresponding Markdown file in the isolated workspace.
- Read-only and external-edit scenarios verify that drafts are retained and existing Markdown is not silently overwritten.
- Stability check: all 5 scenarios passed in 10 consecutive full-suite runs (50/50), with no flaky results or cleanup failures.
- On failure, the output identifies the scenario and failed expectation; Playwright diagnostics are retained separately from the temporary workspace.

## Troubleshooting

- If the first run cannot download VS Code, restore network access and rerun; do not point the suite at the active user profile as a workaround.
- If VS Code launch or Playwright Electron connection is blocked by endpoint security, preserve the reported launch error and diagnose that environment before attempting UI selectors.
- If a locator stops finding the chat view after a VS Code update, inspect the run using Playwright's trace/inspector and update accessible selectors only after confirming the UI behavior. Update the pinned VS Code build intentionally rather than tracking an unreviewed workbench change.

For isolation and reporting guarantees, see the [runner contract](contracts/e2e-runner.md); transient test entities are described in the [data model](data-model.md).
