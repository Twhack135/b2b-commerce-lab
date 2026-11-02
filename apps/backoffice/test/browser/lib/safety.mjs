// Safety rules of the browser test runner. Pure functions (unit tested in
// safety.test.mjs) plus small runtime checks. The runner refuses to start
// instead of guessing whenever one of them fails.

import net from "node:net";

/** Ports of the real development environment (API, Backoffice, PostgreSQL) */
export const PROTECTED_PORTS = Object.freeze([3000, 3001, 5432]);

/** Prefix of every container the runner creates; nothing else is touched */
export const CONTAINER_PREFIX = "b2b-browser-test-";

/** Docker label that marks a container as belonging to one runner run */
export const RUN_LABEL = "b2b-commerce-lab.browser-test-run";

/** A port for a temporary service: unprivileged and never a protected one */
export function assertTestPort(port, name) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name}: ${port} is not a valid unprivileged port (1024-65535).`);
  }
  if (PROTECTED_PORTS.includes(port)) {
    throw new Error(
      `${name}: port ${port} belongs to the development environment and is never used for tests.`,
    );
  }
  return port;
}

/** All test ports must be valid and different from each other */
export function assertTestPorts(ports) {
  const seen = new Map();
  for (const [name, port] of Object.entries(ports)) {
    assertTestPort(port, name);
    if (seen.has(port)) {
      throw new Error(`${name} and ${seen.get(port)} use the same port ${port}.`);
    }
    seen.set(port, name);
  }
  return ports;
}

/**
 * The connection string of the disposable test database: local, on the
 * test port, a database name ending with "_test", never the development
 * database b2b_erp.
 */
export function assertTestDatabaseUrl(url, port) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("The test database URL is not a valid URL.");
  }
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("The test database URL is not a PostgreSQL URL.");
  }
  if (parsed.hostname !== "127.0.0.1") {
    throw new Error(`The test database must be on 127.0.0.1, not ${parsed.hostname}.`);
  }
  if (Number(parsed.port) !== port || PROTECTED_PORTS.includes(Number(parsed.port))) {
    throw new Error(`The test database must use port ${port}, not ${parsed.port || "5432"}.`);
  }
  if (!/^[a-z0-9_]+_test$/.test(database) || database === "b2b_erp") {
    throw new Error(`"${database}" is not a test database name (must end with "_test").`);
  }
  if ([...parsed.searchParams.keys()].length > 0) {
    throw new Error("The test database URL must not contain parameters.");
  }
  return url;
}

/** The ERP API the test Backoffice talks to: exactly the test API */
export function assertTestApiUrl(url, apiPort) {
  if (url !== `http://127.0.0.1:${apiPort}`) {
    throw new Error(`The test Backoffice must use http://127.0.0.1:${apiPort}, not ${url}.`);
  }
  if (PROTECTED_PORTS.includes(apiPort)) {
    throw new Error(`The test Backoffice must never use port ${apiPort}.`);
  }
  return url;
}

/** Only containers this runner names may be created or removed */
export function assertTestContainerName(name) {
  // The prefix followed by the run ID (hex), nothing else
  if (!new RegExp(`^${CONTAINER_PREFIX}[0-9a-f]{8,}$`).test(name)) {
    throw new Error(`"${name}" is not a browser test container name.`);
  }
  return name;
}

/**
 * Environment of a test service: the parent environment without anything
 * that could redirect it, plus the given settings. PostgreSQL variables are
 * removed so that only the explicit DATABASE_URL counts.
 */
export function serviceEnvironment(base, settings) {
  const env = { ...base };
  for (const name of Object.keys(env)) {
    if (/^PG[A-Z]+$/.test(name)) delete env[name];
  }
  for (const name of ["DATABASE_URL", "ERP_API_URL", "PORT", "HOST", "HOSTNAME"]) {
    delete env[name];
  }
  return { ...env, ...settings };
}

/** True if something accepts connections on 127.0.0.1:port */
export function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

/** True if this process could listen on 127.0.0.1:port right now */
export function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Refuses ports that are in use. The runner never frees a port by stopping
 * whatever uses it: a busy port is the user's to resolve.
 */
export async function assertPortsFree(ports) {
  for (const [name, port] of Object.entries(ports)) {
    if ((await isPortInUse(port)) || !(await canListen(port))) {
      throw new Error(
        `${name}: port ${port} is already in use. Choose another port (see README) or stop that program yourself; the runner never stops processes it did not start.`,
      );
    }
  }
}
