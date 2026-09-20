# Quickstart: メモ & Todo 管理（サイドバー統合）

## Prerequisites
- Node.js と npm が利用可能
- VS Code Extension 開発環境
- ワークスペース直下に書き込み可能

## Setup
```bash
npm ci
npm run compile
```

## Validation Scenarios

### Scenario 1: 新規メモ作成（US1）
1. 拡張機能ホストを起動し、QuickNoteMD のメモビューを開く
2. 「新規メモ」でタイトルを入力して確定
3. `notes/` 配下に `.md` が生成され一覧に表示されることを確認

**Expected**
- 空タイトルは拒否
- 同名時は一意名で作成

### Scenario 2: 既存メモ追記（US2）
1. 既存メモを選択して「メモに追記」実行
2. 1行テキストを入力
3. 末尾にのみ追記され既存本文が変わらないことを確認

**Expected**
- 改行なし末尾でも本文連結が発生しない
- 10 回連続追記で順序欠落なし

### Scenario 3: Todo 作成・完了・再開（US3）
1. 「新規 Todo」で項目を追加
2. 未完了一覧に表示されることを確認
3. 完了操作で完了一覧へ移動、再開で未完了へ戻ることを確認

**Expected**
- 保存形式は Markdown チェックボックス行
- 状態変更は記号のみ更新

### Scenario 4: Todo 削除とソース参照（US4）
1. Todo を選んで削除操作を実行し、確認ダイアログを承認
2. 対象行のみ削除されることを確認
3. 「ソースを開く」で対象ファイル/行に移動できることを確認

### Scenario 5: 外部編集との整合（US5）
1. メモを標準エディタで直接編集して保存
2. サイドバーを更新し、変更が反映されることを確認
3. その後の追記・Todo 操作が最新内容を基準に成功することを確認

### Scenario 6: 拡張機能を無効化しても Markdown を編集できる（FR-022 / SC-006）
1. `notes/` 配下の `.md` を標準 Markdown エディタで開く
2. 拡張機能を無効化しても本文がそのまま読めることを確認
3. テキストエディタで本文・Todo 行を編集して保存する
4. 拡張機能を再有効化し、一覧表示と次回操作が更新済み Markdown を基準に動作することを確認

## Test Commands
```bash
npm run lint
npm run compile
npm test
```

## Validation Log

- 2026-09-20: `npm run lint` ✅
- 2026-09-20: `npm run compile` ✅
- 2026-09-20: `npm test` ⚠️ `vscode-test` が `update.code.visualstudio.com` を解決できず失敗（`getaddrinfo ENOTFOUND`）。pretest の `compile-tests` / `compile` / `lint` は成功。

## Manual Checks

- 新規メモ、同名メモ、10 回の連続追記で既存本文の欠落・重複・順序崩れがないこと
- Todo の作成、完了、再開、削除、ソース参照で対象行以外が変わらないこと
- 既存メモの直接編集保存後に、次回表示・追記・Todo 操作が最新内容を使うこと
- 約 1,000 行規模の Markdown でメモを開く・追記する・Todo を完了する操作が継続して行えること
- 拡張機能を無効化した状態でも `.md` が通常の Markdown として読めて編集できること

## References
- Data model: [data-model.md](./data-model.md)
- Command contract: [contracts/sidebar-commands.md](./contracts/sidebar-commands.md)
- Storage contract: [contracts/markdown-storage-contract.md](./contracts/markdown-storage-contract.md)
