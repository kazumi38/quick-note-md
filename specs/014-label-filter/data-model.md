# Data Model: Issue 一覧のラベル絞り込み

本機能は既存 Issue データの読み取りに限定し、Markdown保存形式や永続データを変更しない。以下の絞り込み状態は現在のビュー操作中だけの一時状態である。

## 1. Issue Label

**Purpose**: Issueに既に付与されている分類名。Issue metadataのラベル配列から取得する。

| Field | Type | Required | Rules |
|---|---|---:|---|
| `name` | string | Yes | 前後空白を除いた既存値。大小文字を区別する。 |
| `issues` | Issue[] | No | 有効なIssueの0件以上。候補生成時に現在の一覧条件を適用しない。 |

候補は有効なIssue metadataから重複を取り除いて構成する。Issueが持つラベル順やIssue一覧の順序が変わっても候補表示が不必要に揺れないよう、候補順序を安定させる。空白だけの値や破損Issueの原文から候補を作らない。

## 2. Issue List Filter

**Purpose**: 一覧に表示するIssueを決める現在の利用者選択。

| Field | Type | Required | Rules |
|---|---|---:|---|
| `query` | string | Yes | 既存のタイトル・本文検索条件。 |
| `state` | `all \| open \| closed` | Yes | 既存の状態条件。 |
| `label` | string or unset | Yes | 未設定はラベル未指定。設定時は完全一致する1ラベルで絞る。 |

### Matching and lifecycle

- 各Issueは、指定された検索語・状態・ラベルのすべてに一致する場合だけ表示する。
- ラベル比較は前後空白を除いた既存表記に対する完全一致とし、大文字・小文字を区別する。
- ラベルがないIssueはラベル指定時には一致しない。
- 条件はIssueViewの現在の状態として保持する。詳細から一覧へ戻る間は保持し、拡張機能またはビューの新規セッションをまたぐ永続化はしない。
- 絞り込みはIssueの `updatedAt` やMarkdownを変更しない。

## Relationships

```text
Workspace 1 ─── 0..N Issue
Issue 1 ─── 0..N Issue Label
Issue List Filter 1 ─── 0..1 selected Issue Label
```
