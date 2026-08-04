import type { Question, Task, Todo } from "../domain.ts";
import { KanbanRepository } from "../repositories/kanban_repository.ts";

export class KanbanService {
  constructor(private repository: KanbanRepository) {}

  createTask(input: { title: string; description: string; priority?: number }) {
    const now = new Date().toISOString();
    return this.repository.createTask({
      title: input.title,
      description: input.description,
      status: "todo",
      priority: input.priority ?? 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  getTask(taskId: number) {
    const task = this.repository.getTaskById(taskId);
    if (!task) return undefined;

    return {
      task,
      todos: this.repository.listTodosByTask(taskId),
    };
  }

  listTasks() {
    return this.repository.listTasks();
  }

  addTodo(input: { taskId: number; type?: Todo["type"]; title: string; priority?: number; orderNo?: number }) {
    const now = new Date().toISOString();
    return this.repository.createTodo({
      taskId: input.taskId,
      type: input.type ?? "normal",
      title: input.title,
      status: "todo",
      priority: input.priority ?? 0,
      orderNo: input.orderNo ?? this.repository.listTodosByTask(input.taskId).length + 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  getNextTodo(taskId: number) {
    return this.repository.getNextTodo(taskId);
  }

  updateTodo(todoId: number, status: Todo["status"]) {
    return this.repository.updateTodo(todoId, status);
  }

  askQuestion(input: { taskId: number; context: string; question: string }) {
    const now = new Date().toISOString();
    const questionTodo = this.repository.createTodo({
      taskId: input.taskId,
      type: "question",
      title: input.question,
      status: "waiting",
      priority: 0,
      orderNo: this.repository.listTodosByTask(input.taskId).length + 1,
      createdAt: now,
      updatedAt: now,
    });

    return this.repository.createQuestion({
      todoId: questionTodo.id,
      context: input.context,
      question: input.question,
      answer: null,
      status: "waiting",
      createdAt: now,
      answeredAt: null,
    });
  }

  listWaitingQuestions() {
    return this.repository.listWaitingQuestions();
  }

  getQuestion(questionId: number) {
    return this.repository.getQuestionById(questionId);
  }

  findTaskByQuestionId(questionId: number) {
    const question = this.repository.getQuestionById(questionId);
    if (!question) return undefined;
    const todo = this.repository.getTodoById(question.todoId);
    if (!todo) return undefined;
    return this.repository.getTaskById(todo.taskId);
  }

  listQuestionsByTask(taskId: number) {
    return this.repository.listQuestionsByTaskId(taskId);
  }

  answerQuestion(questionId: number, answer: string) {
    const now = new Date().toISOString();
    const question = this.repository.updateQuestionAnswer(questionId, answer, now);
    if (!question) {
      throw new Error(`Question not found: ${questionId}`);
    }

    const sourceTodo = this.repository.getTodoById(question.todoId);
    if (!sourceTodo) {
      throw new Error(`Question todo not found: ${question.todoId}`);
    }

    // question todo を完了にしないと CLI が waiting 状態のままスキップし続ける
    this.repository.updateTodo(sourceTodo.id, "done");

    const resumeTodo = this.repository.createTodo({
      taskId: sourceTodo.taskId,
      type: "resume",
      title: `[Q] ${question.question} / [A] ${answer}`,
      status: "todo",
      priority: 0,
      orderNo: this.repository.listTodosByTask(sourceTodo.taskId).length + 1,
      createdAt: now,
      updatedAt: now,
    });

    return { question, resumeTodo };
  }
}