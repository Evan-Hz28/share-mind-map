import { sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { newId } from "../id.js";
import type { DatabaseTransaction } from "./member.repository.js";

function payloadText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export interface NotificationOutboxInput {
  eventKey: string;
  eventType: string;
  recipientUserId: string;
  workspaceId: string;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
}

export class NotificationRepository {
  public async enqueue(
    transaction: DatabaseTransaction,
    input: NotificationOutboxInput,
  ): Promise<void> {
    await transaction.execute(sql`
      INSERT INTO notification_outbox
        (id, event_key, event_type, recipient_user_id, workspace_id, target_type, target_id, payload)
      VALUES
        (${newId()}, ${input.eventKey}, ${input.eventType}, ${input.recipientUserId}, ${input.workspaceId},
         ${input.targetType}, ${input.targetId}, ${JSON.stringify(input.payload)}::jsonb)
      ON CONFLICT (event_key) DO NOTHING
    `);
  }

  public async materializeOutboxEvent(database: Database, outboxId: string): Promise<boolean> {
    return database.transaction(async (transaction) => {
      const result = await transaction.execute<{
        event_key: string;
        recipient_user_id: string;
        workspace_id: string;
        event_type: string;
        target_type: string | null;
        target_id: string | null;
        payload: Record<string, unknown>;
        status: string;
      }>(sql`
        SELECT event_key, recipient_user_id, workspace_id, event_type, target_type, target_id, payload, status
        FROM notification_outbox
        WHERE id = ${outboxId}
        FOR UPDATE
      `);
      const event = result.rows[0];
      if (event === undefined) return false;
      if (event.status === "delivered") return true;
      await transaction.execute(sql`
        INSERT INTO notifications
          (id, event_key, user_id, workspace_id, notification_type, title, body, target_type, target_id)
        VALUES
          (${newId()}, ${event.event_key}, ${event.recipient_user_id}, ${event.workspace_id},
           ${event.event_type}, ${payloadText(event.payload.title, "平台通知")},
           ${payloadText(event.payload.body, "你有一条新的平台通知。")}, ${event.target_type}, ${event.target_id})
        ON CONFLICT (event_key) DO NOTHING
      `);
      await transaction.execute(sql`
        UPDATE notification_outbox
        SET status = 'delivered', delivered_at = now(), updated_at = now()
        WHERE id = ${outboxId}
      `);
      return true;
    });
  }

  public async readyBatch(database: Database, limit: number): Promise<string[]> {
    const result = await database.$client.query<{ id: string }>(
      `SELECT id
       FROM notification_outbox
       WHERE status IN ('pending', 'failed') AND available_at <= now()
       ORDER BY id
       LIMIT $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows.map((row) => row.id);
  }

  public async markFailed(database: Database, outboxId: string): Promise<void> {
    await database.$client.query(
      `UPDATE notification_outbox
       SET status = 'failed', attempt_count = attempt_count + 1,
           available_at = now() + interval '30 seconds',
           last_error = 'notification materialization failed', updated_at = now()
       WHERE id = $1 AND status <> 'delivered'`,
      [outboxId],
    );
  }
}
