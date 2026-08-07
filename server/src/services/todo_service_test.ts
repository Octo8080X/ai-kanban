import { assertEquals } from "@std/assert";
import { TodoService } from "./todo_service.ts";

Deno.test("getNextTodo prefers resume todos over normal todos", () => {
  const service = new TodoService();

  service.seedTask({
    id: 1,
    title: "Build editor",
    description: "",
    status: "doing",
    priority: 1,
    branch: "task/1-build-editor",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  });

  service.seedTodo({
    id: 1,
    taskId: 1,
    type: "normal",
    title: "Implement canvas layer",
    status: "todo",
    priority: 10,
    orderNo: 1,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  });

  service.seedTodo({
    id: 2,
    taskId: 1,
    type: "resume",
    title: "Resume after question",
    status: "todo",
    priority: 0,
    orderNo: 0,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  });

  const nextTodo = service.getNextTodo(1);

  assertEquals(nextTodo?.id, 2);
  assertEquals(nextTodo?.type, "resume");
});

Deno.test("askQuestion creates a resume todo after answerQuestion", () => {
  const service = new TodoService();

  service.seedTask({
    id: 1,
    title: "Build editor",
    description: "",
    status: "doing",
    priority: 1,
    branch: "task/1-build-editor",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  });

  service.seedTodo({
    id: 1,
    taskId: 1,
    type: "normal",
    title: "Implement canvas layer",
    status: "todo",
    priority: 10,
    orderNo: 1,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  });

  const question = service.askQuestion({
    taskId: 1,
    context: "SVG editor strategy is unclear",
    question: "Should we use Canvas or SVG?",
  });

  assertEquals(question.status, "waiting");
  assertEquals(service.getNextTodo(1)?.id, 1);

  service.answerQuestion(question.id, "Use SVG");

  const nextTodo = service.getNextTodo(1);
  assertEquals(nextTodo?.type, "resume");
  assertEquals(nextTodo?.status, "todo");
});