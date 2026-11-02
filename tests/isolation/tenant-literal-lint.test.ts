// DEL-2 / TEN-15: proves the repository ESLint config rejects tenant literals and tenant
// branching in src/ and accepts ordinary code. Lints virtual files with the real config.
import { join } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const eslint = new ESLint({ cwd: ROOT });

async function messages(code: string, file = "src/lib/probe.tsx"): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
  return result.messages
    .filter((m) => m.ruleId === "no-restricted-syntax")
    .map((m) => `${m.line}: ${m.message.split(" (")[0].replace(/\.$/, "")}`);
}

describe("tenant-literal lint rule", () => {
  it("fails on a hard-coded tenant slug in src/", async () => {
    expect(await messages(`export const slug = "numa-klinik";`)).toEqual([
      "1: No tenant slugs or brand names in src/",
    ]);
  });

  it("fails on brand names in templates and JSX, and on UUID literals", async () => {
    expect(
      await messages(
        [
          "export const a = `https://${'x'}.numa.id`;",
          "export const b = <p>Selamat datang di Numa Klinik</p>;",
          'export const c = "0198f2a1-1234-7abc-8def-0123456789ab";',
        ].join("\n"),
      ),
    ).toEqual([
      "1: No tenant slugs or brand names in src/",
      "2: No tenant slugs or brand names in src/",
      "3: No UUID literals in src/: tenant and object ids come from data",
    ]);
  });

  it("fails on branching on tenant identity", async () => {
    expect(
      await messages(
        [
          "export function f(t: { slug: string; tenantId: string }, tenant_id: string) {",
          '  if ("abc" !== t.tenantId) return 1;',
          '  if (tenant_id == "x") return 2;',
          "  switch (t.slug) { default: return 3; }",
          "}",
        ].join("\n"),
      ),
    ).toEqual([
      "2: Do not branch on tenant identity",
      "3: Do not branch on tenant identity",
      "4: Do not branch on tenant identity",
    ]);
  });

  it("fails on an inline server action and accepts a module-level directive", async () => {
    expect(
      await messages(
        ["export async function save() {", '  "use server";', "}"].join("\n"),
      ),
    ).toEqual(['2: No inline "use server": move the action to a "use server" module so the isolation gate covers it']);
    expect(
      await messages(['"use server";', "export async function save() {}"].join("\n"), "src/lib/actions.ts"),
    ).toEqual([]);
    expect(
      await messages(["export const save = async () => {", '  "use server";', "};"].join("\n")),
    ).toHaveLength(1);
  });

  it("accepts ordinary code", async () => {
    expect(
      await messages(
        [
          'export const tz = "Asia/Jakarta";',
          'export const word = "numerik ruangan";',
          "export const same = (t: { slug: string }, s: string) => t.slug === s;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("does not apply outside src/ (fixtures may name synthetic tenants)", async () => {
    expect(await messages(`export const slug = "numa";`, "tests/isolation/probe.ts")).toEqual([]);
  });
});
