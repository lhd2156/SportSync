/**
 * SportSync - ML Prediction Widget
 *
 * Win probability bar chart showing home vs away win percentages.
 * Uses Recharts BarChart per blueprint Section 9.
 */
import { memo } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, LabelList } from "recharts";
import { getDisplayPercentages } from "../utils/predictions";

type PredictionWidgetProps = {
  homeTeam: string;
  awayTeam: string;
  homeWinProb: number;
  awayWinProb: number;
  modelVersion: string;
};

function PredictionWidget({
  homeTeam,
  awayTeam,
  homeWinProb,
  awayWinProb,
  modelVersion,
}: PredictionWidgetProps) {
  const { homePct, awayPct } = getDisplayPercentages(homeWinProb, awayWinProb);
  const data = [
    { team: homeTeam, probability: homePct, isHome: true },
    { team: awayTeam, probability: awayPct, isHome: false },
  ];

  return (
    <div className="bg-surface border border-muted/15 rounded-xl p-6 game-detail-enter">
      <h3 className="text-foreground font-medium mb-4">Win Probability</h3>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 40 }}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis
            type="category"
            dataKey="team"
            width={80}
            tick={{ fill: "var(--chart-tooltip-text)", fontSize: 13 }}
            axisLine={false}
            tickLine={false}
          />
          <Bar dataKey="probability" radius={[0, 6, 6, 0]} barSize={28}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.isHome ? "var(--accent)" : "var(--chart-axis)"} />
            ))}
            <LabelList
              dataKey="probability"
              position="right"
              formatter={(v: unknown) => `${v}%`}
              style={{ fill: "var(--chart-tooltip-text)", fontSize: 13, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted mt-2">Model: {modelVersion}</p>
    </div>
  );
}

export default memo(PredictionWidget);
