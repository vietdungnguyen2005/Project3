import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const parentEnvPath = path.resolve(projectRoot, "..", ".env");
const localEnvPath = path.resolve(projectRoot, ".env.local");

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...rest] = trimmed.split("=");
    const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
    process.env[key.trim()] ??= value;
  }
}

function mapCloudflareAliases() {
  process.env.CLOUDFLARE_ACCOUNT_ID ??= process.env.ACCOUNT_ID;
  process.env.CLOUDFLARE_API_TOKEN ??= process.env.API_TOKEN;
}

function assertCloudflareCredentials() {
  const missing = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"].filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing Cloudflare credential(s): ${missing.join(", ")}`);
    console.error("Accepted aliases from ../.env: ACCOUNT_ID -> CLOUDFLARE_ACCOUNT_ID, API_TOKEN -> CLOUDFLARE_API_TOKEN.");
    process.exit(1);
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

loadDotEnv(parentEnvPath);
loadDotEnv(localEnvPath);
mapCloudflareAliases();

const action = process.argv[2] ?? "check";

if (action === "check") {
  assertCloudflareCredentials();
  console.log("Cloudflare credentials detected: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are available.");
  process.exit(0);
}

assertCloudflareCredentials();

const openNextCli = path.join(projectRoot, "node_modules", "@opennextjs", "cloudflare", "dist", "cli", "index.js");

const commands = {
  build: [[process.execPath, [openNextCli, "build"]]],
  preview: [
    [process.execPath, [openNextCli, "build"]],
    [process.execPath, [openNextCli, "preview"]],
  ],
  deploy: [
    [process.execPath, [openNextCli, "build"]],
    [process.execPath, [openNextCli, "deploy"]],
  ],
  upload: [
    [process.execPath, [openNextCli, "build"]],
    [process.execPath, [openNextCli, "upload"]],
  ],
};

if (!commands[action]) {
  console.error(`Unknown Cloudflare action: ${action}`);
  process.exit(1);
}

for (const [command, args] of commands[action]) {
  await run(command, args);
}
