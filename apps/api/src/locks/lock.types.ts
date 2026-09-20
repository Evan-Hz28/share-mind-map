export interface LockOwner {
  documentId: string;
  userId: string;
  platformSessionId: string;
  browserEditSessionId: string;
}

export type LockAcquireResult =
  | { status: "acquired"; token: string; generation: number; ttlSeconds: number }
  | { status: "occupied"; generation: number; ttlSeconds: number };

export type LockHeartbeatResult =
  | { status: "renewed"; generation: number; ttlSeconds: number }
  | { status: "lost"; generation: number };

export type LockForceReleaseResult =
  { status: "released"; generation: number } | { status: "absent"; generation: number };

export interface LockInspection {
  occupied: boolean;
  userId?: string;
  platformSessionId?: string;
  browserEditSessionId?: string;
  generation: number;
  heartbeatAt?: string;
  ttlSeconds: number;
}
