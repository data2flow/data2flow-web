/**
 * 규칙·알람 화면 차트(시뮬레이션 히트맵 UI-RUL-03, 알람 통계 일별 막대 UI-RUL-10)에 필요한 ECharts 부품만 더한다.
 * 공용 lib/echarts.client(시계열)과 같은 레지스트리를 쓰며, 브라우저에서만 동적으로 불러온다.
 */
import { BarChart, HeatmapChart } from "echarts/charts";
import { GridComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([HeatmapChart, BarChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

export { echarts };
