# Tasks: 入力中に描画する Markdown チャット UI

**入力**: `/specs/009-realtime-markdown-chat/` の設計資料

**前提資料**: `plan.md`、`spec.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`、`acceptance-tests.md`、`ux-guide.md`

**テスト方針**: 仕様・計画で parser、serializer、保存ガード、Webview 操作の検証を要求しているため、各ストーリーに対応した自動テストと手動受入確認を含める。

**構成**: 共通のビルド／データ安全基盤の後、優先度順にユーザーストーリー単位で実装する。各ストーリーの成果は独立して確認できる。

## Phase 1: Setup（共有インフラ）

**目的**: Webview 用エディター依存とビルド経路を追加する。

- [ ] T001 `package.json` と `package-lock.json` に計画記載の ProseMirror モジュール（`prosemirror-model`、`prosemirror-state`、`prosemirror-view`、`prosemirror-commands`、`prosemirror-history`、`prosemirror-keymap`、`prosemirror-inputrules`、`prosemirror-markdown`、`prosemirror-tables`）を追加し、Webview をビルドする npm script を定義する
- [ ] T002 `webpack.config.js` を拡張し、`./src/extension.ts` を Extension Host 用 `dist/extension.js` に、`./src/webview/chat.ts` を Webview 用 `media/chat.js` に bundle する別々の webpack configuration を定義し、ProseMirror を Extension Host bundle に含めない
- [ ] T003 [P] `tsconfig.webview.json` を新設し、Webview ソースを DOM 型で型検査しつつ既存の `tsconfig.json`／Extension Host 型設定から分離する

---

## Phase 2: Foundational（全ストーリーのブロッカー）

**目的**: ストーリー実装が共有するチャット形式、下書き保護、文書更新ガードを用意する。

**⚠️ このフェーズが完了するまでユーザーストーリー実装を開始しない。**

- [ ] T004 [P] `src/chatMarkdown.ts` に `contracts/chat-markdown.md` の厳密なチャット parser と型を実装する。先頭の `#` title、順序付き `##` section、`### YYYY-MM-DD HH:mm` message heading、32文字の小文字16進 message ID の開始／終了コメント対を解析し、本文内見出し・コード内見出し・未知 section を本文境界と誤認しない。不正・入れ子・欠損・重複 marker は書き込み不可として理由を返す
- [ ] T005 [P] `src/chatDrafts.ts` に `ComposerDraft` の globalStorage JSON 保存・復元を実装する。新規 draft とチャット／section ごとに分離し、schema version・revision・base fingerprint・最終 Markdown を保持し、壊れたデータや未知 schema を成功扱いせず回収可能なエラーにする
- [ ] T006 [P] `src/documents.ts` の `DocumentStore` にチャット対象の管理範囲・dirty document・外部変更・readonly・per-file queue の検証を再利用する操作境界を追加する。更新 URI と source range は Extension Host 内で解決し、既存の無関係な Todo／メモ更新挙動を維持する
- [ ] T007 `src/chatView.ts` に `contracts/webview-protocol.md` のメッセージ型と discriminant・必須項目・型・長さ検証を用意し、Webview からの URI、path、source offset、HTML を受理しない。snapshot generation と operation/draft revision を照合し、成功と失敗を明示する
- [ ] T008 [P] `src/test/chatMarkdown.test.ts` に marker の正常系、本文内の見出し・code fence、同時刻の別 message、未知 section、不正・曖昧構造の parser 単体テストを追加する
- [ ] T009 [P] `src/test/chatDrafts.test.ts` に draft の分離、復元、revision、破損 JSON、未知 schema、fingerprint 不一致時に自動適用しないことのテストを追加する

**チェックポイント**: チャット形式、下書き永続化、Webview 境界の共通契約が実装され、対応する純粋ロジックをテストできること。

---

## Phase 3: User Story 1 - 入力中の Markdown をチャット内で確認する（優先度: P1 / MVP）

**ゴール**: 本文・返信の composer 自体で Markdown を整形表示し、同じ場所で編集を続けられる。

**独立テスト**: 1,000行・32,000文字以下の下書きに入力、削除、貼り付け、Undo/Redo を100回行い、95回以上で操作から500ms以内に入力欄が最新表示になること。Enter、Shift+Enter、日本語 IME 中にキャレット・選択・入力内容が保たれ、送信前にチャット Markdown ファイルが変更されないこと。

