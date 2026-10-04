/**
 * 현장 작업 오프라인 대기열(BR-DSH-22, BR-DEV-37, AT-DSH-16.3, AT-DEV-27.4·27.5).
 * 연결이 없을 때 만든 작업(체크·사진·완료·현장 설치)을 기기에 보관했다가 연결되면 넣은 순서대로 보낸다.
 * 작업마다 처음 정한 멱등 키(Idempotency-Key 또는 clientOpId)를 그대로 다시 보내므로 같은 작업은 서버에 한 번만 반영된다.
 * - 네트워크 실패(상태 0)·5xx·429: 그 자리에서 멈추고 다음 flush에서 이어 보낸다(순서 유지)
 * - 409(COMMISSION_CONFLICT 등)·그 밖의 4xx: 대기열에서 빼고 결과(서버 값 포함)를 알린다
 */

export type QueuedKind = "commission" | "checklist" | "attachment" | "transition";

export interface QueuedOp {
  id: string;
  kind: QueuedKind;
  /** 화면에 보일 이름(예: 기기 이름, 작업 지시 제목) */
  label: string;
  createdAt: number;
  /** 넣은 순서(대기열이 매긴다). 같은 밀리초에 넣어도 순서가 바뀌지 않게 */
  seq?: number;
  /** 멱등 키(처음 정한 값을 끝까지 쓴다) */
  key: string;
  /** 요청 대상과 값(JSON으로 저장할 수 있는 것) */
  target: Record<string, string | number | boolean | null>;
  files?: { blob: Blob; name: string }[];
}

export interface SendOutcome {
  ok: boolean;
  status: number;
  code?: string;
  /** 응답 본문의 response(409이면 서버 기록) */
  response?: unknown;
}

export interface QueueResult {
  op: QueuedOp;
  outcome: SendOutcome;
}

export interface QueueStore {
  all(): Promise<QueuedOp[]>;
  put(op: QueuedOp): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 보낼 순서: 넣은 순서(seq), 없으면 만든 시각 */
export function byOrder(a: QueuedOp, b: QueuedOp): number {
  return (a.seq ?? 0) - (b.seq ?? 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

export class MemoryQueueStore implements QueueStore {
  private items = new Map<string, QueuedOp>();
  async all() {
    return [...this.items.values()].sort(byOrder);
  }
  async put(op: QueuedOp) {
    this.items.set(op.id, op);
  }
  async remove(id: string) {
    this.items.delete(id);
  }
}

/** 다시 보내면 될 실패인가(연결 끊김·서버 일시 오류·제한) */
export function isRetryable(outcome: SendOutcome): boolean {
  return outcome.status === 0 || outcome.status === 429 || outcome.status >= 500;
}

export type Sender = (op: QueuedOp) => Promise<SendOutcome>;

export interface QueueSnapshot {
  pending: QueuedOp[];
  flushing: boolean;
}

export class OfflineQueue {
  private listeners = new Set<(snapshot: QueueSnapshot) => void>();
  private resultListeners = new Set<(result: QueueResult) => void>();
  private flushing: Promise<QueueResult[]> | null = null;
  private pending: QueuedOp[] = [];
  private lastSeq = 0;

  constructor(
    private readonly store: QueueStore,
    private readonly send: Sender,
  ) {}

  async load(): Promise<QueuedOp[]> {
    this.pending = await this.store.all();
    this.emit();
    return this.pending;
  }

  snapshot(): QueueSnapshot {
    return { pending: [...this.pending], flushing: this.flushing !== null };
  }

  subscribe(listener: (snapshot: QueueSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onResult(listener: (result: QueueResult) => void): () => void {
    this.resultListeners.add(listener);
    return () => this.resultListeners.delete(listener);
  }

  async enqueue(op: QueuedOp): Promise<void> {
    const last = (await this.store.all()).reduce((max, o) => Math.max(max, o.seq ?? 0), 0);
    await this.store.put({ ...op, seq: Math.max(last, this.lastSeq) + 1 });
    this.lastSeq = Math.max(last, this.lastSeq) + 1;
    this.pending = await this.store.all();
    this.emit();
  }

  /** 넣은 순서대로 보낸다. 이미 보내는 중이면 그 결과를 기다린다 */
  flush(): Promise<QueueResult[]> {
    if (this.flushing) return this.flushing;
    this.flushing = this.run().finally(() => {
      this.flushing = null;
      this.emit();
    });
    this.emit();
    return this.flushing;
  }

  private async run(): Promise<QueueResult[]> {
    const results: QueueResult[] = [];
    // 보내는 동안 새로 들어온 작업도 같은 차례에 이어 보낸다(하나씩 다시 읽음)
    for (let [op] = await this.store.all(); op; [op] = await this.store.all()) {
      let outcome: SendOutcome;
      try {
        outcome = await this.send(op);
      } catch {
        outcome = { ok: false, status: 0, code: "SERVICE_UNAVAILABLE" };
      }
      if (!outcome.ok && isRetryable(outcome)) break;
      await this.store.remove(op.id);
      this.pending = await this.store.all();
      const result = { op, outcome };
      results.push(result);
      for (const listener of this.resultListeners) listener(result);
      this.emit();
    }
    return results;
  }

  private emit() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

const DB_NAME = "data2flow-field";
const STORE = "queue";

/** 브라우저 IndexedDB 보관소. 열 수 없으면(사생활 보호 모드 등) 메모리 보관소를 쓴다 */
export function createQueueStore(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): QueueStore {
  if (!factory) return new MemoryQueueStore();
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const fallback = new MemoryQueueStore();
  let db: Promise<IDBDatabase | null> | null = null;
  const database = () => (db ??= open().catch(() => null));
  const tx = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const handle = await database();
    if (!handle) throw new Error("no-db");
    return new Promise<T>((resolve, reject) => {
      const request = run(handle.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };
  return {
    async all() {
      try {
        const items = (await tx("readonly", (s) => s.getAll())) as QueuedOp[];
        return items.sort(byOrder);
      } catch {
        return fallback.all();
      }
    },
    async put(op) {
      try {
        await tx("readwrite", (s) => s.put(op));
      } catch {
        await fallback.put(op);
      }
    },
    async remove(id) {
      try {
        await tx("readwrite", (s) => s.delete(id));
      } catch {
        await fallback.remove(id);
      }
    },
  };
}
