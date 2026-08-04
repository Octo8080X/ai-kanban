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
