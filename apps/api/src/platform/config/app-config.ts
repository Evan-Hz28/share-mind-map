import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");
const isStrongSecret = (value: string): boolean =>
  Buffer.byteLength(value, "utf8") >= 32 && !/replace|placeholder|change-me/i.test(value);
const urlUsesProtocol = (value: string, protocols: readonly string[]): boolean =>
  URL.canParse(value) && protocols.includes(new URL(value).protocol);
const urlPassword = (value: string): string => {
  if (!URL.canParse(value)) return "";
  try {
    return decodeURIComponent(new URL(value).password);
  } catch {
    return "";
  }
};
const environmentSchema = z
  .object({
    APP_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_HOST: z.string().min(1).default("0.0.0.0"),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    API_PUBLIC_URL: z.url(),
    WEB_ORIGIN: z.url(),
    DATABASE_URL: z.string().refine((value) => urlUsesProtocol(value, ["postgresql:"]), {
      message: "must use postgresql://",
    }),
    REDIS_URL: z.string().refine((value) => urlUsesProtocol(value, ["redis:", "rediss:"]), {
      message: "must use redis:// or rediss://",
    }),
    MINIO_ENDPOINT: z.url(),
    MINIO_ROOT_USER: z.string().min(1),
    MINIO_ROOT_PASSWORD: z.string().min(1),
    MINIO_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    MINIO_USE_SSL: booleanString.default(false),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
    SMTP_SECURE: booleanString.default(false),
    SMTP_FROM: z.string().min(3),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SESSION_SECRET: z.string().min(1),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(604_800).default(86_400),
    DOCUMENT_LOCK_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    COOKIE_SECURE: booleanString.default(false),
    COOKIE_SAME_SITE: z.enum(["lax", "strict"]).default("lax"),
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(8_192).default(65_536),
    ARGON2_ITERATIONS: z.coerce.number().int().min(1).default(3),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(4).default(1),
    TRUST_PROXY_COUNT: z.coerce.number().int().min(0).default(0),
    XMIND_QUEUE_PREFIX: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .default("smm"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
  })
  .superRefine((environment, context) => {
    if ((environment.SMTP_USER === undefined) !== (environment.SMTP_PASSWORD === undefined)) {
      context.addIssue({
        code: "custom",
        path: [environment.SMTP_USER === undefined ? "SMTP_USER" : "SMTP_PASSWORD"],
        message: "must be configured together with the other SMTP credential",
      });
    }
    const minioUrl = URL.canParse(environment.MINIO_ENDPOINT)
      ? new URL(environment.MINIO_ENDPOINT)
      : undefined;
    if (minioUrl !== undefined && environment.MINIO_USE_SSL !== (minioUrl.protocol === "https:")) {
      context.addIssue({
        code: "custom",
        path: ["MINIO_USE_SSL"],
        message: "must match the MINIO_ENDPOINT scheme",
      });
    }
    if (environment.APP_ENV !== "production") return;

    if (!environment.COOKIE_SECURE) {
      context.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message: "must be true in production",
      });
    }
    if (!environment.API_PUBLIC_URL.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["API_PUBLIC_URL"],
        message: "must use HTTPS in production",
      });
    }
    if (!environment.WEB_ORIGIN.startsWith("https://") || environment.WEB_ORIGIN === "*") {
      context.addIssue({
        code: "custom",
        path: ["WEB_ORIGIN"],
        message: "must be a non-wildcard HTTPS origin in production",
      });
    }
    if (!isStrongSecret(environment.SESSION_SECRET)) {
      context.addIssue({
        code: "custom",
        path: ["SESSION_SECRET"],
        message: "must be a non-placeholder secret of at least 32 bytes in production",
      });
    }
    const credentialUrls = [
      ["DATABASE_URL", environment.DATABASE_URL],
      ["REDIS_URL", environment.REDIS_URL],
    ] as const;
    for (const [variable, value] of credentialUrls) {
      if (isStrongSecret(urlPassword(value))) continue;
      context.addIssue({
        code: "custom",
        path: [variable],
        message: "must contain a non-placeholder password of at least 32 bytes in production",
      });
    }
    if (!isStrongSecret(environment.MINIO_ROOT_PASSWORD)) {
      context.addIssue({
        code: "custom",
        path: ["MINIO_ROOT_PASSWORD"],
        message: "must be a non-placeholder secret of at least 32 bytes in production",
      });
    }
    if (environment.SMTP_PASSWORD !== undefined && !isStrongSecret(environment.SMTP_PASSWORD)) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_PASSWORD"],
        message: "must be a non-placeholder secret of at least 32 bytes in production",
      });
    }
    if (environment.ARGON2_MEMORY_KIB < 65_536) {
      context.addIssue({
        code: "custom",
        path: ["ARGON2_MEMORY_KIB"],
        message: "must be at least 65536 in production",
      });
    }
    if (environment.ARGON2_ITERATIONS < 3) {
      context.addIssue({
        code: "custom",
        path: ["ARGON2_ITERATIONS"],
        message: "must be at least 3 in production",
      });
    }
  });

