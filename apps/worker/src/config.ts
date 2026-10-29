import { isAbsolute } from "node:path";

import { z } from "zod";

const workerEnvironmentSchema = z.object({
  WORKER_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  WORKER_HOST: z.string().min(1).default("127.0.0.1"),
  DATABASE_URL: z.url().refine((value) => value.startsWith("postgresql://"), {
    message: "must use postgresql://",
  }),
  REDIS_URL: z
    .url()
    .refine((value) => value.startsWith("redis://") || value.startsWith("rediss://"), {
      message: "must use redis:// or rediss://",
    }),
  MINIO_ENDPOINT: z.url(),
  MINIO_ROOT_USER: z.string().min(1),
  MINIO_ROOT_PASSWORD: z.string().min(1),
  MINIO_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  XMIND_QUEUE_PREFIX: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .default("smm"),
  XMIND_FIXTURE_ROOT: z.string().refine(isAbsolute, { message: "must be an absolute path" }),
  API_TEST_ROOT: z.string().refine(isAbsolute, { message: "must be an absolute path" }).default("/app/api-tests"),
  API_TEST_PYTHON: z.string().refine(isAbsolute, { message: "must be an absolute path" }).default("/opt/api-tests-venv/bin/python"),
  API_TEST_ALLOWED_HOSTS: z
    .string()
    .default("api.kitarx.com,ydqapi.kitarx.com,cjyapi.kitarx.com,lfxapi.kitarx.com,lwapi.kitarx.com"),
  API_TEST_CAPTURE: z.enum(["all", "failures", "none"]).default("failures"),
  AUTH_METHOD: z.string().min(1).default("sms"),
  AUTH_PHONE: z.string().default("+6281111111111"),
  AUTH_SMS_CODE: z.string().default("666666"),
  API_TOKEN: z.string().optional(),
  IM_USERNAME: z.string().optional(),
  IM_PASSWORD: z.string().optional(),
});

export interface WorkerConfig {
  host: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  minioEndpoint: string;
  minioAccessKey: string;
  minioSecretKey: string;
  minioBucket: string;
  queuePrefix: string;
  fixtureRoot: string;
  apiTestRoot: string;
  apiTestPython: string;
  apiTestAllowedHosts: string[];
  apiTestCapture: "all" | "failures" | "none";
  authMethod: string;
  authPhone: string;
  authSmsCode: string;
  apiToken?: string;
  imUsername?: string;
  imPassword?: string;
}

export function parseWorkerConfig(environment: Record<string, string | undefined>): WorkerConfig {
  const result = workerEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid worker configuration: ${problems.join("; ")}`);
  }
  return {
    host: result.data.WORKER_HOST,
    port: result.data.WORKER_PORT,
    databaseUrl: result.data.DATABASE_URL,
    redisUrl: result.data.REDIS_URL,
    minioEndpoint: result.data.MINIO_ENDPOINT,
    minioAccessKey: result.data.MINIO_ROOT_USER,
    minioSecretKey: result.data.MINIO_ROOT_PASSWORD,
    minioBucket: result.data.MINIO_BUCKET,
    queuePrefix: result.data.XMIND_QUEUE_PREFIX,
    fixtureRoot: result.data.XMIND_FIXTURE_ROOT,
    apiTestRoot: result.data.API_TEST_ROOT,
    apiTestPython: result.data.API_TEST_PYTHON,
    apiTestAllowedHosts: result.data.API_TEST_ALLOWED_HOSTS.split(",")
      .map((host) => host.trim())
      .filter((host) => host.length > 0),
    apiTestCapture: result.data.API_TEST_CAPTURE,
    authMethod: result.data.AUTH_METHOD,
    authPhone: result.data.AUTH_PHONE,
    authSmsCode: result.data.AUTH_SMS_CODE,
    ...(result.data.API_TOKEN === undefined ? {} : { apiToken: result.data.API_TOKEN }),
    ...(result.data.IM_USERNAME === undefined ? {} : { imUsername: result.data.IM_USERNAME }),
    ...(result.data.IM_PASSWORD === undefined ? {} : { imPassword: result.data.IM_PASSWORD }),
  };
}
