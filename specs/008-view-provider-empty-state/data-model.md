# Data Model: ビュー起動と空状態からの作成

本機能は新しい永続データを導入しない。以下の状態は既存の Markdown 一覧を提示するための実行時 UI 状態である。

## ViewState

| 状態 | 意味 | 表示・操作 |
|------|------|------|
| `loading` | 保存先の一覧を取得中 | TreeView / WebviewView に読み込み中と示す。空状態の作成ボタンは表示しない。 |
| `ready` | 1件以上の対象データを取得済み | 通常の一覧を表示する。 |
| `empty` | 読み込みが成功し対象データが0件 | 対象ビューに対応する新規作成操作を表示する。 |
| `unavailable` | ワークスペースが開かれておらず、保存先を特定できない | ワークスペースを開く案内を表示する。作成操作は表示しない。 |
| `error` | 一覧の取得に失敗した | エラー理由と再試行手段を示す。空状態と作成操作で代替しない。 |

TreeView の空状態判定には `quick-note-md.memosEmpty` と `quick-note-md.todosEmpty` の各 context key を用いる。起動・更新開始時、ワークスペース未選択時、読み込み失敗時は `false` とし、対象一覧の読み込みが成功し0件の場合だけ `true` とする。各キーは独立して更新する。初期表示と更新中は `TreeView.message` に読み込み中の状態を設定し、空状態の welcome content を抑止する。

状態遷移:

```text
activation / refresh -> loading
loading -> ready | empty | unavailable | error
ready | empty | unavailable | error -> loading (refresh)
```

`unavailable` は「空の保存先ディレクトリ（正常な `empty`）」と異なる。`error` はファイル読み込み・設定値などの例外状態である。

## View と provider

| View ID | 種別 | データ | 空状態の操作 |
|---------|------|--------|--------------|
| `quick-note-md.memos` | TreeView | 既存の `MemoNode[]`（管理対象 Markdown 一覧） | `quick-note-md.newMemo` |
| `quick-note-md.todos` | TreeView | 既存の `StatusNode[]`（データのある状態グループのみ） | `quick-note-md.newTodo` |
| `quick-note-md.sidebar` | WebviewView | ファイル一覧、Todo 一覧、既存 draft | `quick-note-md.newMemo` と `quick-note-md.newTodo` |

TreeView の空状態は、一覧取得が成功し0件である時だけ空コンテキストを有効にし、`viewsWelcome` の表示条件で使う。`TreeView.message` は `unavailable` または `error` の案内、および既存一覧の補助状態に利用し、正常空状態ではセットしない。

## 既存の永続エンティティ

### Memo

| 属性 | 説明 |
|------|------|
| URI | 管理対象ディレクトリ内の Markdown ファイル位置 |
| title | ファイル名（`.md` を除く） |
| body | 通常の Markdown 文書 |

作成時は既存のファイル名検証と同名連番規則を使う。ユーザーが入力をキャンセルした場合、ファイルを作成しない。

### Todo

| 属性 | 説明 |
|------|------|
| URI | `notesDirectory` 内の既存 `todo.md` |
| text | 空でない1行テキスト |
| status | 新規作成時は `open` |

既存 `todo.md` がなければ Markdown チェックボックス行を作成し、あれば安全な追記規則を使う。キャンセル時は新しい行・ファイルを作成しない。

## Validation

- 作成ボタン自体はデータを含まず、既存コマンドに処理を委譲する。
- メモ/Todo の内容検証、保存先安全性、連番、キャンセル、書込み失敗時の挙動は既存コマンドと DocumentStore の契約を維持する。
- view state、空状態の context key、ロード結果は永続化しない。
