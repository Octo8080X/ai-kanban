import { createApp } from "./src/app.ts";

if (import.meta.main) {
  Deno.serve({ port: 8000 }, createApp().fetch);
}

export { createApp };