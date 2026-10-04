/**
 * 옵션 하나를 그리는 작은 ECharts 부품(히트맵·막대). 옵션은 model/simulation이 만들고 단위 테스트한다.
 * 테스트에서는 factory로 가짜 차트를 넣는다. 접근성: 같은 내용을 표로 함께 보여 주는 화면에서만 쓴다.
 */
import { useEffect, useRef, useState } from "react";
import type { ChartFactory, ChartHandle } from "~/components/charts/timeseries-chart";
import { isDarkNow } from "~/lib/theme";

const defaultFactory: ChartFactory = async (element, dark) => {
  const { echarts } = await import("../echarts-extra.client");
  return echarts.init(element, dark ? "dark" : undefined, { renderer: "canvas" }) as unknown as ChartHandle;
};

export function EChart({ option, height = 220, label, factory = defaultFactory }: { option: Record<string, unknown>; height?: number; label: string; factory?: ChartFactory }) {
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
    if (ready) chart.current?.setOption(option, true);
  }, [ready, option]);
  return <div ref={element} role="img" aria-label={label} data-testid="echart" style={{ height }} className="w-full" />;
}
