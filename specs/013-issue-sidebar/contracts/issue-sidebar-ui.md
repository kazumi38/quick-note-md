# Contract: Issue サイドバー UI

## Surface and navigation

- Issue一覧はQuickNoteMD Activity BarのIssue専用WebviewViewに表示する。画面遷移はWebviewView内で行い、Issue表示・作成・編集のためにEditor/WebviewPanelを開かない。
- 一覧行にはIssue番号、title、Open/Closed、labels、comment countを示す。既定順は更新日時の降順。
- 一覧は検索欄と状態フィルター（すべて/Open/Closed）を持つ。詳細から一覧へ戻っても検索値・フィルターを維持する。
- 一覧からIssueを選ぶと同じビューの詳細へ遷移する。詳細上部に一覧への戻る操作を置く。
- Issue作成は一覧上のパネル状態として同じサイドバー内に表示する。タイトルは必須、本文は任意。キャンセルで保存しない。
- サイドバー幅が狭い場合は一覧・詳細・作成を一列にし、操作ボタンを隠さない。本文は詳細ヘッダー領域内で折り返し表示し、コメントはその下のタイムラインだけに表示する。
- 詳細はtitle、番号、状態、labels、説明本文をヘッダー領域に表示する。コメントは古い順に独立カードとして並べ、本文をコメントに重複表示しない。
- コメント入力、投稿、Markdown本文編集、title編集、state切り替え、label操作はサイドバー内で完了する。

## Accessibility

- すべての操作に日本語のaccessible nameを付け、キーボードのみで移動・実行できる。
- stateや選択状況を色だけで示さず、文字またはアイコンの意味名を併記する。
- 空一覧、検索結果なし、読み込み中、読み込み失敗、保存失敗、競合状態を別の状態として表示する。
- WebviewのMarkdown表示は安全なレンダリングを用い、script実行・外部画像の自動取得をしない。

## Webview -> extension host messages

メッセージはdiscriminated unionで検証し、未知フィールドや不正ID、過大入力、古いrevisionは保存処理へ渡さない。ファイルURIや編集範囲はWebviewから指定させない。

| Kind | Payload | Effect |
|---|---|---|
| `ready`, `refresh` | none | 現在のIssue一覧・選択状態を再取得する。 |
| `selectIssue` | `issueId`, `snapshotRevision` | hostの現在の一覧にあるIssueだけを詳細表示する。 |
| `startCreate` | none | 新規Issue用draftを開く。 |
| `draftChanged` | `draftId`, `revision`, `field`, `value`, optional `issueId`, optional `commentId` | hostのdraft storeへ未保存入力を反映する。 |
| `createIssue` | `operationId`, `draftId`, `revision`, `title`, `bodyMarkdown` | 検証後に一つのIssueを排他的に作成する。 |
| `saveField` | `operationId`, `issueId`, `field`, `value`, `baseRevision`, optional `commentId` | title/body/labels/comment/stateの単一変更を検証・保存する。 |
| `cancelDraft` | `draftId`, `revision` | draftを明示的にキャンセルする。 |
| `setFilter` | `query`, `stateFilter` | 一覧条件を更新する。 |

## Extension host -> Webview messages

| Kind | Payload | Effect |
|---|---|---|
| `snapshot` | `revision`, `state`, `issues`, optional `selectedIssueId`, optional `draft`, optional `error` | 一覧・詳細・draft状態を表示する。 |
| `operationResult` | `operationId`, `ok`, optional `issueId`, optional `field`, optional `errorCode`, optional `message` | 操作の確定結果を伝える。保存完了前に成功を返さない。 |
| `preview` | `draftId`, `revision`, `sourceMarkdown`, `safeHtml` | 現在のdraftのMarkdown表示を更新する。 |

古いsnapshotや非同期応答は新しいrevision/draftを上書きしない。失敗または競合時はdraftを保持する。
