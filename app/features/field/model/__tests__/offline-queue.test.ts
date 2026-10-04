/**
 * DSH-13.04 TC-DSH-125 AT-DSH-16.3 BR-DSH-22, DEV-13.05 AT-DEV-27.4 BR-DEV-37: 오프라인 대기열.
 * 오프라인 중 사진 2장·완료를 보관했다가 연결되면 넣은 순서대로 보내고, 같은 작업 재전송은 저장한 멱등 키로 한 번만 반영된다.
 */
import { describe, expect, it, vi } from "vitest";
import { queueSender, type FieldApi } from "../../api";
import { MemoryQueueStore, OfflineQueue, createQueueStore, isRetryable, type QueuedOp, type SendOutcome } from "../offline-queue";

const op = (id: string, kind: QueuedOp["kind"], createdAt: number, target: QueuedOp["target"] = { workOrderId: "1042" }, files?: QueuedOp["files"]): QueuedOp => ({ id, kind, label: "작업", createdAt, key: `key-${id}`, target, files });

describe("OfflineQueue", () => {
  it("TC-DSH-125: 넣은 순서대로 보내고, 연결 끊김(0)·5xx·429면 그 자리에서 멈췄다가 다음 flush에서 이어 보낸다", async () => {
    const sent: string[] = [];
    let offline = true;
    const queue = new OfflineQueue(new MemoryQueueStore(), async (o) => {
      if (offline) return { ok: false, status: 0 };
      sent.push(`${o.id}:${o.key}`);
      return { ok: true, status: 200 };
    });
    const snapshots: number[] = [];
    queue.subscribe((s) => snapshots.push(s.pending.length));
    // 같은 밀리초에 넣어도(시각 같음) 넣은 순서를 지킨다
    await queue.enqueue(op("p1", "attachment", 5));
    await queue.enqueue(op("p2", "attachment", 5));
    await queue.enqueue(op("done", "transition", 3, { workOrderId: "1042", action: "COMPLETE" }));
    expect((await queue.flush()).length).toBe(0);
    expect(queue.snapshot().pending.map((o) => o.id)).toEqual(["p1", "p2", "done"]);
    offline = false;
    const results = await queue.flush();
    expect(sent).toEqual(["p1:key-p1", "p2:key-p2", "done:key-done"]);
    expect(results.map((r) => r.outcome.ok)).toEqual([true, true, true]);
    expect(queue.snapshot().pending).toEqual([]);
    expect(snapshots.at(-1)).toBe(0);
  });

  it("AT-DEV-27.5: 409·4xx는 빼고 결과(서버 값)를 알린다, 보내는 중에 들어온 작업도 같은 차례에 보낸다, 예외는 연결 끊김으로", async () => {
    const outcomes: Record<string, SendOutcome> = { a: { ok: false, status: 409, code: "COMMISSION_CONFLICT", response: { installedByName: "박설치" } }, b: { ok: false, status: 400, code: "INVALID_REQUEST" } };
    const holder: { queue?: OfflineQueue } = {};
    const send = vi.fn(async (o: QueuedOp) => {
      if (o.id === "a") await holder.queue?.enqueue(op("late", "checklist", 9));
      if (o.id === "boom") throw new Error("network");
      return outcomes[o.id] ?? { ok: true, status: 200 };
    });
    const queue = new OfflineQueue(new MemoryQueueStore(), send);
    holder.queue = queue;
    const seen: string[] = [];
    const off = queue.onResult((r) => seen.push(`${r.op.id}:${r.outcome.status}`));
    await queue.enqueue(op("a", "commission", 1));
    await queue.enqueue(op("b", "commission", 2));
    const first = queue.flush();
    expect(queue.flush()).toBe(first); // 보내는 중이면 같은 약속
    await first;
    expect(seen).toEqual(["a:409", "b:400", "late:200"]);
    off();
    await queue.enqueue(op("boom", "checklist", 10));
    await queue.flush();
    expect(queue.snapshot().pending.map((o) => o.id)).toEqual(["boom"]);
    expect(isRetryable({ ok: false, status: 503 })).toBe(true);
    expect(isRetryable({ ok: false, status: 429 })).toBe(true);
    expect(isRetryable({ ok: false, status: 404 })).toBe(false);
  });

  it("load는 보관소에 남은 작업을 다시 읽는다(앱을 다시 열어도 유지), IndexedDB가 없으면 메모리", async () => {
    const store = new MemoryQueueStore();
    await store.put(op("x", "checklist", 1));
    const queue = new OfflineQueue(store, async () => ({ ok: true, status: 200 }));
    expect((await queue.load()).map((o) => o.id)).toEqual(["x"]);
    const fallback = createQueueStore(undefined);
    await fallback.put(op("y", "checklist", 1));
    expect((await fallback.all()).map((o) => o.id)).toEqual(["y"]);
    await fallback.remove("y");
    expect(await fallback.all()).toEqual([]);
  });

  it("IndexedDB를 열 수 없으면 메모리로 대신한다", async () => {
    const broken = { open: () => { const req: Record<string, unknown> = {}; setTimeout(() => (req.onerror as () => void)?.(), 0); return req; } } as unknown as IDBFactory;
    const store = createQueueStore(broken);
    await store.put(op("z", "checklist", 1));
    expect((await store.all()).map((o) => o.id)).toEqual(["z"]);
    await store.remove("z");
    expect(await store.all()).toEqual([]);
  });
});