const environmentKeys = Object.keys(environmentSchema.shape);

export type AppEnvironment = "development" | "test" | "production";
export type CookieSameSite = "lax" | "strict";
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user?: string;
  password?: string;
}

export interface AppConfig {
  environment: AppEnvironment;
  host: string;
  port: number;
  apiPublicUrl: URL;
  webOrigin: URL;
  databaseUrl: string;
  redisUrl: string;
  minio: {
    endpoint: URL;
    accessKey: string;
    secretKey: string;
    bucket: string;
    useSsl: boolean;
  };
  smtp: SmtpConfig;
  sessionSecret: string;
  sessionTtlSeconds: number;
  documentLockTtlSeconds: number;
  cookie: { secure: boolean; sameSite: CookieSameSite };
  argon2: { memoryKiB: number; iterations: number; parallelism: number };
  trustProxyCount: number;
  queuePrefix: string;
  logLevel: LogLevel;
}

export function parseAppConfig(environment: Record<string, string | undefined>): AppConfig {
  const selected = Object.fromEntries(environmentKeys.map((key) => [key, environment[key]]));
  const result = environmentSchema.safeParse(selected);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
    );
    throw new Error(`Invalid application configuration: ${problems.join("; ")}`);
  }

  const smtpCredentials =
    result.data.SMTP_USER === undefined || result.data.SMTP_PASSWORD === undefined
      ? {}
      : { user: result.data.SMTP_USER, password: result.data.SMTP_PASSWORD };
  return {
    environment: result.data.APP_ENV,
    host: result.data.API_HOST,
    port: result.data.API_PORT,
    apiPublicUrl: new URL(result.data.API_PUBLIC_URL),
    webOrigin: new URL(result.data.WEB_ORIGIN),
    databaseUrl: result.data.DATABASE_URL,
    redisUrl: result.data.REDIS_URL,
    minio: {
      endpoint: new URL(result.data.MINIO_ENDPOINT),
      accessKey: result.data.MINIO_ROOT_USER,
      secretKey: result.data.MINIO_ROOT_PASSWORD,
      bucket: result.data.MINIO_BUCKET,
      useSsl: result.data.MINIO_USE_SSL,
    },
    smtp: {
      host: result.data.SMTP_HOST,
      port: result.data.SMTP_PORT,
      secure: result.data.SMTP_SECURE,
      from: result.data.SMTP_FROM,
      ...smtpCredentials,
    },
    sessionSecret: result.data.SESSION_SECRET,
    sessionTtlSeconds: result.data.SESSION_TTL_SECONDS,
    documentLockTtlSeconds: result.data.DOCUMENT_LOCK_TTL_SECONDS,
    cookie: {
      secure: result.data.COOKIE_SECURE,
      sameSite: result.data.COOKIE_SAME_SITE,
    },
    argon2: {
      memoryKiB: result.data.ARGON2_MEMORY_KIB,
      iterations: result.data.ARGON2_ITERATIONS,
      parallelism: result.data.ARGON2_PARALLELISM,
    },
    trustProxyCount: result.data.TRUST_PROXY_COUNT,
    queuePrefix: result.data.XMIND_QUEUE_PREFIX,
    logLevel: result.data.LOG_LEVEL,
  };
}
