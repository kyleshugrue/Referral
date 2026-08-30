import { spawn } from "node:child_process";
import process from "node:process";
import { assertDisposableDatabaseUrl } from "../server/lib/database-readiness.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for schema push.");
assertDisposableDatabaseUrl(databaseUrl);

const child = spawn("npx", ["drizzle-kit", "push"], {
  stdio: "inherit",
  shell: false,
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});