# Contract: Unified Todo Markdown Storage

## Scope

この契約は Todo 行、属性、本文、リプライを 1 つの Markdown 文書へ保存・解析・更新する規則を
定義する。すべての変更は対象 Todo と直後の拡張ブロックに限定する。

## Canonical layout

```markdown
- [ ] 調査する
<!-- quick-note-md:meta labels="調査,顧客" due="2026-10-01" -->
<!-- quick-note-md:body -->
背景と対応方針
<!-- quick-note-md:end-body -->
<!-- quick-note-md:comments -->
<!-- quick-note-md:comment -->
最初の補足
<!-- quick-note-md:end-comment -->
<!-- quick-note-md:end-comments -->
```

- Todo 行は既存のチェックボックス記法を維持する。
- `meta` は最大 1 行で、`labels` と `due` は任意属性である。
- `body` は最大 1 ブロックで、通常の複数行 Markdown を持てる。
- `comments` は最大 1 ブロックで、0 件以上の `comment` ブロックを作成順に持てる。
- すべてのマーカーは、Todo 行と同じリストインデントで単独行に置く。
- 本文とリプライの Markdown は、そのインデントを除けば拡張機能なしでも通常の内容として読める。
- HTML コメントは Markdown 表示で隠れるが、境界と属性を明示する。

## Parsing contract

1. パーサーは通常の Markdown リスト項目として認識できる Todo 行だけを変更対象にする。
2. コードブロック、HTML ブロック、本文・リプライ境界内のチェックボックスは Todo として列挙しない。
3. メタデータ、本文、リプライは Todo 行直後にこの順番で連続していなければならない。
4. 既存の Todo 行だけ、旧コメントブロックだけ、旧メタデータだけの文書も有効とする。
5. 無効な境界、重複マーカー、順序違反、無効日付は読み取り専用で返す。内容の推測・自動修復・再整形はしない。

## Write contract

- 本文、リプライ、ラベル、対応日は明示保存時だけに書き込む。
- 書き込みは現在の文書バージョン、対象 Todo の元行、対象範囲、ディスク内容が一致したときだけ行う。
- 更新は対象 Todo の拡張ブロックだけを置換または追加し、他の Todo、通常メモ、改行コードを変更しない。
- 本文またはリプライを削除する際は、空のブロックを残さず、そのブロックだけを削除する。
- 個別リプライの削除は対象リプライを示す確認後に行う。
- Todo 削除は、Todo 行と直後のメタデータ・本文・全リプライを示す確認後に一括で行う。
- 競合、保存失敗、読み取り専用、無効構造では書き込みを行わない。

## Compatibility examples

```markdown
- [ ] 従来 Todo

- [ ] コメントのみの Todo
<!-- quick-note-md:comments -->
<!-- quick-note-md:comment -->
既存コメント
<!-- quick-note-md:end-comment -->
<!-- quick-note-md:end-comments -->
```

これらは有効である。新しい属性または本文を保存しても、既存の Todo 行・コメント本文・改行形式は
保持する。
