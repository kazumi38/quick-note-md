# Task 009 データモデル

**正本**: ワークスペース内のチャット Markdown ファイル。下書きのみ Extension global storage の JSON バックアップ。Webview の ProseMirror 文書は編集中の一時状態であり、送信前のメッセージファイルではない。

## エンティティ

### ChatThread

| フィールド | 型・規則 | 説明 |
|---|---|---|
| `id` | 管理対象 URI の内部識別子 | 1つの Markdown ファイルと一対一。Webview には opaque ID のみ渡す。 |
| `uri` | `vscode.Uri` | Extension Host 内で保持。すべての更新で管理対象ルートを再検証する。 |
| `title` | 非空文字列 | ファイル先頭の構造見出し `#`。一覧は Markdown 見出しから取得する。 |
| `sections` | 順序付き `ChatSection[]` | ファイル内の `##` 見出し順を保持する。`本文`・`返信` 以外の名前も保持する。 |
| `mtime` | ファイルの更新時刻 | 既存一覧規則の降順。同時刻は URI の安定順。 |
| `documentVersion` | VS Code 文書バージョン | 操作時の optimistic concurrency token。 |
| `isDirty` | boolean | VS Code 原文エディターに未保存変更がある状態。表示には反映するが、送信・チェック保存を停止する。 |
| `parseState` | `valid` / `legacy` / `unsupported` | 不正・曖昧なファイルは読取専用で元の Markdown を開く導線を持つ。 |

### ChatSection

| フィールド | 型・規則 | 説明 |
|---|---|---|
| `id` | セクション内で安定な parser identity | 表示名や時刻の重複に依存しない。 |
| `name` | Markdown 見出し本文 | `本文`・`返信` または未知の名前。 |
| `messages` | 順序付き `ChatMessage[]` | ファイル順が表示順。 |
| `sourceRange` | Extension 内部の `[start, end)` | 最新文書の parse 結果から導出。Webview 入力として信用しない。 |

### ChatMessage

| フィールド | 型・規則 | 説明 |
|---|---|---|
| `id` | 128-bit random hex | コメント境界に保存する識別子。時刻とは独立し、重複は拒否する。 |
| `timestamp` | ローカル時刻 `YYYY-MM-DD HH:mm` | `###` 見出しに表示する。並べ替え・一意性に使わない。 |
| `bodyMarkdown` | Markdown source string | 対応する marker コメント間の正確な本文。送信済み本文は読取専用。 |
| `sourceRange` | Extension 内部の `[start, end)` | チェックマーカー更新を再解決する範囲。保存前に document version と再照合する。 |
| `tasks` | `ChatTask[]` | 本文内の `[ ]` / `[x]` 項目。既存 status 表示 `[i]`, `[!]`, `[n]`, `[-]` は別の表示型で、完了切替不可。 |

### ComposerDraft

| フィールド | 型・規則 | 説明 |
|---|---|---|
| `target` | `{ chatId?, sectionId }` | 新規スレッドまたは特定スレッド内の本文・返信先。 |
| `title?` | 新規スレッドの非空タイトル候補 | 初回送信までファイルを作らない。 |
| `markdown` | serializer により正規化可能な Markdown | ProseMirror 文書から生成。空白だけでは送信不可。 |
| `baseFingerprint` | 現ファイル内容の SHA-256 または未作成値 | 外部変更・原文保存後の競合判定。 |
| `baseVersion?` | VS Code `TextDocument.version` | 同一セッションの編集競合判定。 |
| `revision` | 単調増加整数 | 遅延した送信結果が後続入力を消さないようにする。 |
| `state` | `clean` / `dirty` / `saving` / `conflict` / `failed` | UI 表示と送信可能性を制御する。 |

下書きキーは file URI または新規 draft ID、section ID、必要ならスレッド identity の組とし、別スレッドへ混在させない。保存内容にはスキーマ版、基準 fingerprint、最終 Markdown、更新日時を含める。URI が解決できない／基準内容が変わった場合は自動適用せず orphan/conflict として回収できる。

### ChatTask

| フィールド | 型・規則 | 説明 |
|---|---|---|
| `id` | 現在の message ID と source offset から算出する一時 identity | 保存要求には marker/text を含めず、Host 側で現文書から再解決する。 |
| `checked` | boolean | `[ ]` または `[x]`。大文字 `[X]` も完了として parse する。 |
| `sourceRange` | marker 部分のみの範囲 | Host が現在の source/version から計算し、他のテキストを変更しない。 |
| `statusKind` | `task` / `info` / `warn` / `note` / `skip` / `important` | 通常 task だけ toggle 可。 |

## 状態遷移

```text
ComposerDraft: clean -> dirty -> saving -> clean
                            |          |
                            +-> conflict / failed

ChatThread: valid <-> dirty-source -> saved-current
                         |
                         +-> conflict / unsupported (read-only for writes)
```

- 描画・編集は `ComposerDraft` のみ更新し、スレッドファイルは変更しない。
- `send` 成功は同 revision の下書きだけを消去する。処理中に作られた新しい revision は保持する。
- `toggle` は markdown source の一つの marker のみ変更し、対象を再読込した場合にも値が維持される。
- Markdown parser が marker 対、section、message 境界を一意に解決できない場合は source を保持して `unsupported` とし、送信・toggle を許可しない。

## 制約・検証

- Chat ID は管理対象 URI から Extension Host が生成し、Webview の URI・範囲値は信用しない。
- `messageId` は重複不可。timestamp は重複可。
- title / section / body は原文を保持し、ファイル名の安全化は新規作成 URI のみで行う。
- 保存時は既存 `DocumentStore` の safe-root、symlink、dirty-document、disk conflict、readonly、per-file serialization の各 guard を通す。
- LF / CRLF は既存 `TextDocument.eol` に合わせ、既存 message 範囲を含む無関係な source を直列化し直さない。
- 破損した draft JSON、未知の schema version、壊れた境界は成功形で無視・適用せず、回収可能なエラーとして提示する。
