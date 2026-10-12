# Contract: Issue Markdown Storage

## Location

- Issue storeはワークスペース内の`.quick-note-md/issues`とし、旧Memo/Todo/Chat保存ディレクトリと独立させる。
- 1 Issueを`issue-<zero-padded-id>.md`の単一ファイルに保存する。`.meta` sidecarは作成しない。
- Issue storeと旧保存先が同一、または片方がもう片方の親となる場合、移行・読み書きを始めず明示的エラーを返す。
- 新規Issue store、sequence ledger、Issue draftsは旧データ削除処理の対象にしない。

## Document shape

`issue-000027.md`:

```markdown
<!-- quick-note-md:issue:v1 {"id":27,"title":"Markdownプレビューで日本語の見出しが崩れる","state":"open","labels":["bug","エディター"],"createdAt":"2026-10-12T01:00:00.000Z","updatedAt":"2026-10-12T06:00:00.000Z"} -->

## 現象

日本語を含む見出しを入力すると、プレビューで見出しの位置がずれる。

- 入力中に表示がちらつく
- 保存後も一部の書式が維持されない

期待する表示に直したい。

<!-- quick-note-md:comments:v1 -->
<!-- quick-note-md:comment:v1 {"id":"c1","createdAt":"2026-10-11T08:00:00.000Z"} -->
日本語IMEの変換中に起きやすいようです。変換確定後もカーソル位置が飛ぶケースがありました。
<!-- quick-note-md:end-comment -->
<!-- quick-note-md:comment:v1 {"id":"c2","createdAt":"2026-10-12T06:00:00.000Z"} -->
見出しだけでなく、箇条書きの連続入力でも再現しました。
<!-- quick-note-md:end-comment -->
<!-- quick-note-md:end-comments -->
```

- ファイル先頭のHTML comment markerにschema version、ID、title、state、labels、createdAt、updatedAtを保存する。sidecarは使わない。
- コメント本文も同じMarkdownファイル内に順番に保存する。コメント開始markerに内部IDとcreatedAtを含め、end markerまでを一件のコメント本文とする。
- すべての構造markerはMarkdownレンダリング上には表示しない。「コメント」などの見える区切り文字は使わない。アプリはmarkerでIssue説明と個々のコメントを分け、説明を詳細ヘッダー、コメントをtimelineに表示する。
- `.sequence.md`は次のIssue番号を保持する補助ファイルであり、Issue一覧には含めない。

## Parsing and validation

- metadata markerとコメントmarkerは行単位・厳密なv1形式で解析する。JSON schema、型、Issue IDとファイル名の一致、コメントID重複を検証する。未知versionは読み取り専用とする。
- markerの欠落・重複・順序不正・不正JSON、閉じていないcomment範囲、予約markerと本文内容の衝突を検出した場合、Issueを編集不可として理由を表示する。内容を推測して分割・修復しない。
- `open`と`closed`以外のstate、空title、空白label、同一表記label重複、空白のみのコメント追加を拒否する。Issue本文は空でも有効。

## Writes and recovery

- すべての更新は同じディレクトリ内の一時ファイルへ完全なMarkdown文書を書き、再parseして検証してから置換する。`.meta` sidecarやコメント別ファイルは作らない。
- 作成・編集時の外部変更を検出した場合は保存を停止し、外部内容を上書きせずdraftを保持する。
- 書き込み中断時は一時ファイルを検証し、完全な有効版だけを採用する。不完全なcanonical fileを検出した場合は原文を保持して読み取り専用とし、ユーザーに復旧・退避を案内する。
- UTF-8を使用し、Markdownの改行形式（LF/CRLF）を維持する。他Issueのファイルに変更を加えない。

## Sequence ledger

- `.sequence.md`更新は排他作成・version照合で競合を検知する。破損時に既存IDを再利用しない。
- Issue IDを走査し、最大既存IDの次以上へ修復可能な場合だけ継続する。修復できない場合はIssue作成を停止し、理由を通知する。
