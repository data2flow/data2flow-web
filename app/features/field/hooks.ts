/**
 * 현장 작업 화면 공용 훅: 연결 상태(오프라인 띠, UI-DSH-14)와 오프라인 대기열(BR-DSH-22). 대기열은 탭 하나에 하나만 둔다.
 */
import { useEffect, useState } from "react";
import { fieldApi, queueSender } from "./api";
import { OfflineQueue, createQueueStore, type QueueResult, type QueueSnapshot } from "./model/offline-queue";

/** 브라우저 연결 상태. 서버 렌더에서는 연결된 것으로 본다 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

let shared: OfflineQueue | null = null;

/** 탭에 하나뿐인 대기열(IndexedDB). 연결이 돌아오면 바로 보낸다 */
export function sharedQueue(): OfflineQueue {
  if (!shared) {
    const queue = new OfflineQueue(createQueueStore(), queueSender(fieldApi));
    shared = queue;
    void queue.load().then(() => {
      if (navigator.onLine !== false) void queue.flush();
    });
    window.addEventListener("online", () => void queue.flush());
  }
  return shared;
}

/** 대기열 상태(대기 건수)와 보낸 결과. queue를 주지 않으면 탭 공용 대기열 */
export function useQueue(queue?: OfflineQueue): { queue: OfflineQueue | null; snapshot: QueueSnapshot; results: QueueResult[] } {
  const [active, setActive] = useState<OfflineQueue | null>(queue ?? null);
  const [snapshot, setSnapshot] = useState<QueueSnapshot>({ pending: [], flushing: false });
  const [results, setResults] = useState<QueueResult[]>([]);
  useEffect(() => {
    const q = queue ?? sharedQueue();
    setActive(q);
    setSnapshot(q.snapshot());
    const offSnapshot = q.subscribe(setSnapshot);
    const offResult = q.onResult((result) => setResults((current) => [...current, result]));
    return () => {
      offSnapshot();
      offResult();
    };
  }, [queue]);
  return { queue: active, snapshot, results };
}
