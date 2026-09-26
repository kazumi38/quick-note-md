# Research: Todo 中心の統合メモサイドバー

## Decision: 既存 Todo 行の直後に拡張ブロックを置く

**Decision**: Todo 行は変更せず、その直後にこの順序でメタデータ、本文、リプライを置く。

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

**Rationale**: 現行コードは Todo 行直後のメタデータ、本文、コメント境界を既に保守的に解析できる。
通常の Markdown は拡張機能なしでも読め、HTML コメントは機械的境界を明示しつつ表示を汚さない。
Todo 行、インデント、改行コードを保持した最小範囲置換に適合する。

**Alternatives considered**:

- YAML front matter: 文書単位の属性には適するが、複数 Todo の局所属性と対象範囲更新には不適切。
- 通常テキストだけの暗黙境界: 本文内のリストやチェックボックスと区別できず、安全な更新を保証できない。
- 詳細用の別 Markdown ファイル: 関係を追跡する追加状態が必要になり、可搬性と削除整合性を損なう。

## Decision: 破損・未知の拡張ブロックは読み取り専用にする

**Decision**: Todo の直後にあるメタデータ、本文、リプライ境界が欠落、重複、順序違反、別 Todo にまたがる
場合、その Todo の拡張編集と削除を停止し、生 Markdown を開く導線だけを示す。

**Rationale**: 推測による回復や自動整形は、ユーザーの Markdown を変更・消失させる危険がある。

**Alternatives considered**:

- 不足する終端マーカーを自動補完する: 本文の本来の境界を誤認する可能性がある。
- 壊れた部分だけを無視する: リプライ内 Todo の二重計上や意図しない削除を防げない。

## Decision: ラベル色はリソース設定でワークスペース共有する

**Decision**: Todo の Markdown にはラベル名のみを保存し、ラベル名から固定パレット色への対応は
VS Code のリソース設定に保存する。同名のラベルは管理対象 Markdown 全体で同じ色を使う。

**Rationale**: Todo の移動・コピー後も Markdown は意味を保ち、色はワークスペースで一貫する。
ラベルごとの色を各 Todo に重複保存しないため、対象範囲更新と外部編集の競合を小さくできる。

**Alternatives considered**:

- 色を各 Todo のメタデータに保存: 同名ラベルの色が分岐し、ワークスペース共有の要件を満たさない。
- 自動色割当のみ: ユーザーが分類の視覚的意味を選べない。

## Decision: サイドバーは既存の TreeView を統合して段階的に拡張する

**Decision**: ファイル設定/メモと Todo を同一の Activity Bar コンテナー内に残し、Todo は状態グループ
配下の折りたたみノードとして表示する。展開時は本文ノード、リプライ群、属性・保存状態を示す。

**Rationale**: 既存の TreeDataProvider、キーボード操作、アクセシビリティ説明、更新スケジュールを
再利用できる。別 Webview サイドバーを新設するより低リスクである。

**Alternatives considered**:

- 全面 Webview 化: ライブ編集には柔軟だが、TreeView の VS Code ネイティブなキーボード/アクセシビリティ
を作り直す必要がある。
- Todo をメモと別コンテナーに残す: 「同一サイドバーで完結」の情報構造を満たさない。

## Decision: 本文・リプライのライブ編集は Webview draft と明示保存を分離する

**Decision**: Webview は入力中の draft とプレビューをローカルに保持し、保存ボタン/コマンドだけが
DocumentStore に書き込む。保存前に文書バージョン、対象範囲、ディスク内容を検証する。

**Rationale**: 連続入力を可能にしながら、ファイル操作を明示的・競合検出可能に保つ。現在の
CustomTextEditor の安全な CSP、HTML 無効 Markdown、メッセージ検証の設計を引き継げる。

**Alternatives considered**:

- 入力ごとの自動保存: 外部編集との競合頻度と破損リスクを増やす。
- TreeView の InputBox だけを使う: 複数段落、ライブプレビュー、未保存入力の保持を満たせない。

## Decision: 競合は自動統合しない

**Decision**: 未保存 draft 中に外部変更を検出した場合、書き込みを中止し、外部変更版の再読み込み、
未保存内容のコピー、手動反映、再試行を提示する。

**Rationale**: 行番号だけで紐づく Todo ブロックを自動マージすると、本文・リプライの境界を壊したり、
無関係な外部編集を上書きしたりする可能性がある。

**Alternatives considered**:

- 非重複範囲だけ自動マージ: ブロック内の意味的な競合を確実に判定できない。
- draft または外部変更を常に優先: どちらかのユーザーデータを黙って失う。

## Decision: ライブ表示は安全な Markdown に限定する

**Decision**: HTML は無効、リンクは遷移不可のテキスト表現、画像は説明テキストとして扱う。複雑な
Markdown 構造は読める表示を維持するが、直接編集ではなく生 Markdown へ案内する。

**Rationale**: Webview で外部スクリプトやリモート画像を実行・取得せず、構造破壊を避けられる。

**Alternatives considered**:

- Webview で HTML/外部画像を許可: セキュリティとプライバシーの要件に反する。
- 全 Markdown を直接リッチ編集: パーサー往復で構造を保持できず、複雑性が過剰になる。
