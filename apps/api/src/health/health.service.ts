import { createDatabase } from "@share-mind-map/database";
import { Inject, Injectable, Optional } from "@nestjs/common";
import Redis from "ioredis";
import { Client as MinioClient } from "minio";

import { SmtpMailProvider } from "../mail/smtp-mail.provider.js";
import type { MailProvider } from "../mail/mail-provider.js";
import type { AppConfig } from "../platform/config/app-config.js";

export type HealthComponent = "postgres" | "redis" | "minio" | "smtp";
export type HealthCheck = () => Promise<void>;
export type HealthChecks = Record<HealthComponent, HealthCheck>;
export type HealthComponentStatus = "ok" | "unavailable";

export const HEALTH_CHECKS = Symbol("HEALTH_CHECKS");

export interface InfrastructureHealthRuntime {
  checks: HealthChecks;
  mailProvider: MailProvider;
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

@Injectable()
export class HealthService {
  public constructor(
    @Inject(HEALTH_CHECKS) private readonly checks: HealthChecks,
    @Optional()
    private readonly timeoutMs = 1_000,
  ) {}

  public liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  public async readiness(): Promise<{
    status: "ok" | "unavailable";
    components: Record<HealthComponent, HealthComponentStatus>;
  }> {
    const entries = Object.entries(this.checks) as [HealthComponent, HealthCheck][];
    const results = await Promise.all(
      entries.map(async ([component, check]) => {
        try {
          await runWithTimeout(check, this.timeoutMs);
          return [component, "ok"] as const;
        } catch {
          return [component, "unavailable"] as const;
        }
      }),
    );
    const components = Object.fromEntries(results) as Record<
      HealthComponent,
      HealthComponentStatus
    >;
    const ready = Object.values(components).every((status) => status === "ok");
    return { status: ready ? "ok" : "unavailable", components };
  }
}

export function createInfrastructureHealthRuntime(config: AppConfig): InfrastructureHealthRuntime {
  const database = createDatabase(config.databaseUrl);
  const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const endpoint = config.minio.endpoint;
  const minio = new MinioClient({
    endPoint: endpoint.hostname,
    port: endpoint.port === "" ? (config.minio.useSsl ? 443 : 80) : Number(endpoint.port),
    useSSL: config.minio.useSsl,
    accessKey: config.minio.accessKey,
    secretKey: config.minio.secretKey,
  });
  const smtp = new SmtpMailProvider(config.smtp);
  return {
    mailProvider: smtp,
    checks: {
      postgres: async () => {
        await database.$client.query("SELECT 1");
      },
      redis: async () => {
        await redis.ping();
      },
      minio: async () => {
        if (!(await minio.bucketExists(config.minio.bucket))) {
          throw new Error("Configured MinIO bucket is unavailable");
        }
      },
      smtp: () => smtp.verify(),
    },
    close: async () => {
      await database.$client.end();
      redis.disconnect();
      smtp.close();
    },
  };
}
