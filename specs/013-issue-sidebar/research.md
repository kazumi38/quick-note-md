# Research: Issue サイドバー

## Repository findings

- `package.json` はTypeScript 6、VS Code `^1.138.0`、Webpack、`markdown-it`、ProseMirror一式、Mocha/VS Codeテスト、Playwright E2Eをすでに使用する。新規ランタイム依存は不要。
- 現在のQuickNoteMD Activity Barには`quick-note-md.chat` WebviewViewがあり、旧Memo/Todo UIは`SidebarView`のWebviewPanelで開かれる。要件はエディター領域ではなくサイドバー完結のため、実装先はActivity Bar内の新しいIssue専用WebviewViewとする。
- 旧メモ、Todo、チャットのMarkdownファイルは`quick-note-md.notesDirectory`（既定値 `notes`）配下に共存する。`ChatView`はこの同じ`DocumentStore.list()`からチャットを探索する。したがって旧領域の削除はチャット履歴にも影響する。ユーザーはこれを理解した上で、チャット機能と履歴も削除してIssueだけにすることを選択した。
- チャットdraftは`context.globalStorageUri/chat-drafts`、旧Issue風Todo/メモdraftは`context.globalStorageUri/sidebar-drafts`に保存される。削除はそれらの専用サブフォルダーだけを対象とし、拡張機能global storage全体を削除しない。
- `src/webview/issueComposer.ts`はProseMirror Markdown composerのツールバー統合、選択維持、Undo/Redoをすでに実装し、`media/issue.css`はGitHub風スタイルを含む。これらは旧データモデルに依存しない表示・編集部品として再利用できる。`renderSafeMarkdown`も安全な表示用に再利用する。
- `DocumentStore`はTodo/Memo/Chat固有のパーサーと操作が混在する。新Issueの読み書きに流用せず、既存のin-root、symlink、dirty-document、外部更新検出といった安全性要件を新しいIssueStoreで独立して満たす。

## Decisions

### 1. Issue画面はVS CodeサイドバーのWebviewViewに置く

**Decision**: QuickNoteMD Activity Bar内にIssue専用WebviewViewを登録し、一覧・詳細・作成・コメントを同じビュー内で切り替える。エディター領域の`WebviewPanel`やMarkdownエディターはIssue操作に使わない。

**Rationale**: ユーザーの明示要件は拡張機能のサイドバーだけで完結することである。以前のFeature 012計画のWebviewPanel案ではこの要件を満たさない。

**Alternatives considered**:
- Editor-area WebviewPanel: 利用可能幅は広いが、ユーザーが避けたいエディター領域に表示されるため不採用。
- 既存ChatViewをIssue UIに改造: 旧チャット機能とデータを廃止し、新規Issueだけにする決定に反する。Issue専用ビューを作る。

### 2. Issue保存を旧Memo/Todo/Chatモデルから分離する

**Decision**: Issue専用の`IssueStore`とパーサーを新設する。IssueのMarkdownファイルはワークスペース内の`.quick-note-md/issues`に置き、旧`notesDirectory`と分ける。パスが重なる設定では旧データを削除せず、移行をエラーとして止める。

**Rationale**: 新しい機能を旧データモデルへ継ぎ足さず、削除処理が新Issueを巻き込まないことを明確にする。Markdownファイルは外部から閲覧・編集できる。

**Alternatives considered**:
- `DocumentStore`をIssue storeに作り替える: Todo、Memo、Chat形式への結合を持ち込み、旧機能の残存を招く。
- Issue本文をVS Code global storageに保存: 拡張機能なしで利用しにくく、Markdown Firstと可搬性を損なう。
- Issueも旧`notesDirectory`に保存: 初回の旧保存先全消去時に新Issueを誤削除する危険がある。

### 3. Issue metadataとコメントを単一Markdownファイルに保存する

**Decision**: 1 Issueを`issue-<id>.md`の単一ファイルに保存する。先頭の非表示HTML comment markerにtitle/state/labels/日時/ID/versionを、後続の非表示HTML comment markerにコメントIDと投稿日時・境界を保存する。Issue説明とコメント本文は同じMarkdownファイル内に順に格納する。`.meta` sidecarは作成しない。

