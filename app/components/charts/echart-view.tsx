/**
 * option 하나를 그리는 일반 ECharts 부품(대시보드 막대·게이지·히트맵 위젯). 시계열은 TimeseriesChart를 쓴다.
 * 내려갈 때(unmount) 차트를 dispose한다(키오스크 순환 메모리, TC-DSH-062).
 */
import { useEffect, useRef, useState } from "react";
import { isDarkNow } from "~/lib/theme";
import { cx } from "../ui";
import type { ChartFactory, ChartHandle } from "./timeseries-chart";

const defaultFactory: ChartFactory = async (element, dark) => {
  const { echarts } = await import("~/lib/echarts.client");
  return echarts.init(element, dark ? "dark" : undefined, { renderer: "canvas" }) as unknown as ChartHandle;
};

export function EChartView({ option, height = 240, factory = defaultFactory, label, loading }: { option: (dark: boolean) => Record<string, unknown>; height?: number; factory?: ChartFactory; label: string; loading?: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<ChartHandle | null>(null);
  const [ready, setReady] = useState(false);
  const dark = isDarkNow();
  useEffect(() => {
    let disposed = false;
    const node = element.current;
    if (!node) return;
    factory(node, dark)
      .then((handle) => {
        if (disposed) return handle.dispose();
        chart.current = handle;
        setReady(true);
      })
      .catch(() => setReady(false));
    const onResize = () => chart.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      chart.current?.dispose();
      chart.current = null;
    };
  }, [factory, dark]);
  useEffect(() => {
    if (ready && chart.current) chart.current.setOption(option(dark), true);
  }, [ready, option, dark]);
  return <div ref={element} role="img" aria-label={label} data-testid="echart-view" style={{ height }} className={cx("w-full", loading && "opacity-40")} />;
}
