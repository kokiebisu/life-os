#!/usr/bin/env bun
/**
 * gh pr create ラッパー — "No commits between" エラー時に gh api にフォールバック
 *
 * 使い方:
 *   bun run scripts/create-pr.ts --title "feat: ..." [--body "..."] [--base main] [--head branch]
 */

export interface CreatePrArgs {
  title: string;
  body: string;
  base: string;
  head: string;
}

export function parseArgs(argv: string[]): CreatePrArgs {
  const args = argv.slice(2);
  let title = "";
  let body = "";
  let base = "main";
  let head = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--title" && args[i + 1]) {
      title = args[++i];
    } else if (args[i] === "--body" && args[i + 1]) {
      body = args[++i];
    } else if (args[i] === "--base" && args[i + 1]) {
      base = args[++i];
    } else if (args[i] === "--head" && args[i + 1]) {
      head = args[++i];
    }
  }

  return { title, body, base, head };
}

export function shouldFallback(exitCode: number, stderr: string): boolean {
  return exitCode !== 0 && stderr.includes("No commits between");
}

async function runCommand(
  cmd: string[],
  captureOutput = false
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    stdout: captureOutput ? "pipe" : "inherit",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const stdout = captureOutput ? await new Response(proc.stdout as ReadableStream).text() : "";
  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

async function getCurrentBranch(): Promise<string> {
  const proc = Bun.spawn(["git", "branch", "--show-current"], { stdout: "pipe", stderr: "pipe" });
  const branch = (await new Response(proc.stdout as ReadableStream).text()).trim();
  await proc.exited;
  return branch;
}

async function main() {
  const parsed = parseArgs(process.argv);

  if (!parsed.title) {
    console.error("Error: --title is required");
    process.exit(1);
  }

  if (!parsed.head) {
    parsed.head = await getCurrentBranch();
    if (!parsed.head) {
      console.error("Error: could not detect current branch. Use --head to specify.");
      process.exit(1);
    }
  }

  // 1. Try gh pr create
  const ghArgs = [
    "gh", "pr", "create",
    "--title", parsed.title,
    "--body", parsed.body,
    "--base", parsed.base,
    "--head", parsed.head,
  ];

  const result = await runCommand(ghArgs, true);

  if (result.exitCode === 0) {
    const url = result.stdout.trim();
    if (url) console.log(url);
    return;
  }

  // 2. Check if we should fall back
  if (!shouldFallback(result.exitCode, result.stderr)) {
    // Some other error — propagate stderr and exit
    process.stderr.write(result.stderr);
    process.exit(result.exitCode);
  }

  // 3. Fallback: gh api
  console.error("gh pr create failed (No commits between). Falling back to gh api...");

  const repoProc = Bun.spawn(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { stdout: "pipe", stderr: "pipe" });
  const repoName = (await new Response(repoProc.stdout as ReadableStream).text()).trim();
  await repoProc.exited;

  const apiArgs = [
    "gh", "api",
    `repos/${repoName}/pulls`,
    "--method", "POST",
    "--field", `title=${parsed.title}`,
    "--field", `head=${parsed.head}`,
    "--field", `base=${parsed.base}`,
    "--field", `body=${parsed.body}`,
  ];

  const apiResult = await runCommand(apiArgs, true);

  if (apiResult.exitCode !== 0) {
    process.stderr.write(apiResult.stderr);
    process.exit(apiResult.exitCode);
  }

  try {
    const json = JSON.parse(apiResult.stdout);
    const url: string = json.html_url ?? json.url ?? "";
    if (url) console.log(url);
  } catch {
    // JSON parse failed — just print raw output
    console.log(apiResult.stdout.trim());
  }
}

// Only run main when executed directly (not when imported in tests)
if (import.meta.main) {
  main();
}
