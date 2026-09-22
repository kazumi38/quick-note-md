# Data Model: Todo コメント機能

## Overview
本機能では、既存の Markdown ベース Todo を維持しつつ、各 Todo に対して Markdown コメント群を紐付ける。保存処理は従来の `.md` 文書に戻り、拡張機能が読み取れる記法を常に実ファイルの中に残す。

## Persistence Boundary

- **正本**: Todo とコメントの保存先は、既存のワークスペース内 Markdown ファイルだけとする。
- **内部表現**: 実装中は下記エンティティを TypeScript の型付きオブジェクトとして保持する。形状は JSON 互換（文字列、数値、真偽値、配列、オブジェクト）に制限し、解析・編集・検証を簡潔にする。
- **JSONファイル**: TodoやコメントのJSONファイル、キャッシュ、別データベースは作成しない。再起動時は必ずMarkdownから内部モデルを再構築する。
- **書き戻し**: Markdownパーサーが内部モデルを元の文書範囲へ反映する。内部モデルのフィールド名や一時的なIDをMarkdownへ自動出力することは、保存形式として必要な場合を除き行わない。
- **同期**: Markdownの外部変更、削除、移動、競合を検知した場合は内部モデルを破棄または再構築し、古い内部モデルから書き戻さない。

## Entities

### TodoEntry
- **Purpose**: 1件の作業項目。タイトルと状態を持ち、同名の他項目と区別される。
- **Fields**:
  - `id: { filePath, lineNumber, originalText }`
  - `title: string`（必須）
  - `status: TodoStatus`
  - `filePath: string`
  - `sourceLine: number`
  - `commentIds: string[]`
  - `rawMarkdown: string`
- **Rules**:
  - 同一ファイル内・同一タイトルであっても、行位置で識別する。
  - 担当者属性は持たない。
  - コメント追加・編集時にタイトルや状態を自動変更しない。

### TodoComment
- **Purpose**: 1件の Todo に紐付くメモ・調査結果・対応方針の記録。
- **Fields**:
  - `id: string`（Todo 内で一意）
  - `todoId: TodoEntry.id`
  - `order: number`（作成順）
  - `bodyMarkdown: string`（複数行 Markdown）
  - `createdAt: ISO string`（任意、保存時の記録）
  - `updatedAt: ISO string`（任意、保存時の記録）
- **Rules**:
  - 0 件以上を持てる。
  - 返信スレッドや相互参照の再構成を行わない。
  - バージョン差分はコメント単位で保持する。
  - `id` は実装中の識別に使う値であり、JSONや別ファイルへ永続化しない。Markdown上で安定した識別が必要な場合は、保存フォーマットの明示的な境界とソース範囲を優先する。

### TodoCommentSet
- **Purpose**: 1件の Todo に対するコメント群の集合。
- **Fields**:
  - `todoId: TodoEntry.id`
  - `comments: TodoComment[]`（古い順に整列）
  - `sourceText: string`（元の Markdown）
- **Rules**:
  - 追加時は末尾に追記し、既存順序を維持する。
  - 更新時は対象コメントのみ置換し、他のコメントを再整列しない。

### DraftInput
- **Purpose**: ユーザーが未保存で編集しているコメント内容。
- **Fields**:
  - `todoId: TodoEntry.id`
  - `commentId?: string`
  - `text: string`
  - `mode: 'new' | 'edit'`
  - `dirty: boolean`
  - `lastSavedVersion: number`
- **Rules**:
  - 保存前に外部変更があれば拒否し、入力は退避可能にする。
  - 保存が失敗した場合は未保存のまま保持する。

### TodoStatus
- **Values**: `todo`, `done`, `note`, `skip`, `warn`, `imp`
- **Status mapping**:
  - `todo`: 未完了
  - `done`: 完了
  - `note`: 参考記録
  - `skip`: 対応しない
  - `warn`: 注意が必要
  - `imp`: 重要な未解決
- **Rules**:
  - 既存の 6 状態表示を維持する。
  - コメント追加・編集は状態変更を伴わない。

## Relationships
- 1つの `TodoEntry` は 0..n の `TodoComment` を持つ。
- `TodoCommentSet` は `TodoEntry` に対して 1 対 1 であり、コメント本文は同一ファイルの Markdown 内で読み込み・保存される。
- `DraftInput` は `TodoEntry` と `TodoComment` の編集前状態を表し、保存完了後は破棄される。

## Validation Rules
- `TodoEntry.title` は空文字であってはならない。
- `TodoComment.bodyMarkdown` は空文字でもよいが、通常は少なくとも 1 行以上の Markdown を持つ。
- `TodoComment.order` は `TodoCommentSet.comments` 内で昇順に並ぶ必要がある。
- `TodoCommentSet` のコメント順は「古い → 新しい」を基本とし、MVP では手動並び替えをサポートしない。
- 既存内容を保持するため、編集・保存時に対象範囲以外の本文を変更しない。
- コメント境界が曖昧な場合は保存せず、読み取り専用メッセージを表示する。

## Serialization Pattern
- 保存形式は通常の Markdown のまま保持し、コメント群は対象 Todo の直後に置く。
- コメント群の確定記法は次のとおりとする:
  - 開始境界: `<!-- quick-note-md:comments -->`
  - コメント境界: `<!-- quick-note-md:comment -->`
  - コメント終了境界: `<!-- quick-note-md:end-comment -->`
  - コメント群終了境界: `<!-- quick-note-md:end-comments -->`
  - 各マーカーは、Todo の子ブロックとして必要なインデントを除き、行頭に単独で置く。コメント本文は開始・終了境界の間に通常の複数行 Markdown として置く。
  - コメント群は対象 Todo の直後から次の Todo または親ブロックの終了までに置き、別の Todo や通常本文の後ろへ暗黙に所属させない。
  - マーカーの欠落、重複、順序違反、対象 Todo と結び付かない位置にある記法は曖昧なコメント境界として読み取り専用で扱い、保存時に拒否する。
  - 既存のタイトルのみ Todo にはマーカーを追加せず、最初のコメント追加時に対象範囲へコメント群を挿入する。
- この記法は以下を満たす:
  - ユーザーが通常の Markdown で読める
  - 既存の Todo 行とコメント本文を区別できる
  - 拡張機能なしで編集しても、コメント境界が理解しやすい
  - 既存のファイルの順序や対象外の行を変更しない
- 破損や未知の記法は「認識できない Todo」として扱い、元のテキストを破棄しない。
- JSONは保存形式ではなく、Markdownから生成される内部モデルの表現に限る。JSONへ変換した値を正本としてMarkdownを再生成する設計にはしない。

## State Transitions
- `TodoEntry` は任意の `TodoStatus` から同じ状態のままコメント編集を行える。
- `TodoStatus` 切替は別コマンドとし、コメント保存時に自動で状態を戻さない。
- `TodoComment` は `draft -> saved -> edited -> saved` のように連続して保存される。

## Data Safety Invariants
- コメントの保存は対象 Todo とそのコメント群に対してのみ適用する。
- `filePath` が変わったとき、行位置が移動したとき、ファイルが削除されたときは更新を中止する。
- 競合時は他の未保存編集を破棄せず、ユーザーが手動で回避できるようにする。