- [ ] T010 [P] [US1] `src/test/chatComposer.test.ts` に Markdown parse/serialize 往復、未完成記法、paste、強調・見出し・状態付き項目・INFO/WARN callout・GFM 表の編集モデルテストを追加する
- [ ] T011 [US1] `src/webview/chatComposer.ts` に ProseMirror schema と `markdown-it` token mapping／serializer を実装し、見出し、段落、強調、リスト、引用、code、GFM 表、`- [ ]`／`- [x]`／`- [i]`／`- [!]`／`- [n]`／`- [-]`、`> [!INFO]`／`> [!WARN]` を表現する。許可 schema 外の HTML を編集 DOM に取り込まず、未知構文を黙って破棄しない
- [ ] T012 [US1] `src/webview/chatComposer.ts` に input rule、貼付 parser、history、keymap を実装し、変換中に editor DOM を置換せず、変換確定後に同じ editor state を更新する。選択・キャレットを保持し、古い revision の描画結果を適用しない
- [ ] T013 [US1] `src/webview/chatComposer.ts` の Enter／Shift+Enter／Backspace 操作を仕様どおり実装する。Enter は送信せず、見出し末尾は通常段落へ、list は次項目へ、check item は未完了項目へ、callout は内部改行へ進み、空項目で書式退出、Shift+Enter は同じ書式内で改行する
- [ ] T014 [US1] `src/webview/chatComposer.ts` に composer task checkbox の click・keyboard toggle を追加し、下書き ProseMirror state のみを更新して `- [i]`／`- [!]`／`- [n]`／`- [-]` の状態は変更しない
- [ ] T015 [US1] `media/chat.css` に入力欄内の見出し・通常段落・名前付き状態・INFO/WARN callout・表・コードの表示規則を追加し、入力欄自体が描画と直接編集を兼ねるスタイルにする
- [ ] T016 [US1] `src/webview/chat.ts` から `src/webview/chatComposer.ts` を初期化して Webview UI を構築し、webpack の出力先 `media/chat.js` と `media/chat.css` を読み込む。本文／返信の draft ID・section ID・revision を送る `draftChanged` と `draftAck` を接続し、入力変更だけで send を発火させない
- [ ] T017 [US1] `src/test/chatComposer.test.ts` と `specs/009-realtime-markdown-chat/acceptance-tests.md` を使って IME、選択置換、Enter／Shift+Enter、Backspace、全削除、Undo/Redo、連続編集、500ms性能基準を検証し、測定結果を受入記録へ記入する

**チェックポイント**: 新規本文／返信の未送信入力がチャットファイルを変更せず、同じ入力欄で整形・編集できること。

---

## Phase 4: User Story 2 - チャット一覧から保存済み会話を読む（優先度: P1）

**ゴール**: 旧 Todo／Memo 管理 UI をチャット一覧と選択中スレッドに置き換え、保存済み Markdown を安全に表示する。

**独立テスト**: 管理対象に3つのチャットファイルを用意し、一覧から各チャットを選択する。タイトル、section、時刻、順序付き message、本文 Markdown、未対応形式の識別が正しく表示され、選択外のスレッド内容が混ざらないことを確認する。

