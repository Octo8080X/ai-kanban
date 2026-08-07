#!/usr/bin/env -S deno run -A
import { parseArgs } from "jsr:@std/cli/parse-args";

const SERVER = "http://localhost:8000";

// Sleep durations (step 1/2/3 それぞれの待機時間)
const SLEEP_RATE_LIMIT_MS  = 30 * 60 * 1000; // 30 分: 利用枠 90% 超
const SLEEP_HIGH_USAGE_MS  = 10 * 60 * 1000; // 10 分: 利用枠 80% 超
const SLEEP_NO_WORK_MS     =  5 * 60 * 1000; //  5 分: 実行できる todo なし
const SLEEP_AFTER_WORK_MS  =  1 * 60 * 1000; //  1 分: claude 実行後
const SLEEP_ON_ERROR_MS    =  5 * 60 * 1000; //  5 分: claude 異常終了/タイムアウト後
const CLAUDE_TIMEOUT_MS    = 20 * 60 * 1000; // 20 分: claude セッションのタイムアウト

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Task { id: number; title: string; description: string; status: "todo" | "doing" | "done"; branch: string }
interface Todo { id: number; taskId: number; type: "normal" | "question" | "resume"; title: string; status: "todo" | "doing" | "waiting" | "done"; priority: number; orderNo: number }

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Step 1: 使用状況の確認 ────────────────────────────────────────────────────

async function checkUsage(): Promise<{ sessionPct: number | null }> {
  const { stdout, stderr } = await new Deno.Command("claude", {
    args: ["--dangerously-skip-permissions", "-p", "/usage"],
    stdout: "piped",
    stderr: "piped",
  }).output();

  const text = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);

  // 使用状況をそのままコンソールに出力する
  if (text.trim()) console.log(text.trim());

  const sessionMatch = text.match(/Current session:\s*(\d+)%\s*used/i);
  const sessionPct = sessionMatch ? parseInt(sessionMatch[1], 10) : null;
  return { sessionPct };
}

// ── Step 2: 次の作業を探す ────────────────────────────────────────────────────

async function findNextWork(): Promise<{ task: Task; todo: Todo | null } | null> {
  let tasks: Task[];
  try {
    ({ tasks } = await fetchJson<{ tasks: Task[] }>(`${SERVER}/api/tasks`));
  } catch (err) {
    console.error(`[サーバー接続エラー] ${err}`);
    return null;
  }
  const active = tasks.filter((t) => t.status !== "done");

  for (const task of active) {
    const data = await fetchJson<{ task?: { task: Task; todos: Todo[] } }>(`${SERVER}/api/tasks/${task.id}`);
    const todos: Todo[] = data.task?.todos ?? [];

    if (todos.length === 0) return { task, todo: null };

    const pending = todos.filter((t) => t.status === "todo");
    if (pending.length === 0) continue;

    // 未回答の質問がある間は同タスクの他の todo を実行しない
    const hasWaitingQuestion = todos.some((t) => t.type === "question" && t.status === "waiting");
    if (hasWaitingQuestion) {
      console.log(`タスク ${task.id}「${task.title}」: 人の回答待ち → スキップ`);
      continue;
    }

    pending.sort((a, b) => {
      if (a.type !== b.type) { if (a.type === "resume") return -1; if (b.type === "resume") return 1; }
      return a.priority !== b.priority ? a.priority - b.priority : a.orderNo - b.orderNo;
    });
    return { task, todo: pending[0] };
  }
  return null;
}

// ── Step 3: git ブランチを合わせる ────────────────────────────────────────────

async function runGit(args: string[]): Promise<{ ok: boolean; text: string }> {
  const { code, stdout, stderr } = await new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = (new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr)).trim();
  return { ok: code === 0, text };
}

