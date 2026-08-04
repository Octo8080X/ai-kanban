export type TaskStatus = "todo" | "doing" | "done";

export type TodoType = "normal" | "question" | "resume";

export type TodoStatus = "todo" | "doing" | "waiting" | "done";

export interface Question {
  id: number;
  todoId: number;
  context: string;
  question: string;
  answer: string | null;
  status: "waiting" | "done";
  createdAt: string;
  answeredAt: string | null;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface Todo {
  id: number;
  taskId: number;
  type: TodoType;
  title: string;
  status: TodoStatus;
  priority: number;
  orderNo: number;
  createdAt: string;
  updatedAt: string;
}