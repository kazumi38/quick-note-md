# Contract: Markdown Storage and Parsing

## Managed Path Contract
- 管理対象は `quick-note-md.notesDirectory` 配下の `.md` ファイルのみ
- 絶対パス・親ディレクトリ遡り・外部ディレクトリは拒否

## Memo Write Contract
- 新規メモ: UTF-8 の通常 Markdown ファイルとして作成
- 追記: ファイル末尾のみ更新
  - 末尾改行あり: そのまま新規行追加
  - 末尾改行なし: 1つ改行を補って追加
  - 空ファイル: 先頭空行を追加せず1行目に書く
- 同一ファイルへの複数要求は順序を保持して直列化

## Todo Parse Contract
- 標準形式 `- [ ] text`, `- [x] text`, `- [X] text` を認識
- 各 Todo の同一性は `file path + line` で定義
- 未認識行は非破壊で保持し、通常 Todo 一覧に含めない

## Todo Mutation Contract
- 完了/再開: チェックボックス記号のみ変更、本文は不変
- 削除: 対象1行のみ除去
- 不在/移動/読み取り専用検知時は更新せず失敗を返す

## External Change Contract
- ファイル作成/変更/削除/リネームを監視し表示を再同期
- 監視遅延や停止中変更は次回操作時に再検証して整合させる
