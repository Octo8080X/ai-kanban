import { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { z } from "npm:zod";
import type { KanbanService } from "../services/kanban_service.ts";

function toJsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function createMcpServer(service: KanbanService) {
  const server = new McpServer({ name: "ai-agent-kanban", version: "0.1.0" });

  server.registerTool(
    "createTask",
    {
      title: "Create Task",
      description: "Create a new kanban task",
      inputSchema: z.object({
        title: z.string(),
        description: z.string().optional(),
        priority: z.number().int().optional(),
      }),
    },
    async ({ title, description, priority }: { title: string; description?: string; priority?: number }) => {
      const task = service.createTask({
        title,
        description: description ?? "",
        priority,
      });

      return {
        content: [{ type: "text", text: toJsonText(task) }],
      };
    },
  );

  server.registerTool(
    "getTask",
    {
      title: "Get Task",
      description: "Get a task with its todo list",
      inputSchema: z.object({
        taskId: z.number().int(),
      }),
    },
    async ({ taskId }: { taskId: number }) => {
      const task = service.getTask(taskId);
      return {
        content: [{ type: "text", text: toJsonText(task ?? null) }],
      };
    },
  );

  server.registerTool(
    "listTasks",
    {
      title: "List Tasks",
      description: "List all tasks",
      inputSchema: z.object({}),
    },
    async () => {
      const tasks = service.listTasks();
      return {
        content: [{ type: "text", text: toJsonText(tasks) }],
      };
    },
  );

  server.registerTool(
    "addTodo",
    {
      title: "Add Todo",
      description: "Add a todo to a task",
      inputSchema: z.object({
        taskId: z.number().int(),
        title: z.string(),
        type: z.enum(["normal", "question", "resume"]).optional(),
        priority: z.number().int().optional(),
        orderNo: z.number().int().optional(),
      }),
    },
    async ({
      taskId,
      title,
      type,
      priority,
      orderNo,
    }: {
      taskId: number;
      title: string;
      type?: "normal" | "question" | "resume";
      priority?: number;
      orderNo?: number;
    }) => {
      const todo = service.addTodo({ taskId, title, type, priority, orderNo });
      return {
        content: [{ type: "text", text: toJsonText(todo) }],
      };
    },
  );

  server.registerTool(
    "getNextTodo",
    {
      title: "Get Next Todo",
      description: "Get the next runnable todo for a task",
      inputSchema: z.object({
        taskId: z.number().int(),
      }),
    },
    async ({ taskId }: { taskId: number }) => {
      const todo = service.getNextTodo(taskId);
      return {
        content: [{ type: "text", text: toJsonText(todo ?? null) }],
      };
    },
  );

  server.registerTool(
    "updateTodo",
    {
      title: "Update Todo",
      description: "Update a todo status",
      inputSchema: z.object({
        todoId: z.number().int(),
        status: z.enum(["todo", "doing", "waiting", "done"]),
      }),
    },
    async ({ todoId, status }: { todoId: number; status: "todo" | "doing" | "waiting" | "done" }) => {
      const todo = service.updateTodo(todoId, status);
      return {
        content: [{ type: "text", text: toJsonText(todo) }],
      };
    },
  );

  server.registerTool(
    "interruptTodo",
    {
      title: "Interrupt Todo",
      description: "Add a highest-priority todo to a task",
      inputSchema: z.object({
        taskId: z.number().int(),
        title: z.string(),
      }),
    },
    async ({ taskId, title }: { taskId: number; title: string }) => {
      const todo = service.addTodo({ taskId, title, priority: 0, orderNo: 0 });
      return {
        content: [{ type: "text", text: toJsonText(todo) }],
      };
    },
  );

  server.registerTool(
    "askQuestion",
    {
      title: "Ask Question",
      description: "Register a question and pause the task",
      inputSchema: z.object({
        taskId: z.number().int(),
        context: z.string(),
        question: z.string(),
      }),
    },
    async ({ taskId, context, question }: { taskId: number; context: string; question: string }) => {
      const record = service.askQuestion({ taskId, context, question });
      return {
        content: [{ type: "text", text: toJsonText(record) }],
      };
    },
  );

  return server;
}