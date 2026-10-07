# UI Contract: Issue風メモ・Todo詳細

## Surface and navigation

- 機能はエディター領域の `WebviewPanel` として公開し、Issue詳細・コメント・作成サイドパネルに十分な横幅を確保する。既存ChatViewは維持する。
- 一覧でMemoまたはTodoを選ぶと、同じビュー内に項目のIssue風詳細を表示する。Webviewから送るのは現在のスナップショットに存在する不透明IDと操作値に限る。パス・ファイル範囲をWebviewに決定させない。
- 新規作成はポップアップではなく、現在の一覧／詳細を保つ作成サイドパネルで行う。十分な幅がある場合は横パネル、狭い場合は同じ画面内の全幅パネルへ切り替える。
- 作成パネルはMemo/Todo種別、タイトル、説明、作成、キャンセルを明示する。既存の種別固有作成規則を呼び出し、保存完了まで一覧上の正本として表示しない。
- 閉じる、キャンセル、別項目への切替でdirty draftを黙って破棄しない。下書きを保持するか、破棄を明示確認する。

## Detail presentation

- 見た目の正本は `mock/index.html` とする。背景 `#0d1117`、カード・ツールバー `#161b22`、境界 `#30363d`、通常ボタン `#21262d`、確定ボタン `#238636`、6〜8pxの角丸とモックの余白を `media/issue.css` に実装する。Chat用のグローバルCSSをIssue画面へ読み込まない。
- 説明・コメントカードは32pxの円形アイコンと42pxの左余白を持つタイムラインに並べる。アイコンは項目種別を表し、存在しない作成者・時刻・履歴は表示しない。書式ボタンはモック同様のコンパクトな記号表示にし、日本語のアクセシブルな名前を維持する。
- 作成中はモック同様に詳細と横パネルをグリッドで並べ、暗いオーバーレイで詳細を覆わない。700px以下では全幅の作成画面へ切り替える。

- タイトル、説明、コメント履歴、ラベルを区別する。Memoのステータス操作は存在しない。Todoの既存ステータスはラベルの横に表示し、既存の状態変更のみ提供する。
- コメントは古い順に表示し、各コメントと説明本文は独立カードとして扱う。コメントなしの項目では空の履歴と追加操作を表示する。
- タイトル横に項目メニューを置き、「タイトルを編集」を提供する。説明カードと各コメントカードの右上にも独立した `…` メニューを置き、対象カード内編集を提供する。
- ラベルはTodoでは状態の横に、Memoでは状態表示なしで表示する。ラベル領域の `…` は項目メニューと別にし、追加・名前変更・取り外し・適用・キャンセルを提供する。
- メニュー、ツールバー、入力欄、保存状態、readonly理由は日本語のアクセシブルな名前を持つ。意味や状態を色だけで伝えず、Tab/Shift+Tab、Enter/Space、Escape、および適切な編集ショートカットを利用可能にする。
- 通知、プロジェクト、担当者、GitHub同期、メンション、Issue参照、共有機能は表示しない。

## Markdown editor contract

- 作成説明、新規コメント、説明編集、既存コメント編集には同一機能・順序のProseMirror Markdown編集面を用いる。入力の変更は同じ編集面に即時整形表示され、別のPreview操作を必要としない。
- 共通ツールバーの順序は、`見出し・太字・斜体・引用・コード・リンク`、区切り、`箇条書き・番号付きリスト・チェックリスト`、区切り、`元に戻す`。キーボード名・ツールチップを提供する。見出しはH1〜H6を選択できる。RedoはエディターのUndo履歴と既存のキーボード操作で利用可能にする。
- 選択範囲があれば書式操作は選択範囲を保持・装飾し、なければ入力可能なMarkdownひな形を挿入して選択位置を適切に移動する。複数行書式は各行へ適用する。
- IME composition中は自動整形やメッセージ処理によってcomposition文字列・selectionを失わない。Undo/Redoは通常入力と書式操作を扱う。
- Markdownは既存serializerで保存し、表示HTMLは `renderSafeMarkdown` を用いる。外部スクリプトを実行せず、リモート画像を自動取得しない。
- サーバー／extension hostで保存が確定していない入力はdraftとして表示し、保存失敗時も再試行・コピー可能な状態で保持する。

## Webview message contract

すべてのメッセージはJSON互換の有限サイズpayloadとし、ホスト側で判別子、必須／許可フィールド、文字列長、配列要素、ID、バージョン、現在の選択Itemを検証する。未知の形・未知の操作は無視または明示的な拒否とし、書き込みを行わない。

### Webview -> extension host

| Kind | Required payload | Effect |
|---|---|---|
| `ready` / `refresh` | なし | 現在の一覧とdraftを再取得 |
| `create` | `itemKind`, `title`, `descriptionMarkdown`, request ID | 種別固有の作成ルールで新しいMarkdown itemを作成 |
| `selectItem` | `itemId` | 現在スナップショットのItemを選択 |
| `draftField` | `itemId`, `field`, `value`, `baseVersion` | title/description/labels/commentの未確定draftを保存 |
| `saveField` | 同上。comment編集時は`commentId` | ホストで再解析・再検証して対象範囲を更新 |
| `cancelField` | `itemId`, `field`, optional `commentId` | 明示的なキャンセルを処理し、draftの破棄／保持を規則に従い行う |
| `setStatus` | Todo `itemId`, 既存status値 | Todoの既存状態のみ更新 |
| `deleteComment` | `itemId`, `commentId`, `baseVersion` | 対象コメントだけを確認付きで削除 |

Webviewから任意のURI、行範囲、offset、Markdown保存先を受け取らない。Todo statusを含まないMemo操作をstatus更新へ変換しない。

### Extension host -> Webview

| Kind | Required payload | Effect |
|---|---|---|
| `snapshot` | request/revision, state, items, selected ID, label palette, draft state | 一覧・詳細を置換または現在revisionに反映 |
| `operationResult` | request ID, success, affected ID/field, optional error | 成功・失敗を明確にし、失敗時の入力保持・再試行を示す |
| `preview` | item ID, field/comment ID, source text, safe rendered HTML, revision | 未保存Markdownの同じ編集面に対する表示更新 |

非同期応答はrevision/request IDと照合し、古い応答で新しいdraftや選択を上書きしない。保存成功はDocumentStoreの完了後にのみ通知する。保存失敗・競合・readonly時は明確なエラーを返し、該当draftを維持する。

## Failure behavior

- 空タイトル、無効なファイル名、空コメント、重複ラベル、未知Item、削除済みファイル、readonlyファイル、壊れたmarker、古いversionは書き込む前に検出し、理由と次の操作を提示する。
- 同じ対象の外部変更または未保存変更を検出した場合、古いsourceで上書きせず、最新状態の再読込／再試行を促す。入力draftは成功確認前に削除しない。
- ファイルrename衝突は既存ファイルを置換せず、タイトル入力を保ったまま別名への修正を案内する。
- 関連するMarkdown部分を読み取り専用表示にしても、ファイル全体を破棄・修復しない。ソースMarkdownから安全に修正できる旨を示す。
