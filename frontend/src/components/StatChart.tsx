import { useEffect, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ChartSeries = {
  dataKey: string;
  color: string;
  name?: string;
};

type StatChartProps = {
  title: string;
  subtitle?: string;
  type: "line" | "bar";
  data: Record<string, string | number | null>[];
  xKey: string;
  series: ChartSeries[];
  valueFormatter?: (value: number | string) => string;
};

export default function StatChart({
  title,
  subtitle,
  type,
  data,
  xKey,
  series,
  valueFormatter,
}: StatChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const updateSize = () => {
      const nextWidth = element.clientWidth;
      const nextHeight = element.clientHeight;

      setChartSize((current) => (
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight }
      ));
    };

    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
    });

    observer.observe(element);
    window.addEventListener("resize", updateSize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  const isChartReady = chartSize.width > 0 && chartSize.height > 0;

  return (
    <div className="min-w-0 rounded-3xl border border-muted/15 bg-surface p-5">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>

      <div ref={containerRef} className="h-64 min-w-0 w-full">
        {isChartReady ? (
          type === "line" ? (
            <LineChart width={chartSize.width} height={chartSize.height} data={data}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey={xKey} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                formatter={(value) =>
                  valueFormatter ? valueFormatter(value as number | string) : String(value)
                }
                contentStyle={{
                  backgroundColor: "var(--chart-tooltip-slate)",
                  border: "1px solid var(--chart-tooltip-border)",
                  borderRadius: "16px",
                  color: "var(--chart-tooltip-text)",
                }}
              />
              {series.map((item) => (
                <Line
                  key={item.dataKey}
                  type="monotone"
                  dataKey={item.dataKey}
                  name={item.name || item.dataKey}
                  stroke={item.color}
                  strokeWidth={3}
                  dot={{ r: 3, fill: item.color }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart width={chartSize.width} height={chartSize.height} data={data}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey={xKey} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis
                  tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <Tooltip
                  formatter={(value) =>
                    valueFormatter ? valueFormatter(value as number | string) : String(value)
                  }
                  contentStyle={{
                    backgroundColor: "var(--chart-tooltip-slate)",
                    border: "1px solid var(--chart-tooltip-border)",
                    borderRadius: "16px",
                    color: "var(--chart-tooltip-text)",
                }}
              />
              {series.map((item) => (
                <Bar
                  key={item.dataKey}
                  dataKey={item.dataKey}
                  name={item.name || item.dataKey}
                  fill={item.color}
                  radius={[10, 10, 4, 4]}
                />
              ))}
            </BarChart>
          )
        ) : (
          <div className="h-full w-full" />
        )}
      </div>
    </div>
  );
}
