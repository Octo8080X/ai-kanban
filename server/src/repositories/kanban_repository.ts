import type { Database } from "jsr:@db/sqlite@0.13.0";
import type { Question, Task, Todo } from "../domain.ts";

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: Number(row.id),
    title: String(row.title),
    description: String(row.description),
    status: row.status as Task["status"],
    priority: Number(row.priority),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToTodo(row: Record<string, unknown>): Todo {
  return {
    id: Number(row.id),
    taskId: Number(row.task_id),
    type: row.type as Todo["type"],
    title: String(row.title),
    status: row.status as Todo["status"],
    priority: Number(row.priority),
    orderNo: Number(row.order_no),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToQuestion(row: Record<string, unknown>): Question {
  return {
    id: Number(row.id),
    todoId: Number(row.todo_id),
    context: String(row.context),
    question: String(row.question),
    answer: row.answer == null ? null : String(row.answer),
    status: row.status as Question["status"],
    createdAt: String(row.created_at),
    answeredAt: row.answered_at == null ? null : String(row.answered_at),
  };
}

export class KanbanRepository {
  constructor(private db: Database) {}

  createTask(input: Omit<Task, "id">) {
    this.db
      .prepare(
        `INSERT INTO tasks (title, description, status, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.title,
        input.description,
        input.status,
        input.priority,
        input.createdAt,
        input.updatedAt,
      );

    return this.getTaskById(this.db.lastInsertRowId)!;
  }

  listTasks() {
    return this.db.prepare("SELECT * FROM tasks ORDER BY priority ASC, id ASC").all().map(rowToTask);
  }

  getTaskById(id: number) {
    const rows = this.db.prepare("SELECT * FROM tasks WHERE id = ? LIMIT 1").all(id);
    return rows[0] ? rowToTask(rows[0]) : undefined;
  }

  createTodo(input: Omit<Todo, "id">) {
    this.db
      .prepare(
        `INSERT INTO todos (task_id, type, title, status, priority, order_no, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.taskId,
        input.type,
        input.title,
        input.status,
        input.priority,
        input.orderNo,
        input.createdAt,
        input.updatedAt,
      );

    return this.getTodoById(this.db.lastInsertRowId)!;
  }

  listTodosByTask(taskId: number) {
    return this.db
      .prepare("SELECT * FROM todos WHERE task_id = ? ORDER BY priority ASC, order_no ASC, id ASC")
      .all(taskId)
      .map(rowToTodo);
  }

  getTodoById(id: number) {
    const rows = this.db.prepare("SELECT * FROM todos WHERE id = ? LIMIT 1").all(id);
    return rows[0] ? rowToTodo(rows[0]) : undefined;
  }

  getNextTodo(taskId: number) {
    const rows = this.db
      .prepare(
        `SELECT * FROM todos
         WHERE task_id = ? AND status = 'todo'
         ORDER BY CASE WHEN type = 'resume' THEN 0 ELSE 1 END, priority ASC, order_no ASC, id ASC
         LIMIT 1`,
      )
      .all(taskId);

    return rows[0] ? rowToTodo(rows[0]) : undefined;
  }

  createQuestion(input: Omit<Question, "id">) {
    this.db
      .prepare(
        `INSERT INTO questions (todo_id, context, question, answer, status, created_at, answered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.todoId,
        input.context,
        input.question,
        input.answer,
        input.status,
        input.createdAt,
        input.answeredAt,
      );

    return this.getQuestionById(this.db.lastInsertRowId)!;
  }

  getQuestionById(id: number) {
    const rows = this.db.prepare("SELECT * FROM questions WHERE id = ? LIMIT 1").all(id);
    return rows[0] ? rowToQuestion(rows[0]) : undefined;
  }

  updateQuestionAnswer(questionId: number, answer: string, answeredAt: string) {
    this.db
      .prepare(
        `UPDATE questions
         SET answer = ?, status = 'done', answered_at = ?
         WHERE id = ?`,
      )
      .run(answer, answeredAt, questionId);
    return this.getQuestionById(questionId);
  }

  listWaitingQuestions() {
    return this.db
      .prepare("SELECT * FROM questions WHERE status = 'waiting' ORDER BY created_at ASC")
      .all()
      .map(rowToQuestion);
  }

  listQuestionsByTodoId(todoId: number) {
    return this.db
      .prepare("SELECT * FROM questions WHERE todo_id = ? ORDER BY created_at ASC")
      .all(todoId)
      .map(rowToQuestion);
  }

  listQuestionsByTaskId(taskId: number) {
    return this.db
      .prepare(
        `SELECT q.* FROM questions q
         JOIN todos t ON t.id = q.todo_id
         WHERE t.task_id = ?
         ORDER BY q.created_at ASC`,
      )
      .all(taskId)
      .map(rowToQuestion);
  }

  updateTodo(todoId: number, status: Todo["status"]) {
    this.db
      .prepare(
        `UPDATE todos
         SET status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, new Date().toISOString(), todoId);
    return this.getTodoById(todoId);
  }
}