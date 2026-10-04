# Task 009 調査結果

**対象**: [仕様](spec.md) の入力中描画、Markdown の往復、ファイル境界と安全な更新
**調査日**: 2026-10-04

## 決定 1: チャット入力に ProseMirror の最小構成を使う

**決定**: `prosemirror-model`、`prosemirror-state`、`prosemirror-view` と必要な `prosemirror-commands`、`prosemirror-history`、`prosemirror-keymap`、`prosemirror-inputrules`、`prosemirror-markdown`、`prosemirror-tables` を Webview に閉じて使う。スキーマと入力規則で見出し、段落、強調、引用、リスト、チェック項目、コード、表、注意書きの許可範囲を明示し、編集状態を ProseMirror 文書として保つ。入力ごとに Extension Host へ問い合わせず、Webview 内で同期的に描画する。markdown-it が `<a>`／`<img>` を許容する意味でも、composer schema は遷移不能な span と外部取得のない画像ラベルとして描画する。

**根拠**:

- リポジトリの `src/rendering.ts` は既存 Markdown の安全な一部だけを編集可能な span とし、編集後はソース全体を再解析して構造が変わらないことを確認する設計である。これは既存メモ本文の限定編集には適するが、自由な複数行 Markdown の新規入力、書式をまたぐ選択・改行、チェック項目や表の編集を支える完全なコンポーザーではない。
- Task 009 のブラウザモックは DOM 全体を Markdown へ再直列化する試作であり、その serializer は完全な Markdown 往復を保証しない。キャレット復元、composition、Undo/Redo、Backspace を独自に保守する必要も残る。要件にある多数の編集操作をこの試作へ継ぎ足すと、データ損失と入力不安定性のリスクが高い。
- ProseMirror の公式設計は、許可した要素だけからなる文書モデル、状態トランザクション、編集ビュー、履歴を分離する。Webview 内の単一編集面に適用し、チャット全体の UI や同期機構を持ち込まない。
- 公式 `prosemirror-markdown` は markdown-it をトークナイザーとして使う Markdown parser と serializer を提供する。したがって別の Markdown renderer/parser を導入せず、既存 markdown-it を拡張して入力スキーマへ接続できる。Callout・状態付きリスト・GFM 表はカスタム token mapping と schema node で扱い、受入テストで入力規則と保存結果の一致を検証する。
- `prosemirror-markdown` の既定 schema は GFM 表を含まないため、表の編集には `prosemirror-tables` と明示的な Markdown table token mapping / serializer が必要である。Markdown 入力の `# `、`**...**`、リスト marker、fence の input rule、貼付時 parse、block 別 Enter と Shift+Enter を別途用意し、単に依存を入れれば仕様を満たすとは扱わない。

**検討した代替案**:

| 案 | 判断 |
|---|---|
| 既存 `contenteditable` と独自 DOM→Markdown serializer | 却下。試作は全 Markdown の損失のない往復を保証せず、IME・キャレット・Undo・Backspace の状態管理も独自実装となる。単純な safe span は自由な新規入力に不足する。 |
| `<textarea>` と別プレビュー | 却下。ソースを保ちやすいが、別領域を使わず入力欄自体に描画する要件を満たさない。 |
| CodeMirror 6 の live-preview decoration | 有力だが今回は不採用。トランザクション・履歴・言語パーサは強い一方、入力欄内での構造編集を構成する追加アダプターと Lezer Markdown parser が必要で、markdown-it の token semantics との二重管理が生じる。試作を安定化するより独立した編集文書モデルを持つ方が今回の WYSIWYG 要件に合う。 |
| Monaco | 却下。VS Code Webview に二つ目の大規模コードエディターを埋め込む価値がなく、Markdown WYSIWYG 構成に適合しない。 |
| Tiptap / React、Milkdown 等の一体型フレームワーク | 却下。目的に必要な ProseMirror 部品を超えるフレームワーク、抽象化、依存を追加する。 |

## 決定 2: markdown-it を parser・serializer・安全な renderer として再利用する

**決定**: `prosemirror-markdown` の markdown-it tokenizer を既存 markdown-it 方針で構成し、ProseMirror schema/token mapping と Markdown serializer を定義する。保存済みメッセージの読み取り表示は `renderSafeMarkdown` を引き続き使う。表示 HTML を信頼済み入力として挿入しない。任意 HTML は無効、リンク・画像は既存通り不活性とし、Webview CSP は既存同等以上に維持する。

**根拠**: 既存 `src/rendering.ts` は `html: false`、リンク遷移無効、画像取得無効を明示し、markdown-it の token stream から安全な表示を組み立てる。既存の表示規則を保ちつつ、入力編集用には構造化 schema を設けられる。`prosemirror-markdown` は tokenizer を差し替え可能で、token 名から schema node/mark への対応を設定できる。

