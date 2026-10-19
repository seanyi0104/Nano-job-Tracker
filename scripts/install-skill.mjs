/**
 * Copy the job-analysis skill into nanobot's workspace, on any OS.
 *
 *     npm run install-skill
 *
 * The file under agent/ is the source of truth. nanobot only reads skills from
 * ~/.nanobot/workspace/skills/, so run this again after every edit to SKILL.md.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(projectRoot, "agent", "skills", "job-analysis", "SKILL.md");
const targetDir = join(homedir(), ".nanobot", "workspace", "skills", "job-analysis");

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, join(targetDir, "SKILL.md"));
console.log(`Installed the job-analysis skill into ${targetDir}`);
