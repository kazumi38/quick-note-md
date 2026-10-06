# Local E2E Runner Contract

## Entry Point

- **Command**: `npm run test:e2e`
- **Build behavior**: compile the extension and webview bundles before launching the suite.
- **Supported host for the initial release**: Windows desktop development environment.
- **Application under test**: the actual VS Code desktop executable with this repository loaded as an extension development extension.
- **VS Code version**: 1.138.0, pinned to the extension's minimum supported version.
- **UI automation**: Playwright Electron API; the chat is accessed in its VS Code webview, not a standalone mock page.
- **Existing test command**: `npm test` continues to run the current Extension Host/Mocha suite; it does not implicitly run the Playwright suite.

## Scenarios

The default command runs the independently executable chat scenarios:

1. Create a new chat, send a message, and verify the visible conversation and saved Markdown.
2. Open a fixture chat, send a reply, and verify old and new messages are visible and persisted once.
3. Verify that read-only state disables sending, then trigger an external-edit conflict; both scenarios verify the draft remains available and existing content is not silently overwritten.

The runner supports Playwright's standard test selection arguments so one scenario can be run in isolation, for example:

```powershell
npm run test:e2e -- --grep "new chat"
```

## Isolation and Cleanup

- Before each scenario, create an empty, unique temporary workspace, VS Code `user-data` directory, and extensions directory.
- Never inherit the developer's active VS Code profile, active workspace, or notes directory.
- Run the extension with pinned VS Code 1.138.0 for all scenarios.
- Always close the test-launched VS Code process and remove only that scenario's temporary root.
- Retain failure traces/screenshots under a separate test-results directory, not in the workspace fixtures.

## Result Contract

- Exit successfully only when all selected scenario assertions and environment cleanup succeed.
- Exit unsuccessfully on setup, launch, UI assertion, persistence assertion, teardown, or cleanup failure.
- Identify the failed scenario and include the expected and observed result.
- Keep diagnostics limited to synthetic scenario data; do not capture or use the developer's normal workspace/profile.

## Out of Scope

- CI execution and non-Windows hosts.
- Memo and Todo UI flows.
- A standalone mock browser page.
- Replacing or broadening the existing Mocha unit/integration test runner.
