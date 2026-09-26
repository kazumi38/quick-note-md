# Contract: Unified Sidebar and Draft Editing

## Sidebar hierarchy

```text
QuickNoteMD
├── ファイル設定群
│   └── 管理対象 Markdown のメモ一覧
└── Todo
    └── 状態グループ
        └── Todo（折りたたみ可能）
            ├── 本文
            └── リプライ（古い順）
```

Todo の一覧行は、チェック状態、タイトル、ラベル名、ラベル色、対応日、期限切れ/期限内/未設定、保存状態を
表示する。すべての意味はラベル・説明・スクリーンリーダー向け文字列でも伝える。

## Draft lifecycle

| State | User-visible behavior | Allowed actions |
|---|---|---|
| clean | 「保存済み」 | 編集開始、展開/折りたたみ |
| dirty | 「未保存」 | 続行、保存、コピー、切替時の保存/破棄/キャンセル |
| saving | 「保存中」 | 重複保存を防止 |
| conflict | 「外部変更を検出」 | 外部版を再読み込み、draft をコピー、手動反映、再試行 |
| failed | 「保存失敗」 | エラー理由の表示、コピー、再試行 |

本文・リプライを編集中も Markdown プレビューを更新するが、Markdown ファイルへの書込みは保存操作まで
行わない。Todo、ファイル、表示方式、サイドバーの表示状態を変えるときは、dirty draft を保持するか、
保存・破棄・キャンセルを選択させる。

## Command contract

| Command | Input | Result | Failure behavior |
|---|---|---|---|
| 本文を保存 | Todo 参照、本文 draft | 対象本文だけを更新 | draft を残して競合/失敗を表示 |
| リプライ追加 | Todo 参照、draft | 末尾に 1 件を追加 | draft を残して競合/失敗を表示 |
| リプライ編集 | Todo 参照、Reply ID、draft | 対象リプライだけを更新 | draft を残して競合/失敗を表示 |
| リプライ削除 | Todo 参照、Reply ID、確認 | 対象リプライだけを削除 | 確認キャンセルまたは失敗では変更なし |
| 属性を保存 | Todo 参照、ラベル、対応日 | メタデータだけを更新 | draft を残して競合/失敗を表示 |
| Todo 削除 | Todo 参照、確認 | Todo と直後の拡張ブロックを削除 | 確認キャンセルまたは失敗では変更なし |
| 生 Markdown を表示 | Todo 参照 | 標準エディタを対象 Todo 行へ移動 | 変更なし |

## Live rendering safety

- Webview は HTML をレンダリングしない。
- リンクは遷移不可のテキストとして、画像は代替説明として表示する。
- コンテンツスクリプトは Webview の nonce と Content Security Policy で限定する。
- テーブル、コードブロック、複雑なネスト、未知の記法は表示できても直接編集しない。生 Markdown を案内する。
- Webview からのメッセージは種別、キー、サイズ、バージョン、対象 ID を検証してから処理する。
