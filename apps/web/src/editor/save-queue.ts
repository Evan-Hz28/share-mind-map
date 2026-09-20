import {
  cloneCloudDocument,
  validateCloudDocumentSnapshot,
  type CloudDocumentV1,
} from "@share-mind-map/document-model";

export type SaveKind = "auto" | "manual" | "restore";

export interface SaveQueueOptions {
  debounceMs?: number;
}

export type SaveHandler<TResult> = (
  snapshot: CloudDocumentV1,
  kind: SaveKind,
) => Promise<TResult> | TResult;

interface Waiter<TResult> {
  resolve: (value: TResult) => void;
  reject: (reason?: unknown) => void;
}

interface QueueEntry<TResult> {
  snapshot: CloudDocumentV1;
  kind: SaveKind;
  waiters: Array<Waiter<TResult>>;
}

function cloneSnapshot(snapshot: CloudDocumentV1): CloudDocumentV1 {
  return cloneCloudDocument(validateCloudDocumentSnapshot(snapshot));
}

export class SaveQueue<TResult = unknown> {
  private readonly debounceMs: number;
  private readonly save: SaveHandler<TResult>;
  private pendingAuto: QueueEntry<TResult> | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private tail: Promise<void> = Promise.resolve();

  public constructor(save: SaveHandler<TResult>, options: SaveQueueOptions = {}) {
    this.save = save;
    this.debounceMs = options.debounceMs ?? 500;
  }

  public enqueue(snapshot: CloudDocumentV1, kind: SaveKind): Promise<TResult> {
    const cloned = cloneSnapshot(snapshot);
    return new Promise<TResult>((resolve, reject) => {
      if (kind === "auto") {
        if (this.pendingAuto === null) {
          this.pendingAuto = { snapshot: cloned, kind, waiters: [] };
        } else {
          this.pendingAuto.snapshot = cloned;
        }
        this.pendingAuto.waiters.push({ resolve, reject });
        this.scheduleAutoFlush();
        return;
      }

      this.flushAutoInto({ snapshot: cloned, kind, waiters: [{ resolve, reject }] });
    });
  }

  public async flush(): Promise<void> {
    this.flushPendingAuto();
    await this.tail;
  }

  public dispose(): void {
    if (this.autoTimer !== null) clearTimeout(this.autoTimer);
    this.autoTimer = null;
  }

  private scheduleAutoFlush(): void {
    if (this.autoTimer !== null) clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      this.flushPendingAuto();
    }, this.debounceMs);
  }

  private flushPendingAuto(): void {
    if (this.pendingAuto === null) return;
    const entry = this.pendingAuto;
    this.pendingAuto = null;
    this.append(entry);
  }

  private flushAutoInto(next: QueueEntry<TResult>): void {
    if (this.autoTimer !== null) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    if (this.pendingAuto === null) {
      this.append(next);
      return;
    }
    next.waiters = [...this.pendingAuto.waiters, ...next.waiters];
    this.pendingAuto = null;
    this.append(next);
  }

  private append(entry: QueueEntry<TResult>): void {
    this.tail = this.tail.then(async () => {
      try {
        const result = await this.save(entry.snapshot, entry.kind);
        for (const waiter of entry.waiters) waiter.resolve(result);
      } catch (error) {
        for (const waiter of entry.waiters) waiter.reject(error);
      }
    });
  }
}
