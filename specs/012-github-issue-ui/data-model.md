# Data Model: GitHub Issue風UI

## 1. Shared Issue Item (view model)

**Purpose**: MemoとTodoを共通の詳細・コメント・ラベルUIに渡す読み取り用モデル。永続エンティティではなく、Markdownからスナップショットごとに構築する。

### Common fields

- `kind` (`memo | todo`, required): 種類別の操作・表示を判定する判別子
- `id` (string, required): 現在のWebviewスナップショット内で項目を識別する不透明ID。保存形式には書き込まない
- `title` (string, required): Memoはファイル名由来、TodoはTodo行由来
- `descriptionMarkdown` (string, required): Memoは末尾Issue wrapperを除いた文書Markdown、TodoはTodo bodyブロックのMarkdown。既存Memoの本文にタイトル見出しがある場合はMarkdown本文として保持する
- `descriptionHtml` (string, required): `renderSafeMarkdown` による安全な表示用HTML
- `labels` (Label[], required): 項目に付く順序付きラベル。未設定は空配列
- `comments` (Comment[], required): 項目に属するコメント。表示・保存ともに古い順
- `readOnly` (boolean, required): 破損マーカー、曖昧な範囲、未知Todo等のため安全に変更できないときtrue
- `warning` (string, optional): 読み取り専用理由とソース編集案内
- `documentVersion` (number, required): スナップショット生成時の文書バージョン。mutation前の再検証に用いる

### Identity

- Memoの一覧上の識別は管理対象URI。タイトル編集はURIを管理対象内で安全にrenameする。古いWebview IDはrename後に無効化し、更新済みスナップショットから新IDを取得する。
- Todoの論理識別は管理対象URIとMarkdown行。変更操作では表示名だけに依存せず、TodoRefの行・元テキスト・文書バージョン・状態を照合する。複数ファイル／同名Todoを混同しない。
- Memo/Todo IDはクライアント入力としてパスや書き込み範囲を指定するために使わず、ホスト側の現在の一覧と照合する。

## 2. Memo

**Purpose**: 既存Markdownメモを、状態を持たないIssue風項目として表示する。

### Fields

- `uri` (VS Code URI, required): 管理対象ディレクトリ内のMarkdownファイル
- `title` (string, required): ファイル名から拡張子を除いた表示名
- `descriptionMarkdown` (string, required): ファイルのMarkdown内容全体から、末尾の有効な `quick-note-md:issue` wrapperのみを除いた文字列
- `labels` (`Label[]`, required): 末尾metadata blockに保存する項目単位ラベル
- `comments` (`Comment[]`, required): 末尾comments blockに保存する項目単位コメント
- `status`: **存在しない**。メモの状態を生成・表示・保存しない

### Validation and operations

- 保存先は既存の管理対象Markdownのみ。`.md` 拡張子と `DocumentStore` のin-root・symbolic-link・writableガードを維持する。
- タイトルは空・不正なファイル名を拒否する。rename先の衝突や外部変更時は失敗し、入力下書きを保持する。
- 既存ファイルにIssue wrapperがなければ、本文・改行を変更せずに読み取る。ラベルまたはコメントの初回保存時に限り、元の末尾改行を維持できる2行区切り付きwrapperを追加する。
- 不完全または複数解釈可能な拡張ブロックは自動修復・置換しない。影響を受ける操作を読み取り専用として警告する。
- 空本文は許可し、タイトルのみのMemoを扱える。

## 3. Todo

**Purpose**: 既存Markdownのタスクリスト行を、既存状態を保ったIssue風項目として表示する。

### Fields

- `uri` (VS Code URI, required): Todo行を含む管理対象Markdown
- `line` (number, required): 0-basedの行位置
- `raw` (string, required): パース時の元行
- `title` (string, required): チェックボックス記号を除いたTodo行テキスト
- `status` (existing `TodoStatus`, required): 既存の `open | done | info | warn | note | skip | unknown` 状態。未知形式は読み取り専用
- `descriptionMarkdown` (string, optional): 既存のTodo body extension block
- `labels` (`Label[]`, required): 既存メタデータのラベル。更新時は同じメタデータにあるdue dateを保持
- `comments` (`Comment[]`, required): 対象Todo直下の既存コメント群
- `readOnly` / `warning`: パーサーが編集安全性を確認できない場合の保護状態と理由

### Validation and operations

- Todoの状態モデル、marker形式、未知形式のreadonly扱いは既存実装のままとする。Memo用状態を追加しない。
- 本文、ラベル、状態、コメントは既存の対象Todoまたは認識済み隣接extension blockだけを更新する。
- コメント内のチェックボックスを独立Todoとして扱わない既存parser規則を維持する。
- タイトル変更はTodo行だけを対象とし、ラベル・状態・本文・コメントを変えない。

## 4. Label

- `name` (string, required): 前後空白を除去した表示名・保存名
- `color` (string, optional): 既存のlabel paletteによる表示色。色はユーザー設定で、ラベル名とは独立

**Rules**: 空または空白のみは拒否し、同じ項目内の同一表記を重複登録しない。大文字・小文字は別名として扱う。編集は対象項目内だけに適用し、他項目の一括renameや通知は行わない。ステータスとの関係を持たない。

## 5. Comment

- `id` (string, required in view model): 現在パースした順序と対象Itemから生成する一時ID。Markdownに新たなIDは永続化しない
- `bodyMarkdown` (string, required): 複数行Markdown本文。空または空白のみでの追加・保存は拒否
- `bodyHtml` (string, required): `renderSafeMarkdown` による安全な表示用HTML
- `ordinal` (integer, required): 0から始まる表示・追記順

**Relationships**: Memo/Todo 1件は0..N件のCommentを持つ。各Commentはちょうど1項目に属し、作成順を保つ。返信・担当者・時刻・メンションは本機能のデータモデルに追加しない。

**Mutation safety**: Comment IDだけを信頼せず、親Itemの現在状態、文書バージョン、対象コメント範囲・既存ソース文字列を照合して編集・削除する。競合時は更新を止め、入力draftを保持する。

## 6. Draft

**Purpose**: Webview内の未確定入力を保存失敗・競合・ビュー再表示から復旧するための一時データ。Markdown本文の正本ではない。

- `itemKey` (string, required): Memo URIまたはTodoの現在の識別子に対応するキー
- `field` (`title | description | labels | comment`, required): 下書き対象
- `commentId` (string, optional): 既存コメント編集時の一時ID。新規コメントdraftでは省略
- `value` (field-specific, required): 文字列、ラベル配列など
- `baseVersion` (number, optional): 編集開始時の文書バージョン
- `state` (`dirty | conflict`, required): 未保存または競合

保存成功後は該当draftだけを消去する。失敗・競合・未保存状態では黙って破棄しない。DraftStoreの容量・識別規則を拡張する場合も、他の項目のdraftを誤って消去しない。

## Relationships

```text
IssueItem (view model)
├── Memo (0 or 1 status; status is absent)
├── Todo (existing status)
├── 0..N Label
├── 0..N ordered Comment
└── 0..N transient Draft (not canonical)
```

正本は既存Markdownであり、Memo/Todo view model、コメントID、編集中のdraftは再解析・再照合される。
