"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function RankingChart({ data }: { data: any[] }) {
  return <div className="h-64"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="week" /><YAxis reversed domain={[1, 10]} /><Tooltip /><Area type="monotone" dataKey="rank" stroke="currentColor" fill="currentColor" fillOpacity={0.12} /></AreaChart></ResponsiveContainer></div>;
}
export function ReviewsChart({ data }: { data: any[] }) {
  return <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Bar dataKey="reviews" radius={[8,8,0,0]} /><Bar dataKey="facial" radius={[8,8,0,0]} /></BarChart></ResponsiveContainer></div>;
}
