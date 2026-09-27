# Contract: Unified Sidebar and Draft Editing

## Sidebar hierarchy

```text
QuickNoteMD
└── 単一 WebviewView
    ├── ファイル設定群・管理対象 Markdown のメモ一覧
    └── Todo
        └── 状態グループ
            └── Todo（折りたたみ可能）
                ├── 本文
                └── リプライ（古い順）
```

ファイル一覧、Todo 一覧、Todo 詳細の編集はこの WebviewView 内に配置し、中央エディタを切り替えない。
ホストは `WebviewViewProvider` として登録し、Webview の入力・選択・保存・復元メッセージを検証する。
Todo の一覧行は、チェック状態、タイトル、ラベル名、ラベル色、対応日、期限切れ/期限内/未設定、保存状態を
表示する。すべての意味はラベル・説明・スクリーンリーダー向け文字列でも伝える。

## Draft lifecycle

| State | User-visible behavior | Allowed actions |
|---|---|---|
| clean | 「保存済み」 | 編集開始、展開/折りたたみ |
| dirty | 「未保存」 | 続行、保存、コピー、切替時の保存/破棄/キャンセル。本文、Reply、ラベル、対応日の draft を対象に含む |
| saving | 「保存中」 | 重複保存を防止 |
| conflict | 「外部変更を検出」 | 外部版を再読み込み、draft をコピー、手動反映、再試行 |
| failed | 「保存失敗」 | エラー理由の表示、コピー、再試行 |

本文・リプライを編集中も Markdown プレビューを更新するが、Markdown ファイルへの書込みは保存操作まで
行わない。キーボードだけで一覧、展開、編集、保存、切替を操作でき、フォーカス位置と選択を維持する。
状態は色だけでなく文字ラベルと Webview のアクセシビリティ属性でも示す。

dirty draft は入力変更時に `globalStorageUri` 配下の一時バックアップファイルへ書き出す。バックアップには編集対象種別（本文、Reply、属性）とその draft 値、Todo 元行、対象ブロックの保存時テキストを含める。Todo、ファイル、
表示方式、サイドバー表示の切替時はその draft を保持し、再表示時に復元する。VS Code 再起動後に対応
バックアップがあれば復元を提示する。文書・Todo の版と範囲が一致しない場合は競合として保管し、
ファイルへ自動適用しない。再起動後の対象照合は保存した Todo 元行と対象ブロックのテキストを使い、
同じ元行の Todo が複数あり特定できない場合は競合とする。session-local な document version は再起動後の
照合に使わない。保存完了またはユーザーの明示破棄後に限りバックアップファイルを削除する。

## Command contract

| Command | Input | Result | Failure behavior |
|---|---|---|---|
| 本文を保存 | Todo 参照、本文 draft | 対象本文だけを更新 | draft を残して競合/失敗を表示 |
| リプライ追加 | Todo 参照、draft | 末尾に 1 件を追加 | draft を残して競合/失敗を表示 |
| リプライ編集 | Todo 参照、Reply ID、draft | 対象リプライだけを更新 | draft を残して競合/失敗を表示 |
| リプライ削除 | Todo 参照、Reply ID、確認 | 対象リプライだけを削除 | 確認キャンセルまたは失敗では変更なし |
| 属性を保存 | Todo 参照、ラベル draft、対応日 draft | メタデータだけを更新 | draft を残して競合/失敗を表示 |
| Todo 削除 | Todo 参照、確認 | Todo と直後の拡張ブロックを削除 | 確認キャンセルまたは失敗では変更なし |
| draft を退避/復元 | draft snapshot、保存キー | globalStorageUri の一時ファイルを更新/復元 | 読み書き失敗を通知し、メモリ上の draft を保持 |
| 生 Markdown を表示 | Todo 参照 | 同じサイドバー内で生 Markdown 表示へ切替 | draft は退避して保持 |

## Live rendering safety

- Webview は HTML をレンダリングしない。
- リンクは遷移不可のテキストとして、画像は代替説明として表示する。
- コンテンツスクリプトは Webview の nonce と Content Security Policy で限定する。
- テーブル、コードブロック、複雑なネスト、未知の記法は表示できても直接編集しない。生 Markdown を案内する。
- Webview からのメッセージは種別、キー、サイズ、バージョン、対象 ID を検証してから処理する。
