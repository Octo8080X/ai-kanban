import type { Question, Task, Todo } from "../domain.ts";

export class TodoService {
  #tasks: Task[] = [];
  #todos: Todo[] = [];
  #questions: Question[] = [];
  #nextQuestionId = 1;
  #nextTodoId = 1000;

  seedTask(task: Task) {
    this.#tasks = this.#tasks.filter((item) => item.id !== task.id);
    this.#tasks.push(task);
  }

  seedTodo(todo: Todo) {
    this.#todos = this.#todos.filter((item) => item.id !== todo.id);
    this.#todos.push(todo);
  }

  getNextTodo(taskId: number): Todo | undefined {
    const candidates = this.#todos.filter((todo) => {
      return todo.taskId === taskId && todo.status === "todo";
    });

    candidates.sort((left, right) => {
      if (left.type !== right.type) {
        if (left.type === "resume") return -1;
        if (right.type === "resume") return 1;
      }

      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      return left.orderNo - right.orderNo;
    });

    return candidates[0];
  }

  askQuestion(input: { taskId: number; context: string; question: string }): Question {
    const now = new Date().toISOString();
    const questionTodo = {
      id: this.#nextTodoId++,
      taskId: input.taskId,
      type: "question" as const,
      title: input.question,
      status: "waiting" as const,
      priority: 0,
      orderNo: this.#todos.length + 1,
      createdAt: now,
      updatedAt: now,
    };

    this.#todos.push(questionTodo);

    const question: Question = {
      id: this.#nextQuestionId++,
      todoId: questionTodo.id,
      context: input.context,
      question: input.question,
      answer: null,
      status: "waiting",
      createdAt: now,
      answeredAt: null,
    };

    this.#questions.push(question);
    return question;
  }

  answerQuestion(questionId: number, answer: string) {
    const question = this.#questions.find((item) => item.id === questionId);
    if (!question) {
      throw new Error(`Question not found: ${questionId}`);
    }

    question.answer = answer;
    question.answeredAt = new Date().toISOString();
    question.status = "done";

    const sourceTodo = this.#todos.find((item) => item.id === question.todoId);
    if (sourceTodo) {
      sourceTodo.status = "done";
      sourceTodo.updatedAt = new Date().toISOString();
    }

    const resumeTodo: Todo = {
      id: this.#nextTodoId++,
      taskId: sourceTodo?.taskId ?? 0,
      type: "resume",
      title: `Resume: ${question.question}`,
      status: "todo",
      priority: 0,
      orderNo: this.#todos.length + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.#todos.push(resumeTodo);
    return resumeTodo;
  }
}