describe("queueSender: 저장한 멱등 키를 다시 쓴다(BR-DSH-22, BR-DEV-37)", () => {
  it("현장 설치는 clientOpId = 키, 첨부·전이는 Idempotency-Key = 키, 체크는 PATCH", async () => {
    const calls: unknown[] = [];
    const api = {
      commission: async (id: string, form: FormData) => {
        calls.push(["commission", id, form.get("clientOpId"), form.get("spaceId"), form.get("x"), form.get("installedAt"), form.getAll("photos").length]);
        return { ok: false as const, status: 409, code: "COMMISSION_CONFLICT", message: "", response: { spaceId: "32" } };
      },
      check: async (id: string, item: string, done: boolean) => {
        calls.push(["check", id, item, done]);
        return { ok: true as const, status: 200, data: { id: item, text: "", done } };
      },
      attach: async (id: string, _f: Blob, name: string, key?: string) => {
        calls.push(["attach", id, name, key]);
        return { ok: true as const, status: 201, data: { id: "1" } };
      },
      transition: async (id: string, body: unknown, key?: string) => {
        calls.push(["transition", id, body, key]);
        return { ok: true as const, status: 200, data: { id } };
      },
    } as unknown as FieldApi;
    const send = queueSender(api);
    const photo = new Blob(["x"], { type: "image/jpeg" });
    expect(await send({ ...op("c", "commission", 1, { deviceId: "1050", spaceId: "31", x: 0.42, y: 0.31, installedAt: "2026-10-04T00:00:00Z" }, [{ blob: photo, name: "a.jpg" }]), key: "uuid-1" })).toEqual({ ok: false, status: 409, code: "COMMISSION_CONFLICT", response: { spaceId: "32" } });
    await send(op("c2", "commission", 1, { deviceId: "1050", spaceId: "31", x: null, y: null, installedAt: "2026-10-04T00:00:00Z" }));
    await send(op("k", "checklist", 2, { workOrderId: "1042", itemId: "2", done: true }));
    await send(op("f", "attachment", 3, { workOrderId: "1042" }, [{ blob: photo, name: "b.jpg" }]));
    expect(await send(op("f2", "attachment", 3, { workOrderId: "1042" }))).toMatchObject({ ok: false, status: 400 });
    await send(op("t", "transition", 4, { workOrderId: "1042", action: "COMPLETE", note: "끝", result: JSON.stringify({ replacedOn: "2026-10-04" }) }));
    await send(op("t2", "transition", 4, { workOrderId: "1042", action: "START", note: null, result: null }));
    expect(calls).toEqual([
      ["commission", "1050", "uuid-1", "31", "0.42", "2026-10-04T00:00:00Z", 1],
      ["commission", "1050", "key-c2", "31", null, "2026-10-04T00:00:00Z", 0],
      ["check", "1042", "2", true],
      ["attach", "1042", "b.jpg", "key-f"],
      ["transition", "1042", { action: "COMPLETE", note: "끝", result: { replacedOn: "2026-10-04" } }, "key-t"],
      ["transition", "1042", { action: "START" }, "key-t2"],
    ]);
  });
});
