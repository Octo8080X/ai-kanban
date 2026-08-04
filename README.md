# AI Agent Kanban

Deno + Hono + SQLite 製の AI Agent 向けカンバンです。  
人向け Web UI・REST API・MCP サーバーを 1 プロセスで起動します。

## 前提

- [Deno](https://deno.com/) がインストールされていること
- コマンドはリポジトリのルートで実行すること

---

## サーバーの起動

```bash
deno task dev:server
```

起動後、ブラウザで `http://localhost:8000/` を開きます。  
MCP エンドポイントは `http://localhost:8000/mcp`（Streamable HTTP）です。

---

## コマンド CLI の使い方

サーバーが起動した状態で、別ターミナルから実行します。

```bash
# 30 秒ごとにポーリングして Claude に todo を実行させる
deno run -A command/main.ts

# 1 回だけ実行して終了
deno run -A command/main.ts --once
```

CLI は次の順で動作します。

1. サーバーから未完了タスクを取得する
2. todo がなければ **planning**（Claude が `addTodo` でタスクを分解）
3. todo があれば **implement**（Claude が 1 件実行して `updateTodo(done)`）
4. 指定間隔で繰り返す

Claude が判断できない場合は `askQuestion` を呼んで停止します。  
ブラウザで `http://localhost:8000/questions` を開いて回答すると作業が再開します。

**前提条件**

- `claude` CLI がインストール・認証済みであること（`claude auth login`）
- `.mcp.json` がプロジェクトルートに置かれていること（同梱済み）

---

## Skill を Claude に設置する方法

`skill/` 配下の手順書を Claude Code に読み込ませます。

### CLAUDE.md を置く

プロジェクトルートの `CLAUDE.md`（同梱済み）を確認してください。  
Claude Code はセッション開始時にこのファイルを自動で読み込み、skill の参照先と基本ルールを把握します。

```markdown
# AI Agent Kanban

このプロジェクトでは MCP サーバー（kanban）を使って作業を管理します。

## 作業手順

新しい作業を始めるときは @skill/planning.md を参照してください。
実装を進めるときは @skill/implement.md を参照してください。
実装が終わったら @skill/review.md を参照してください。
```

### MCP サーバーを登録する

`.mcp.json`（同梱済み）により、Claude Code がこのディレクトリで自動的に kanban MCP を認識します。

```json
{
  "mcpServers": {
    "kanban": {
      "type": "http",
      "url": "http://localhost:8000/mcp"
    }
  }
}
```

CLI で追加する場合は次のコマンドを使います。

```bash
claude mcp add --transport http kanban http://localhost:8000/mcp
```

### Skill の内容

| ファイル | 役割 |
|---------|------|
| `skill/planning.md` | タスクを todo に分解する手順 |
| `skill/implement.md` | todo を 1 件ずつ実行する手順 |
| `skill/review.md` | タスク全体をレビューして割り込み todo を入れる手順 |

---

## テスト

```bash
deno test --allow-env --allow-ffi --allow-read --allow-write
```


- [Deno](https://deno.com/) がインストールされていること
- コマンドはすべてリポジトリのルートで実行すること

---

## server の起動

```bash
deno task dev:server
```

`http://localhost:8000/` を開くと人向け UI が表示されます。  
同じプロセスで `http://localhost:8000/mcp` が MCP エンドポイントになります。

### 人向け画面

| URL | 機能 |
|-----|------|
| `GET /` | Task 一覧・作成フォーム |
| `GET /tasks/:id` | Task 詳細・Todo 一覧・Question 一覧 |
| `GET /questions` | 未回答 Question 一覧・回答フォーム |

### REST API

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/tasks` | Task 一覧 |
| `POST` | `/api/tasks` | Task 作成 |
| `GET` | `/api/tasks/:id` | Task 詳細（todos 含む）|
| `GET` | `/api/tasks/:id/todos` | Todo 一覧 |
| `PATCH` | `/api/todos/:id` | Todo 状態更新 |
| `GET` | `/api/questions` | 未回答 Question 一覧 |
| `POST` | `/api/questions/:id/answer` | Question に回答 |

### MCP tools

AI が呼ぶツール一覧です。エンドポイントは `POST /mcp`（Streamable HTTP）です。

| tool | 説明 |
|------|------|
| `createTask` | Task を作成する |
| `getTask` | Task と Todo 一覧を取得する |
| `listTasks` | 全 Task を取得する |
| `addTodo` | Todo を追加する |
| `getNextTodo` | 次に実行すべき Todo を取得する |
| `updateTodo` | Todo の状態を更新する |
| `interruptTodo` | 最優先 Todo を追加する（priority 0）|
| `askQuestion` | 人への質問を登録し、Todo を waiting にする |

---

## client の設置と使い方

`client/` は MCP client の実装例です。自分のスクリプトやエージェントループに組み込んで使います。

### 動作確認（smoke test）

```bash
deno task dev:client
```

サーバーが `http://localhost:8000/mcp` で動いている状態で実行すると、tool 一覧の取得と `createTask` の呼び出しを行います。

接続先を変えるには URL を引数で渡します。

```bash
deno run -A client/main.ts http://your-host/mcp
```

---

## skill の設置と使い方

`skill/` は AI Agent に渡すワークフロー定義です。Claude Code などのシステムプロンプトやエージェントの手順書として参照させます。

### ファイル構成

| ファイル | 内容 |
|---------|------|
| `.claude/skill/planning.md` | Task を Todo に分割するフロー |

### 使い方

各スキルのファイルパスをエージェントに渡してください。Claude Code の場合は `CLAUDE.md` から参照するか、セッション開始時に内容を読み込ませます。

**planning.md の手順（抜粋）**

1. 対象 Task を `getTask` で取得する
2. 作業を Todo に分割する
3. `addTodo` で登録する（実行順・優先度を設定する）
4. 不明点があれば `askQuestion` で人に確認を依頼する

**implement.md の手順（抜粋）**

1. `getNextTodo` で次の Todo を取得する
2. 実装する
3. 完了したら `updateTodo(done)` を呼ぶ
4. 次の Todo に進む（ループ）

**review.md の手順（抜粋）**

1. `getTask` で Task 全体を確認する
2. 不足やリスクを洗い出す
3. 必要なら `interruptTodo` で割り込み Todo を追加する

### 質問フロー（AI ↔ 人）

AI が判断できない場合は `askQuestion` を呼びます。Question が作成され、Todo が `waiting` 状態になります。  
人は `/questions` ページで回答すると、`resume` タイプの Todo が自動生成され、AI は次の `getNextTodo` 呼び出しでそれを受け取って作業を再開します。

```
AI: askQuestion()
  → Question 作成
  → Todo が waiting に
  → 人が /questions で回答
  → resume Todo が生成
  → AI: getNextTodo() で resume を取得
  → 作業再開
```

---

## Claude Code での使い方

### 1. server を起動する

```bash
deno task dev:server
```

`http://localhost:8000/mcp` が MCP エンドポイントになります。

### 2. MCP サーバーを Claude Code に登録する

プロジェクトルートの `.mcp.json` に以下を置くと、Claude Code がそのディレクトリで自動的に MCP サーバーとして認識します。

```json
{
  "mcpServers": {
    "kanban": {
      "type": "http",
      "url": "http://localhost:8000/mcp"
    }
  }
}
```

CLI で追加するには次のコマンドを使います。

```bash
claude mcp add --transport http kanban http://localhost:8000/mcp
```

登録後は `claude mcp list` で確認できます。

### 3. CLAUDE.md でスキルを読み込ませる

プロジェクトルートに `CLAUDE.md` を置くと、Claude Code がセッション開始時に自動で読み込みます。以下の内容で作成してください。

```markdown
# AI Agent Kanban

このプロジェクトでは MCP サーバー（kanban）を使って作業を管理します。

## 作業手順

新しい作業を始めるときは @skill/planning.md を参照してください。  
実装を進めるときは @skill/implement.md を参照してください。  
実装が終わったら @skill/review.md を参照してください。

## 基本ルール

- 作業はすべて `createTask` でタスクを作成してから始める
- 実装ループは `getNextTodo` → 実装 → `updateTodo(done)` を繰り返す
- 判断に迷ったら実装を止めて `askQuestion` で人に確認する
- 人が回答するまで次の todo には進まない
```

### 4. 実際の使い方

#### Task を作成して計画を立てる

Claude Code に対して次のように指示します。

```
kanban に「ユーザー認証機能の実装」というタスクを作成して、
planning スキルに従って todo に分割してください。
```

Claude Code は `createTask` → `addTodo` × n の順で MCP tool を呼びます。

#### 実装を進める

```
implement スキルに従って、タスク 1 の実装を進めてください。
```

Claude Code は `getNextTodo` で次の todo を取得し、実装後に `updateTodo(done)` を呼ぶループを繰り返します。

#### 人への質問と回答

Claude Code が `askQuestion` を呼ぶと作業が一時停止します。  
ブラウザで `http://localhost:8000/questions` を開いて回答すると、Claude Code は次の `getNextTodo` で `resume` タイプの todo を受け取り、自動的に作業を再開します。

#### 定期実行 CLI で自動化する

`command/main.ts` は、カンバンの pending todo を見つけて Claude Code に自動で実行させる CLI です。  
server が起動している状態で、別ターミナルから実行します。

```bash
# 全アクティブタスクを 30 秒ごとにポーリングして実行
deno run -A command/main.ts

# タスク 1 だけを 1 回だけ実行
deno run -A command/main.ts --task-id 1 --once

# 60 秒間隔でポーリング
deno run -A command/main.ts --interval 60
```

内部では次の処理をループします。

1. REST API でアクティブなタスクを取得する
2. 各タスクの次の todo を取得する（`waiting` 中は人の回答待ちとしてスキップ）
3. `claude -p "..."` を起動し、implement スキルに沿って todo を実行させる
4. 指定した間隔で繰り返す

`--once` を付けると 1 回実行して終了します。CI や cron での利用に向いています。

---



```
タスク 1 に「まずセキュリティレビューをしてほしい」という割り込みを入れてください。
```

Claude Code は `interruptTodo` を呼び、次の `getNextTodo` 呼び出しで割り込み todo が最優先で返ります。
