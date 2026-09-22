# Quickstart: Todo に課題と対応方針を残す

## Prerequisites
- Node.js と npm が利用可能であること
- VS Code Extension Development Host を起動できること
- 値を保存するワークスペースが書き込み可能であること

## Setup
```bash
npm ci
npm run compile
```

## Validation Scenarios

### Scenario 1: 既存 Todo にコメントを追加する
1. `notes/` 配下の既存 Markdown に Todo を 1 件作成する
2. QuickNoteMD の Todo ビューでその項目を選択する
3. コメント追加操作を実行し、背景・調査内容・対応方針を複数行 Markdown で入力する
4. 保存後に、再表示・再起動後も同じ Todo に紐づくコメントとして残ることを確認する

**Expected**
- タイトルとコメント一覧は区別される
- コメントは古い順に表示される
- 既存のタイトル・状態・他の Todo は変更されない
- 生 Markdown では、対象 Todo の直後に `<!-- quick-note-md:comments -->` と各コメントの境界が表示される

### Scenario 2: コメントの再編集と追記を行う
1. 既存コメントがある Todo を開く
2. 1件目を修正し、新しいコメントを末尾に追加する
3. 再開いて表示順と本文の正しさを確認する

**Expected**
- 既存コメントだけが更新される
- 新規コメントは末尾に追加される
- 中間のほかの Todo やタイトルは変更されない
- コメントの順序マーカーは変更されず、手動並び替えは行えない

### Scenario 3: 状態に依存せずコメント追加できる
1. 完了済み Todo と Warn / Skip / IMP の項目を用意する
2. それらの項目からコメント追加・編集を実行する
3. 状態を戻さずに保存できることを確認する

**Expected**
- コメントは保存される
- 状態は操作によって自動的に変わらない
- UI では色だけでなくラベルや状態名で確認できる

### Scenario 4: 同名 Todo と削除確認の境界を確認する
1. 同一タイトルの Todo を複数ファイルに作成する
2. 1つの Todo のコメント群だけを編集し、他の同名項目に影響しないことを確認する
3. Todo を削除し、確認ダイアログでキャンセルしたときは何も変化しないことと、承認時に対象範囲だけ削除されることを確認する

**Expected**
- 同名項目の誤編集がない
- 削除は対象 Todo とそのコメント群に限定される
- キャンセル時は恒久的な破壊がない

### Scenario 5: 競合・曖昧入力・外部変更の安全性を確認する
1. 別プロセスで対象 Markdown を変更してからコメント保存を試みる
2. コメント境界が曖昧な行を含むファイルにアクセスする
3. 外部スクリプトやリモート画像を自動取得しないことを確認する

**Expected**
- 競合時は保存を拒否し、再読込/再試行の案内が出る
- 破損・曖昧なコメントは読み取り専用で警告される
- 外部コンテンツが自動実行されない

## Test Commands
```bash
npm run lint
npm run compile
npm test
```

## Manual Checks
- 既存の 6 状態とタイトルのみの Todo を維持できること
- コメント 0 件の Todo が通常どおり扱えること
- コメントの表示順が古いコメントから新しいコメント順であること
- 既存の Markdown の対象外部分を編集せずに保てること
- Markdown を通常のファイルとして開いても、コメントの境界と内容が理解できること

## References
- Spec: [spec.md](./spec.md)
- Research: [research.md](./research.md)
- Data model: [data-model.md](./data-model.md)
- Commands: [contracts/todo-comment-contract.md](./contracts/todo-comment-contract.md)
- Storage: [contracts/markdown-storage-contract.md](./contracts/markdown-storage-contract.md)
