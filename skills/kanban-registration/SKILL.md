---
name: kanban-registration
description: Use to register a plan discussed in the current session into kanban. Creates the Task, writes a detailed Task description, breaks the plan down into detailed, actionable TODOs, and reports back the branch the task will be implemented on. Does not reference other already-registered tasks.
---

# Breakdown

セッション内で検討した内容を kanban に登録する。他に登録済みの Task を参照する必要はない。

## 手順

1. セッション内で検討した内容をもとに、Task のタイトルと詳細な説明をまとめる。
2. `createTask` を呼んで Task を登録する。レスポンスに含まれる `branch`（例: `task/12`、Task ID のみから機械的に採番される）を控えておく。自分でブランチ名を考えたり `git` コマンドで作成・切り替えを行ったりしない（実際のブランチ切り替えは実行時に自動実行 CLI が行う）。
3. その実装計画を、実行可能な単位まで詳細化した TODO として書き出す。
4. 詳細化した TODO を実行順に並べ、`createTask` で得た taskId を使って順番に `addTodo` で登録する。
5. 判断できないことがあれば細分化を止めて `askQuestion` を **1 問だけ** 呼んでセッションを終了する。複数の疑問があっても、1 回のセッションで聞くのは 1 問に限定する。
6. 登録が完了したら、Task ID・タイトル・登録した TODO 件数・上記の `branch` をユーザーに簡潔に報告して終了する。
