import { sql } from "drizzle-orm";

import { newId } from "../id.js";
import type { DatabaseTransaction } from "./member.repository.js";

export interface AuditEvent {
  id?: string;
  organizationId: string;
  workspaceId: string | null;
  actorUserId: string | null;
  actorSessionId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: "success" | "failure" | "denied";
  requestId: string;
  fromVersion: number | null;
  toVersion: number | null;
  metadata: Record<string, unknown>;
}

export class AuditRepository {
  public async append(transaction: DatabaseTransaction, event: AuditEvent): Promise<void> {
    await transaction.execute(sql`
      INSERT INTO audit_logs
        (id, organization_id, workspace_id, actor_user_id, actor_session_id, action,
         target_type, target_id, result, request_id, from_version, to_version, metadata)
      VALUES
        (${event.id ?? newId()}, ${event.organizationId}, ${event.workspaceId},
         ${event.actorUserId}, ${event.actorSessionId}, ${event.action}, ${event.targetType},
         ${event.targetId}, ${event.result}, ${event.requestId}, ${event.fromVersion},
         ${event.toVersion}, ${JSON.stringify(event.metadata)}::jsonb)
    `);
  }
}
