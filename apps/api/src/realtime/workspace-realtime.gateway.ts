import { Inject } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { OnGatewayConnection, OnGatewayDisconnect } from "@nestjs/websockets";
import type { Socket } from "socket.io";
import { z } from "zod";

import type { Database } from "@share-mind-map/database";
import { AUTH_DATABASE } from "../auth/auth.tokens.js";
import { SESSION_LOOKUP, type SessionLookup } from "../common/guards/session.guard.js";
import type { SessionRecord } from "../auth/session/session.types.js";
import { DocumentRoomService } from "./document-room.service.js";

const subscriptionSchema = z.object({ batchId: z.uuid() });
const documentSubscriptionSchema = z.object({ workspaceId: z.uuid(), documentId: z.uuid() });

interface SocketData {
  session?: SessionRecord;
  sessionToken?: string;
}

function socketData(client: Socket): SocketData {
  const data: unknown = client.data;
  return data !== null && typeof data === "object" ? data : {};
}

function cookieValue(cookie: string | undefined, name: string): string | undefined {
  return cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

@WebSocketGateway({ namespace: "/workspace", cors: { origin: true, credentials: true } })
export class WorkspaceRealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  public constructor(
    @Inject(AUTH_DATABASE) private readonly database: Database,
    @Inject(SESSION_LOOKUP) private readonly sessions: SessionLookup,
    private readonly documentRooms: DocumentRoomService,
  ) {}

  public async handleConnection(client: Socket): Promise<void> {
    const token = cookieValue(client.handshake.headers.cookie, "smm_session");
    const session = token === undefined ? null : await this.sessions.get(token);
    if (session === null || token === undefined) {
      client.disconnect(true);
      return;
    }
    const data = socketData(client);
    data.session = session;
    data.sessionToken = token;
  }

  public handleDisconnect(client: Socket): void {
    const timer = this.timers.get(client.id);
    if (timer !== undefined) clearInterval(timer);
    this.timers.delete(client.id);
    void this.documentRooms.leaveSocket(client);
  }

  @SubscribeMessage("document:join")
  public async joinDocument(
    @ConnectedSocket() client: Socket,
    @MessageBody() input: unknown,
  ): Promise<void> {
    const parsed = documentSubscriptionSchema.safeParse(input);
    if (!parsed.success) {
      client.emit("document:error", { code: "INVALID_INPUT", message: "Invalid document room." });
      return;
    }
    const result = await this.documentRooms.join(
      client,
      parsed.data.workspaceId,
      parsed.data.documentId,
    );
    if (result.mode === "denied") {
      client.emit("document:error", { code: result.code, message: "Document room denied." });
      return;
    }
    client.emit("document:joined", {
      mode: result.mode,
      currentVersion: result.currentVersion,
      reason: result.mode === "rest" ? result.reason : undefined,
    });
  }

  @SubscribeMessage("document:leave")
  public async leaveDocument(
    @ConnectedSocket() client: Socket,
    @MessageBody() input: unknown,
  ): Promise<void> {
    const parsed = documentSubscriptionSchema.safeParse(input);
    if (parsed.success)
      await this.documentRooms.leave(client, parsed.data.workspaceId, parsed.data.documentId);
  }

  @SubscribeMessage("import:subscribe")
  public async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() input: unknown,
  ): Promise<void> {
    const parsed = subscriptionSchema.safeParse(input);
    const session = socketData(client).session;
    if (!parsed.success || session === undefined) {
      client.emit("import:error", { code: "INVALID_INPUT", message: "Invalid subscription." });
      return;
    }
    const result = await this.database.$client.query<{
      workspace_id: string;
      requested_by: string;
    }>("SELECT workspace_id, requested_by FROM import_batches WHERE id = $1", [
      parsed.data.batchId,
    ]);
    const batch = result.rows[0];
    if (
      batch === undefined ||
      batch.workspace_id !== session.workspaceId ||
      (batch.requested_by !== session.userId && session.role !== "admin")
    ) {
      client.emit("import:error", { code: "PERMISSION_DENIED", message: "Subscription denied." });
      return;
    }
    const emitState = async () => {
      const state = await this.database.$client.query(
        `SELECT id, status, total_jobs, uploaded_jobs, succeeded_jobs, failed_jobs, cancelled_jobs, updated_at
         FROM import_batches WHERE id = $1`,
        [parsed.data.batchId],
      );
      if (state.rows[0] !== undefined) client.emit("import:progress", state.rows[0]);
    };
    await emitState();
    const previous = this.timers.get(client.id);
    if (previous !== undefined) clearInterval(previous);
    const timer = setInterval(() => void emitState(), 1_000);
    this.timers.set(client.id, timer);
  }
}
