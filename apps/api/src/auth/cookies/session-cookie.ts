import type { Response } from "express";

import type { AppConfig } from "../../platform/config/app-config.js";

export const sessionCookieName = "smm_session";

type CookieConfig = Pick<AppConfig, "cookie" | "sessionTtlSeconds">;

export function setSessionCookie(response: Response, token: string, config: CookieConfig): void {
  response.cookie(sessionCookieName, token, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: "/",
    maxAge: config.sessionTtlSeconds * 1_000,
  });
}

export function clearSessionCookie(response: Response, config: CookieConfig): void {
  const secure = config.cookie.secure ? "; Secure" : "";
  const sameSite = config.cookie.sameSite === "strict" ? "Strict" : "Lax";
  response.append(
    "Set-Cookie",
    `${sessionCookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=${sameSite}${secure}`,
  );
}

export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined;
  const values = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${sessionCookieName}=`))
    .map((part) => part.slice(sessionCookieName.length + 1));
  return values.length === 1 && values[0] !== "" ? values[0] : undefined;
}
