# Research: GitHub Issue風UI

## Repository findings

- `src/sidebarView.ts` already implements the Markdown-file and Todo presentation, preview, status changes, labels, drafts, and Todo replies. The existing activity-bar view is too narrow to match the approved GitHub Issue-like HTML design, so keep the host-side logic but present the Issue surface in an editor-area `WebviewPanel`; the chat view remains unchanged.
- `src/core.ts` parses Todo rows, statuses, labels, body extensions, and ordered comment blocks. The comment syntax and metadata markers use ordinary Markdown HTML comments. `src/documents.ts` updates a verified source range through `WorkspaceEdit`; it checks managed paths, file writability, document version, source text, disk freshness, and save success.
- `src/drafts.ts` and `src/draftManager.ts` already persist and reconcile Todo drafts separately from canonical Markdown. Equivalent recovery behavior is needed for memo creation and edits; drafts must not become a second canonical data store.
- `src/webview/chatComposer.ts` and `chatComposerModel.ts` provide a ProseMirror Markdown editor with history, input rules, parsing, serialization, and task-list support. `src/chatView.ts` provides a discriminated message union, exact-shape validation, CSP-bound local assets, document revisions, and conflict/recovery behavior. Reuse these patterns rather than add a new editor or trust Webview payloads.
- The package already depends on `markdown-it` and the required ProseMirror packages. `renderSafeMarkdown` in `src/rendering.ts` is the existing safe display path.
- Existing tests are in `src/test`; Playwright extension-host scenarios are in `e2e`. Existing Todo metadata also includes a due date, so saving labels from the new UI must preserve that field.

## Decisions

### 1. Extend the existing memo/Todo Webview, not the chat UI

**Decision**: Extend `SidebarView` and its local Webview assets for the Issue-style memo/Todo workflow. Open the surface in a full-width editor-area `WebviewPanel` from the contributed `openIssues`, `newMemo`, and `newTodo` commands. Keep the existing chat view and its interactions separate.

**Rationale**: The existing implementation can be reused without coupling issue-style notes to the chat data model, while the panel provides the horizontal space the HTML mock uses for its Issue heading, timeline, and creation side panel. The narrow activity-bar view remains suitable for chat, not for the full Issue workflow.

**Alternatives considered**:
- Replacing or extending `ChatView`: rejected because chat files and chat messages have a separate format and are outside feature 012.
- Building a new Webview/provider: rejected because it would duplicate existing selection, draft, message, and document-store integration.

### 2. Use one presentation model with kind-specific fields

**Decision**: Create a view-level union for Memo and Todo detail data with common title, description, labels, comments, and draft state. Only the Todo variant has status. Do not create a persisted Issue entity or assign Issue IDs.

**Rationale**: This directly implements the clarified shared workflow without changing the existing semantic distinction or introducing a parallel identity model.

**Alternatives considered**:
- Convert Memos into Todos or add a status to Memos: rejected by the clarification.
- Persist a new shared Issue record in JSON or a database: rejected by Markdown-first ownership and the requirement to preserve existing note/Todo formats.

### 3. Preserve existing Todo persistence and safe edit boundaries

**Decision**: Retain Todo row identity, status markers, metadata, body and comment markers, and the guarded `DocumentStore` operations. Extend the parser/store only for missing operations. A change must be scoped to the selected Todo row or its validated metadata/body/comment block and guarded by the current source/version.

**Rationale**: This reuses the format and safety checks already relied on by Todo parsing and edits. Label updates must retain the existing due date; comments remain ordered, Markdown-readable, and attached to the target Todo.

**Alternatives considered**:
- Rewrite a whole Markdown file from the Webview snapshot: rejected because it can overwrite unrelated changes and alter line endings or unknown syntax.
- Store labels/comments outside the Markdown file: rejected because Markdown must remain canonical and portable.

### 4. Append memo metadata and comments as a recognized Markdown extension block

**Decision**: Treat a Memo's existing Markdown document as its description. When it first receives labels or comments, append a strict, recognizable metadata/comment block at the document tail. Reuse the established `quick-note-md:meta`, `quick-note-md:comments`, `quick-note-md:comment`, and matching end markers and serializer conventions. Parse only a complete, unambiguous extension block in the supported position; absent blocks mean no labels/comments. Do not migrate existing files.

