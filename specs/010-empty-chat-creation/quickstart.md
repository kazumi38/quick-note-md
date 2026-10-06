# クイックスタート: 空状態からのチャット作成

## 前提条件

- Node.js と npm が利用可能で、リポジトリの依存関係をインストール済みであること。
- VS Code Extension Test を実行可能な環境であること。

## 自動検証

```powershell
npm test -- --grep "Sidebar and settings|Chat view host integration"
```

期待結果:

- command と view contribution のテストが、新規チャット command の宣言・空状態リンク・view/title action を確認する。
- ChatView 統合テストが、開始操作から本文 draft が作られることと、既存の送信・保存・失敗時の draft 保持を確認する。

実装時の検証結果:

- `npm.cmd test -- --grep "Sidebar and settings|Chat view host integration|Extension commands"`: 16 passing。
- `npm.cmd test`: 103 passing、2 pending。TypeScript compile、webpack bundle、ESLint、VS Code Extension Test は終了コード 0。

型チェック、bundle、lint を含めたプロジェクト標準のテスト前処理も通す場合:

```powershell
npm test
```

## 手動確認

1. VS Code でチャットがまだ存在しないワークスペースを開き、QuickNoteMD の「チャット」ビューを開く。
2. 空状態の「新しいチャット」リンクを選ぶ。ビュータイトルの追加操作とコマンドパレットの「QuickNoteMD: 新しいチャット」からもビューが表示され composer が始まることを確認する。
3. composer が本文入力状態で開き、入力して送信するまで Markdown チャットファイルが作成されないことを確認する。
4. 作成済みチャットがある状態で新しいチャット操作を選び、新規 draft が始まる一方で既存一覧が残ることを確認する。
5. 送信を失敗させた場合、既存どおりエラーが通知され入力内容が保持されることを確認する。

手動確認の記録: 空の一時ワークスペースでチャットビューの「新しいチャット」をクリックし、composer が表示されることを確認。送信前にワークスペース内にファイルが作られないことも確認した。空状態と composer 表示状態のスクリーンショットをテストエビデンスとして保存した。command palette と view/title アイコンはこのシナリオでは未確認。
