"use client";
import { useState } from "react";
import { Card, PageHeader, Badge, Button, Progress } from "@/components/ui";
import { plan as initialPlan } from "@/lib/mock/data";

export default function PlannerPage() {
  const [plan, setPlan] = useState(initialPlan);
  const total = plan.flatMap((w) => w.tasks).length;
  const done = plan.flatMap((w) => w.tasks).filter((t) => t.status === "completed").length;
  function completeFirstPending() {
    setPlan((current) => current.map((week) => ({ ...week, tasks: week.tasks.map((task) => task.status === "pending" ? { ...task, status: "completed" } : task) })).slice());
  }
  return <><PageHeader title="90-Day Strategy Planner" description="A guided execution plan to shift Google’s perception from foot-care authority to facial-treatment authority in Danderyd." action={<Button onClick={completeFirstPending}>Mark pending tasks completed</Button>} />
  <Card className="mb-6"><div className="mb-2 flex justify-between text-sm"><span>Overall completion</span><span>{Math.round((done / total) * 100)}%</span></div><Progress value={(done / total) * 100} /></Card>
  <div className="grid gap-5 lg:grid-cols-2">{plan.map((week) => <Card key={week.week}><div className="mb-4 flex items-center justify-between"><div><h2 className="text-xl font-bold text-ink">Week {week.week}</h2><p className="text-sm text-muted-foreground">Focus: {week.focus}</p></div><Badge variant="gold">Sprint</Badge></div><div className="space-y-3">{week.tasks.map((task) => <div key={task.title} className="rounded-2xl border bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-ink">{task.title}</p><p className="mt-1 text-sm text-muted-foreground">Priority: {task.priority} · Impact: {task.impact} · Difficulty: {task.difficulty}</p></div><Badge variant={task.status === "completed" ? "default" : task.status === "in_progress" ? "gold" : "muted"}>{task.status}</Badge></div></div>)}</div></Card>)}</div></>;
}
