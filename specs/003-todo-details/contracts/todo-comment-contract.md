# Contract: Todo Comment Operations

## Scope
この契約は、Todo 1件に対するコメント追加・編集・削除のユーザー操作と、対象の Markdown 変更範囲を定義する。

## Storage Format
- コメント群は対象 Todo の直後に `<!-- quick-note-md:comments -->` と `<!-- quick-note-md:end-comments -->` で囲んで保存する。
- 各コメントは `<!-- quick-note-md:comment -->` と `<!-- quick-note-md:end-comment -->` の間に通常の複数行 Markdown として保存する。
- 各マーカーは必要なリストインデントを除き行頭に単独で置く。マーカーの欠落・重複・順序違反・対象 Todo と分離した記法は読み取り専用として扱う。

## Commands

### `quick-note-md.addTodoComment`
- **Input**: `todo: { filePath, lineNumber, status }`, `commentText: string`
- **Behavior**:
  1. 対象 Todo を再検証し、ファイルと行位置が現在の状態と一致することを確認する
  2. 新しいコメントを対象 Todo のコメント群に追記する
  3. 保存時にタイトル・状態・他の Todo を変更しない
- **Errors**: 対象が存在しない、ファイルが削除済み、読み取り専用、保存失敗

### `quick-note-md.editTodoComment`
- **Input**: `todo: { filePath, lineNumber }`, `commentId: string`, `commentText: string`
- **Behavior**:
  1. 対象コメントの ID と所属 Todo を再確認する
  2. そのコメントだけを更新する
  3. 他のコメントやタイトル・状態の順序を維持する
- **Errors**: コメントが見つからない、対象範囲が曖昧、競合、保存失敗

### `quick-note-md.deleteTodo`
- **Input**: `todo: { filePath, lineNumber }`, `confirm: true`
- **Behavior**:
  1. 削除確認を要求する
  2. 承認時のみ対象 Todo とそのコメント群を除去する
  3. キャンセル時は何も変更しない
- **Errors**: 確認キャンセル、行位置変更、ファイル競合、保存失敗

### `quick-note-md.showSource`
- **Input**: `todo: { filePath, lineNumber }`
- **Behavior**: ターゲットの Markdown を標準のエディタで開き、対象 Todo の位置にカーソルを合わせる
- **Errors**: 対象が存在しない、読み取り専用

## Invariants
- Todo の状態変更とコメント編集は独立した操作とする
- すべての書き込みは対象 Todo とそのコメント群のみを更新する
- コメント一覧は古い順に並ぶ
- コメントの手動並び替えは提供せず、保存順を表示順として維持する
- 自動的に他の Todo を更新しない
- 失敗時は古い内容を上書きせず、ユーザーに再試行を案内する
