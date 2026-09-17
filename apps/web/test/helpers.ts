import type {
  LoginResponseDto,
  MemberResponseDto,
  SessionResponseDto,
} from "@share-mind-map/api-client";

export function sessionResponse(
  role: SessionResponseDto["role"] = "reader",
  mustChangePassword = false,
): SessionResponseDto {
  return {
    user: { id: "00000000-0000-7000-8000-000000000001", displayName: "Reader One" },
    organization: { id: "00000000-0000-7000-8000-000000000002", name: "Kitar" },
    defaultWorkspace: {
      id: "00000000-0000-7000-8000-000000000003",
      name: "产品工作区",
    },
    role,
    effectivePermissions:
      role === "admin" ? ["workspace:read", "workspace:admin"] : ["workspace:read"],
    mustChangePassword,
  };
}

export function loginResponse(
  role: LoginResponseDto["role"] = "reader",
  mustChangePassword = false,
): LoginResponseDto {
  return { ...sessionResponse(role, mustChangePassword), csrfToken: "csrf-from-login" };
}

export function member(overrides: Partial<MemberResponseDto> = {}): MemberResponseDto {
  return {
    id: "00000000-0000-7000-8000-000000000011",
    userId: "00000000-0000-7000-8000-000000000012",
    displayName: "Reader One",
    loginName: "reader.one",
    role: "reader",
    accountStatus: "active",
    mustChangePassword: false,
    lastLoginAt: null,
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": "request-id-00000001" },
  });
}

export function apiError(code: string, message: string, status: number): Response {
  return jsonResponse(
    { error: { code, message, details: {}, requestId: "request-id-00000001" } },
    status,
  );
}
