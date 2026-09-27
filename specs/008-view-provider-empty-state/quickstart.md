# Quickstart: ビュー起動と空状態からの作成

## 前提条件

- Node.js と npm
- VS Code 1.138 以上
- 拡張機能の依存関係をインストール済み
- Extension Development Host で開けるワークスペース

```powershell
npm ci
```

## 自動検証

```powershell
npm run lint
npm run compile
npm run compile-tests
npm test
```

期待結果:

- Lint とコンパイルが成功する。
- contributed view ID、activation events、provider registration、empty-state command が契約と一致する。
- TreeDataProvider の空・非空状態、既存作成コマンド、キャンセル・作成後の一覧更新がテストを通過する。

## 手動シナリオ

1. Extension Development Host を新しいワークスペースで起動し、初めて QuickNoteMD の各ビューを開く。メモ、Todo、統合ビューが provider 未登録エラーなしで表示されることを確認する。
2. Extension Development Host を再読み込みし、各ビューを初回表示する。読み込みが完了する前に正常な空状態や作成ボタンが表示されないことを確認する。
3. 空の保存先でメモ TreeView を開き、welcome action からメモを作成する。メモ一覧が更新され、管理対象ディレクトリに Markdown が作られることを確認する。
4. Todo TreeView の welcome action から Todo を作成する。Todo が `todo.md` に保存され、Todo TreeView が通常の状態グループへ更新されることを確認する。
5. 統合ビューに戻り、メモも Todo もない空の保存先で「新規メモ」「新規 Todo」ボタンが表示され、それぞれ既存の入力・保存操作を開始できることを確認する。
6. 作成入力をキャンセルする。空ファイルや空の Todo ができず、表示状態が空のまま保たれることを確認する。
7. メモのみ、Todo のみ、両方がある状態をそれぞれ開く。正常空状態の welcome/buttons は表示されず、存在するデータが一覧に表示されることを確認する。
8. ワークスペースなしと、一覧読み込みエラーになる保存先を試す。案内が正常な空状態と区別され、作成ボタンが誤表示されないことを確認する。
9. マウスを使わず、TreeView welcome actions と統合ビューの作成ボタンを実行する。フォーカス可能で、名前・目的がスクリーンリーダーから確認できることを確認する。

詳細な view ID、状態遷移、操作契約は [view lifecycle contract](./contracts/view-lifecycle-contract.md)、既存データの前提は [data model](./data-model.md) を参照する。
