# 新規チャット開始操作の契約

## VS Code command

| 項目 | 契約 |
|---|---|
| Command ID | `quick-note-md.newChat` |
| 表示名 | `QuickNoteMD: 新しいチャット` |
| 引数 | なし |
| 効果 | QuickNoteMD ビューコンテナーを表示し、`ChatView` に新しい本文 composer draft の開始を依頼して Webview へ snapshot を表示する |
| 永続化 | command 実行時にはチャットファイルを作らない。Markdown ファイルは既存の送信フローで作成する |
| エラー | command 経路と既存の draft 初期化から予期しないエラーを握りつぶさない。送信・保存エラーは既存の通知と下書き保持を維持する |

## 起動場所

- `package.json` の `viewsWelcome` に、`command:quick-note-md.newChat` を実行する「新しいチャット」リンクを表示する。
- 同じ command を `quick-note-md.chat` の `view/title` に追加アイコン付きで表示する。
- Webview 内の既存「新しいチャット」ボタンは同じ host 側の draft 開始処理へ委譲する。
- command palette から呼び出された場合も `workbench.view.extension.quick-note-md` を実行してビューを表示し、ビューがまだ解決されていない場合は draft を保持する。ビュー初期化後の snapshot により composer を表示する。

## 結果

- 空状態からいずれの開始操作を選んでも、本文入力用の draft と composer が表示される。
- チャット一覧が空でなくても view/title の新規作成操作を利用でき、既存チャット選択・一覧表示を変更しない。
- 作成開始だけで既存の Markdown ファイルを変更・削除しない。
