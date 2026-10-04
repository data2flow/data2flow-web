/**
 * 대시보드 격자 배치(DSH-04.01, BR-DSH-18, UI-DSH-04). core `DashboardLayoutValidator`와 같은 규칙을 화면에서 먼저 본다:
 * 24열 격자, 위젯 최대 40개, `x ≥ 0, y ≥ 0, w ≥ 1, h ≥ 1, x + w ≤ 24, h ≤ 48`, 겹침 금지, 위젯 id 1~40자 고유.
 * 끌어 놓기·크기 조정·키보드 이동은 모두 "새 배치를 만들어 보고 규칙을 지키면 받아들이는" 순수 함수다(겹치면 그대로 둔다).
 */
import type { Widget } from "./types";

export const COLUMNS = 24;
export const MAX_WIDGETS = 40;
export const MAX_HEIGHT = 48;
/** 격자 한 줄 높이(px) */
export const ROW_HEIGHT = 40;

const WIDGET_ID = /^[A-Za-z0-9_-]{1,40}$/;

export type LayoutErrorCode = "OUT_OF_GRID" | "OVERLAP" | "TOO_MANY_WIDGETS" | "DUPLICATE_ID" | "INVALID_ID";

export interface LayoutError {
  index: number;
  code: LayoutErrorCode;
}

type Box = Pick<Widget, "x" | "y" | "w" | "h">;

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function inGrid(b: Box): boolean {
  return [b.x, b.y, b.w, b.h].every(Number.isInteger) && b.x >= 0 && b.y >= 0 && b.w >= 1 && b.h >= 1 && b.x + b.w <= COLUMNS && b.h <= MAX_HEIGHT;
}

/** 배치 전체 검사. 비어 있으면 저장할 수 있다 */
export function validateLayout(widgets: readonly Widget[]): LayoutError[] {
  if (widgets.length > MAX_WIDGETS) return [{ index: MAX_WIDGETS, code: "TOO_MANY_WIDGETS" }];
  const errors: LayoutError[] = [];
  const ids = new Set<string>();
  widgets.forEach((w, index) => {
    if (!WIDGET_ID.test(w.id)) errors.push({ index, code: "INVALID_ID" });
    else if (ids.has(w.id)) errors.push({ index, code: "DUPLICATE_ID" });
    ids.add(w.id);
    if (!inGrid(w)) errors.push({ index, code: "OUT_OF_GRID" });
    else if (widgets.slice(0, index).some((other) => inGrid(other) && overlaps(w, other))) errors.push({ index, code: "OVERLAP" });
  });
  return errors;
}

function fits(widgets: readonly Widget[], box: Box, ignoreId?: string): boolean {
  return inGrid(box) && !widgets.some((other) => other.id !== ignoreId && overlaps(box, other));
}

/** 위에서부터 왼쪽부터 처음 비는 자리 */
export function findFreeSlot(widgets: readonly Widget[], w: number, h: number): { x: number; y: number } {
  const width = Math.min(COLUMNS, Math.max(1, w));
  const bottom = widgets.reduce((max, other) => Math.max(max, other.y + other.h), 0);
  for (let y = 0; y <= bottom; y += 1) {
    for (let x = 0; x + width <= COLUMNS; x += 1) {
      if (fits(widgets, { x, y, w: width, h })) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

/** 다음 위젯 id(w1, w2, …) */
export function nextWidgetId(widgets: readonly Widget[]): string {
  const used = new Set(widgets.map((w) => w.id));
  let n = widgets.length + 1;
  while (used.has(`w${n}`)) n += 1;
  return `w${n}`;
}

/** 새 위젯을 빈 자리에 넣는다. 40개를 넘으면 null */
export function addWidget(widgets: readonly Widget[], widget: Omit<Widget, "id" | "x" | "y"> & { id?: string }): Widget[] | null {
  if (widgets.length >= MAX_WIDGETS) return null;
  const w = Math.min(COLUMNS, Math.max(1, widget.w));
  const h = Math.min(MAX_HEIGHT, Math.max(1, widget.h));
  const slot = findFreeSlot(widgets, w, h);
  return [...widgets, { ...widget, id: widget.id ?? nextWidgetId(widgets), w, h, ...slot }];
}

/** 위치 옮기기. 격자 밖은 가장자리로 맞추고, 겹치면 null(받아들이지 않음) */
export function moveWidget(widgets: readonly Widget[], id: string, x: number, y: number): Widget[] | null {
  const current = widgets.find((w) => w.id === id);
  if (!current) return null;
  const box = { x: clamp(Math.round(x), 0, COLUMNS - current.w), y: Math.max(0, Math.round(y)), w: current.w, h: current.h };
  if (box.x === current.x && box.y === current.y) return null;
  if (!fits(widgets, box, id)) return null;
  return widgets.map((w) => (w.id === id ? { ...w, x: box.x, y: box.y } : w));
}

/** 크기 조정. 1×1 이상, 오른쪽 끝·최대 높이까지. 겹치면 null */
export function resizeWidget(widgets: readonly Widget[], id: string, w: number, h: number): Widget[] | null {
  const current = widgets.find((item) => item.id === id);
  if (!current) return null;
  const box = { x: current.x, y: current.y, w: clamp(Math.round(w), 1, COLUMNS - current.x), h: clamp(Math.round(h), 1, MAX_HEIGHT) };
  if (box.w === current.w && box.h === current.h) return null;
  if (!fits(widgets, box, id)) return null;
  return widgets.map((item) => (item.id === id ? { ...item, w: box.w, h: box.h } : item));
}

/** 복제: 같은 설정을 새 id로 빈 자리에. 40개면 null */
export function duplicateWidget(widgets: readonly Widget[], id: string): Widget[] | null {
  const source = widgets.find((w) => w.id === id);
  if (!source) return null;
  const copy = structuredCloneSafe(source);
  return addWidget(widgets, { ...copy, id: nextWidgetId(widgets) });
}

export function removeWidget(widgets: readonly Widget[], id: string): Widget[] {
  return widgets.filter((w) => w.id !== id);
}

export function updateWidget(widgets: readonly Widget[], id: string, patch: Partial<Omit<Widget, "id">>): Widget[] {
  return widgets.map((w) => (w.id === id ? { ...w, ...patch } : w));
}

/** 모바일 1열: 위에서 아래, 왼쪽에서 오른쪽 순서(UI-DSH-04 "반응형: 모바일에서 1열") */
export function readingOrder(widgets: readonly Widget[]): Widget[] {
  return [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** 끌어 옮긴 픽셀 → 칸 수 */
export function pixelsToCells(dx: number, dy: number, cellWidth: number, rowHeight = ROW_HEIGHT): { dx: number; dy: number } {
  const width = cellWidth > 0 ? cellWidth : 1;
  return { dx: Math.round(dx / width), dy: Math.round(dy / rowHeight) };
}

/** 키보드 대체 조작(TC-DSH-100 "키보드만으로"): 화살표는 옮기기, Shift+화살표는 크기 조정 */
export function keyboardDelta(key: string, shift: boolean): { dx: number; dy: number; dw: number; dh: number } | null {
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (!step) return null;
  return shift ? { dx: 0, dy: 0, dw: step[0], dh: step[1] } : { dx: step[0], dy: step[1], dw: 0, dh: 0 };
}

/** 격자 전체 높이(줄 수) */
export function gridRows(widgets: readonly Widget[]): number {
  return widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
