# Quickstart: Issue 一覧のラベル絞り込み

## 前提

- リポジトリのルートでNode.jsとnpmを利用できる。
- VS CodeテストランタイムとPlaywrightの既存開発依存がインストールされている。
- `npm run test:e2e` でVS Codeを起動できる。

## 実行コマンド

```sh
npm ci
npm test
npm run test:e2e
npm run lint
```

`npm test`は既存のissue store・viewテストを含むユニットテストを実行する。`npm run test:e2e`はVS Codeサイドバー上の利用者操作を検証する。テストは既存のIssueシードデータヘルパーと使い捨てワークスペースを使う。

## ユーザーストーリー別の手順とE2Eテストケース

### P1 — ラベルでIssueを絞り込む

**利用手順**

1. 異なるラベルを持つ複数のIssueがあるワークスペースでIssue一覧を開く。
2. ラベル条件から既存ラベルを1つ選ぶ。
3. 選んだラベルを持つIssueだけが残ることを確認する。
4. 選択条件を解除し、ラベル条件を除いた一覧へ戻ることを確認する。

**E2Eケース**: `filters Issues by one label and clears only the label condition`

- `bug`、`docs`、ラベルなしのIssueをシードする。
- `bug`を選び、`bug`付きIssueのみ表示されることを確認する。
- 選択中の条件が見えることを確認し、解除後に全Issueへ戻ることを確認する。
- 検索語または状態も組み合わせて一致結果を0件にし、検索結果なしが「Issueはまだありません」と区別されることを確認する。

### P2 — 検索語・状態と組み合わせる

**利用手順**

1. 検索語を入力する。
2. OpenまたはClosedを選ぶ。
3. ラベルを1つ選び、結果が3条件すべてに一致することを確認する。
4. ラベル条件だけ解除し、検索語と状態は維持されることを確認する。

**E2Eケース**: `combines label, state, and text filters without changing Issue files`

- 検索語・状態・ラベルの組み合わせが異なるIssueをシードする。
- 条件を一つずつ設定し、結果がAND条件になることを確認する。
- 大文字小文字の異なるラベルを区別し、ラベルなしIssueがラベル指定時に除外されることを確認する。
- 絞り込み前後のMarkdown内容と更新日時が一致することを確認する。

### P3 — 詳細を確認して一覧へ戻る

**利用手順**

1. P1/P2の手順で複数条件を設定する。
2. 結果のIssue詳細を開く。
3. 「一覧へ戻る」を選ぶ。
4. 選択条件・結果が元のまま表示されることを確認する。

**E2Eケース**: `preserves label filter when returning from Issue detail`

- 複数ラベルのシードIssueを使い、ラベルを含む条件を設定する。
- 詳細画面へ移動してから一覧へ戻る。
- 条件表示と該当Issue集合が維持され、他のIssueが混入しないことを確認する。

## 完了判定

- 3つのE2EケースがVS Codeサイドバー上で成功する。
- Store/Viewのテストでラベル候補範囲、完全一致、大小文字、条件合成、無効メッセージの拒否を確認する。
- `npm test`、`npm run test:e2e`、`npm run lint` が成功する。
- フィルター変更によるIssueファイル内容・更新日時の変更がない。

これらは実装時に追加・実行するケースであり、本計画作成時点での実行済みテスト結果ではない。

## 実装検証記録

- `npm ci`: 成功。lockfileに基づく依存関係を復元した。npm auditは依存パッケージに5件の脆弱性（Low 3、Moderate 1、High 1）を報告した。依存関係は本機能で変更していない。
- `npm run compile-tests`: 成功。ソースとユニットテストのTypeScriptコンパイルが完了した。
- `npm run compile`: 成功。拡張機能とWebviewのWebpackビルドが完了した。
- `npm run lint`: 成功。
- `npm test`: compile-tests、Webpack build、lintは成功したが、VS Codeテストランタイムの取得時に `getaddrinfo ENOTFOUND update.code.visualstudio.com` となり、テスト本体は実行できなかった。
- `npm run test:e2e`: 拡張機能ビルドとE2E TypeScript型検査は成功した。既存E2E fixtureがWindows専用のため、このLinux環境では6ケースすべてが実行前に停止した。Windows環境で再実行が必要。
