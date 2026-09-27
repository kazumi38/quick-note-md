# Research: ビュー起動と空状態からの作成

## Decision: provider 登録と view ID の整合を起動境界で保証する

**Decision**: `quick-note-md.sidebar`、`quick-note-md.memos`、`quick-note-md.todos` の各 view ID と、それぞれの `WebviewViewProvider` / `TreeDataProvider` 登録を一対一で維持する。provider は一覧の非同期読み込みを始める前に拡張機能の `activate` 内で登録する。既存の明示 `onView:<id>` activation events は維持し、manifest と provider の ID をテストで照合する。

**Rationale**: VS Code は extension-contributed view が開かれる時に `onView:<id>` を activation event として扱う。既存の provider 登録自体は同期実行だが、manifest と登録先の不一致、provider 登録前の例外、非同期登録への変更はビューの初回表示失敗につながり得る。実際の「provider 未登録」表示の発生原因は確認できていないため、単に表示を隠すのではなく、ID と登録順序を保護する。

VS Code 1.74 以降は contributed view が暗黙に activate されるため、明示 activation event は必須ではない。本プロジェクトはユーザーが報告した初回表示問題に対して view と起動条件の対応を明瞭に保つため既存宣言を維持するが、明示宣言だけで provider 登録まで保証されたとは見なさず、登録順序と実 view ID を検証する。

**Alternatives considered**:

- activation event だけを追加して provider registration を未検証にする: manifest の対象 ID と登録先の食い違いを防がない。
- データ取得後に provider を遅延登録する: 初回表示と非同期読み込みの競合を招く。
- エラーメッセージを隠す: provider が未登録のまま操作不能となり、根本原因を隠す。

**References**:

- [VS Code Activation Events — onView](https://code.visualstudio.com/api/references/activation-events#onview): view 展開による activation を説明。VS Code 1.74 以降、contributed views は暗黙に activate されるため明示宣言は必須ではない。現在の `engines.vscode` は 1.138 以上。
- [VS Code API declarations](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts): `WebviewViewProvider`, `TreeView`, `TreeDataProvider` の契約。

## Decision: TreeView の正常な空状態は `viewsWelcome` で作成可能にする

**Decision**: メモ・Todo の TreeView が正常に読み込まれて子要素ゼロの場合は、`contributes.viewsWelcome` から既存の `quick-note-md.newMemo` または `quick-note-md.newTodo` を呼び出す command link を表示する。Todo provider は全ステータスの空グループを常時返さず、実際に Todo があるグループだけを返す。welcome の可視性は初回ロードが終わり、対応一覧が空だと判明した後に限る。

**Rationale**: VS Code の welcome content は `TreeView.message` が空で、ツリーに子要素がない場合に表示される。単独行の command link はボタンとして描画され、`TreeView.message` は plain string で command link を扱えない。従って通常の空状態では message を設定せず、読み込み中とエラーでは welcome を抑止する必要がある。

**Alternatives considered**:

- 空状態を `TreeView.message` に案内する: 押せる作成アクションを置けない。
- Todo の空ステータスグループを残したまま `viewsWelcome` を使う: ルート要素が残るため空 TreeView と判定されない。
- 既存の `view/title` 作成アイコンのみに依存する: 初回ユーザーに空状態からの行動を明示できない。

**References**:

- [VS Code Contribution Points — `viewsWelcome`](https://code.visualstudio.com/api/references/contribution-points#contributes.viewsWelcome): welcome は空の TreeView のみ対象。ツリーに children がなく `TreeView.message` が設定されていない状態を空とし、単独行の command links はボタン表示される。
- [VS Code API declarations](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts): `TreeView.message` は optional `string`、`TreeDataProvider.getChildren` は root/element の child array を返す。

## Decision: 統合 WebviewView はロード結果に応じて空表示とアクションを描く

**Decision**: 統合ビューの状態を `loading`、`ready`（データあり）、`empty`、`unavailable`（ワークスペースなし）、`error`（一覧取得失敗）に分ける。`empty` の場合だけメモ/Todo 作成ボタンを表示し、Webview メッセージから既存の作成コマンドに中継する。エラー時は理由を表示し、作成ボタン付きの空状態として扱わない。

**Rationale**: `viewsWelcome` は TreeView 専用であり、既存の `SidebarView` は WebviewView である。現状はファイル読込に失敗すると空ファイル一覧を返し、読み込み中も Webview の初期 snapshot が空一覧として描画され得る。Webview 内で状態を明示することで、誤認と誤った作成導線を避けられる。

**Alternatives considered**:

- TreeView の `viewsWelcome` を統合 Webview に適用する: API 対象外。
- 初期 snapshot の空配列を正常空状態と扱う: 読み込み前または失敗時に誤った空状態を表示する。
- Webview から Markdown を直接書く: 既存のコマンド検証・DocumentStore のデータ安全性を迂回する。

**References**:

- [VS Code Webview Views](https://code.visualstudio.com/api/extension-guides/webview#webview-views): `WebviewViewProvider` が自身の WebviewView UI を解決・描画する。
- [VS Code Activation Events — onView](https://code.visualstudio.com/api/references/activation-events#onview): contributed view が開く時の activation lifecycle。

## Decision: 新規作成には既存コマンドと Markdown 保存規則を再利用する

**Decision**: 空状態アクションはすでに登録済みの `quick-note-md.newMemo` / `quick-note-md.newTodo` コマンドへ接続する。メモ名の検証・連番、Todo の `todo.md` 作成/追記、キャンセル、書込み失敗は既存の `extension.ts` と `DocumentStore` の動作を維持する。

**Rationale**: 既存コマンドは VS Code UI 入力を通じて title/text を検証し、既存管理領域に Markdown として保存する。もう一つの作成実装を追加すると、保存形式や失敗時の扱いが分岐する。

**Alternatives considered**:

- 各ビューで独自作成ロジックを実装する: 重複した入力検証、ファイル命名、保存制御を生む。
- 空状態から空ファイルを先に生成し後で入力させる: キャンセル時に不完全ファイルを残す。

**References**:

- Repository: `src/extension.ts` (`newMemo`, `newTodo` command handlers)
- Repository: `src/documents.ts` (`createMemo`, `createTodo`)
