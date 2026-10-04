# チャット Markdown ファイル契約

この契約はチャットファイルの読み書きに用いる。Markdown 本文はファイルの正本であり、Webview の HTML は保存しない。

## 文法

```text
thread       = title *(blank-line section)
title        = "# " title-text
section      = "## " section-name *(blank-line item)
item         = message / legacy-message / preserved-unknown
message      = timestamp-heading LF start-marker LF body LF end-marker
timestamp-heading = "### " timestamp
timestamp    = YYYY "-" MM "-" DD SP HH ":" mm
start-marker = "<!-- quick-note-md:message " message-id ":start -->"
end-marker  = "<!-- quick-note-md:message " message-id ":end -->"
message-id   = 32 lowercase hexadecimal characters
```

- `title` はファイル先頭に1つ、`section` は順序付き。`本文`・`返信` 以外の section name を保持する。
- `message-id` は生成時に暗号学的乱数 16 bytes から hex 化する。時刻は一意でなくてよい。
- `body` は空行を含む Markdown 全体。本文の見出し `#` / `##` / `###` を構造として扱わない。開始・終了 marker はペアで同じ ID、非入れ子、各 ID 一意。
- serializer がユーザー本文内に予約形式の marker 行を見つけた場合は送信を拒否し、その理由を示して入力を保持する。境界 marker として曖昧に解釈しない。
- チャット本体に HTML を実行する意味は持たせない。保存済み本文は marker を除いて既存 `renderSafeMarkdown` に渡す。

## 例

```markdown
# API仕様について

## 本文

### 2026-10-04 07:30
<!-- quick-note-md:message 52a9f08231de4f09bcabac71fc083071:start -->
## エンドポイント

`GET /v1/items`
<!-- quick-note-md:message 52a9f08231de4f09bcabac71fc083071:end -->

## 返信

### 2026-10-04 07:42
<!-- quick-note-md:message 11a62a887897493db8501b19dc0dfb44:start -->
- [ ] レスポンス形式を確認する
<!-- quick-note-md:message 11a62a887897493db8501b19dc0dfb44:end -->
```

## 解析・互換性規則

1. markdown-it token stream で code fence / inline code 等の内容を構造行と誤認せず、厳密な top-level heading と marker 対を識別する。
2. 新形式は message marker 対を構造の根拠とする。`#` / `##` / `###` の本文見出しは marker 内に留まる。
3. marker の欠損、入れ子、ID 重複、時間書式の不正、複数 title、未分類の曖昧な構造は読み取り専用とし、該当 source を保持して理由を示す。自動補修しない。
4. marker がない旧形式は `# title`、`## section`、`### YYYY-MM-DD HH:mm` の従来構造として読み取れる場合だけ legacy として表示する。本文との境界が曖昧な heading がある場合、無変更で表示し書込を停止する。自動で全体を新形式へ変換しない。
5. 新規送信は新形式 marker を使う。既存メッセージや未知 section の source range を serializer で再生成せず、対象セクション EOF へ最小挿入する。
6. ファイルの Markdown renderer に影響する metadata は標準 HTML コメントのみ。独自 DB、YAML front matter、非標準 fenced directives は導入しない。

## Markdown renderer

- markdown-it `html: false`, `linkify: false`, `typographer: false` の既存方針を維持する。
- Link は遷移しない表示、image は外部 fetch しない代替テキスト表示とする。
- Webview へ送る `html` は Extension Host がこの設定から作成する。Webview から返された HTML は描画・保存に使わない。
- marker metadata は本文 renderer に渡す前に取り除く。