**検討した代替案**: HTML を DOM に再解析して本文を取得する方法は、Webview からの HTML を信頼する必要があり、安全性と Markdown 意味の保守が難しいため採らない。Markdown 描画用に別のライブラリを追加する方法も採らない。

## 決定 3: 本文境界を標準 HTML コメントで囲む

**決定**: `#` はスレッド、`##` はセクション、`### YYYY-MM-DD HH:mm` はメッセージ見出しのまま保ち、メッセージ本文を各メッセージ ID と対になる標準 Markdown/HTML コメントで囲む。

```markdown
# ログイン画面について

## 本文

### 2026-10-04 06:30
<!-- quick-note-md:message 52a9f08231de4f09bcabac71fc083071:start -->
## 現在の仕様

通常の本文です。
<!-- quick-note-md:message 52a9f08231de4f09bcabac71fc083071:end -->
```

ID はタイムスタンプと独立したランダムな 128-bit 識別子とする。同時刻のメッセージを区別し、順序はファイル内の順序を使う。コメントは標準 Markdown の HTML コメント構文であり、HTML コメントを解釈する Markdown ビューアーでは通常の本文表示に境界用文字が現れない。HTML 自体は Webview 描画で引き続き無効にする。構造コメントを持つ本文は marker 範囲を除いて描画する。

**根拠**: Markdown の heading level は文書のブロック境界を一意にネストしない。本文で自由に `#`、`##`、`###` を使える要件を見出しレベルだけで分離するのは曖昧である。HTML コメントの開始・終了ペアで本文範囲を明示すれば、本文の見出しを変換・制限せず構造を再現できる。コメントは標準構文だが、HTML を無効にする実装独自 renderer では metadata として除去してから本文描画する。

**代替案**:

| 案 | 判断 |
|---|---|
| 見出しレベル・タイムスタンプだけで境界を推定 | 却下。本文の同レベル見出しや日時形式の見出しを構造と誤認し得る。 |
| 本文見出しを `####` 以下へ制限 | 却下。仕様に反し、一般 Markdown の意味を改変する。 |
| 非標準 sentinel、YAML front matter、DB 保存 | 却下。ファイル単独で読めることを損なうか、Markdown と別の原本を生む。 |
| メッセージ本文全体の escaping / heading 書換え | 却下。原文と Markdown 意味を変える。 |

ID 形式と parser の厳密な文法は [Markdown ファイル契約](contracts/chat-markdown.md) を参照。

## 決定 4: 下書き・送信・チェック更新は別の書込経路とする

**決定**: 未送信文書はチャット URI とセクションをキーにバックアップし、元ファイルの基準内容と文書バージョンを保持する。送信時は Extension Host で最新状態を確認後、新規スレッドの作成または対象セクション末尾への追加を実行する。送信済みチェック状態は parser が再解決した対象 marker のみを、DocumentStore のガード内で置換する。

**根拠**: 現在の `DraftStore` は Extension global storage に下書き JSON を保管するが、Todo の生行と固有フィールドに依存している。`DocumentStore` は保存先の範囲、symlink、dirty document、disk conflict、読み取り専用、per-file queue、特定テキスト範囲の編集を既に扱う。ファイル安全性を再実装せず、チャットの message/section identity に合わせて最小限に一般化する。

**失敗時**: 競合・dirty document・読み取り専用・対象消失・parse ambiguity・save failure は失敗として Webview に返す。状態切替をローカル表示で確定せず、本文・他の項目・返信下書きを保持する。広域 catch と成功形 fallback は作らない。

## 参考資料

- ProseMirror Guide — document schema、state/transactions、editable view、history: https://prosemirror.net/docs/guide/
- `prosemirror-markdown` — markdown-it tokenizer、Markdown parser/serializer、schema token mapping: https://code.haverbeke.berlin/prosemirror/prosemirror-markdown
- `prosemirror-tables` — table node/commands/plugins for editing table cells: https://github.com/ProseMirror/prosemirror-tables
- markdown-it architecture — token stream と renderer rules: https://github.com/markdown-it/markdown-it/blob/master/docs/architecture.md
- CommonMark 0.31.2 — Markdown の可搬性と HTML blocks: https://spec.commonmark.org/0.31.2/#html-blocks
- W3C Input Events Level 2 — composition 開始・終了イベントの分離と `beforeinput`: https://www.w3.org/TR/input-events-2/

W3C Input Events Level 2 は Working Draft でありブラウザー適合性に差が残るため、規範だけに依存せず VS Code の Chromium Webview で日本語 IME を実操作して検証する。
