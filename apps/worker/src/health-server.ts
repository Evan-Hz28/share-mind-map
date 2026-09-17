import { createServer, type Server } from "node:http";

export type HealthComponent = "postgres" | "redis" | "minio" | "queue";
export type HealthCheck = () => Promise<void>;
export type HealthChecks = Record<HealthComponent, HealthCheck>;

export interface HealthServerOptions {
  host: string;
  port: number;
  timeoutMs?: number;
  checks: HealthChecks;
}

export interface HealthServer {
  nodeServer: Server;
  port: number;
  close(): Promise<void>;
}

function runWithTimeout(check: HealthCheck, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("health check timed out"));
    }, timeoutMs);
    void check().then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      () => {
        clearTimeout(timeout);
        reject(new Error("health check failed"));
      },
    );
  });
}

function writeJson(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export async function startHealthServer(options: HealthServerOptions): Promise<HealthServer> {
  const timeoutMs = options.timeoutMs ?? 1_000;
  const server = createServer((request, response) => {
    if (request.method !== "GET") {
      writeJson(response, 405, { status: "method_not_allowed" });
      return;
    }
    if (request.url === "/health/live") {
      writeJson(response, 200, { status: "ok" });
      return;
    }
    if (request.url !== "/health/ready") {
      writeJson(response, 404, { status: "not_found" });
      return;
    }

    void Promise.all(
      (Object.entries(options.checks) as [HealthComponent, HealthCheck][]).map(
        async ([component, check]) => {
          try {
            await runWithTimeout(check, timeoutMs);
            return [component, "ok"] as const;
          } catch {
            return [component, "unavailable"] as const;
          }
        },
      ),
    ).then((results) => {
      const components = Object.fromEntries(results) as Record<
        HealthComponent,
        "ok" | "unavailable"
      >;
      const ready = Object.values(components).every((status) => status === "ok");
      writeJson(response, ready ? 200 : 503, {
        status: ready ? "ok" : "unavailable",
        components,
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Worker health server did not bind a TCP address.");
  }
  return {
    nodeServer: server,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
}
