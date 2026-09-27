# Quickstart: Todo 中心の統合メモサイドバー

## Prerequisites

- Node.js と npm
- VS Code 1.138 以上
- 依存関係をインストール済みであること

```powershell
npm ci
```

## Automated validation

```powershell
npm run lint
npm run compile-tests
npm run compile
npm test
```

期待結果:

- TypeScript コンパイルと ESLint が成功する。
- Markdown 解析・直列化、DocumentStore の競合保護、WebviewView、draft バックアップ、レンダリング安全性のテストが成功する。
- [Markdown storage contract](./contracts/markdown-storage-contract.md) の canonical layout と破損・未対応旧形式のケースを含む。

## Manual end-to-end scenario

1. VS Code の Extension Development Host で拡張機能を起動し、ノート保存先を開く。
2. `todo.md` に Todo を 1 件作成し、同じ QuickNoteMD サイドバーでファイル一覧と Todo 一覧が使えることを確認する。
3. Todo を展開し、本文を複数段落で記入する。中央エディタを切り替えず編集でき、入力中に整形結果が表示され、
   明示保存前は「未保存」と分かることを確認する。
4. 保存後に Markdown を生表示し、Todo 行の直後に本文境界があり、通常 Markdown の本文を読めることを
   確認する。[保存形式](./contracts/markdown-storage-contract.md) と一致すること。
5. 2 件のリプライを追加して保存し、古い順に表示されることを確認する。1 件を削除して確認をキャンセルし、
   何も変わらないことを確認する。再度承認し、対象だけが消えることを確認する。
6. 複数ラベルと対応日を設定する。同名ラベルを別 Markdown の Todo に付け、色とラベル名が同じことを
   確認する。色を使わずにラベル名・期限切れ/期限内/未設定を判別できることを確認する。
7. 未保存の本文を残したまま別 Todo・別ファイル・生 Markdown 表示へ切り替え、draft が
   `globalStorageUri` 配下の一時ファイルに退避され、同じサイドバーに戻ったとき復元されることを確認する。
   VS Code を再起動した後も draft の復元を提示すること、保存完了・明示破棄でバックアップが削除されることを確認する。
8. 未保存の本文を残している間に同じファイルを外部で変更する。保存時に自動統合されず、再読み込み、
   draft のコピー、手動反映、再試行を選べることを確認する。対象が見つからない場合もバックアップを保持する。
9. 本文・リプライ・属性を持つ Todo を削除し、対象一式が表示された確認の後、承認時だけ対象 Todo と
   直後の拡張ブロックが削除されることを確認する。
10. 壊れた境界、無効な日付、本文内のチェックボックスを含む文書を開く。壊れた Todo が読み取り専用で、
    本文内チェックボックスが Todo 数・未解決件数へ加算されず、生 Markdown へ移動できることを確認する。

## Performance spot check

本文・リプライを連続入力し、プレビューが入力中に更新されること、通常の一覧規模で操作を妨げる遅延が
ないことを目視確認する。固定の文書サイズや応答時間による合否閾値は設けない。
