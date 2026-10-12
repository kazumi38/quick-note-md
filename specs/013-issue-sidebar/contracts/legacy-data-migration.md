# Contract: Legacy Data Migration and Removal

## User-approved behavior

- 初回移行時、確認ダイアログなしで旧Todo・メモ・チャット機能を廃止し、旧保存データを削除する。ユーザーは旧チャット機能・履歴を含む削除を選択済み。
- 旧workspace `quick-note-md.notesDirectory`（既定は`notes`）内の全ファイルとサブフォルダーを削除する。手作業で配置されたファイルとチャットMarkdown履歴も対象。
- 旧チャットdraft専用ディレクトリ`globalStorageUri/chat-drafts`および旧Memo/Todo draft専用ディレクトリ`globalStorageUri/sidebar-drafts`を削除する。
- extension global storage全体、Issue保存先、Issue draft store、workspaceの旧保存先以外のファイルは削除しない。
- 旧設定、Todo/Memo/Chatのコマンド、custom editor、provider/viewを以後登録・使用しない。無関係なVS Code user/workspace settingsファイルそのものは削除しない。

## Order, scope guards, and idempotency

1. workspaceが開かれていることと旧保存先のworkspace内相対パスを検証する。workspace root自体またはworkspace外を削除対象にしてはならない。
2. Issue保存先、sequence ledger、Issue draft保存先を解決し、旧削除対象とのパス一致・親子重複を検査する。交差があれば何も削除せず、パス修正を案内するエラーを表示する。
3. workspace固有のmigration stateを確認する。成功済みなら削除を繰り返さない。
4. 旧workspace保存フォルダーと2つの旧draft専用フォルダーのみを削除する。旧draftフォルダーが存在しない場合は成功扱い。
5. すべての削除が成功した後にのみmigration完了を記録し、Issue view/storeを有効化する。

## Failure behavior

- 途中で削除が失敗した場合は成功状態を記録しない。対象パスと理由を報告し、再起動またはrefresh後に安全に再試行する。
- Issue Storeのディレクトリを旧保存先削除の前に作成しない。交差検出または削除失敗時にIssueの記録・保存を実行しない。
- 繰り返し実行されてもIssueデータを削除しない。完了記録後に旧notesDirectoryに追加ファイルが作られていても、それを削除しない。
- 削除対象外ファイル、workspace root、global storageの他の子ディレクトリ、symbolic linkの参照先を再帰削除しない。

## Verification cases

- 旧notesDirectoryにMemo、Todo、Chat Markdown、手作業ファイル、サブディレクトリがある場合、対象範囲が全削除される。
- 旧chat-drafts/sidebar-draftsだけが削除され、同じglobalStorageUri下のIssue draftsと他ファイルは維持される。
- Issue storeと旧保存先が重なる場合、削除前に停止し、全データを維持する。
- 削除途中でpermission/I/O errorが起きた場合、失敗を報告し、Issue機能を成功状態として起動しない。
- 完了後の再起動で移行処理が旧領域を再消去せず、Issueファイルを維持する。