- [ ] T018 [P] [US2] `src/test/chatMarkdown.compatibility.test.ts` にファイル内順序、本文見出し、未知 section、legacy形式、title欠損、複数 title、日時不正、marker破損時の読取可否・書込禁止テストを追加する
- [ ] T019 [US2] `src/chatMarkdown.ts` に parse 済み ChatThread／ChatSection／ChatMessage から message marker と timestamp heading を生成する serializer を追加する。message ID は暗号学的乱数16 bytesを小文字hex32文字へ変換し、timestamp を一意性に使わず、予約形式 marker を含む本文は拒否する
- [ ] T020 [US2] `src/documents.ts` の `DocumentStore` に管理対象 `.md` ファイルのチャット一覧・読込処理を追加し、既存の symlink／root guard と mtime降順・URI安定順を維持して URI を Webview に露出しない内部 chat ID へ変換する
- [ ] T021 [US2] `src/chatView.ts` に WebviewView provider と snapshot builder を実装し、選択中 chat の section/message をファイル順に渡す。marker を本文 HTML に含めず、`src/rendering.ts` の safe renderer を使い、dirty／legacy／unsupported を明示する。message 内の `[ ]`／`[x]` は対象 message ID・task ID・document version を付けた操作可能な checkbox として表示し、状態付き項目は checkbox にしない
- [ ] T022 [US2] `src/extension.ts` で旧 Todo／Memo view 登録をチャット view に置換し、一覧・新規チャット操作・チャット選択・原文を開く操作・refresh を登録する。既存 Markdown 原文編集機能は残し、旧 Todo/Memo UI をチャット view に残さない
- [ ] T023 [US2] `package.json` の `contributes.views`、`viewsWelcome`、activation events、view title menus をチャット UI に合わせ、旧 Todo/Memo の分類・作成・カード操作を view から除去する。既存の原文編集・閲覧コマンドは必要な範囲で維持する
- [ ] T024 [US2] `src/test/chatView.test.ts` に一覧・選択 snapshot、チャットなし／workspaceなし、未知 section表示、unsupportedファイル識別、原文を開く操作、古いgenerationを破棄する挙動、送信済み `[ ]`／`[x]` の checkbox 表示と `[i]`／`[!]`／`[n]`／`[-]` が操作対象にならないことのテストを追加する
- [ ] T025 [US2] `specs/009-realtime-markdown-chat/acceptance-tests.md` と `specs/009-realtime-markdown-chat/quickstart.md` の手順で3ファイルの一覧・選択・安全な描画・原文導線を検証し、対象 VS Code／OS の結果を記録する

**チェックポイント**: チャット選択で対応するファイルだけが表示され、旧 Todo/Memo UI なしで空状態・未対応形式もユーザーに説明されること。

---

## Phase 5: User Story 3 - 本文・返信を送信して Markdown に保存する（優先度: P1）

**ゴール**: 新しいチャットを1ファイルとして作成し、返信を同ファイルの section 末尾へ最小範囲で追記する。

**独立テスト**: 新規チャット1件と返信2件を送信し、作られた Markdown ファイルが正確に1つであること、再読込後にタイトル・section・message順・Markdown意味が一致することを確認する。

- [ ] T026 [P] [US3] `src/test/documents.test.ts` に chat file の排他的作成、タイトル衝突時の安全な別名、返信 section 末尾への最小追記、未知内容・既存改行保持、対象外範囲を変更しないことのテストを追加する
- [ ] T027 [P] [US3] `src/test/chatView.test.ts` に空白 title/body の拒否、send revision重複の拒否、保存成功・失敗結果、成功したrevisionだけを消去する protocol テストを追加する
- [ ] T028 [US3] `src/documents.ts` に新規チャット作成と既存チャットへの返信追記を追加する。title は空白不可、body は空白だけ不可とし、同名ファイルを上書きせず、既存 source・未知 section・LF/CRLF・末尾改行状態を保持して対象 section だけを更新する
- [ ] T029 [US3] `src/chatView.ts` の send handler で draft ID・revision・section・本文・title を再検証し、Host 側でローカル日時 `YYYY-MM-DD HH:mm` と message ID を生成する。新規 thread は初回送信でのみファイル化し、返信 section がなければ作成し、処理中の二重送信を拒否する
- [ ] T030 [US3] `src/chatDrafts.ts` と `src/chatView.ts` を連携し、保存成功後に送信したrevisionの下書きだけを削除して snapshot を更新する。処理中に入力された新revisionと保存失敗時の下書きは保持する
- [ ] T031 [US3] `src/test/documents.test.ts`、`src/test/chatView.test.ts`、`specs/009-realtime-markdown-chat/acceptance-tests.md` で新規1件＋返信2件、本文内見出し、連打、保存失敗、再読込後の一致、2秒以内の一覧反映を検証し結果を記録する

**チェックポイント**: 初回送信から返信追加・再読込まで一貫し、失敗・重複送信・後続入力によるデータ損失がないこと。

---

## Phase 6: User Story 4 - 外部編集と保存失敗から入力を保護する（優先度: P2）

**ゴール**: 原文の未保存変更、外部変更、削除・移動、readonly、保存失敗を画面へ反映し、下書きを失わず安全に再開できる。

**独立テスト**: 選択中のファイルを原文でdirtyにし、外部編集・削除・移動・readonlyも試す。dirty表示と送信停止が行われ、下書きが維持され、保存／破棄後にfingerprintを照合し、差異を競合として扱うことを確認する。

