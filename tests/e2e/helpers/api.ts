import type { APIRequestContext, APIResponse } from "@playwright/test";

export interface ApiSession {
  csrfToken: string;
  workspaceId: string;
}

export interface ApiLockLease {
  browserEditSessionId: string;
  generation: number;
  token: string;
}

export async function apiCreateDocument(
  request: APIRequestContext,
  workspaceId: string,
  csrfToken: string,
  name: string,
): Promise<string> {
  const response = await request.post(`/api/v1/workspaces/${workspaceId}/documents`, {
    headers: { "X-CSRF-Token": csrfToken },
    data: { name },
  });
  if (response.status() !== 201) {
    throw new Error(`Document creation failed with ${String(response.status())}`);
  }
  return (await jsonBody<{ document: { id: string } }>(response)).document.id;
}

export async function apiDocumentDetail(
  request: APIRequestContext,
  workspaceId: string,
  documentId: string,
): Promise<{ document: { currentVersion: number; snapshot: Record<string, unknown> } }> {
  const response = await request.get(`/api/v1/workspaces/${workspaceId}/documents/${documentId}`);
  if (!response.ok()) throw new Error(`Document detail failed with ${String(response.status())}`);
  return jsonBody(response);
}

export async function apiAcquireDocumentLock(
  request: APIRequestContext,
  workspaceId: string,
  documentId: string,
  csrfToken: string,
  browserEditSessionId: string,
): Promise<ApiLockLease> {
  const response = await request.post(
    `/api/v1/workspaces/${workspaceId}/documents/${documentId}/lock`,
    { headers: { "X-CSRF-Token": csrfToken }, data: { browserEditSessionId } },
  );
  if (response.status() !== 201) {
    throw new Error(`Lock acquisition failed with ${String(response.status())}`);
  }
  const body = await jsonBody<{ lock: ApiLockLease }>(response);
  return { ...body.lock, browserEditSessionId };
}

export async function apiForceReleaseDocumentLock(
  request: APIRequestContext,
  workspaceId: string,
  documentId: string,
  csrfToken: string,
): Promise<APIResponse> {
  return request.post(
    `/api/v1/workspaces/${workspaceId}/documents/${documentId}/lock/force-release`,
    { headers: { "X-CSRF-Token": csrfToken }, data: { confirm: true } },
  );
}

export async function apiSaveDocumentSnapshot(
  request: APIRequestContext,
  workspaceId: string,
  documentId: string,
  csrfToken: string,
  lease: ApiLockLease,
  snapshot: Record<string, unknown>,
  idempotencyKey: string,
): Promise<APIResponse> {
  const baseVersion = snapshot.version;
  if (typeof baseVersion !== "number") throw new Error("Snapshot version is missing");
  return request.post(`/api/v1/workspaces/${workspaceId}/documents/${documentId}/snapshots`, {
    headers: { "X-CSRF-Token": csrfToken, "Idempotency-Key": idempotencyKey },
    data: {
      baseVersion,
      browserEditSessionId: lease.browserEditSessionId,
      generation: lease.generation,
      imageBytes: 0,
      saveKind: "manual",
      snapshot,
      token: lease.token,
      assetIds: [],
    },
  });
}

export interface E2eMember {
  id: string;
  displayName: string;
  role: "reader" | "editor" | "admin";
}

interface E2eCreatedMember {
  member: E2eMember;
  temporaryPassword: string;
}

export async function jsonBody<T>(response: APIResponse): Promise<T> {
  const body: unknown = await response.json();
  return body as T;
}

export async function apiLogin(
  request: APIRequestContext,
  loginName: string,
  password: string,
): Promise<{ response: APIResponse; session?: ApiSession }> {
  const response = await request.post("/api/v1/auth/login", {
    data: { loginName, password },
  });
  if (!response.ok()) return { response };
  const login = await jsonBody<{ csrfToken: string; defaultWorkspace: { id: string } }>(response);
  return {
    response,
    session: { csrfToken: login.csrfToken, workspaceId: login.defaultWorkspace.id },
  };
}

export async function apiChangePassword(
  request: APIRequestContext,
  csrfToken: string,
  currentPassword: string,
  newPassword: string,
): Promise<APIResponse> {
  return request.put("/api/v1/auth/password", {
    headers: { "X-CSRF-Token": csrfToken },
    data: { currentPassword, newPassword },
  });
}

export async function apiCsrf(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/v1/auth/csrf");
  if (!response.ok()) throw new Error(`CSRF bootstrap failed with ${String(response.status())}`);
  const body = await jsonBody<{ csrfToken: string }>(response);
  return body.csrfToken;
}

export async function apiMembers(request: APIRequestContext): Promise<E2eMember[]> {
  const response = await request.get("/api/v1/admin/members");
  if (!response.ok()) throw new Error(`Member list failed with ${String(response.status())}`);
  return (await jsonBody<{ members: E2eMember[] }>(response)).members;
}

export async function apiCreateMember(
  request: APIRequestContext,
  csrfToken: string,
  input: { loginName: string; displayName: string },
): Promise<E2eCreatedMember> {
  const response = await request.post("/api/v1/admin/members", {
    headers: { "X-CSRF-Token": csrfToken },
    data: input,
  });
  if (response.status() !== 201) {
    throw new Error(`Member creation failed with ${String(response.status())}`);
  }
  return jsonBody<E2eCreatedMember>(response);
}

export async function apiChangeStatus(
  request: APIRequestContext,
  csrfToken: string,
  memberId: string,
  status: "active" | "disabled",
): Promise<APIResponse> {
  return request.patch(`/api/v1/admin/members/${memberId}/account-status`, {
    headers: { "X-CSRF-Token": csrfToken },
    data: { status },
  });
}

export async function apiRevokeMemberEditing(
  request: APIRequestContext,
  csrfToken: string,
  membershipId: string,
): Promise<APIResponse> {
  return request.post(`/api/v1/admin/members/${membershipId}/revoke-editing`, {
    headers: { "X-CSRF-Token": csrfToken },
  });
}

export async function apiErrorCode(response: APIResponse): Promise<string | undefined> {
  const body = await jsonBody<{ error?: { code?: string } }>(response);
  return body.error?.code;
}
