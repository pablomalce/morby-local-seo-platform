"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Vulkan chart palette — orange dominates only the primary signal; metals carry the rest. */
const ORANGE = "#EF4C24";
const ORANGE_SOFT = "#F56A44";
const METAL_300 = "#B5B5B5";
const METAL_500 = "#666666";
const METAL_700 = "#1A1A1A";
const WHITE = "#F5F5F5";

const tooltipStyle: React.CSSProperties = {
  background: "#0A0A0A",
  border: "1px solid #1A1A1A",
  borderRadius: 4,
  color: WHITE,
  fontFamily: "var(--font-jetbrains)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.18em",
};

const axisProps = {
  stroke: METAL_500,
  fontSize: 10,
  tick: { fill: METAL_500, fontFamily: "var(--font-jetbrains)" },
};

export function RankingChart({ data }: { data: { week: string; rank: number }[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="rankFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ORANGE} stopOpacity={0.6} />
              <stop offset="100%" stopColor={ORANGE} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={METAL_700} vertical={false} />
          <XAxis dataKey="week" {...axisProps} />
          <YAxis reversed domain={[1, 12]} {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: ORANGE, strokeOpacity: 0.4 }} />
          <Area
            type="monotone"
            dataKey="rank"
            stroke={ORANGE}
            strokeWidth={2}
            fill="url(#rankFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ReviewsChart({
  data,
}: {
  data: { month: string; reviews: number; mentions: number }[];
}) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={METAL_700} vertical={false} />
          <XAxis dataKey="month" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: METAL_700 }} />
          <Legend
            wrapperStyle={{
              fontFamily: "var(--font-jetbrains)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              color: METAL_300,
            }}
          />
          <Bar dataKey="reviews" fill={METAL_300} radius={[2, 2, 0, 0]} />
          <Bar dataKey="mentions" fill={ORANGE} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendLineChart({
  data,
  dataKey,
  color = ORANGE_SOFT,
}: {
  data: Record<string, string | number>[];
  dataKey: string;
  color?: string;
}) {
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={METAL_700} vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: ORANGE, strokeOpacity: 0.3 }} />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
