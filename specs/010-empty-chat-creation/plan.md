# 実装計画: 空状態からのチャット作成

**ブランチ**: `kazumi38-fix-empty-chat-create` | **日付**: 2026-10-07 | **仕様**: [spec.md](./spec.md)

**入力**: `/specs/010-empty-chat-creation/spec.md`

## 概要

チャットがない状態で表示される案内文に、既存の新規チャット下書き開始処理を呼ぶ `quick-note-md.newChat` コマンドリンクを追加する。同じコマンドをチャットビューのタイトル操作にも登録し、Webview の空状態表示前や表示に問題がある場合も、VS Code 標準のビュー操作から開始できるようにする。Webview の既存「新しいチャット」ボタンも同じ処理へ委譲し、入口ごとの挙動を統一する。新しい保存形式・依存関係・チャット作成処理は追加しない。

## 技術コンテキスト

- **言語・実行環境**: TypeScript 6、Node.js Extension Host
- **主要依存**: VS Code Extension API 1.138 以上、既存 Webview。依存追加なし。
- **保存**: 既存の Markdown チャットファイルと `ChatDraftStore` を再利用。開始操作だけではチャットファイルを作成しない。
- **テスト**: Mocha / VS Code Extension Test、TypeScript コンパイル、ESLint。command contribution、空状態リンク、コマンド実行からの draft snapshot、既存のチャット操作を検証する。
- **対象プラットフォーム**: VS Code 1.138 以上の Windows、macOS、Linux
- **プロジェクト種別**: VS Code デスクトップ拡張機能
- **性能目標**: コマンド選択後、既存の draft snapshot を使って即時に composer を表示する。追加の一覧走査や外部処理を導入しない。
- **制約**: 初回利用者に見える明確な操作を置く。操作は既存の作成フローへ統一し、キャンセルや送信前の下書き扱い、保存失敗通知を維持する。
- **規模**: チャットビューの空状態と、ビュータイトルの新規作成操作のみ。

## 憲章チェック

### 計画前

| 原則 | 判定 | 根拠 |
|---|---|---|
| I. Markdown First とデータ所有権 | PASS | 新規チャットは既存の Markdown 保存形式を使い、作成操作だけでファイルを生成しない。 |
| II. VS Code Native Experience とアクセシビリティ | PASS | 空状態にはラベル付きコマンドリンク、ビュータイトルには名前付きコマンドを使用する。どちらもキーボード操作可能な VS Code 標準 UI。 |
| III. 単純さと高速な操作 | PASS | 既存コマンド・draft フローへ委譲し、状態モデルや依存を増やさない。 |
| IV. データ安全性と明確な責務 | PASS | 下書き・送信・永続化は既存 `ChatView` と `ChatDraftStore` に委譲し、開始ボタンからファイルを直接書かない。 |
| V. 仕様、検証、保守性の優先 | PASS | manifest と command の整合、およびユーザーから見える開始動作を既存拡張テストで検証する。 |

計画前ゲートに違反なし。重大な技術的不明点はなく、既存のビュー空状態・新規チャット処理と同じ構成を再利用する。

## Phase 0: 調査結果

詳細は [research.md](./research.md) を参照。リポジトリ内の実装・直前の空状態設計を確認し、次を決定した。

- `package.json` の現在の `viewsWelcome` は静的な案内であり、そこに作成コマンドへのリンクがない。
- `src/webview/chat.ts` には Webview が描画された後に使える「新しいチャット」ボタンがある。ボタンは `newChat` メッセージを送り、`src/chatView.ts` が新規 composer draft を作る。
- 空状態が VS Code 標準の welcome 表示になった場合にも開始できるよう、welcome の案内文を `quick-note-md.newChat` への command link にする。さらに同一コマンドを view/title に追加して、常時の作成経路を設ける。
- コマンド、welcome link、既存 Webview ボタンは、同じ `ChatView` の draft 初期化処理に集約する。新しいチャットは送信まで永続化しない。

外部技術選択や未解決の仕様事項はなく、追加の技術調査は不要。

## Phase 1: 設計

### データと状態

変更対象の状態は永続データではなく既存の `ComposerDraft`。新しいチャット開始時に `ChatView` が本文セクション用の空 draft を作成し、Webview snapshot で composer に表示する。入力内容は既存の `ChatDraftStore` により復旧用に保存され、送信時のみ Markdown チャットファイルが作成される。詳細は [data-model.md](./data-model.md)。

### インターフェース契約

新たに寄与する `quick-note-md.newChat` コマンド、空状態の command link、view/title 操作、および Webview の既存 `newChat` メッセージ間の動作を [contracts/new-chat-entry.md](./contracts/new-chat-entry.md) に定義する。独立した外部 API は追加しない。

### 検証手順

[quickstart.md](./quickstart.md) に自動テストと空状態・既存チャット・作成失敗時の手動確認を記載する。実装タスクでは最低限 `src/test/sidebar.test.ts` と `src/test/chatView.integration.test.ts` の回帰確認を追加する。

## 憲章チェック（設計後）

| 原則 | 判定 | 設計上の確認 |
|---|---|---|
| I. Markdown First とデータ所有権 | PASS | 保存形式も実際の作成タイミングも変更しない。 |
| II. VS Code Native Experience とアクセシビリティ | PASS | 作成リンクには明確な日本語ラベルを付け、VS Code 標準の command link と view/title action を使う。Webview 内の既存ボタンも残す。 |
| III. 単純さと高速な操作 | PASS | コマンドから既存 `ChatView` draft 初期化を呼び出し、重複実装を避ける。 |
| IV. データ安全性と明確な責務 | PASS | 空操作はファイルを書かず、送信・失敗処理・復旧は既存フローに任せる。 |
| V. 仕様、検証、保守性の優先 | PASS | manifest のリンク・view/title command とコマンド登録を自動検査し、draft 作成を統合テストで確認する。 |

設計後もすべて PASS。憲章違反や複雑性の例外なし。

## リポジトリ構成

### この機能の設計資料

```text
specs/010-empty-chat-creation/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   └── new-chat-entry.md
├── quickstart.md
└── tasks.md                 # /speckit-tasks で作成
```

### 関連実装とテスト

```text
package.json                         # newChat command、空状態リンク、view/title action
src/
├── extension.ts                     # VS Code command を既存 ChatView へ接続
├── chatView.ts                      # draft 開始処理を共有可能にする
├── webview/chat.ts                  # 既存 Webview 操作を維持
└── test/
    ├── sidebar.test.ts              # command/welcome/menu contribution の契約
    └── chatView.integration.test.ts  # command 起点での新規 draft 開始
```

**構成判断**: 既存の extension command 登録と `ChatView` の責務境界を再利用する。manifest は VS Code 標準 UI の導線を宣言し、extension host が draft を作成し、Webview は受け取った snapshot から composer を描画する。独立した作成サービス、データモデル、永続化形式は追加しない。

## 複雑性の追跡

憲章チェックに違反はない。追加の依存・抽象化・永続状態は不要。
