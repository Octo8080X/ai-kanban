import { Hono } from "npm:hono@4.11.4";
import { StreamableHTTPTransport } from "npm:@hono/mcp";
import { openDatabase } from "./db/sqlite.ts";
import { KanbanRepository } from "./repositories/kanban_repository.ts";
import { KanbanService } from "./services/kanban_service.ts";
import { createMcpServer } from "./mcp/server.ts";

// Shared CSS injected into every page
const pageStyle = `
  body { font-family: sans-serif; margin: 0; padding: 0; background: #f5f5f5; color: #222; }
  header { background: #1a1a2e; color: #fff; padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
  header a { color: #aad4ff; text-decoration: none; font-weight: bold; }
  main { max-width: 900px; margin: 32px auto; padding: 0 24px; }
  h1 { margin-top: 0; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px #0001; }
  th { background: #eef; text-align: left; padding: 10px 14px; }
  td { padding: 10px 14px; border-top: 1px solid #eee; }
  a { color: #1a6bc4; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; }
  .badge-todo { background: #e0e7ff; color: #3730a3; }
  .badge-doing { background: #fef9c3; color: #854d0e; }
  .badge-done { background: #dcfce7; color: #166534; }
  .badge-waiting { background: #fee2e2; color: #991b1b; }
  .badge-resume { background: #fce7f3; color: #9d174d; }
  form { display: flex; flex-direction: column; gap: 10px; max-width: 480px; }
  input, textarea, select { padding: 8px 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; }
  button { padding: 8px 18px; background: #1a6bc4; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; align-self: flex-start; }
  button:hover { background: #1558a0; }
  .card { background: #fff; border-radius: 8px; box-shadow: 0 1px 4px #0001; padding: 20px 24px; margin-bottom: 24px; }
  .section-title { font-size: 16px; font-weight: bold; margin: 24px 0 8px; }
  .empty { color: #888; font-style: italic; }
`;

function layout(title: string, body: string) {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} — AI Agent Kanban</title>
  <style>${pageStyle}</style>
</head>
<body>
  <header>
    <a href="/">AI Agent Kanban</a>
    <a href="/questions">Questions</a>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

function badge(status: string) {
  return `<span class="badge badge-${status}">${status}</span>`;
}

