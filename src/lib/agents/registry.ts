/**
 * Agent Registry — universal, scope-aware
 *
 * Phase 1 ships the definitions and a deterministic demo runner. Phase 3 will replace `runAgent`
 * with real OpenAI calls behind a server-only abstraction, preserving the same input/output shape.
 *
 * Every run produces a `scope` + `scopeId` so future audit logs, cost tracking and approval flows
 * can resolve which tenant/entity the run belongs to.
 */

import { agentDefinitions, businesses, getBusinessSnapshot } from "@/lib/mock/universal";
import type { AgentDefinition, AgentRun, AgentScope } from "@/lib/types/core";

export interface AgentRunInput {
  agentId: string;
  scope: AgentScope;
  scopeId: string;
  payload?: Record<string, unknown>;
}

export function listAgents(): AgentDefinition[] {
  return agentDefinitions;
}

export function getAgent(agentId: string): AgentDefinition | undefined {
  return agentDefinitions.find((a) => a.id === agentId);
}

/**
 * Deterministic demo output keyed on the agent + selected business. Output text reflects the
 * universal context (no client-specific hardcoding) so the same agent reads naturally for every
 * vertical in the demo.
 */
export function runAgent(input: AgentRunInput): AgentRun {
  const agent = getAgent(input.agentId);
  if (!agent) {
    return {
      id: `run-${Date.now()}`,
      agentId: input.agentId,
      scope: input.scope,
      scopeId: input.scopeId,
      status: "failed",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: `Agent '${input.agentId}' is not registered.`,
    };
  }

  // Resolve a friendly business context. Default to first business if scopeId not found.
  const business =
    businesses.find((b) => b.id === input.scopeId) ??
    businesses.find((b) => b.id === resolveBusinessId(input)) ??
    businesses[0];
  const snap = getBusinessSnapshot(business.id);
  const featured = snap.services.find((s) => s.isFeatured) ?? snap.services[0];
  const location = snap.locations.find((l) => l.isPrimary) ?? snap.locations[0];

  const output = composeDemoOutput(agent, business.name, featured?.name, location?.primaryGeoQuery);

  return {
    id: `run-${Date.now()}`,
    agentId: agent.id,
    scope: input.scope,
    scopeId: input.scopeId,
    status: "completed",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    input: input.payload,
    output,
    tokensUsed: 0,
    costUsd: 0,
  };
}

export function runAllAgents(input: { scope: AgentScope; scopeId: string }): AgentRun[] {
  return agentDefinitions.map((a) => runAgent({ agentId: a.id, scope: input.scope, scopeId: input.scopeId }));
}

function resolveBusinessId(input: AgentRunInput): string | undefined {
  if (input.scope === "business") return input.scopeId;
  if (typeof input.payload?.businessId === "string") return input.payload.businessId;
  return undefined;
}

function composeDemoOutput(
  agent: AgentDefinition,
  business: string,
  featuredService: string | undefined,
  geoQuery: string | undefined,
): string {
  const service = featuredService ?? "your featured service";
  const geo = geoQuery ?? "the selected market";

  switch (agent.id) {
    case "local-seo":
      return `Local SEO Auditor — ${business}: prioritise the ${service} landing page, add FAQ schema, and reinforce internal links toward ${geo}.`;
    case "website-seo":
      return `Website SEO Agent — ${business}: optimise titles, meta, Core Web Vitals; cluster pages around ${service} and supporting topics.`;
    case "gbp":
      return `GBP Agent — ${business}: confirm primary category, weekly posts on ${service}, refresh photos, request reviews referencing ${service}.`;
    case "competitor":
      return `Competitor Intelligence — ${business}: top competitors win on review volume and identity. Out-execute on ${service}-specific content and reviews.`;
    case "content":
      return `Content Strategy — ${business}: produce locale-correct H1/meta/FAQ/posts around ${service} and ${geo}.`;
    case "review":
      return `Review Growth — ${business}: weekly request after ${service} appointments; reply in the customer's language.`;
    case "social-content":
      return `Social Content — ${business}: 4 platform-aware caption variants (LinkedIn, Instagram, Facebook, GBP) for the ${service} campaign.`;
    case "social-image":
      return `Social Image — ${business}: generate 3 on-brand image variants for ${service}; aspect ratios 1:1, 4:5 and 9:16.`;
    case "entity":
      return `Entity Optimisation — ${business}: align website, GBP, content and reviews around ${service} and ${geo}.`;
    case "reporting":
      return `Reporting Agent — ${business}: weekly report includes rankings, GBP delta, reviews growth, and next-week priorities.`;
    case "planner":
      return `Task Planner — ${business}: 13-week sprint plan focused on ${service} authority and ${geo} dominance.`;
    case "campaign":
      return `Campaign Agent — ${business}: orchestrate content + social + image + reporting agents for the active campaign on ${service}.`;
    default:
      return `${agent.name} produced a demo recommendation for ${business}.`;
  }
}
