// The disposable PostgreSQL database of one test run: a container that only
// lives in memory (tmpfs), removes itself when stopped (--rm), listens only
// on 127.0.0.1 and carries the run ID as a label. Only a container with the
// runner's name AND this run's label is ever stopped.

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  assertTestContainerName,
  assertTestDatabaseUrl,
  RUN_LABEL,
} from "./safety.mjs";

const USER = "erp_user";
export const DATABASE = "b2b_erp_browser_test";

function docker(args) {
  return spawnSync("docker", args, { encoding: "utf8", windowsHide: true });
}

export function assertDockerAvailable() {
  const info = docker(["info", "--format", "{{.ServerVersion}}"]);
  if (info.error || info.status !== 0) {
    throw new Error(
      `Docker is not available. Start Docker Desktop and run the tests again.\n  ${(info.error?.message ?? info.stderr ?? "").trim()}`,
    );
  }
}

export class DisposableDatabase {
  constructor({ runId, port }) {
    this.runId = runId;
    this.port = port;
    this.container = assertTestContainerName(`b2b-browser-test-${runId}`);
    this.password = randomBytes(16).toString("hex");
    this.url = assertTestDatabaseUrl(
      `postgresql://${USER}:${this.password}@127.0.0.1:${port}/${DATABASE}`,
      port,
    );
    this.started = false;
  }

  /** Starts the container and waits until PostgreSQL accepts TCP connections */
  async start() {
    const exists = docker(["ps", "-a", "--filter", `name=^${this.container}$`, "--format", "{{.Names}}"]);
    if (exists.stdout.trim()) {
      throw new Error(`Container ${this.container} already exists.`);
    }
    const run = docker([
      "run", "--detach", "--rm",
      "--name", this.container,
      "--label", `${RUN_LABEL}=${this.runId}`,
      "--env", `POSTGRES_USER=${USER}`,
      "--env", `POSTGRES_PASSWORD=${this.password}`,
      "--env", `POSTGRES_DB=${DATABASE}`,
      "--publish", `127.0.0.1:${this.port}:5432`,
      "--tmpfs", "/var/lib/postgresql",
      "postgres:18",
    ]);
    if (run.status !== 0) {
      throw new Error(`The test database could not be started: ${run.stderr.trim()}`);
    }
    this.started = true;

    // During its first-time setup the server only listens on a socket, so
    // two successful TCP checks in a row are required
    const deadline = Date.now() + 60_000;
    let ready = 0;
    while (ready < 2) {
      if (Date.now() > deadline) throw new Error("The test database did not become ready within 60 s.");
      const check = docker(["exec", this.container, "pg_isready", "-h", "127.0.0.1", "-U", USER, "-d", DATABASE]);
      ready = check.status === 0 ? ready + 1 : 0;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  /** A query on THIS container (read-only checks and test assertions) */
  sql(query) {
    const result = docker(["exec", this.container, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", USER, "-d", DATABASE, "-c", query]);
    if (result.status !== 0) throw new Error(`SQL failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  }

  /** Stops (and thereby removes) the container, after checking its identity */
  stop() {
    if (!this.started) return "not started";
    const label = docker(["inspect", "--format", `{{ index .Config.Labels "${RUN_LABEL}" }}`, this.container]);
    if (label.status !== 0) return "already removed";
    if (label.stdout.trim() !== this.runId) {
      throw new Error(`Container ${this.container} does not belong to run ${this.runId}; it is left alone.`);
    }
    docker(["stop", this.container]);
    this.started = false;
    return "removed";
  }
}
