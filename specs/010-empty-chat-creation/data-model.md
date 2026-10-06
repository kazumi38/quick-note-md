# データモデル: 空状態からのチャット作成

この変更では新しい永続エンティティや保存形式を導入しない。新規チャット操作は既存の実行時 draft を開始する。

## ComposerDraft

既存の `ChatDraftStore` が復旧用として保持する composer の下書き。

| フィールド | 用途 | 新規チャット開始時 |
|---|---|---|
| `draftId` | draft の一意な識別子 | 新規ランダム ID |
| `target.sectionId` | 入力対象のセクション | `本文` |
| `target.chatId` | 既存チャットへの返信先 | 未設定 |
| `title` | 新しいスレッドのタイトル | 空文字 |
| `markdown` | 入力内容 | 空文字 |
| `baseFingerprint` | 既存文書との競合確認 | 未設定 |
| `revision` | draft 更新順 | `0` |
| `updatedAt` | 最終更新時刻 | 開始時刻 |

## 状態遷移

```text
空状態
  -> 新規チャット操作
  -> 空の ComposerDraft
  -> 入力中の復旧可能な下書き
  -> 送信成功で Markdown チャットファイルを作成
```

- 操作のキャンセル・開始直後の終了は Markdown ファイルを作らない。
- 送信失敗時は既存 draft とエラー通知を保持する。
- 保存・競合・復旧規則は既存 `ChatDraftStore` と `ChatView` の責務のまま。

**検証規則**: 空状態からの command 実行後、snapshot は `sectionId: 本文` の draft を含み、新規ファイルは送信成功まで存在しない。
