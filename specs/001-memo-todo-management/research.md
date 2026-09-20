# Phase 0 Research: メモ & Todo 管理（サイドバー統合）

## Decision 1: ノートディレクトリの既定値と対象範囲
- **Decision**: 既定値は `notes/`、対象は設定で指定された単一ディレクトリ配下の `.md` に限定する。
- **Rationale**: スキャン範囲を制限して操作速度と誤操作防止を両立できる。憲章 III/IV に整合する。
- **Alternatives considered**:
  - ワークスペース全体走査: 高コストで誤検出リスクが高い。
  - 拡張独自 DB 管理: Markdown First 原則に反する。

## Decision 2: メモ新規作成時のファイル名解決
- **Decision**: タイトルから安全なファイル名を生成し、衝突時は連番で一意化する。
- **Rationale**: ユーザー入力の自由度を維持しつつ OS 非依存で保存失敗を減らせる。
- **Alternatives considered**:
  - UUID 固定名: 可読性が低くユーザー価値が下がる。
  - 衝突時に常に再入力: 操作数増加で SC-001 を阻害。

## Decision 3: 追記操作の整合性と安全性
- **Decision**: 追記は末尾行のみを対象にし、改行有無を補正して既存本文を不変に保つ。更新は同一ファイル単位で直列化する。
- **Rationale**: FR-008〜FR-011 を満たし、連続追記時の欠落/順序崩れを防げる。
- **Alternatives considered**:
  - ファイル全体再生成: 既存本文の破壊リスクが高い。
  - 並列書き込み許容: 競合で順序保証を満たせない。

## Decision 4: Todo 認識方式
- **Decision**: 既定保存先は `notes/todo.md` としつつ、管理対象ディレクトリ内の全 Markdown から標準タスクリスト行を認識するハイブリッド方式を採用する。
- **Rationale**: 入力導線の単純さと既存 Markdown 資産の尊重を両立できる（D1/D2/D4）。
- **Alternatives considered**:
  - `todo.md` のみ認識: 既存タスクが UI に現れずロックイン感が出る。
  - 完全自由配置のみ: 新規作成導線が複雑化する。

## Decision 5: Todo 識別と操作対象の特定
- **Decision**: Todo は `file path + line position` を主識別子とし、ステータス切替はチェックボックス記号のみを書き換える。
- **Rationale**: 同文テキスト重複時の誤更新を防ぎ、FR-016/FR-026 を満たせる。
- **Alternatives considered**:
  - テキスト一致のみ: 同文 Todo を区別できない。
  - 行全体置換: 本文改変のリスクがある。

## Decision 6: 外部変更・削除・移動への対応
- **Decision**: ファイル監視で一覧を再同期し、操作時に不在/読み取り専用を再検証して安全に中止・通知する。
- **Rationale**: FR-021/FR-028/FR-030 と NFR-002 を同時に満たす。
- **Alternatives considered**:
  - 起動時のみ読み込み: stale 表示が続き整合性が落ちる。
  - 自動復旧書き込み: 予期しないデータ変更につながる。

## Decision 7: 検証方針
- **Decision**: コアロジック（ファイル更新・Todo 解析・識別）をテスト中心で検証し、VS Code 統合は主要フローの E2E で補完する。
- **Rationale**: 憲章「品質基準」の API 分離テスト方針に合致し、回帰を抑えられる。
- **Alternatives considered**:
  - 手動確認のみ: 回帰検知が遅い。
  - UI 詳細中心のテスト: 仕様価値より実装詳細に依存しやすい。
