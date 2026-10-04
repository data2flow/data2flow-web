/** 규칙·알람 부품 테스트 공용: 가짜 규칙 API, 가짜 차트, 폼 맥락 */
import { vi } from "vitest";
import type { ChartFactory } from "~/components/charts/timeseries-chart";
import type { SpaceNode } from "~/lib/spaces";
import type { RulesApi } from "../api";
import type { MetricInfo, RuleTemplate, ScopeDevice, SimulationResult } from "../model/types";

export const result = (alarms: number, extra: Partial<SimulationResult> = {}): SimulationResult => ({
  alarms,
  notifications: alarms,
  avgDurationSec: 540,
  byDevice: [{ deviceId: "1042", name: "EM500-152590", count: alarms, longestSec: 1800 }],
  heatmap: [{ dow: 2, hour: 10, count: alarms }],
  coverage: { dataRatio: 0.95 },
  ...extra,
});

export function fakeRulesApi(overrides: Partial<RulesApi> = {}): RulesApi & Record<string, ReturnType<typeof vi.fn>> {
  return {
    simulate: vi.fn(async (body: { rule: { condition: { value?: number } } }) => ({ ok: true as const, status: 200, data: result((body.rule.condition.value ?? 1000) >= 1200 ? 5 : 14) })),
    ...overrides,
  } as RulesApi & Record<string, ReturnType<typeof vi.fn>>;
}

export const fakeChart = (): { factory: ChartFactory; options: Record<string, unknown>[] } => {
  const options: Record<string, unknown>[] = [];
  return { options, factory: async () => ({ setOption: (o) => void options.push(o), resize: () => undefined, dispose: () => undefined }) };
};

export const spaces: SpaceNode[] = [{ id: "2", name: "본관", type: "BUILDING", children: [{ id: "31", name: "실습실", type: "ROOM" }, { id: "32", name: "사무실", type: "ROOM" }] }] as SpaceNode[];
export const devices: ScopeDevice[] = [{ id: "1042", name: "AM107-067999", spaceId: "31", modelCode: "AM107", tags: ["pilot"], metrics: ["co2", "temperature"] }];
export const metrics: MetricInfo[] = [
  { key: "co2", displayName: "CO2", unit: "ppm", valueType: "NUMBER", validMin: 0, validMax: 10000 },
  { key: "temperature", displayName: "온도", unit: "℃", valueType: "NUMBER", validMin: -20, validMax: 60 },
  { key: "occupancy", displayName: "재실", valueType: "BOOLEAN" },
];
export const templates: RuleTemplate[] = [{ key: "high-co2", name: "고CO2", defaults: { condition: { kind: "threshold", metric: "co2", op: ">", value: 1000, for: "PT5M", clear: 900 }, severity: "MAJOR", titleTemplate: "고CO2 · {{space.path}}" } }];
