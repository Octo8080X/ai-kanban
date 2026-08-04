import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.29.0/server/stdio.js";
import { openDatabase } from "../db/sqlite.ts";
import { KanbanRepository } from "../repositories/kanban_repository.ts";
import { KanbanService } from "../services/kanban_service.ts";
import { createMcpServer } from "./server.ts";

function createService() {
  return new KanbanService(new KanbanRepository(openDatabase("kanban.db")));
}

if (import.meta.main) {
  const server = createMcpServer(createService());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}