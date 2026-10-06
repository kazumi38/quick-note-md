# Research: VS Code Extension E2E Automation

**Feature**: [spec.md](spec.md)
**Date**: 2026-10-07

## Decisions

### Decision: Drive the actual VS Code desktop application with Playwright Electron

- **Decision**: Add `@playwright/test` as a development dependency and launch a VS Code executable using Playwright's Electron API. Resolve/download the executable through the existing `@vscode/test-electron` dependency. Continue using the current Mocha Extension Host test suite for API-level checks.
- **Rationale**: The clarified requirement is to test the real extension and chat webview, not a browser mock. The existing `vscode-test` setup runs Mocha inside the Extension Development Host but does not provide browser locators for the rendered webview. Playwright can drive the Electron window and inspect the nested webview frame.
- **Alternatives considered**:
  - Keep only `@vscode/test-cli`/`@vscode/test-electron`: useful for API integration but insufficient for real rendered UI interactions.
  - Use Microsoft's `vscode-automation` smoke-test driver: couples tests to private, unpublished VS Code internals and is maintained for VS Code's own smoke tests.
  - Use `vscode-test-playwright`: purpose-built but currently pre-1.0 with a small community footprint; avoid making it a core dependency before validating the direct approach.
  - Use Selenium-based VS Code extension testers: mature but conflicts with the requested Playwright tooling.
  - Test a standalone mock page: would not validate the actual VS Code extension/webview integration.

### Decision: Isolate every scenario and pin its VS Code build

- **Decision**: Create a fresh temporary root per scenario containing a workspace, `user-data` directory, and `extensions` directory. Pass those paths to the test-launched VS Code process. Pin VS Code to `1.138.0`, the minimum version declared in `engines.vscode`, and update that pin intentionally alongside compatibility changes.
- **Rationale**: A dedicated profile prevents the test process from borrowing the developer's active settings, credentials, installed extensions, or session. A clean workspace ensures repeatable setup and prevents writes to real notes. Pinning limits locator breakage caused by changing workbench DOM.
- **Alternatives considered**:
  - Reuse the current VS Code profile or workspace: rejected because test state could leak into or overwrite user data and runs would not be independent.
  - Follow the latest VS Code release implicitly: rejected for the primary local suite because workbench UI changes could make results vary over time.

### Decision: Keep E2E local and independent of the existing test command

- **Decision**: Expose an opt-in `npm run test:e2e` command and a separate Playwright configuration rooted at `e2e/`. Do not include E2E in `pretest`, `npm test`, or CI in this release.
- **Rationale**: The user selected Windows-local execution. A separate command avoids slowing or destabilizing the existing Extension Host test suite and keeps the local E2E setup explicit.
- **Alternatives considered**:
  - Replace the existing Mocha suite: rejected because API-level tests remain valuable and cheaper to run.
  - Run Playwright on every default test invocation or in CI: excluded by the clarified initial scope.

### Decision: Assert both user-visible behavior and persisted Markdown

- **Decision**: Use Playwright locators for the VS Code workbench and chat webview interactions; inspect files in the dedicated test workspace directly for persistence assertions. On failures, report the scenario and expected/actual outcome and retain Playwright diagnostics outside the disposable workspace.
- **Rationale**: The feature's success criteria require checking what the developer sees and what the extension saves. Combining the two catches cases where UI state and Markdown storage diverge.
- **Alternatives considered**:
  - Assert only on DOM: does not prove the user data persisted.
  - Assert only through `DocumentStore` or Extension Host messages: does not exercise the actual UI.

## Feasibility and Risks

- VS Code extension integration tests are officially run inside a separate Extension Development Host; this repository already uses `@vscode/test-cli` and `@vscode/test-electron`. The selected test version `1.138.0` is the extension's declared minimum (`engines.vscode: ^1.138.0`).
- VS Code documents a webview as an iframe inside VS Code. Existing real-extension Electron automation examples use nested frame locators to reach webview content.
- Playwright Electron automation against VS Code has precedent in Microsoft's own VS Code automation harness and in maintained VS Code extension projects. This does not make workbench DOM selectors a stable public API; keep VS Code version pinned and prefer role/name locators over CSS classes.
- Start implementation with a minimal Windows smoke test that launches the pinned VS Code build, opens the development extension, and locates the chat webview. If endpoint security blocks CDP/Electron automation, stop before implementing scenarios and report the environment limitation rather than silently falling back to a mock.
- Obtain the VS Code 1.138.0 binary once and reuse the local test cache for later runs. The first setup needs network access to download the selected VS Code build.
- Use `finally`/test teardown to close the VS Code process and remove only the created temporary root. Preserve failure diagnostics in a separate test-results directory; do not include the user's normal profile or workspace in diagnostics.

## Sources

- VS Code, **Testing Extensions**: https://code.visualstudio.com/api/working-with-extensions/testing-extension
- VS Code, **Webview API Guide**: https://code.visualstudio.com/api/extension-guides/webview
- Playwright, **Electron API**: https://playwright.dev/docs/api/class-electron
- Microsoft, **vscode-test**: https://github.com/microsoft/vscode-test
- Microsoft, **VS Code Playwright Electron harness**: https://github.com/microsoft/vscode/blob/main/test/automation/src/playwrightElectron.ts
- Zoo-Code, **VS Code E2E Electron automation**: https://github.com/Zoo-Code-Org/Zoo-Code/blob/main/apps/vscode-e2e/src/visual/electron.visual.ts
- Repository context: `package.json` already includes `@vscode/test-cli` and `@vscode/test-electron`; `.vscode-test.mjs` runs `out/test/**/*.test.js`; `src/test/chatView.integration.test.ts` verifies chat persistence at the Extension Host level without driving the rendered webview.
