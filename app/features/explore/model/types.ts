import type { ChartSeries } from "~/lib/chart-model";
import type { SpaceNode } from "~/lib/spaces";
import type { ApiAnnotation } from "./query";
import type { ExploreState } from "./state";
import type { RangeProblem } from "./time";

/** 데이터 탐색기 loader가 화면에 넘기는 값 */
export interface ExploreData {
  state: ExploreState;
  range: { from: string; to: string; live: boolean };
  problem?: RangeProblem;
  result?: { resolutionUsed?: string; reason?: string; truncated?: boolean };
  series: ChartSeries[];
  annotations: ApiAnnotation[];
  failure?: { code: string; message?: string; retryAfter?: number };
  spaces: SpaceNode[];
  canAnnotate: boolean;
  /** [내보내기](UI-TSD-02) — TS_EXPORT */
  canExport?: boolean;
  timezone: string;
  meId?: string;
  /** 표시 단위(DEV-04.04). 없으면 ℃ */
  temperatureUnit?: "C" | "F";
}

export interface ExploreActionResult {
  intent: string;
  ok?: boolean;
  error?: { code: string; message?: string };
  fieldError?: "title" | "time";
}