// Prevent XSS by escaping all user-supplied content before injecting into HTML
function h(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createApp(options?: { databasePath?: string }) {
  const databasePath = options?.databasePath ?? "kanban.db";
  const service = new KanbanService(new KanbanRepository(openDatabase(databasePath)));
  const mcpServer = createMcpServer(service);
  const transport = new StreamableHTTPTransport();

  const app = new Hono();

  // ── UI: Task 一覧 ─────────────────────────────────────────────────
  app.get("/", (c) => {
    const tasks = service.listTasks();
    const rows = tasks.length
      ? tasks.map((t) =>
        `<tr>
          <td><a href="/tasks/${t.id}">${h(t.title)}</a></td>
          <td>${badge(t.status)}</td>
          <td>${t.priority}</td>
          <td>${t.createdAt.slice(0, 10)}</td>
        </tr>`
      ).join("")
      : `<tr><td colspan="4" class="empty">タスクがありません</td></tr>`;

    return c.html(layout("Task 一覧", `
      <h1>Task 一覧</h1>
      <div class="card">
        <div class="section-title">新しいタスクを追加</div>
        <form method="post" action="/tasks">
          <input name="title" placeholder="タイトル" required/>
          <textarea name="description" placeholder="説明（任意）" rows="2"></textarea>
          <button type="submit">作成</button>
        </form>
      </div>
      <table>
        <thead><tr><th>タイトル</th><th>状態</th><th>優先度</th><th>作成日</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `));
  });

  // Task 作成フォーム送信 (HTML form POST)
  app.post("/tasks", async (c) => {
    const body = await c.req.parseBody();
    service.createTask({
      title: String(body.title),
      description: String(body.description ?? ""),
    });
    return c.redirect("/");
  });

  // ── UI: Task 詳細 + Todo 一覧 ────────────────────────────────────
  app.get("/tasks/:id", (c) => {
    const taskId = Number(c.req.param("id"));
    const result = service.getTask(taskId);
    if (!result) {
      return c.html(layout("Not found", "<p>タスクが見つかりません。</p>"), 404);
    }
    const { task, todos } = result;
    const questions = service.listQuestionsByTask(taskId);

    const todoRows = todos.length
      ? todos.map((t) =>
        `<tr>
          <td>${t.orderNo}</td>
          <td>${h(t.title)}</td>
          <td>${badge(t.type)}</td>
          <td>${badge(t.status)}</td>
          <td>
            ${t.status !== "done"
          ? `<form method="post" action="/todos/${t.id}/done" style="display:inline">
                  <button type="submit" style="padding:3px 10px;font-size:12px">完了</button>
                </form>`
          : ""}
          </td>
        </tr>`
      ).join("")
      : `<tr><td colspan="5" class="empty">Todoがありません</td></tr>`;

    const questionRows = questions.length
      ? questions.map((q) =>
        `<tr>
          <td><a href="/questions/${q.id}" target="_blank">${h(q.question)}</a></td>
          <td>${h(q.context)}</td>
          <td>${badge(q.status)}</td>
          <td>${q.answer != null ? h(q.answer) : "—"}</td>
        </tr>`
      ).join("")
      : `<tr><td colspan="4" class="empty">質問はありません</td></tr>`;

    return c.html(layout(`Task: ${h(task.title)}`, `
      <h1>${h(task.title)}</h1>
      <div class="card">
        <p>${task.description ? h(task.description) : '<span class="empty">説明なし</span>'}</p>
        <p>状態: ${badge(task.status)} &nbsp; 優先度: ${task.priority}</p>
      </div>

      <div class="section-title">Todo 一覧</div>
      <table>
        <thead><tr><th>#</th><th>タイトル</th><th>種別</th><th>状態</th><th></th></tr></thead>
        <tbody>${todoRows}</tbody>
      </table>

      <div class="card" style="margin-top:16px">
        <div class="section-title" style="margin-top:0">Todo を追加</div>
        <form method="post" action="/tasks/${task.id}/todos" style="display:flex;flex-direction:column;gap:8px">
          <textarea name="title" placeholder="タイトル" required rows="3" style="resize:vertical"></textarea>
          <button type="submit" style="align-self:flex-start">追加</button>
        </form>
      </div>

      <div class="section-title">Question 一覧</div>
      <table>
        <thead><tr><th>質問</th><th>背景</th><th>状態</th><th>回答</th></tr></thead>
        <tbody>${questionRows}</tbody>
      </table>
    `));
  });

  // Todo を完了にする (HTML form POST)
  app.post("/todos/:id/done", (c) => {
    const todoId = Number(c.req.param("id"));
    const todo = service.updateTodo(todoId, "done");
    const taskId = todo?.taskId;
    return c.redirect(taskId ? `/tasks/${taskId}` : "/");
  });

  // Todo を直接追加 (HTML form POST)
  app.post("/tasks/:id/todos", async (c) => {
    const taskId = Number(c.req.param("id"));
    const body = await c.req.parseBody();
    service.addTodo({ taskId, title: String(body.title) });
    return c.redirect(`/tasks/${taskId}`);
  });

  // ── UI: Question 一覧 + 回答 ─────────────────────────────────────
  app.get("/questions", (c) => {
    const questions = service.listWaitingQuestions();

    const rows = questions.length
      ? questions.map((q) =>
        `<tr>
          <td>${h(q.question)}</td>
          <td>${h(q.context)}</td>
          <td>
            <form method="post" action="/questions/${q.id}/answer">
              <input name="answer" placeholder="回答を入力" required style="width:220px"/>
              <button type="submit">回答</button>
            </form>
          </td>
        </tr>`
      ).join("")
      : `<tr><td colspan="3" class="empty">待機中の質問はありません</td></tr>`;

    return c.html(layout("Question 一覧", `
      <h1>Question 一覧</h1>
      <p>AI から届いた未回答の質問です。</p>
      <table>
        <thead><tr><th>質問</th><th>背景</th><th>回答</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `));
  });

  // Question に回答 (HTML form POST)
  app.post("/questions/:id/answer", async (c) => {
    const questionId = Number(c.req.param("id"));
    const body = await c.req.parseBody();
    service.answerQuestion(questionId, String(body.answer));
    return c.redirect("/questions");
  });
  // ── UI: Question 詳細 + 回答 ─────────────────────────────────
  app.get("/questions/:id", (c) => {
    const questionId = Number(c.req.param("id"));
    const question = service.getQuestion(questionId);
    if (!question) {
      return c.html(layout("Not found", "<p>質問が見つかりません。</p>"), 404);
    }
    const task = service.findTaskByQuestionId(questionId);
    const answered = question.status === "done";

    return c.html(layout(`Question #${question.id}`, `
      <h1>Question #${question.id}</h1>

      ${
  task
    ? `<div class="card">
          <div class="section-title">タスク</div>
          <p><a href="/tasks/${task.id}">#${task.id} ${h(task.title)}</a></p>
          <p>${task.description ? h(task.description) : '<span class="empty">説明なし</span>'}</p>
        </div>`
    : ""
}

      <div class="card">
        <div class="section-title">背景・状況</div>
        <p style="white-space:pre-wrap">${h(question.context)}</p>
      </div>

      <div class="card">
        <div class="section-title">質問</div>
        <p style="font-size:18px;font-weight:bold;white-space:pre-wrap">${h(question.question)}</p>
      </div>

      ${answered
  ? `<div class="card">
          <div class="section-title">回答済み</div>
          <p style="white-space:pre-wrap">${h(question.answer ?? "")}</p>
        </div>`
  : `<div class="card">
          <div class="section-title">回答を入力</div>
          <form method="post" action="/questions/${question.id}/answer" style="display:flex;flex-direction:column;gap:12px">
            <textarea name="answer" required
              placeholder="回答を入力してください"
              style="width:100%;min-height:200px;padding:12px;font-size:15px;border:1px solid #ccc;border-radius:6px;resize:vertical;box-sizing:border-box"
            ></textarea>
            <button type="submit" style="align-self:flex-start">回答する</button>
          </form>
        </div>`
}
    `));
  });
  // ── REST API ─────────────────────────────────────────────────────
  app.get("/api", (c) => {
    return c.json({ scope: "server", status: "ok" });
  });

  app.get("/api/tasks", (c) => {
    return c.json({ tasks: service.listTasks() });
  });

  app.get("/api/tasks/:id", (c) => {
    const taskId = Number(c.req.param("id"));
    const task = service.getTask(taskId);
    if (!task) return c.json({ message: "Task not found" }, 404);
    return c.json({ task });
  });

  app.post("/api/tasks", async (c) => {
    const body = await c.req.json<{ title: string; description?: string; priority?: number }>();
    const task = service.createTask({
      title: body.title,
      description: body.description ?? "",
      priority: body.priority,
    });
    return c.json({ task }, 201);
  });

  app.get("/api/tasks/:id/todos", (c) => {
    const taskId = Number(c.req.param("id"));
    const result = service.getTask(taskId);
    if (!result) return c.json({ message: "Task not found" }, 404);
    return c.json({ todos: result.todos });
  });

  app.patch("/api/todos/:id", async (c) => {
    const todoId = Number(c.req.param("id"));
    const body = await c.req.json<{ status: "todo" | "doing" | "waiting" | "done" }>();
    const todo = service.updateTodo(todoId, body.status);
    if (!todo) return c.json({ message: "Todo not found" }, 404);
    return c.json({ todo });
  });

  app.get("/api/questions", (c) => {
    return c.json({ questions: service.listWaitingQuestions() });
  });

  app.post("/api/questions/:id/answer", async (c) => {
    const questionId = Number(c.req.param("id"));
    const body = await c.req.json<{ answer: string }>();
    try {
      const result = service.answerQuestion(questionId, body.answer);
      return c.json({ question: result.question, resumeTodo: result.resumeTodo });
    } catch {
      return c.json({ message: "Question not found" }, 404);
    }
  });

  // ── MCP ──────────────────────────────────────────────────────────
  app.all("/mcp", async (c) => {
    if (!mcpServer.isConnected()) {
      await mcpServer.connect(transport);
    }
    return transport.handleRequest(c);
  });

  return app;
}