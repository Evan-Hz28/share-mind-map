import { Inject, Injectable } from "@nestjs/common";
import type { Socket } from "socket.io";

import type { CloudDocumentV1 } from "@share-mind-map/document-model";
import type { Database } from "@share-mind-map/database";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import type { SessionRecord } from "../auth/session/session.types.js";

export const DOCUMENT_ROOM_LIMIT = 100;

export type DocumentJoinResult =
  | { mode: "joined"; currentVersion: number }
  | { mode: "rest"; currentVersion: number; reason: "ROOM_LIMIT" }
  | { mode: "denied"; code: "UNAUTHORIZED" | "PERMISSION_DENIED" | "DOCUMENT_NOT_FOUND" };

export interface DocumentSnapshotBroadcast {
  workspaceId: string;
  documentId: string;
  snapshot: CloudDocumentV1;
  version: number;
  /** 触发保存的浏览器编辑会话,用于让保存者忽略自己的广播回声。 */
  browserEditSessionId: string | null;
}

export interface DocumentLockBroadcast {
  workspaceId: string;
  documentId: string;
  occupied: boolean;
  editorDisplayName: string | null;
  expiresAt: string | null;
  generation: number;
}

export function documentRoomName(workspaceId: string, documentId: string): string {
  return `document:${workspaceId}:${documentId}`;
}

interface SocketData {
  session?: SessionRecord;
}

function sessionOf(socket: Socket): SessionRecord | undefined {
  const data: unknown = socket.data;
  if (data === null || typeof data !== "object") return undefined;
  return (data as SocketData).session;
}

@Injectable()
export class DocumentRoomService {
  private readonly members = new Map<string, Map<string, Socket>>();

  public constructor(@Inject(AUTH_DATABASE) private readonly database: Database) {}

  public async join(
    socket: Socket,
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentJoinResult> {
    const session = sessionOf(socket);
    if (session === undefined) return { mode: "denied", code: "UNAUTHORIZED" };
    if (session.workspaceId !== workspaceId) return { mode: "denied", code: "PERMISSION_DENIED" };
    const result = await this.database.$client.query<{ current_version: number | string }>(
      "SELECT current_version FROM documents WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL",
      [documentId, workspaceId],
    );
    const row = result.rows[0];
    if (row === undefined) return { mode: "denied", code: "DOCUMENT_NOT_FOUND" };
    const version = Number(row.current_version);
    const room = documentRoomName(workspaceId, documentId);
    const roomMembers = this.members.get(room) ?? new Map<string, Socket>();
    if (!roomMembers.has(socket.id) && roomMembers.size >= DOCUMENT_ROOM_LIMIT) {
      return { mode: "rest", currentVersion: version, reason: "ROOM_LIMIT" };
    }
    await socket.join(room);
    roomMembers.set(socket.id, socket);
    this.members.set(room, roomMembers);
    this.broadcastPresence(room);
    return { mode: "joined", currentVersion: version };
  }

  public async leave(socket: Socket, workspaceId: string, documentId: string): Promise<void> {
    const room = documentRoomName(workspaceId, documentId);
    await socket.leave(room);
    const roomMembers = this.members.get(room);
    roomMembers?.delete(socket.id);
    if (roomMembers?.size === 0) this.members.delete(room);
    this.broadcastPresence(room);
  }

  public async leaveSocket(socket: Socket): Promise<void> {
    const rooms = [...this.members.entries()];
    for (const [room, roomMembers] of rooms) {
      if (!roomMembers.delete(socket.id)) continue;
      await socket.leave(room);
      if (roomMembers.size === 0) this.members.delete(room);
      this.broadcastPresence(room);
    }
  }

  public broadcastSnapshot(event: DocumentSnapshotBroadcast): void {
    const roomMembers = this.members.get(documentRoomName(event.workspaceId, event.documentId));
    if (roomMembers === undefined) return;
    const payload = {
      version: event.version,
      snapshot: event.snapshot,
      browserEditSessionId: event.browserEditSessionId,
    };
    for (const member of roomMembers.values()) member.emit("document:snapshot", payload);
  }

  public broadcastLock(event: DocumentLockBroadcast): void {
    const roomMembers = this.members.get(documentRoomName(event.workspaceId, event.documentId));
    if (roomMembers === undefined) return;
    for (const member of roomMembers.values())
      member.emit("document:lock", {
        occupied: event.occupied,
        editorDisplayName: event.editorDisplayName,
        expiresAt: event.expiresAt,
        generation: event.generation,
      });
  }

  private broadcastPresence(room: string): void {
    const roomMembers = this.members.get(room);
    if (roomMembers === undefined) return;
    for (const member of roomMembers.values()) {
      member.emit("document:presence", { memberCount: roomMembers.size });
    }
  }
}