// リモートのデフォルトブランチ（origin/HEAD が指す先）を調べる。
// リモートが無い/取得できない場合は main → master の順にローカル/リモート参照を探し、
// どれも無ければ現在のブランチにフォールバックする。
async function getDefaultBranch(): Promise<string> {
  const symbolic = await runGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const remoteDefault = symbolic.ok ? symbolic.text.replace(/^origin\//, "") : null;
  const candidates = [...(remoteDefault ? [remoteDefault] : []), "main", "master"];

  for (const name of candidates) {
    if ((await runGit(["show-ref", "--verify", "--quiet", `refs/heads/${name}`])).ok) return name;
  }
  for (const name of candidates) {
    if ((await runGit(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${name}`])).ok) return `origin/${name}`;
  }

  const current = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  return current.ok ? current.text : "HEAD";
}

// タスクに紐づくブランチへ切り替える。存在しなければデフォルトブランチから作成する。
// 既存ブランチのコミットを壊さないよう、リセットは行わない。
async function ensureBranch(branch: string): Promise<boolean> {
  if (!branch) {
    console.error("[エラー] タスクにブランチ名が設定されていません。");
    return false;
  }

  const checkout = await runGit(["checkout", branch]);
  if (checkout.ok) {
    console.log(`[git] ブランチ「${branch}」に切り替えました。`);
    return true;
  }

  const base = await getDefaultBranch();
  const create = await runGit(["checkout", "-b", branch, base]);
  if (create.ok) {
    console.log(`[git] デフォルトブランチ「${base}」から「${branch}」を作成して切り替えました。`);
    return true;
  }

  console.error(`[エラー] ブランチ「${branch}」への切り替え/作成に失敗しました: ${create.text}`);
  return false;
}

// commit は claude 自身に diff を見て範囲を選ばせて行わせる（CLI 側で `git add -A` は行わない）。
// 呼び忘れ・失敗時に気づけるよう、commit されずに残った差分がないかだけ確認して警告する。
async function warnIfUncommittedChanges(task: Task, todo: Todo): Promise<void> {
  const status = await runGit(["status", "--porcelain"]);
  if (!status.ok) {
    console.error(`[エラー] git status に失敗しました: ${status.text}`);
    return;
  }
  if (!status.text.trim()) return;

  console.warn(
    `[警告] タスク ${task.id} / todo #${todo.id} の実行後、commit されていない差分が残っています。claude が commit し忘れた可能性があります:\n` +
      status.text,
  );
}

// ── Step 4: claude を呼び出す ─────────────────────────────────────────────────

// `-p` (print) モードは既定の --output-format=text だと最終応答の1行しか
// 出力されず、途中の tool 呼び出し（Bash/Edit/MCP など）が一切コンソールに
// 出ない。--verbose --output-format stream-json で全イベントを取得し、
// 人が読める形に要約してその都度出力する。
async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        yield buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (buffer.trim()) yield buffer;
}

function shortToolName(name: string): string {
  const m = name.match(/^mcp__[^_]+__(.+)$/);
  return m ? m[1] : name;
}

function truncate(text: string, max = 300): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

// stream-json の1行を人が読めるログ行に要約する。ログ対象がなければ null。
function describeEvent(line: string): string | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  switch (event.type) {
    case "assistant": {
      const content = (event.message as { content?: unknown[] } | undefined)?.content ?? [];
      const parts: string[] = [];
      for (const block of content as Record<string, unknown>[]) {
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          parts.push(`[claude] ${truncate(block.text, 500)}`);
        } else if (block.type === "tool_use") {
          const name = shortToolName(String(block.name));
          const input = block.input as Record<string, unknown> | undefined;
          const detail = input?.description ?? input?.command ?? (input ? JSON.stringify(input) : "");
          parts.push(`[claude→tool] ${name}${detail ? `: ${truncate(String(detail), 200)}` : ""}`);
        }
      }
      return parts.length ? parts.join("\n") : null;
    }
    case "user": {
      const content = (event.message as { content?: unknown[] } | undefined)?.content ?? [];
      for (const block of content as Record<string, unknown>[]) {
        if (block.type === "tool_result") {
          const raw = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          const label = block.is_error ? "[tool エラー]" : "[tool 結果]";
          return `${label} ${truncate(raw, 200)}`;
        }
      }
      return null;
    }
    case "result": {
      const cost = typeof event.total_cost_usd === "number" ? `$${event.total_cost_usd.toFixed(4)}` : "unknown";
      return `[claude] 終了 subtype=${event.subtype} turns=${event.num_turns} cost=${cost} duration=${event.duration_ms}ms`;
    }
    default:
      return null;
  }
}

// 成功したら true、異常終了・タイムアウトなら false を返す（呼び出し元のループは継続する）。
async function runClaude(prompt: string): Promise<boolean> {
  console.log("\n======\n");
  const child = new Deno.Command("claude", {
    args: ["--dangerously-skip-permissions", "--verbose", "--output-format", "stream-json", "-p", prompt],
    stdin: "null",
    stdout: "piped",
    stderr: "inherit",
  }).spawn();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGTERM");
    } catch {
      // プロセスが既に終了している場合は無視する
    }
  }, CLAUDE_TIMEOUT_MS);

  for await (const line of readLines(child.stdout)) {
    if (!line.trim()) continue;
    const summary = describeEvent(line);
    if (summary) console.log(summary);
  }

  const { code } = await child.status;
  clearTimeout(timer);
  console.log("\n======\n");

  if (timedOut) {
    console.error(`[エラー] claude が ${CLAUDE_TIMEOUT_MS / 60000} 分以内に終了しませんでした。強制終了しました。`);
    return false;
  }

  if (code !== 0) {
    console.error("[エラー] claude が異常終了しました（code: " + code + "）。認証切れの場合は claude auth login を実行してください。");
    return false;
  }

  return true;
}

// ── プロンプト構築 ────────────────────────────────────────────────────────────

function buildPlanningPrompt(task: Task): string {
  const context = JSON.stringify({ task: { id: task.id, title: task.title, description: task.description, branch: task.branch } }, null, 2);

  return (
    `あなたは kanban 自動実行セッションです。以下の task を todo に分解してください。他の task には手を出さないでください。\n\n` +
    "```json\n" + context + "\n```\n\n" +
    `- 上記 JSON が最新の情報です。kanban MCP の getTask / listTasks を読み取り目的で呼ぶ必要はありません。\n` +
    `- MCP は次の状態変更のためだけに使ってください。\n` +
    `  - addTodo を必要な数だけ呼んで todo を登録したら終了する\n` +
    `  - 判断に迷うことが1つあれば askQuestion を1問だけ呼んで終了する（複数まとめて聞かない。質問した後は続けない）\n`
  );
}

