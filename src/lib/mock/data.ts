/**
 * Backward-compatible shim.
 *
 * The original MVP imported everything from `@/lib/mock/data`. The platform has since moved to the
 * universal multi-tenant dataset in `@/lib/mock/universal`. This file re-exports a default snapshot
 * so any pages still pointing at the old path continue to work during the migration.
 */

import {
  agentDefinitions,
  businesses,
  competitors as allCompetitors,
  getBusinessSnapshot,
  reviews as allReviews,
} from "@/lib/mock/universal";

export const DEFAULT_BUSINESS_ID = businesses[0].id;
const snapshot = getBusinessSnapshot(DEFAULT_BUSINESS_ID);

export const business = {
  name: snapshot.business.name,
  location: `${snapshot.locations[0]?.city}, ${snapshot.locations[0]?.region}`,
  website: snapshot.business.website,
  targetKeyword: snapshot.services[0]?.primaryKeyword ?? "",
  mode: "Demo Mode",
};

export const metrics = snapshot.metrics.map((m) => ({
  label: m.label,
  value: m.value,
  delta: m.delta ?? "",
  note: m.note ?? "",
}));

export const rankingTrend = snapshot.rankingTrend;
export const reviewsGrowth = snapshot.reviewsGrowth.map((r) => ({ month: r.month, reviews: r.reviews, facial: r.mentions }));

export const tasksProgress = [
  { name: "Done", value: snapshot.plan.filter((t) => t.status === "completed").length },
  { name: "In progress", value: snapshot.plan.filter((t) => t.status === "in_progress").length },
  { name: "Pending", value: snapshot.plan.filter((t) => t.status === "pending").length },
];

export const priorityTasks = snapshot.plan.slice(0, 4).map((t) => ({
  title: t.title,
  priority: t.priority,
  impact: t.impact,
  category: t.category,
}));

export const competitors = allCompetitors
  .filter((c) => c.businessId === DEFAULT_BUSINESS_ID)
  .map((c) => ({
    name: c.name,
    rating: c.rating ?? 0,
    reviews: c.reviewCount ?? 0,
    strength: c.strengthScore,
    relevance: c.relevanceScore,
    strengths: c.strengths,
    weaknesses: c.weaknesses,
    opportunities: c.opportunities,
  }));

export const gbpChecklist = snapshot.gbpChecklist;

export const contentIdeas = snapshot.content.map((c) => ({
  type: c.kind,
  text: c.body,
}));

export const reviews = allReviews
  .filter((r) => r.businessId === DEFAULT_BUSINESS_ID)
  .map((r) => ({
    author: r.author,
    rating: r.rating,
    service: r.serviceMentioned ?? "",
    text: r.text,
    suggestedReply: r.suggestedReply ?? "",
  }));

export const plan = Array.from(new Set(snapshot.plan.map((t) => t.week))).map((week) => ({
  week: week ?? 1,
  focus: snapshot.plan.find((t) => t.week === week)?.category ?? "Growth",
  tasks: snapshot.plan
    .filter((t) => t.week === week)
    .map((t) => ({
      title: t.title,
      priority: t.priority,
      impact: t.impact,
      difficulty: t.difficulty,
      status: t.status,
    })),
}));

export const agents = agentDefinitions.map((a) => ({
  id: a.id,
  name: a.name,
  role: a.role,
  status: "Ready",
  lastRun: "Demo never",
  output: `${a.name} is scoped to ${a.scopes.join(", ")} and is ready to run.`,
}));
