/**
 * ECharts(Apache-2.0)를 필요한 부품만 불러온다. 번들 크기를 줄이려고 전체(`echarts`) 대신 `echarts/core`를 쓴다.
 * 브라우저에서만 동적으로 불러온다(SSR에서는 그리지 않는다).
 */
import { LineChart, ScatterChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, MarkAreaComponent, MarkLineComponent, CanvasRenderer]);

export { echarts };
