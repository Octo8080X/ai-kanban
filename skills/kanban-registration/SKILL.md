---
name: kanban-breakdown
description: Use to register a plan discussed in the current session into kanban. Writes a detailed Task description and breaks the plan down into detailed, actionable TODOs. Does not reference other already-registered tasks.
---

# Breakdown

セッション内で検討した内容を kanban に登録する。他に登録済みの Task を参照する必要はない。

## 手順

1. セッション内で検討した内容をもとに、Task の詳細な説明を記載する。
2. その実装計画を、実行可能な単位まで詳細化した TODO として書き出す。
3. 詳細化した TODO を実行順に並べ、順番に `addTodo` で登録する。
4. 判断できないことがあれば細分化を止めて `askQuestion` を **1 問だけ** 呼んでセッションを終了する。複数の疑問があっても、1 回のセッションで聞くのは 1 問に限定する。