**Rationale**: Memos currently have no distinct metadata/comment boundary. A tail block preserves the existing document as-is, avoids imposing a body wrapper on old notes, and follows the existing Todo marker contract. It also allows comments to be parsed without confusing arbitrary paragraphs in legacy files with comments.

**Alternatives considered**:
- Wrap or rewrite every existing memo body: rejected because it risks changing user Markdown and requires migration.
- Add JSON sidecars or workspace state as canonical storage: rejected by Markdown-first ownership.
- Infer comments from headings or trailing paragraphs: rejected because ordinary Markdown has no reliable comment boundary.

**Safety condition**: If a candidate marker sequence is incomplete, duplicated, malformed, or cannot be uniquely attributed to the tail extension, do not rewrite it. Show the item read-only for that operation and direct the user to source Markdown. Updates replace only the validated block or append at EOF, preserving all prior text and the original EOL convention.

### 5. Keep memo titles filename-derived and edit them with a guarded rename

**Decision**: A Memo title remains the display name derived from its Markdown filename, consistent with `DocumentStore.list()` and the existing Memo model. Editing a memo title performs a managed in-root rename without rewriting the document body; a target-name collision fails explicitly and keeps the user's input. A Todo title remains its Markdown task-row text and is edited through a guarded row-range update.

**Rationale**: This preserves current item identity and title conventions while satisfying the independent title-edit interaction. It avoids introducing a second title source in metadata and prevents a title edit from silently changing the description or comments.

**Alternatives considered**:
- Store a separate title field in sidecar metadata: rejected because it would duplicate identity and diverge from the current filename-derived title.
- Rewrite the full Memo body or its first heading on title edit: rejected because the requirement says title editing must not alter the body.
- Silently append a numeric suffix on rename collision: rejected because the resulting displayed title would differ from the user's requested title; fail with an actionable message instead.

### 6. Reuse the existing Markdown editor and validation model

**Decision**: Reuse or extract the existing ProseMirror composer/parser/serializer for create, description edit, and comment edit. Keep the same toolbar order and Markdown semantics across surfaces. Render snapshots/previews through `renderSafeMarkdown`; validate every Webview message as a known, bounded shape and verify the current item identity and revision before writing.

**Rationale**: ProseMirror already handles selection, history, Markdown parsing/serialization, and task syntax; `chatView.ts` and `editor.ts` already demonstrate revision and source-span checks. Reuse avoids introducing a second input engine with different IME or undo behavior.

**Alternatives considered**:
- A plain textarea with a delayed preview: rejected because the requirement demands same-surface live formatting and preservation of selection/IME behavior.
- A new editor dependency or a custom HTML/Markdown parser: rejected because existing dependencies and security-aware rendering are sufficient.

### 7. Keep drafts recoverable but noncanonical

**Decision**: Extend the existing DraftStore/DraftManager pattern for new/editing memo title, description, labels, and comments as needed. Drafts remain recoverable UI state; successful canonical saves clear only the matching draft, and a failed/conflicted save retains it.

**Rationale**: Todo drafts already support recovery independent of document persistence. Reusing this separation supports the required retry behavior without putting unsaved data into the Markdown canonical model.

**Alternatives considered**:
- Keep all edits only in Webview memory: rejected because hiding the view or a save failure could silently lose input.
- Treat the draft store as the canonical issue database: rejected because it would diverge from Markdown and existing file edits.

## Resolved technical unknowns

- **Canonical store**: Existing managed Markdown, with an append-only-on-first-use Memo extension block and existing Todo extensions.
- **Memo/Todo identity**: Memo URI (filename-derived title); Todo URI plus parsed row identity, current raw text, and document version for mutation checks.
- **Editor**: Existing ProseMirror implementation and markdown-it safe renderer.
- **UI integration**: Existing `SidebarView`, exposed as a memo/Todo view independently of ChatView.
- **Conflict and failure behavior**: Fail explicitly, keep the corresponding draft, and refresh/reconcile only after an operation result; never report a failed update as success.
- **Open questions**: User-facing scope decisions are captured in `spec.md`; implementation choices above follow existing source and constitution, with no unresolved planning blocker.
