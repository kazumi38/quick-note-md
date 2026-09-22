# Contract: Markdown Storage and Todo Comment Serialization

## Managed Path Contract
- 管理対象は `notes/` 配下の Markdown ファイルまたは、ユーザーが明示的に扱う Todo を含む Markdown へ限定する
- 絶対パスや親ディレクトリ外への書き込みは拒否する
- `quick-note-md.notesDirectory` の設定値を優先する

## Todo Parsing Contract
- 既存の 6 状態のチェックボックス記法を維持する
- Todo の同一性は `file path + line position` で決定する
- コメント境界が曖昧な記法は読取時に保持し、破棄せずに警告する
- チェックボックス内の Markdown は独立した Todo として二重計上しない

## Comment Serialization Contract
- コメント本文は通常の複数行 Markdown として保持する
- コメントは対象 Todo と同一ファイル内に保存し、対象外の本文や改行形式を維持する
- 既存ファイル末尾や内部改行がない場合でも、保存時に対象範囲以外の行を変えない
- コメント追加時は連続した追記を許可し、逆順表示ではなく時間順で保持する
- Todoとコメントの内部モデルはJSON互換の型付きオブジェクトとして扱えるが、JSONファイルや別データベースへ永続化しない
- 再起動後の正本はMarkdownとし、内部モデルはMarkdownの再解析によって再構築する
- 内部モデルの一時IDや解析用フィールドを、利用者が読めないJSONメタデータとしてMarkdownへ埋め込まない

## Update Safety Contract
- 更新時は対象 Todo と対象コメントのみを書き換える
- 競合が発生した場合は保存を中止し、元ファイルの直近内容を利用者が再読込できるようにする
- 保存失敗時は未保存入力を保持し、手動の退避または再試行を案内する
- コメントデータは外部スクリプトの実行やリモート画像の自動取得を発生させない

## External Change Contract
- ファイルの作成・変更・削除・移動を監視し、表示を再同期する
- 読み取り専用や不在の対象に対する書き込みは安全に失敗する
- 変更前の全文や差分を保持し、対象外の Markdown を上書きしない
