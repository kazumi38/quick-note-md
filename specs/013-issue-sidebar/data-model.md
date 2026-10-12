# Data Model: Issue サイドバー

Issueごとに`issue-<id>.md`を一つ持つ。ファイル先頭の非表示HTML markerにmetadataを格納し、通常Markdownの説明とコメントを同ファイル内に順に保存する。旧Memo/Todo/Chat parserやmarkerは読み込まない。Draftと採番情報は別の補助データである。

## 1. Issue

**Purpose**: ローカルで追跡する一件の課題。単一のMarkdownファイルにmetadata、説明、コメントを保持する。

| Field | Type | Required | Rules |
|---|---|---:|---|
| `id` | positive integer | Yes | workspace内で一意。削除後も番号を再利用しない。 |
| `title` | string | Yes | 前後の空白を除去した後に空でないこと。 |
| `state` | `open \| closed` | Yes | 初期値は`open`。`open ↔ closed`の切り替えを許可。 |
| `labels` | ordered string array | Yes | 初期値は空。各名称の前後空白を除去し、空文字・同一項目内の完全一致重複を拒否。 |
| `bodyMarkdown` | string | Yes | 任意内容。空文字も有効。コメント履歴とは独立して表示・編集する。 |
| `createdAt` | RFC 3339 timestamp | Yes | 作成時に設定し、以降変更しない。 |
| `updatedAt` | RFC 3339 timestamp | Yes | Issueのtitle/body/state/labels/commentを変更したとき更新する。 |
| `comments` | ordered `Comment[]` | Yes | 初期値は空。Issue本文をコメントとして重複登録しない。 |
| `revision` | non-negative integer | View only | Webview snapshotの変更競合検出用。Markdownへ必須保存しない。 |

### Identity and filename

- canonical identityはIssueの正の整数`id`。
- ファイル名はID由来（例: `issue-000027.md`）で、title編集では変更しない。IDはファイル名と先頭marker内のIDが一致しなければならない。
- 先頭markerにschema version、ID、title/state/labels/timestampsを保存する。独立した`.meta` sidecarは作成しない。
- Issue説明はmetadata markerの後、コメント領域markerの前に保存する。コメントは非表示HTML comment markerで囲み、順序・ID・createdAtをコメント開始markerに保持する。Markdown表示に区切り見出しやIDを出さない。
- 一覧は`updatedAt`の降順に表示し、同時刻は`id`降順で安定化する。
- 番号の次値はIssue領域内のMarkdown sequence ledgerに保持し、欠落・巻き戻り時には既存ID最大値より小さい値を採用しない。
- metadataまたはcomment markerが不完全・不正なら推測で上書きせず、復旧不能時も元Markdownを保持し、該当Issueを読み取り専用として通知する。

### State transitions

```text
open <-> closed
```

コメント・label・本文編集によってstateを暗黙変更しない。

## 2. Comment

| Field | Type | Required | Rules |
|---|---|---:|---|
| `id` | unique opaque string | Yes | 親Issue内で一意。外部から提供されたIDを信用しない。 |
| `bodyMarkdown` | string | Yes | 複数行Markdown。投稿時に前後空白を評価し、空白だけなら拒否。 |
| `createdAt` | RFC 3339 timestamp | Yes | 投稿時に設定し、表示順は古い順。 |

各コメントはちょうど1つのIssueに属する。作者、返信、メンション、リアクションは本機能の対象外。

## 3. Label

- LabelはIssueに所属する文字列名であり、Issue stateとは独立。
- 前後空白を除去した空でない値を保存する。
- 同じIssue内の同一文字列重複を拒否する。異なる大小文字は異なる値として扱う。
- 色は表示上の派生値であり、Issueの分類・検索・stateを決定しない。

## 4. Draft

**Purpose**: 保存前の入力を、操作失敗・競合・Webview非表示から復旧するための一時データ。

| Field | Type | Required | Rules |
|---|---|---:|---|
| `draftId` | opaque string | Yes | Draftごとに一意。 |
| `issueId` | positive integer or absent | Yes | absentは新規作成Draft。 |
| `field` | `title \| body \| labels \| comment \| state` | Yes | 対象フィールド。 |
| `commentId` | opaque string or absent | No | 既存コメント編集時に指定。 |
| `value` | field-specific | Yes | 未保存の入力。 |
| `baseRevision` | non-negative integer | Yes | 編集開始時のIssue snapshot revision。 |
| `status` | `dirty \| conflict` | Yes | 未保存または競合状態。 |

保存成功時のみ該当Draftを消去する。失敗・競合時は内容を保持する。DraftはIssue正本ではない。Draft保存先はworkspace URIのSHA-256ごとに分離し、別workspaceの入力を誤表示しない。

## 5. Sequence ledger

- Issue領域内の`.sequence.md`は、次に割り当てる正整数を保持するMarkdown補助ファイル。
- Issueレコードとは分離し、一覧には表示しない。
- 更新は排他作成・version照合で競合を検知する。破損時に推測で既存IDを再利用しない。Issue IDを走査し、最大既存IDの次以上へ修復可能な場合だけ継続する。修復できない場合はIssue作成を停止し、理由を通知する。

## Relationships

```text
Issue 1 ─── 0..N Comment
Issue 1 ─── 0..N Label
Issue 1 ─── 0..N transient Draft
Workspace 1 ─── 0..N Issue
```
