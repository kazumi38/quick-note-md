# Data Model: メモ & Todo 管理（サイドバー統合）

## 1. Memo

### Purpose
ノートディレクトリ配下の Markdown ファイルをサイドバーで扱う基本単位。

### Fields
- `uri` (string, required): ワークスペース内の Markdown ファイル URI
- `path` (string, required): ノートディレクトリ相対パス
- `title` (string, required): ファイル名由来の表示名
- `updatedAt` (datetime, required): 最終更新時刻

### Validation Rules
- 拡張子は `.md`（大文字小文字差異を許容）
- `path` は管理対象ディレクトリ配下のみ（親ディレクトリ遡り不可）
- 同名衝突時は保存時に一意名へ解決（FR-004）

## 2. TodoItem

### Purpose
Markdown 行に存在するタスクリスト項目を操作可能なモデルとして表現する。

### Fields
- `uri` (string, required): 所属 Markdown ファイル URI
- `line` (number, required): 0-based 行位置
- `text` (string, required): チェックボックス以降の本文
- `status` (enum, required): `open | done | unknown`（本仕様 001 の必須範囲）
- `marker` (string, required): 元の Markdown 記号（例: `[ ]`, `[x]`）

### Validation Rules
- 標準認識対象: `- [ ]` / `- [x]`（`[X]` も完了として許容）
- 非標準・壊れた行は `unknown` として読み取り専用（FR-025）
- 一意性は `uri + line` で担保（FR-026）

### State Transitions
- `open -> done`: 完了操作（FR-016）
- `done -> open`: 再開操作（FR-017）
- `unknown`: 状態遷移不可、ソース編集のみ

## 3. TodoSourceFile

### Purpose
Todo 行を含む Markdown ファイル。既定作成先と検出対象の両方を扱う。

### Fields
- `uri` (string, required): Markdown ファイル URI
- `isDefaultTarget` (boolean, required): 既定保存先 (`notes/todo.md`) かどうか
- `exists` (boolean, required): 実ファイルの存在状態

### Validation Rules
- 新規 Todo 追加時に既定ファイルが無ければ自動作成（FR-027）
- 削除・移動・権限不足を検知した場合は書き込みせず失敗を返す（FR-021）

## Relationships
- Memo 1 : N TodoItem（同一ファイル内で複数 Todo 行を保持）
- TodoSourceFile 1 : N TodoItem
- Memo と TodoSourceFile は同一実体になり得る（行単位判定のため）
