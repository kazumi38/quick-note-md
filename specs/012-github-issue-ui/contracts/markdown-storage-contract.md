# Contract: Issue風メモ・Todo Markdown Storage

## Canonical storage

- 管理対象ディレクトリ配下の標準Markdownファイルを唯一の正本とする。外部DB・JSON sidecar・共有サービスに項目のタイトル、状態、ラベル、本文、コメントを保存しない。
- Markdownは拡張機能なしで読める形式とする。QuickNoteMD extension markerは通常のHTML commentで記録し、Markdown閲覧者には表示本文としてレンダリングされないこと。
- 更新は `DocumentStore` の安全な操作を通し、in-root/writable/symlink検査、document version、更新前文字列、ディスクfreshnessを検証する。全文snapshotからファイルを再生成してはならない。
- ファイルのEOL形式（LF/CRLF）、対象外テキスト、対象外行の順序、未知Markdownを保持する。

## Memo representation

- Memoは既存のMarkdown文書であり、ファイル名（拡張子を除く）がtitle。説明はファイル内容全体から、末尾に正しく識別できるQuickNoteMD extension blockだけを除いたMarkdown。
- 既存Memoにextension blockがなければ、そのファイルを変換せずdescriptionとして読み取る。本文にタイトル見出しがあっても本文データとして保持する。
- ラベル／コメントの初回保存時、本文の後ろに専用のIssue wrapperを追加し、その中でTodoと共通するmetadata/comment markerを使う:

```markdown
<!-- quick-note-md:issue -->
<!-- quick-note-md:meta labels="bug,help wanted" -->
<!-- quick-note-md:comments -->
<!-- quick-note-md:comment -->
Markdown comment body
<!-- quick-note-md:end-comment -->
<!-- quick-note-md:end-comments -->
<!-- quick-note-md:end-issue -->
```

- `issue` / `end-issue` はMemoの管理対象extension全体を一意に区切る。wrapperはファイル末尾にだけ認識する。追加時は本文とwrapperの間に同じEOLを2つ挿入し、削除時はその2つだけを取り除くため、元の末尾改行の有無を正確に復元できる。
- ラベルがない場合は `meta` 行を省略する。コメントがない場合はcomments blockを省略する。ラベル・コメントの双方がなくなった場合はextension blockと、QuickNoteMDが追加した区切りだけを正確に除去し、元の本文と末尾改行を復元する。
- コメント追加は作成順にappendする。編集・削除は選択commentの検証済みblock範囲だけを更新する。コメント本文内のmarker文字列はパーサー・serializerで安全に扱い、曖昧になる場合は書き込みを拒否する。
- Memo title編集はmanaged root内のファイルrenameとして行い、本文ブロックを変更しない。rename先の既存ファイル、symlink、管理対象外、外部変更を上書きしない。保存成功後はURIを含む一覧・選択・draft識別を更新する。

## Todo representation

- Todoは既存のMarkdown task rowと既存の状態markerで表す。`open`, `done`, `info`, `warn`, `note`, `skip`等の既存statusと、未知形式のreadonly動作を変更しない。
- Todoのlabels、due date、body、commentsは既存の`quick-note-md:meta`, `quick-note-md:body`, `quick-note-md:comments` markerとserializer/parser契約を使う。
- ラベル保存時は現在のdue dateを保持する。ラベル編集でstatus/task row/body/commentを変更しない。
- Todo本文・状態・ラベル・コメントの各操作はTodo parserが認識した対象だけを変更する。コメント内タスクリストはTodo一覧に再計上しない。

## Marker validation and readonly behavior

- Markerは期待位置に単独行であり、begin/endの対応、順序、対象Itemとの一意な対応が確認できる場合だけ編集する。
- 重複、欠落、入れ子、並べ替え、Item間の分離、別のQuickNoteMD blockとの曖昧さがある場合、parserは元テキストを保持してreadonly warningを返す。markerを自動修復、削除、移動しない。
- Memo footer parserはファイル末尾のextension blockのみをメタデータとして扱う。本文中の類似文字列だけを見て既存内容を切り捨てない。
- 新しいmarker schemaが既存Todo parserの認識規則と異なる場合は、個別の明示的テストと後方互換性を追加し、既存形式を再解釈しない。

## Save, conflict, and draft contract

- Extension hostはWebviewのIDを現在の読み取りsnapshotに照合し、書き込み直前に対象ファイル・Todo row・comment blockを再解析する。
- `documentVersion`, item identity, source range, source textのいずれかが一致しない場合は安全に失敗し、最新状態を再読込する。古い値による成功形fallbackを返さない。
- WorkspaceEdit/saveの完了が確認された後だけdraftをクリアし、snapshotを更新する。保存失敗または競合時は該当draftを保持し、理由と再試行／ソース確認の方法を示す。
- Memo renameとTodo行編集は、選択されているアイテム以外のdraft・本文を消去しない。編集中の別documentを暗黙に保存しない。

## Security and portability

- Markdownは既存の安全なrendererを通す。WebviewのContent Security Policyを維持し、外部scriptを許可せず、リモート画像を自動取得しない。
- path/URI・Markdown offsetsをクライアントから指定させない。すべてextension host側でcanonical itemから導出する。
- Windows/macOS/Linuxのパス・改行をVS Code APIと既存のplatform-independent helperで処理する。
