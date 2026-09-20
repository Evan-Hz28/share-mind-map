import {
  validateCloudDocumentSnapshot,
  type CloudDocumentV1,
} from "@share-mind-map/document-model";
import { io } from "socket.io-client";

export interface DocumentRealtimeSnapshot {
  version: number;
  snapshot: CloudDocumentV1;
}

export interface DocumentRealtimeLock {
  occupied: boolean;
  editorDisplayName: string | null;
  expiresAt: string | null;
  generation: number;
}

interface SocketLike {
  connected: boolean;
  on(event: string, listener: (payload?: unknown) => void): this;
  off?(event: string, listener?: (payload?: unknown) => void): this;
  emit(event: string, payload?: unknown): this;
  disconnect(): this;
}

export interface DocumentRealtimeOptions {
  baseUrl?: string;
  socketFactory?: (url: string, options: { path: string; withCredentials: boolean }) => SocketLike;
  onVersionGap?: (expected: number, received: number) => void;
  onReconnect?: () => void;
}

type SnapshotListener = (event: DocumentRealtimeSnapshot) => void;
type LockListener = (event: DocumentRealtimeLock) => void;

export class DocumentRealtime {
  private readonly options: DocumentRealtimeOptions;
  private readonly snapshots = new Set<SnapshotListener>();
  private readonly locks = new Set<LockListener>();
  private socket: SocketLike | null = null;
  private joined: { workspaceId: string; documentId: string } | null = null;
  private hasConnected = false;
  private lastAcceptedVersion = 0;

  public constructor(options: DocumentRealtimeOptions = {}) {
    this.options = options;
  }

  public get acceptedVersion(): number {
    return this.lastAcceptedVersion;
  }

  public connect(): void {
    if (this.socket !== null) return;
    const baseUrl = new URL(
      this.options.baseUrl ?? globalThis.location.origin,
      globalThis.location.origin,
    );
    const factory = this.options.socketFactory ?? ((url, options) => io(url, options));
    const socket = factory(`${baseUrl.origin}/workspace`, {
      path: "/socket.io",
      withCredentials: true,
    });
    this.socket = socket;
    socket.on("connect", () => {
      if (this.hasConnected) this.options.onReconnect?.();
      this.hasConnected = true;
      if (this.joined !== null) socket.emit("document:join", this.joined);
    });
    socket.on("document:snapshot", (payload) => {
      this.acceptSnapshot(payload);
    });
    socket.on("document:lock", (payload) => {
      this.acceptLock(payload);
    });
  }

  public join(workspaceId: string, documentId: string, currentVersion = 0): void {
    this.joined = { workspaceId, documentId };
    this.lastAcceptedVersion = currentVersion;
    if (this.socket?.connected === true) this.socket.emit("document:join", this.joined);
  }

  public leave(): void {
    if (this.socket !== null && this.joined !== null)
      this.socket.emit("document:leave", this.joined);
    this.joined = null;
  }

  public onSnapshot(listener: SnapshotListener): () => void {
    this.snapshots.add(listener);
    return () => this.snapshots.delete(listener);
  }

  public onLock(listener: LockListener): () => void {
    this.locks.add(listener);
    return () => this.locks.delete(listener);
  }

  public disconnect(): void {
    this.leave();
    this.socket?.disconnect();
    this.socket = null;
    this.hasConnected = false;
  }

  private acceptSnapshot(payload: unknown): void {
    if (payload === null || typeof payload !== "object") return;
    const value = payload as { version?: unknown; snapshot?: unknown };
    if (typeof value.version !== "number" || value.snapshot === undefined) return;
    let snapshot: CloudDocumentV1;
    try {
      snapshot = validateCloudDocumentSnapshot(value.snapshot);
    } catch {
      return;
    }
    if (snapshot.version !== value.version) return;
    if (value.version <= this.lastAcceptedVersion) return;
    if (this.lastAcceptedVersion > 0 && value.version > this.lastAcceptedVersion + 1) {
      this.options.onVersionGap?.(this.lastAcceptedVersion + 1, value.version);
      return;
    }
    this.lastAcceptedVersion = value.version;
    for (const listener of this.snapshots) listener({ version: value.version, snapshot });
  }

  private acceptLock(payload: unknown): void {
    if (payload === null || typeof payload !== "object") return;
    const value = payload as Partial<DocumentRealtimeLock>;
    if (typeof value.occupied !== "boolean" || typeof value.generation !== "number") return;
    for (const listener of this.locks) {
      listener({
        occupied: value.occupied,
        editorDisplayName:
          typeof value.editorDisplayName === "string" ? value.editorDisplayName : null,
        expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : null,
        generation: value.generation,
      });
    }
  }
}
