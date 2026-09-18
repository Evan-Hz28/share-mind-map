import { NotificationRepository, type Database } from "@share-mind-map/database";

export interface NotificationBatchResult {
  attempted: number;
  delivered: number;
  failed: number;
}

interface NotificationRepositoryLike {
  readyBatch(database: Database, limit: number): Promise<string[]>;
  materializeOutboxEvent(database: Database, outboxId: string): Promise<boolean>;
  markFailed(database: Database, outboxId: string): Promise<void>;
}

export class NotificationOutboxProcessor {
  private readonly notifications: NotificationRepositoryLike;

  public constructor(
    private readonly database: Database,
    notifications: NotificationRepositoryLike = new NotificationRepository(),
  ) {
    this.notifications = notifications;
  }

  public async processBatch(limit = 25): Promise<NotificationBatchResult> {
    const ids = await this.notifications.readyBatch(this.database, limit);
    let delivered = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        if (await this.notifications.materializeOutboxEvent(this.database, id)) delivered += 1;
      } catch {
        failed += 1;
        await this.notifications.markFailed(this.database, id);
      }
    }
    return { attempted: ids.length, delivered, failed };
  }
}