- [ ] T032 [P] [US4] `src/test/chatDrafts.test.ts` に再起動後復元、chat/section間の分離、base fingerprint一致・不一致、削除済みURI、競合draftの明示的復旧・破棄をテストする
- [ ] T033 [US4] `src/extension.ts` の workspace document／filesystem watcher をチャット view refresh に接続し、作成・変更・削除・移動とVS Code原文のdirty／save／revertで一覧 title・thread・未保存状態を更新する。既存監視を重複登録しない
- [ ] T034 [US4] `src/chatView.ts` の send／toggleTask handler で最新のVS Code文書・disk fingerprint・readonly・target identityを再照合し、dirty document中の保存を拒否する。送信済み task の切替では `src/documents.ts` が最新 Markdown から message/task を一意に再特定し、対象 `[ ]`／`[x]` marker だけを置換して他の本文・改行・項目を保持する。dirty解消後にdraft基準との差があれば下書きを保持して競合確認を求め、ユーザーが再操作した場合のみ最新 section への新規追記または一意な marker 更新を再検証し、自動上書き・自動送信しない
- [ ] T035 [US4] `src/chatDrafts.ts` に対象ファイル消失・移動・保存先設定変更時の orphan draft 状態と回収可能な表示情報を追加し、復元・破棄の明示操作まで自動送信や別チャットへの適用を行わない
- [ ] T036 [US4] `src/test/chatView.test.ts` と `src/test/documents.test.ts` に dirty／external conflict／readonly／missing target／save failureで保存を停止し、本文・他task・返信draftを保持して失敗理由を返すテストを追加する。送信済み task toggle 成功時は対象 marker のみが変わること、古い document version・消失／重複 task・失敗時は marker と UI 上の確定状態が変わらないことも検証する
- [ ] T037 [US4] `specs/009-realtime-markdown-chat/acceptance-tests.md` の外部編集・dirty・save/revert・削除・readonly・保存失敗ケースを実行し、各ケースで2秒以内の更新または明示エラーとdraft回収を確認して結果を記録する

**チェックポイント**: ファイル状態を安全に再確認できない操作は成功扱いにならず、下書きと既存本文を回収可能なまま保持すること。

---

## Phase 7: User Story 5 - 狭いパネルで安全・アクセシブルに操作する（優先度: P2）

**ゴール**: 幅280px以上で主要操作を保ち、キーボードのみで操作でき、Markdown由来HTML・link・画像を安全に扱う。

**独立テスト**: 280px、400px、800pxで長い日本語、200文字URL、code、tableを表示し、パネル全体の横overflowと主要操作の欠落がないことを確認する。キーボードのみの作成・選択・入力・送信・原文表示・復旧を行い、危険なHTML・link・imageを入力／表示して実行・遷移・外部取得が起きないことを確認する。

- [ ] T038 [P] [US5] `media/chat.css` に幅280px以上の responsive layout、長文・日本語・URL wrap、code/table領域内の横scroll、視認可能なfocus・selected・dirty・error表示を実装し、panel全体の横scrollを防ぐ
- [ ] T039 [US5] `src/webview/chat.ts` と `src/chatView.ts` に一覧選択、composer、送信、source表示、エラー・draft復旧、送信済み task checkbox のキーボード操作を実装し、ARIA label/status と日本語テキストで状態を伝えて色・iconだけに依存しないようにする。競合・dirty・保存失敗時は「下書きをコピー」「原文を開く」「最新状態を再読み込み」を提示し、明示的な再送信／再toggle操作まで draft を保持する
- [ ] T040 [US5] `src/webview/chatComposer.ts` と `src/chatView.ts` の Webview security boundary を確認・強化し、CSPを維持し、Markdown由来のscript/event attributeを実行せず、危険なlinkを遷移不可、imageを外部取得なしで表示する
- [ ] T041 [P] [US5] `src/test/rendering.test.ts` と `src/test/chatView.test.ts` にscript、event attribute、危険なlink、外部imageが入力中・保存後とも実行／遷移／取得されず、CSPと安全なHTML生成が保たれるテストを追加する
- [ ] T042 [US5] `specs/009-realtime-markdown-chat/acceptance-tests.md` の表示幅280px／400px／800px、危険Markdown、キーボードのみ、色なし状態識別、競合時の下書きコピー・原文表示・再読込・明示的再試行の受入ケースを実行し、対象 OS・結果を記録する

**チェックポイント**: 狭いパネルとキーボード操作においても全機能へ到達でき、外部コンテンツが無断実行・取得されないこと。

