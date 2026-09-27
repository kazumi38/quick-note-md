# Contract: ビュー起動、空状態、作成操作

## View と登録

| Manifest view ID | Provider registration | 初回表示時の責務 |
|------------------|-----------------------|------------------|
| `quick-note-md.sidebar` | `vscode.window.registerWebviewViewProvider` | 拡張機能起動後、非同期一覧取得の前に provider を登録する。 |
| `quick-note-md.memos` | `vscode.window.createTreeView` + `MemoProvider` | root children が空の時、正常な empty context に限って新規メモの welcome action を出す。 |
| `quick-note-md.todos` | `vscode.window.createTreeView` + `TodoProvider` | Todo が0件なら root children を空にし、正常な empty context に限って新規 Todo の welcome action を出す。 |

View ID は manifest、activation events、provider 登録で完全一致しなければならない。TreeView / WebviewView provider の登録は `activate` の同期的な初期化経路で行い、一覧読み込みの成否や完了を登録条件にしない。

## TreeView empty content

- `quick-note-md.memos` の正常な0件状態は、`viewsWelcome` から `quick-note-md.newMemo` を実行できる。
- `quick-note-md.todos` の正常な0件状態は、`viewsWelcome` から `quick-note-md.newTodo` を実行できる。
- `quick-note-md.memosEmpty` と `quick-note-md.todosEmpty` を別々に管理する。各 context は一覧取得が成功し0件と判明した後だけ有効にし、初期ロード中、ワークスペースなし、読み込み失敗では無効にする。
- provider 初期化時と更新中は各 TreeView に読み込み中の `message` を設定し、一覧取得完了後に状態に対応した message へ置き換える。正常な空状態では context を有効にしてから message を消し、welcome action を表示する。
- welcome 表示中は `TreeView.message` を空にする。VS Code は `TreeView.message` が設定された TreeView を空と判定せず、welcome content も表示しない。
- Todo provider は空の状態グループを root children として返さない。
- ワークスペースなしまたは一覧エラーでは、作成ボタン付き empty state を表示せず、`TreeView.message` で理由を表示する。
- メモ一覧と Todo 一覧の更新・エラー状態は個別に扱う。一方の取得に失敗しても、他方の正常なデータや空状態を消さない。

## Unified WebviewView

Webview は一覧の状態として `loading` / `ready` / `empty` / `unavailable` / `error` を受け取る。

| State | UI contract |
|-------|-------------|
| `loading` | 読み込み中を明示し、新規作成操作をまだ表示しない。 |
| `ready` | ファイル/Todo データを表示する。 |
| `empty` | 「新規メモ」「新規 Todo」の意味が分かるボタンを両方表示する。 |
| `unavailable` | ワークスペースを開く必要があることを表示し、作成操作を表示しない。 |
| `error` | 一覧取得失敗の理由と「一覧を更新」操作を表示し、正常空状態として扱わない。 |

Webview は作成要求として `{ "kind": "newMemo" }` または `{ "kind": "newTodo" }`、再試行要求として `{ "kind": "refresh" }` を送る。ホストは既存の `quick-note-md.newMemo` / `quick-note-md.newTodo` / `quick-note-md.refresh` コマンドを実行し、Webview からの入力値や URI を保存先として受け付けない。キャンセル・入力検証・保存エラーは既存コマンドの結果に従い、状態を再取得する。ボタンはキーボードフォーカス可能で、日本語の accessible name を持つ。

## Shared create command behavior

| Command | Result |
|---------|--------|
| `quick-note-md.newMemo` | 入力されたタイトルで管理対象 Markdown を作成する。同名なら既存規則に従う。キャンセル時は作成しない。 |
| `quick-note-md.newTodo` | 既存 `todo.md` に Todo を追記し、なければ作成する。入力をキャンセルした時は作成しない。 |

いずれの経路からでも同じ既存コマンドを使い、空状態専用の書き込み処理を設けない。
