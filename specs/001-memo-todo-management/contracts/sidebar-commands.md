# Contract: Sidebar Commands

## Scope
Primary Sidebar から実行されるコマンドの入力/出力契約。

## Commands

### `quick-note-md.newMemo`
- **Input**: `title: string`（空文字不可）
- **Behavior**:
  1. 安全なファイル名に変換
  2. `notesDirectory` 配下へ `.md` 新規作成（衝突時は一意化）
  3. 作成したファイルを開く
- **Errors**: 空タイトル、無効文字のみ、作成失敗

### `quick-note-md.appendMemo`
- **Input**: `uri: Uri`, `text: string`（改行なし1行）
- **Behavior**: 対象末尾に新規1行として追記し、既存本文を変更しない
- **Errors**: 非管理対象 URI、読み取り専用、ファイル不在、保存失敗

### `quick-note-md.newTodo`
- **Input**: `text: string`（改行なし1行）
- **Behavior**: 既定 Todo ファイルへ `- [ ] text` を1行追加（無ければ作成）
- **Errors**: 入力不正、ファイル作成/書き込み失敗

### `quick-note-md.completeTodo` / `quick-note-md.reopenTodo`
- **Input**: `todo: { uri, line, status }`
- **Behavior**: 対象行のチェック記号のみを書き換える
- **Errors**: 行不一致、unknown 状態、ファイル不在、競合

### `quick-note-md.deleteTodo`
- **Input**: `todo: { uri, line }`, `confirm: true`
- **Behavior**: 確認後、対象1行のみ削除
- **Errors**: 確認キャンセル、行不一致、権限/保存失敗

### `quick-note-md.showSource`
- **Input**: `uri: Uri`, `line?: number`
- **Behavior**: 標準 Markdown エディタで開き、line があればカーソル移動

## Invariants
- すべての書き込みは対象 Markdown ファイルのみ変更する
- 失敗時に部分更新を残さない
- エラーはユーザーが理解可能な文言で通知する
