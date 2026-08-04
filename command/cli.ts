#!/usr/bin/env -S deno run -A
import { parseArgs } from "jsr:@std/cli/parse-args";

const SERVER = "http://localhost:8000";

// Sleep durations (step 1/2/3 それぞれの待機時間)
const SLEEP_RATE_LIMIT_MS  = 30 * 60 * 1000; // 30 分: 利用枠 90% 超
const SLEEP_HIGH_USAGE_MS  = 10 * 60 * 1000; // 10 分: 利用枠 80% 超
const SLEEP_NO_WORK_MS     =  5 * 60 * 1000; //  5 分: 実行できる todo なし
const SLEEP_AFTER_WORK_MS  =  1 * 60 * 1000; //  1 分: claude 実行後

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Task { id: number; title: string; description: string; status: "todo" | "doing" | "done" }
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

// ── Step 3: claude を呼び出す ─────────────────────────────────────────────────

async function runClaude(prompt: string): Promise<void> {
  console.log("\n======\n");
  const child = new Deno.Command("claude", {
    args: ["--dangerously-skip-permissions", "-p", prompt],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  const { code } = await child.status;
  console.log("\n======\n");
  if (code !== 0) {
    console.error("[エラー] claude が異常終了しました（code: " + code + "）。認証切れの場合は claude auth login を実行してください。");
    Deno.exit(1);
  }
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

  // 3. 最新の todo を元に claude を呼び出す
  const { task, todo } = work;

  if (!todo) {
    console.log(`タスク ${task.id}「${task.title}」: planning`);
    await runClaude(
      `kanban MCP を使ってタスク ID ${task.id}「${task.title}」を todo に分解してください。\n` +
      `addTodo を必要な数だけ呼んで登録したら終了してください。\n` +
      `判断できないことがあれば askQuestion を 1 問だけ呼んで終了してください（複数まとめて聞かない）。\n` +
      (task.description ? `タスクの説明: ${task.description}` : ""),
    );
  } else {
    console.log(`タスク ${task.id}「${task.title}」: todo #${todo.id}「${todo.title}」[${todo.type}]`);
    const resumeContext = todo.type === "resume"
      ? `\nこの todo は質問への回答を受けて再開するものです。タイトルに含まれる [Q]/[A] の内容を反映して作業してください。\n`
      : "";
    await runClaude(
      `kanban MCP を使って以下の todo を 1 件だけ実行してください。\n\n` +
      `タスク ID: ${task.id}「${task.title}」\n` +
      `Todo ID: ${todo.id}「${todo.title}」（種別: ${todo.type}）\n` +
      resumeContext +
      `\n実行したら updateTodo(todoId: ${todo.id}, status: "done") を呼んで終了してください。\n` +
      `判断できない場合は askQuestion を 1 問だけ呼んで終了してください（複数まとめて聞かない）。`,
    );
  }

  await sleep(SLEEP_AFTER_WORK_MS);
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

