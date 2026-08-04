import { Client } from "npm:@modelcontextprotocol/sdk@1.29.0/client/index.js";
import { StreamableHTTPClientTransport } from "npm:@modelcontextprotocol/sdk@1.29.0/client/streamableHttp.js";

function printUsage() {
  console.log("AI Agent Kanban client");
  console.log("usage: deno run -A client/main.ts [mcp-url]");
}

async function main() {
  const endpoint = Deno.args[0] ?? "http://localhost:8000/mcp";
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));

  const client = new Client({ name: "ai-agent-kanban-client", version: "0.1.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(JSON.stringify(tools.tools.map((tool: { name: string }) => tool.name), null, 2));

  const created = await client.callTool({
    name: "createTask",
    arguments: {
      title: "Client smoke test",
      description: "Created by the MCP client",
      priority: 1,
    },
  });

  console.log(JSON.stringify(created.content, null, 2));
  await client.close();
}

if (import.meta.main) {
  if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
    printUsage();
  } else {
    await main();
  }
}