// Processes the runner starts itself. Only these are ever stopped: the
// runner keeps the ChildProcess handle of each one, so the PID it stops is
// guaranteed to be its own process (a PID is not reused while the handle is
// open and the process has not exited). Nothing is stopped because of a port.

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";

/** A process started by the runner, with its output in a log file */
export class OwnedProcess {
  constructor(name, child, logFile) {
    this.name = name;
    this.child = child;
    this.logFile = logFile;
    this.exited = new Promise((resolve) => child.once("exit", resolve));
  }

  get isRunning() {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  /**
   * Stops this process and the processes it started itself (e.g. the
   * workers of Next.js). Does nothing if it has already exited.
   */
  async stop() {
    if (!this.isRunning) return;
    const pid = this.child.pid;
    if (process.platform === "win32") {
      // /T: the tree below OUR process; /F: without asking
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      // The process was started as leader of its own group (detached)
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        // Already gone
      }
    }
    await Promise.race([this.exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
}

/**
 * Starts a program and writes its output to `logFile`. `env` is used as
 * given (see serviceEnvironment), nothing is inherited implicitly.
 */
export function startProcess(name, command, args, { cwd, env, logFile }) {
  const log = createWriteStream(logFile);
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return new OwnedProcess(name, child, logFile);
}

/** Runs a program to completion; throws with its output if it fails */
export function runToCompletion(command, args, { cwd, env, label }) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-20).join("\n");
    throw new Error(`${label} failed (exit ${result.status}).\n${output}`);
  }
  return result.stdout;
}

/** Waits until `url` answers (any HTTP status) or the process has exited */
export async function waitForHttp(url, owned, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (owned && !owned.isRunning) {
      throw new Error(`${owned.name} exited before it was ready; see ${owned.logFile}`);
    }
    try {
      await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
}
