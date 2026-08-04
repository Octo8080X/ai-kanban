export { createApp } from "./server/src/app.ts";

import { createApp } from "./server/src/app.ts";

if (import.meta.main) {
  Deno.serve(createApp().fetch);
}
