export type SessionRole = "reader" | "editor" | "admin";

export interface SessionPrincipal {
  userId: string;
  workspaceId: string;
  role: SessionRole;
  mustChangePassword: boolean;
}

export interface SessionRecord extends SessionPrincipal {
  csrfDigest: string;
}

export interface CreatedSession {
  token: string;
  csrfToken: string;
}
