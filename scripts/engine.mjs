/**
 * Start nanobot's API server — the engine behind CV parsing and JD analysis —
 * on Windows, macOS or Linux.
 *
 *     npm run engine
 *     npm run engine -- --dry-run     # only report which nanobot it would start
 *     npm run engine -- --port 8901   # anything else is passed to `nanobot serve`
 *
 * Where nanobot is looked for, in order:
 *   1. NANOBOT_SOURCE — a nanobot source checkout with its own .venv
 *   2. a source checkout sitting next to this project, found by its contents
 *      rather than its folder name, so a renamed or non-ASCII folder still works
 *   3. `nanobot` on PATH — what pip, pipx or nanobot's own installer provides
 *
 * This replaced two PowerShell scripts that only ran on Windows, and only when
 * saved with a BOM: without one, Windows PowerShell 5.1 misread a non-ASCII
 * folder name and reported the venv as missing.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const dryRun = process.argv.includes("--dry-run");
const passThrough = process.argv.slice(2).filter((arg) => arg !== "--dry-run");

const isCheckout = (dir) => existsSync(join(dir, "nanobot", "cli", "commands.py"));

function venvPython(dir) {
  const python = isWindows
    ? join(dir, ".venv", "Scripts", "python.exe")
    : join(dir, ".venv", "bin", "python");
  return existsSync(python) ? python : null;
}

function siblingCheckout() {
  const parent = dirname(projectRoot);
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    const dir = join(parent, entry.name);
    if (entry.isDirectory() && dir !== projectRoot && isCheckout(dir)) return dir;
  }
  return null;
}

function onPath(command) {
  return spawnSync(isWindows ? "where" : "which", [command], { stdio: "ignore" }).status === 0;
}

function fail(lines) {
  console.error(lines.join("\n"));
  process.exit(1);
}

let launch;
const source = process.env.NANOBOT_SOURCE || siblingCheckout();
if (source) {
  if (!isCheckout(source)) {
    fail([`NANOBOT_SOURCE points at ${source}, which is not a nanobot checkout.`]);
  }
  const python = venvPython(source);
  if (!python) {
    fail([
      `Found nanobot at ${source}, but it has no .venv yet. Create one there:`,
      "  python -m venv .venv",
      isWindows
        ? '  .\\.venv\\Scripts\\python.exe -m pip install -e ".[api]"'
        : '  .venv/bin/python -m pip install -e ".[api]"',
    ]);
  }
  launch = { command: python, args: ["-m", "nanobot", "serve", ...passThrough], cwd: source, from: `source checkout ${source}` };
} else if (onPath("nanobot")) {
  launch = { command: "nanobot", args: ["serve", ...passThrough], cwd: projectRoot, from: "nanobot on PATH" };
} else {
  fail([
    "Could not find nanobot.",
    'Install it with  pip install "nanobot-ai[api]"  and run  nanobot onboard  once,',
    "or put a nanobot source checkout next to this project, or set NANOBOT_SOURCE to its path.",
  ]);
}

console.log(`${dryRun ? "Would start" : "Starting"} nanobot serve (${launch.from})`);
if (dryRun) process.exit(0);

const child = spawn(launch.command, launch.args, {
  cwd: launch.cwd,
  stdio: "inherit",
  // pip installs `nanobot` as an .exe on Windows, but some installers leave a
  // .cmd shim instead, and those only run through a shell.
  shell: isWindows && launch.command === "nanobot",
});
child.on("exit", (code) => process.exit(code ?? 0));