function buildExecutionPrompt(task: Task, todo: Todo): string {
  const context = JSON.stringify(
    {
      task: { id: task.id, title: task.title, description: task.description, branch: task.branch },
      todo: { id: todo.id, title: todo.title, type: todo.type },
    },
    null,
    2,
  );

  const resumeNote = todo.type === "resume"
    ? `- この todo は質問への回答を受けて再開するものです。タイトルに含まれる [Q]/[A] の内容を反映して作業してください。\n`
    : "";

  return (
    `あなたは kanban 自動実行セッションです。以下の todo を1件だけ実行してください。他の todo・他の task には手を出さないでください。\n\n` +
    "```json\n" + context + "\n```\n\n" +
    `- 作業ブランチ「${task.branch}」は起動前に checkout 済みです。ブランチの切り替え・作成は行わないでください。\n` +
    `- 上記 JSON が最新の情報です。kanban MCP の getTask / getNextTodo / listTasks を読み取り目的で呼ぶ必要はありません。\n` +
    resumeNote +
    `- 実装が完了したら、git status / git diff で変更内容を確認し、この todo に関係するファイルだけを git add で選んで commit してください。\n` +
    `  - git add -A のように無関係な変更まで含めて一括 add しないでください。関係ないファイルの変更（他の作業の残骸等）が混ざっている場合はそれを含めずに commit してください。\n` +
    `  - commit メッセージは todo の内容が分かる一文にしてください。\n` +
    `- MCP は次の状態変更のためだけに使ってください。\n` +
    `  - commit まで完了したら updateTodo(todoId: ${todo.id}, status: "done") を呼んで終了する\n` +
    `  - 作業を todo に分解する必要があれば addTodo を呼ぶ\n` +
    `  - 判断に迷うことが1つあれば askQuestion を1問だけ呼んで終了する（複数まとめて聞かない。質問した後は実装を続けない）\n` +
    `- 判断の迷いではなく実装上のエラー(テスト失敗・依存関係の欠如等)で完了できない場合は、updateTodo は呼ばずに理由を出力して終了してください(その場合も、それまでに生じた意味のある差分があれば commit してから終了して構いません)。\n`
  );
}

async function tick(): Promise<void> {
  // 1. 利用枠を確認する
  const usage = await checkUsage();
  const pctLabel = usage.sessionPct !== null ? `${usage.sessionPct}%` : "不明";
  console.log(`[使用状況] session: ${pctLabel}`);

  if (usage.sessionPct !== null && usage.sessionPct >= 90) {
    console.log(`利用枠が ${usage.sessionPct}% に達しています。${SLEEP_RATE_LIMIT_MS / 60000} 分スリープします...`);
    await sleep(SLEEP_RATE_LIMIT_MS);
    return;
  }

  if (usage.sessionPct !== null && usage.sessionPct >= 80) {
    console.log(`利用枠が ${usage.sessionPct}% に達しています。${SLEEP_HIGH_USAGE_MS / 60000} 分スリープします...`);
    await sleep(SLEEP_HIGH_USAGE_MS);
    return;
  }

  // 2. タスクがあるか確認する
  const work = await findNextWork();
  if (!work) {
    console.log(`実行できる todo はありません。${SLEEP_NO_WORK_MS / 60000} 分スリープします...`);
    await sleep(SLEEP_NO_WORK_MS);
    return;
  }

  const { task, todo } = work;

  // 3. タスクのブランチに切り替える
  if (!(await ensureBranch(task.branch))) {
    console.log(`タスク ${task.id}「${task.title}」: ブランチ切り替えに失敗したためスキップします。`);
    await sleep(SLEEP_ON_ERROR_MS);
    return;
  }

  // 4. todo を元に claude を呼び出す
  let ok: boolean;
  if (!todo) {
    console.log(`タスク ${task.id}「${task.title}」: planning`);
    ok = await runClaude(buildPlanningPrompt(task));
  } else {
    console.log(`タスク ${task.id}「${task.title}」: todo #${todo.id}「${todo.title}」[${todo.type}]`);
    ok = await runClaude(buildExecutionPrompt(task, todo));
    // 5. commit は claude 自身が diff を見て行っている想定。残っていれば警告するだけ。
    await warnIfUncommittedChanges(task, todo);
  }

  await sleep(ok ? SLEEP_AFTER_WORK_MS : SLEEP_ON_ERROR_MS);
}

// ── Entry point ──────────────────────────────────────────────────────────────

const { once } = parseArgs(Deno.args, { boolean: ["once"], default: { once: false } });

if (once) {
  await tick();
} else {
  console.log("自動実行モード  Ctrl+C で停止\n");
  while (true) {
    console.log(`[${new Date().toLocaleTimeString("ja-JP")}] チェック`);
    await tick();
  }
}