**Rationale**: Issueは一つのファイルだけで持ち運び・バックアップできる。Issue metadataおよびコメント境界はHTML commentで不可視にし、通常のMarkdownレンダリングでは構造情報を露出させない。アプリは明示markerを使ってIssue説明とコメントを確実に分割表示する。書き込みは一時ファイルに完全生成・再parseした後に置換し、途中編集された構造を有効データとして採用しない。

**Alternatives considered**:
- `.meta` sidecar: Issueが複数ファイルになり、コメントをIssue本文に含めたいという決定にも合わないため不採用。
- コメント本文を個別Markdownファイルにする: ファイル数と管理単位が増えるため不採用。
- 既存Todo/Memo markerを使う: 旧機能との形式依存を残すため不採用。

**Format safeguards**: schema version/型/ID整合性、コメントmarkerの重複・欠損・順序を検証する。無効なmarkerや不正JSONは推測で修正せず、原文を保護してIssueをreadonlyにする。一時ファイルを完全に書いてparse検証した後にcanonical fileへ置換する。

### 4. 連番を再利用せず、安全にIssueを新規作成する

**Decision**: Issue IDは正の整数とし、Issue専用領域内の再生成可能な`.sequence.md`に次の採番値を保持する。作成時は既存Issue IDとの衝突を検証し、番号由来の`.md`ファイルを排他的に作成する。title編集ではファイル名を変更しない。

**Rationale**: GitHub風の一覧で短い`#N`番号を使え、削除済みIssueの番号も再利用しない。本文タイトルの変更でIssueのidentityやリンクが変わらない。

**Alternatives considered**:
- ファイル数だけから採番: 削除したIssueのIDを再利用する可能性がある。
- タイトルをファイル名にする: タイトル編集をrenameに結び付け、衝突・外部リンク更新を増やす。
- UUIDを番号として表示: 一覧の読みやすさとIssue風の番号表現を損なう。

### 5. 初回の旧データ削除は明示的な一回限り移行として実行する

**Decision**: workspaceごとに移行完了状態を保存し、Issueストアを初期化する前に旧`notesDirectory`全体と旧チャット／Sidebar draftの専用ディレクトリを無確認で削除する。再実行は安全にし、Issue storeとのパスの交差を必ず検査する。削除失敗を報告し、Issueの作成・更新へ移らない。ユーザーは旧データとチャット履歴も削除することを承認済み。

**Rationale**: 「Todo・メモ・チャットをなくしIssueだけにする」という確定スコープを一度だけ適用し、起動ごとに後から作られたファイルを削除し続けない。

**Alternatives considered**:
- 毎回旧ディレクトリを空にする: 初回移行後に追加されたファイルまで削除する。
- 古い拡張機能領域を丸ごと削除: Issue draftや無関係な拡張状態を巻き込む危険がある。
- 削除確認ダイアログ: 利用者がまだいないため不要とのユーザー決定に反する。

### 6. 汎用Markdown編集・表示部品だけを再利用する

**Decision**: `issueComposer.ts`/ProseMirrorと`renderSafeMarkdown`を再利用し、旧Memo/Todo/Chat parser、store、UI stateは使わない。Webview messageは判別可能な有限payloadとし、host側でexact shape、長さ、Issue ID、revisionを検証する。

**Rationale**: IME、選択範囲、Undo/Redo、安全なMarkdown表示を再実装せず、旧機能のドメイン依存を避ける。

**Alternatives considered**:
- `textarea`とPreview切替: 同じ編集面のMarkdown編集要求と書式操作の一貫性を満たさない。
- 既存`SidebarView`をデータだけ置き換える: メッセージ型、draft、parser、UI状態が旧Memo/Todo機能に結合している。

## Resolved technical unknowns

- Target surface: VS Code Activity BarのサイドバーWebviewView。
- Runtime and test stack: 既存TypeScript、VS Code API、Mocha/VS Code tests、Playwright。
- Canonical issue data: Issueごとの単一Markdownファイル（不可視metadata marker、説明、不可視comment markerとコメント本文）。
- Legacy deletion scope: 旧notesDirectory全体、旧chat-draftsとsidebar-drafts。チャット履歴も削除するユーザー判断を記録済み。
- Markdown editor and renderer: 既存ProseMirror composer wrapperと`renderSafeMarkdown`。
- Conflict behavior: version/sourceの変更を検出したら上書きせず、draftを保持して通知。
- Remaining open planning blockers: なし。専用保存先との旧領域のパス重複は実行時に検出し、削除前に停止する。
