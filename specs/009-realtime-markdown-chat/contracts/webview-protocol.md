# Chat Webview protocol

VS Code Extension Host と `chatView` Webview の間の内部 JSON 契約。Webview が送る値はすべて未信頼入力とし、Extension Host で discriminant・必須キー・型・長さを検証する。余分なキーや不正なメッセージは操作に使わない。

## Extension Host → Webview

| `kind` | Payload | 用途 |
|---|---|---|
| `snapshot` | `{ generation, state, chats, selectedChat?, thread?, drafts, error? }` | `loading` / `ready` / `empty` / `unavailable` / `error` を含む完全スナップショット。世代番号で古い結果を除外。 |
| `draftAck` | `{ draftId, revision, state, message? }` | JSON バックアップの保存・競合状態を通知。 |
| `operationResult` | `{ operationId, operation, ok, code?, message?, snapshot? }` | `send` / `toggleTask` などの操作結果。成功と失敗を明示し、新しい snapshot を必要に応じて伴う。 |
| `draftRecovery` | `{ draft }` | 保存済み下書きの復旧候補。base fingerprint が一致しない場合は `conflict` とし自動適用しない。 |

`thread` の各メッセージに含める `html` は Extension Host が既存安全 renderer で生成する。内部 URI、source range、絶対パスは Webview へ送らない。ボタン状態・readonly・原文未保存状態を色だけで表現しない。

## Webview → Extension Host

| `kind` | Payload | 認可・動作 |
|---|---|---|
| `ready` | `{}` | 初回スナップショットを要求。 |
| `selectChat` | `{ chatId }` | Host が snapshot 内の既知 ID を検索し選択する。 |
| `newChat` | `{}` | 新規 composer を開く。ファイルは送信成功まで作らない。 |
| `draftChanged` | `{ draftId, revision, chatId?, sectionId, title?, markdown }` | Markdown source のみ受信し、Host で長さ・識別子を検証して復旧 JSON を保存。描画用 HTML は受け取らない。 |
| `send` | `{ operationId, draftId, revision, chatId?, sectionId, title?, markdown, retryConflict? }` | Host が最新文書・dirty・競合・readonly・section を再検査し、timestamp / message ID を生成して対象ファイルを作成・追記する。競合時は通常送信を停止する。ユーザーが最新状態を確認して明示的な再送信を選んだ場合のみ `retryConflict: true` を受け付け、Host が改めて dirty・readonly・形式・版を検証して追記する。 |
| `toggleTask` | `{ operationId, chatId, messageId, taskId, checked, documentVersion }` | Host が現文書を再解析し対象 marker を再特定、版・readonly・dirty・競合を検証し marker のみ変更する。 |
| `openSource` | `{ chatId }` | 対象 Markdown を VS Code の原文エディターで開く。 |
| `refresh` | `{}` | 一覧と現在の thread を再読込。 |
| `recoverDraft` | `{ draftId, action: "restore" \| "discard" }` | 復旧候補を明示的に復元または破棄する。競合は上書きしない。 |
| `copyDraft` | `{ draftId, revision }` | 指定 revision の下書きをクリップボードへコピーする。成功・失敗を `operationResult` で返す。下書きはコピー後も保持する。 |

## 競合時の復旧操作

- 競合・dirty・保存失敗時は、未送信 Markdown を維持したまま日本語の理由と「下書きをコピー」「原文を開く」「最新状態を再読み込み」を提示する。コピーは指定 revision の内容だけを対象とし、下書きを削除しない。
- 再読み込み後も draft を復元候補として保持する。保存元 fingerprint が変わっている draft は自動適用せず、ユーザーに最新 thread と draft を確認させる。
- 「再試行」は暗黙の自動 retry としない。ユーザーが最新 thread を確認して「最新状態を確認して再送信」を選んだ場合のみ Host が最新文書、対象 chat/section、dirty 状態、書込権限を再検証する。返信の再試行は最新 section 末尾への新規 message 追記に限り、既存 source を置換しない。対象 section が消失・曖昧なら再試行を拒否する。
- 送信済み task の切替を競合後に再試行する場合も、Host が最新本文から message/task を一意に再特定し、対象 marker だけを更新できることを確認する。対象が消失・重複している場合は停止し、他の項目と draft を保持する。
- ユーザーが下書きを破棄する操作を明示するまで、エラー表示の解除・snapshot 更新・再表示によって draft を削除してはならない。

## 入力検証・順序

- `chatId`、`draftId`、`sectionId`、`messageId` は Host が発行した現在有効な ID のみ受け付ける。Webview からの URI、ファイル path、offset は受け付けない。
- `markdown` は string でサイズを検証する。空白だけの送信は拒否し、日本語の理由を操作結果に含める。
- 送信 ID と revision は単調増加または一意とし、二重送信を防止する。送信成功時も一致する revision だけ消去し、後続編集があれば残す。
- snapshot は generation が現行値以上のときだけ UI に適用する。Webview 側の response と composer 更新も draft revision を照合する。
- エラー code は `conflict`, `dirtyDocument`, `readOnly`, `missingTarget`, `unsupportedFormat`, `invalidInput`, `saveFailed` のいずれか。message は日本語で原因と下書き保護状態を説明する。
- `draftChanged` と selection/caret 更新は `send` を発生させない。送信は明示的なボタン操作のみ。
