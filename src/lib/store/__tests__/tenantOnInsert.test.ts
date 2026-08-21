import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every INSERT into a tenant-scoped child table must send `organization_id`.
 *
 * The hole this closes. Migration 0003 gave the ten child tables an
 * `organization_id`, and 0004 tied it to the parent with a composite foreign
 * key — that key is what makes cross-tenant reparenting structurally
 * impossible, and it is why check 5 of `defects_test.sql` passes without a
 * trigger doing the refusing.
 *
 * But the application never sent the column. `fill_organization_id_from_business()`
 * supplied it in a BEFORE INSERT trigger on all ten tables, and that was
 * measured, not assumed: ten INSERTs in the exact shape the code writes, none
 * carrying a tenant, all ten accepted, all ten with the tenant filled in.
 *
 * Which leaves the schema unable to state its own rule. A NOT NULL column is a
 * fact the catalogue enforces; "a trigger will get there first" is not. So the
 * triggers cannot be removed while six INSERT sites depend on them, and while
 * they exist the column is guaranteed by something no migration can validate.
 * This test is the other half: it makes the application send the value, and
 * keeps it sending it, so a later migration can drop the ten triggers without
 * silently starting to write tenant-less rows.
 *
 * Static rather than behavioural, on purpose. A test per call site would cover
 * the six that exist; this one also covers the seventh, which is where the
 * problem would come back — nobody removes a tenant on purpose, they add a
 * writer and do not know one was expected.
 *
 * Check 13 of `supabase/qa/defects_test.sql` is the counterpart on the schema
 * side: it fails if the ten triggers disappear. The two are meant to be retired
 * together, in that order — this one green in production first, the triggers
 * after.
 */

const SRC = path.join(process.cwd(), "src");

/**
 * The child tables from 0003/0004 that carry a tenant of their own.
 *
 * `businesses` is not here: it is the parent, and its `organization_id` is the
 * one every row below is compared against. `pagespeed_cache` is not here
 * either — it is keyed by URL and holds nothing tenant-scoped, which is why
 * check 10 exempts its public read.
 */
const TENANT_SCOPED = [
  "business_locations",
  "business_services",
  "competitors",
  "content_assets",
  "reports",
  "reviews",
  "campaigns",
  "platform_tasks",
  "social_image_assets",
  "agent_runs",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Each `.from("<table>").insert(` in the tree, with EXACTLY the argument passed
 * to it — from the opening parenthesis to its balanced close, and nothing else.
 *
 * The first version of this took a generous window of lines around the call
 * instead, and a mutation caught it: removing `organization_id` from the
 * `business_locations` INSERT left the test green, because the INSERT into
 * `businesses` eleven lines above still had one and the window swallowed it. A
 * scan whose window reaches into the neighbouring statement reports on the
 * neighbour.
 *
 * When the argument is an identifier rather than a literal — `insert(rows)` —
 * the declaration of that identifier is resolved and used instead. That is the
 * other real shape in this repository, and treating it as opaque would exempt
 * three of the six call sites.
 */
/**
 * The same text with comments removed.
 *
 * A mutation found the need for this: deleting the `organization_id` line from
 * the `reports` INSERT left the test green, because the comment above it
 * explaining why the column is passed explicitly still contained the word. A
 * scan that reads comments can be satisfied by a sentence about the field
 * instead of the field.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** The substring from `open` (a parenthesis) to its matching close. */
function balanced(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

/**
 * The text of `const <name> = ...` nearest above `before`.
 *
 * Deliberately simple: it takes from the declaration to the end of the
 * statement that follows it, which for the `const rows = items.map(...)` shape
 * this repository uses is the whole builder. If it finds nothing, the caller
 * falls back to the raw argument and the site is reported rather than excused.
 */
function declarationOf(source: string, name: string, before: number): string | null {
  const head = source.slice(0, before);
  const at = head.lastIndexOf(`const ${name} =`);
  if (at === -1) return null;
  return source.slice(at, before);
}

type Site = { file: string; table: string; argument: string };

function insertSites(): Site[] {
  const sites: Site[] = [];

  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf8");

    for (const table of TENANT_SCOPED) {
      const pattern = new RegExp(
        `\\.from\\(["'\`]${table}["'\`]\\)\\s*\\.(insert|upsert)\\(`,
        "g"
      );
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        const open = match.index + match[0].length - 1;
        let argument = balanced(source, open);

        // `insert(rows)` — follow the identifier to where it is built.
        // `balanced` includes the parentheses, so they come off first.
        const inner = argument.replace(/^\(/, "").replace(/\)$/, "").trim();
        const identifier = inner.match(/^([A-Za-z_$][\w$]*)$/);
        if (identifier) {
          argument = declarationOf(source, identifier[1], match.index) ?? argument;
        }

        sites.push({
          file: path.relative(process.cwd(), file),
          table,
          argument: withoutComments(argument),
        });
      }
    }
  }

  return sites;
}

const sites = insertSites();

describe("inserts into tenant-scoped tables", () => {
  // Anti-vacuity. If the scan finds nothing — src moved, the client changed
  // shape, the regex stopped matching — the assertion below passes over an
  // empty list and reports success while checking nothing.
  it("finds the call sites at all", () => {
    expect(
      sites.length,
      "no INSERT into a tenant-scoped table was found anywhere in src/, " +
        "which means this test is no longer looking where the writes are"
    ).toBeGreaterThanOrEqual(6);
  });

  it("sends organization_id explicitly", () => {
    const missing = sites
      .filter((s) => !s.argument.includes("organization_id"))
      .map((s) => `${s.file} → ${s.table}`);

    expect(
      missing,
      `These writes leave organization_id out. Since 0012 nothing fills it: ` +
        `fill_organization_id_from_business() and its ten triggers are gone, so ` +
        `the write is refused outright by NOT NULL rather than quietly ` +
        `completed. Pass the column — tenantOf() in ` +
        `lib/store/supabaseTenantStore.ts resolves it for a whole batch in one ` +
        `query.`
    ).toEqual([]);
  });
});
