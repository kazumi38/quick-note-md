# 実装計画: 入力中に描画する Markdown チャット UI

**ブランチ**: `kazumi38-009-feature-plan` | **日付**: 2026-10-04 | **仕様**: [spec.md](spec.md)

## 概要

既存の QuickNoteMD サイドバーを、Markdown ファイルを原本とするチャット一覧・スレッドへ置き換える。本文・返信の入力欄は別枠プレビューを持たず、ProseMirror の文書モデル上で入力位置に Markdown の整形結果を表示する。Markdown の字句解析、保存済み本文の安全な HTML 描画、メッセージの Markdown 入出力には既存の `markdown-it` を再利用する。ファイル更新は既存 `DocumentStore` の管理対象・dirty・競合・読み取り専用チェックを共有し、送信済み内容は対象範囲だけ更新する。

保存ファイルは `#` / `##` / `###` の見出し構造を維持し、各メッセージ本文を対応する標準 HTML コメントで囲む。これにより本文中の通常の見出しを構造と取り違えず、Markdown を使う他のツールからも会話本文を読める。入力中の Markdown はメッセージとして確定するまでファイルへ書かず、復旧用下書きだけを既存の `globalStorageUri` 系バックアップ方式で保持する。

## 技術コンテキスト

- **言語・実行環境**: TypeScript 6、Node.js Extension Host、VS Code API `^1.138.0`
- **主要依存**: 既存 `markdown-it` 14、VS Code Webview、ProseMirror の必要モジュール（`prosemirror-model`、`prosemirror-state`、`prosemirror-view`、`prosemirror-commands`、`prosemirror-history`、`prosemirror-keymap`、`prosemirror-inputrules`、`prosemirror-markdown`、表編集用 `prosemirror-tables`）。Tiptap、React、外部 CDN は追加しない。
- **保存**: ワークスペース管理対象ディレクトリ内の Markdown ファイル。復旧下書きは `ExtensionContext.globalStorageUri` 配下の JSON。
- **テスト**: 既存 Mocha / VS Code Extension Test、純粋関数の parser・serializer・保存ガードの単体テスト、Webview 結合・操作テスト。
- **対象プラットフォーム**: VS Code Webview を利用する Windows、macOS、Linux。
- **プロジェクト種別**: VS Code デスクトップ拡張機能。
- **性能目標**: 1,000行・32,000文字以下の入力に対する100操作中95操作以上で、変更から500ms以内に同じ入力欄の描画を更新。送信後2秒以内に一覧とスレッドへ反映。
- **制約**: 入力欄・保存済み本文で同一の Markdown 意味を維持する。Webview への任意 HTML、リンク遷移、外部画像取得を許可しない。既存ファイルの無関係な範囲・改行形式・未保存エディターを変更しない。
- **規模**: 既定の保存先以下の Markdown ファイルを列挙する個人用・ローカル機能。初期性能確認は仕様の測定サイズを使い、ファイル数・本文長を機能上限とはしない。

### 技術選択

- **ProseMirror を入力欄に使う**: 試作の contenteditable DOM 全体を Markdown へ再構成する方法は、選択位置、IME、Undo/Redo、Markdown 構文の損失を独自に再実装する必要があり、試作のシリアライザーも完全な Markdown 往復を保証していない。ProseMirror の明示的な文書スキーマとトランザクションを編集状態の正本とする。入力規則は Markdown の `**`、見出し、リスト、コード囲み等を同じ編集面で整形へ変換し、paste は同じ parser で解析する。Enter / Shift+Enter は独自 keymap で仕様の block 別挙動を優先する。
- **既存 `markdown-it` を引き続き使う**: `prosemirror-markdown` は markdown-it トークナイザーから ProseMirror 文書を構築し、Markdown へ直列化できる。標準 schema に含まれない GFM 表には `prosemirror-tables` と独自 token mapping / serializer を加え、タスク状態・名前付き注意書きも custom schema rules で扱う。保存済みメッセージは引き続き `renderSafeMarkdown` の HTML 無効・不活性リンク／画像の規則で描画する。別の一般 Markdown レンダラーは追加しない。
- **ProseMirror の構造 HTML を生 Markdown へ逆変換しない**: 入力は ProseMirror 文書から Markdown へ直列化し、Markdown から表示文書へは markdown-it を通す。一方向ずつ明示する。未知の構文を通常文字として保持できない場合は編集・送信を停止し、入力退避と原文編集を案内する。
- **送信済みメッセージの Markdown 本文は編集しない**: 送信後に許可する変更は本文内の未完了／完了マーカー切替だけとし、既存のガード済みテキスト編集で対象マーカーのみ置換する。

## 憲章チェック

### 計画前

