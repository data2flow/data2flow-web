/** 가짜 EventSource(실시간 구독 API-DSH-20)와 가짜 제어 API 묶음 */
import { vi } from "vitest";
import type { EventSourceLike } from "~/lib/event-stream";
import type { ControlApi } from "../api";
import type { Command } from "../model/control";
import { aircon } from "./fixtures";

export class FakeES implements EventSourceLike {
  static all: FakeES[] = [];
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(readonly url: string) {
    FakeES.all.push(this);
  }
  addEventListener(type: string, l: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const l of this.listeners[type] ?? []) l({ data: JSON.stringify(data), lastEventId: "" } as MessageEvent);
  }
}

export const live = { createSource: (url: string) => new FakeES(url), checkSession: async () => true };

export function fakeApi(overrides: Partial<ControlApi> = {}): ControlApi & Record<string, ReturnType<typeof vi.fn>> {
  const command: Command = { id: "c-new", status: "REQUESTED", deviceId: "2001", capability: "Thermostat", command: "set", args: { targetTemperature: 24 } };
  return {
    control: vi.fn(async () => ({ ok: true as const, status: 200, data: aircon() })),
    shadow: vi.fn(async () => ({ ok: true as const, status: 200, data: aircon().shadow! })),
    command: vi.fn(async () => ({ ok: true as const, status: 202, data: command })),
    commandDetail: vi.fn(async (id: string) => ({ ok: true as const, status: 200, data: { ...command, id } })),
    cancel: vi.fn(async (id: string) => ({ ok: true as const, status: 200, data: { ...command, id, status: "CANCELLED" } })),
    releaseOverride: vi.fn(async () => ({ ok: true as const, status: 204, data: undefined })),
    ...overrides,
  } as ControlApi & Record<string, ReturnType<typeof vi.fn>>;
}