---

## Phase 8: Polish & Cross-Cutting Concerns

**目的**: 全ストーリーの統合、回帰確認、ドキュメントを仕上げる。

- [ ] T043 [P] `specs/009-realtime-markdown-chat/quickstart.md` を実際の scripts・view名・エラー復旧方法に合わせて更新し、初回セットアップから手動受入までの手順を一通り実行する
- [ ] T044 [P] `README.md` の機能説明と利用手順を新しいチャット一覧／スレッド UI に合わせ、置き換えた旧 Todo/Memo sidebar UI を現行機能として案内しない
- [ ] T045 `specs/009-realtime-markdown-chat/acceptance-tests.md` の AT-01〜AT-26 と success criteria SC-001〜SC-009 を対象OSで最終確認し、未達項目・環境・計測値を記録する
- [ ] T046 `package.json` の `compile-tests`、`compile`、`lint`、`test` scripts を実行して既存機能を含む回帰を確認し、失敗があれば関連タスクへ戻って修正する

---

## 依存関係と実行順

### Phase依存

- **Phase 1 Setup**: 他に依存せず開始できる。
- **Phase 2 Foundational**: Phase 1 の bundle／TypeScript 設定後に開始し、全ユーザーストーリーをブロックする。
- **Phase 3 US1** と **Phase 4 US2**: Phase 2 完了後に開始でき、別担当なら並行可能。
- **Phase 5 US3**: US1 の composer draft と US2 の thread／保存先が必要。
- **Phase 6 US4**: US2 の選択中ファイル・snapshot と US3 の保存操作が必要。
- **Phase 7 US5**: US1/US2/US4 の入力・表示・復旧 UI が必要。US3 完了後に統合受入を行う。
- **Phase 8 Polish**: すべての対象ストーリー完了後。

### User Story依存

- **US1 (P1)**: Foundational 後に開始可能。単独で入力中の描画と保存前の非変更を検証できる。
- **US2 (P1)**: Foundational 後に開始可能。US1 とは並行可能。保存済み一覧とスレッド閲覧を独立検証する。
- **US3 (P1)**: US1・US2 に依存し、送信とMarkdown永続化を追加する。
- **US4 (P2)**: US2・US3 に依存し、dirty／競合と送信・toggleの安全性を完成させる。
- **US5 (P2)**: 入力・thread・復旧 UI が揃った US1・US2・US4 に依存し、US3 も含む統合検証を行う。

### 並行実行の例

- Phase 1 では `T002`（webpack）と `T003`（Webview tsconfig）を独立して進められる。`T001` の package script 名と出力名は共有決定として事前に合わせる。
- Phase 2 では `T004`（Markdown parser）、`T005`（draft store）、`T006`（DocumentStore guard）を別ファイルで並行実装できる。`T008`・`T009` は各モジュールの契約に沿って並行作成できる。
- Foundational 完了後は US1 と US2 を別担当で並行できる。US3〜US5 は記載された先行ストーリー完了後に行う。
- 各ストーリー内では異なるテストファイル、CSS、Webview/Host 実装を分けて並行できる場合があるが、共有する `src/chatView.ts`／`src/documents.ts` を同時編集する場合は統合順を調整する。

## 実装戦略

### MVP（US1）

1. Phase 1 と Phase 2 を完了して Webview build と共有契約を固定する。
2. US1 を実装し、入力欄内描画、直接編集、IME／選択保持、markdown file 未変更を独立確認する。
3. 1,000行・32,000文字以下の100操作で95件以上が500ms以内か計測し、達成前に次ストーリーへ進まない。

### 段階的リリース

1. Setup + Foundational → 共通基盤を確認する。
2. US1 → 入力中描画 composer を MVP として検証する。
3. US2 → 一覧と安全な閲覧を追加し、単独検証する。
4. US3 → 初回送信・返信・再読込を追加し、保存形式を検証する。
5. US4 → 外部編集と失敗からの保護を追加する。
6. US5 + Polish → responsive/accessibility/security と全体回帰を確認する。

## 完了条件

- 全タスクが厳密な `- [ ] Tnnn [P?] [USn?] 説明（具体的なファイルパスを含む）` 形式に従う。
- 各ユーザーストーリーの独立テスト基準を満たし、失敗時に下書きや既存Markdownを失わない。
- `quickstart.md` および `acceptance-tests.md` の検証・計測結果を更新する。