| 原則 | 判定 | 根拠 |
|---|---|---|
| I. Markdown First とデータ所有権 | PASS | 会話本体は通常の `.md`。本文は標準 Markdown として残し、送信前入力は別の復旧用下書きに分離する。 |
| II. VS Code Native Experience とアクセシビリティ | PASS | サイドバー Webview と既存 VS Code API を使う。必要な直接編集体験のためのカスタム UI はスキーマ制約付きとし、名前付き状態・キーボード操作を用意する。 |
| III. 単純さと高速な操作 | PASS（理由を記録） | 編集状態・IME・Undo の信頼性は本機能の中心要件。ProseMirror の必要モジュールだけを追加し、別 renderer、React、ネットワーク機能を導入しない。 |
| IV. データ安全性と明確な責務 | PASS | `chatMarkdown` は解析・構造、`DocumentStore` はガード済みファイル操作、`chatView` は Webview 契約、編集モデルは入力に分離する。 |
| V. 仕様、検証、保守性の優先 | PASS | parser・serializer・保存ガードを VS Code UI から分離して検証し、失敗・競合・各 OS の境界ケースを受入テストに結び付ける。 |

計画時点のゲート違反なし。依存追加は通常の機能追加ではなく、試作で確認された contenteditable の状態管理リスクを避けるための限定的選択であり、実装時に Webview bundle size と最低限の依存数を確認する。

### 設計後

すべての保存データは読める Markdown ファイルに保ち、コメント境界を標準 HTML コメントに限定する。表示 HTML は既存 `markdown-it` 安全設定を維持し、入力 DOM は ProseMirror の許可スキーマから生成する。ファイル操作は保存先の範囲・未保存文書・外部変更・読み取り専用・対象範囲の検証を通す。チェック状態更新は新しいチャット構造の識別子と文書バージョンを再照合し、失敗時は入力状態を成功表示にしない。憲章チェックは PASS。新たな例外や複雑性超過なし。

## リポジトリ構成

### この機能の設計資料

```text
specs/009-realtime-markdown-chat/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── chat-markdown.md
│   └── webview-protocol.md
├── quickstart.md
└── tasks.md                 # /speckit-tasks で作成
```

### 実装対象の主要箇所

```text
src/
├── chatMarkdown.ts          # チャット構造解析、境界識別、メッセージ serializer
├── chatDrafts.ts            # チャット／セクション単位の復旧・競合照合
├── chatView.ts              # WebviewView、スナップショット、操作の検証・保存連携
├── documents.ts             # 既存 DocumentStore へ chat 作成・追記・チェック更新を追加
├── rendering.ts             # 既存 safe markdown-it renderer を継続利用
├── extension.ts             # 旧 TODO/MEMO view 登録をチャット view へ置換
├── webview/
│   ├── chat.ts              # Webview entry point; webpack bundles to media/chat.js
│   └── chatComposer.ts      # ProseMirror schema、markdown-it adapter、input/key rules
└── test/
    ├── chatMarkdown.test.ts
    ├── chatDrafts.test.ts
    ├── chatView.test.ts
    ├── chatComposer.test.ts
    └── chatMarkdown.compatibility.test.ts
media/
├── chat.js                  # src/webview/chat.ts から生成する Webview bundle
└── chat.css
package.json                 # editor modules と Webview build script
package-lock.json            # npm dependencies の lockfile
webpack.config.js            # Extension Host と Webview の bundle を定義
tsconfig.webview.json        # DOM 型を Webview entry に限定
```

**構成判断**: VS Code Extension Host がファイルアクセス、スナップショット、衝突・保存処理を担当する。Webview は ProseMirror 文書と画面を所有し、入力ごとに Extension Host へ描画依頼を往復せずローカルで即時更新する。Extension Host は送信・状態変更時に最新のファイル／文書状態を再検証する。依存は Webview bundle 内に閉じ、Extension Host へ DOM 用コードを読み込まない。

`src/webview/chat.ts` は Webview の TypeScript entry point、`media/chat.js` は webpack が生成する配布 bundle とする。CSS は `media/chat.css` を Webview HTML から読み込む。`src/test/chatComposer.test.ts` と `src/test/chatMarkdown.compatibility.test.ts` はそれぞれ編集モデルと既存 Markdown 互換性を検証する。

## 複雑性の追跡

| 追加要素 | 必要な理由 | より単純な代替を採用しない理由 |
|---|---|---|
| ProseMirror の最小モジュール | 入力中に整形される編集面で、構造化 Markdown、IME、選択、Undo/Redo、Enter 規則を一貫して扱う。 | 単純な `contenteditable` DOM 再直列化は構造の損失と入力状態管理を独自実装する。既存 safe-span renderer は既存文書の限定編集用で、新しい複数行本文を入力するエディターではない。 |
| HTML コメントのメッセージ境界 | `#`・`##`・`###` を通常の本文見出しとして保ちながら、ファイル上のスレッド・セクション・メッセージを曖昧なく識別する。 | 見出しレベルだけでは本文の通常見出しと構造境界を完全に区別できない。本文を `####` に制限する案も仕様に反する。 |
