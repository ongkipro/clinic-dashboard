// Templat Dokumen (UX-54) and Surat (19:92) data (PR-74; T-058). The database decides what each role reads
// (DEC-067): templates for owner, admin pusat and facility head (clinical kinds), letter templates for doctors;
// letters for the doctor, facility head and records officer of the active branch.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import {
  getLetter, getTemplate, letterOptions, listLetters, listTemplates, type LetterDetail, type LetterOptions, type LetterRow, type TemplateDetail, type TemplateKind,
  type TemplateRow,
} from "../../../modules/documents/documents";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { LETTER_READERS, TEMPLATE_WRITERS } from "./labels";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Base = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "no-branch" };
const notFound = (e: unknown) => e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN");

async function context(roles: Set<string>, needsBranch: boolean) {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect" as const, to: rc.to };
  const c = rc.kind === "ok" ? rc.active.context : null;
  if (!c || !roles.has(c.actingRole)) return { kind: "forbidden" as const };
  if (needsBranch && !c.activeBranchId) return { kind: "no-branch" as const };
  return { kind: "ok" as const, c };
}

// The /templat index: where the acting role goes.
export async function homeFor(): Promise<string | null> {
  const rc = await requestContext();
  if (rc.kind !== "ok") return null;
  const r = rc.active.context.actingRole;
  return TEMPLATE_WRITERS.has(r) ? "/templat/dokumen" : LETTER_READERS.has(r) ? "/templat/surat" : null;
}

export type TemplatesData = Base | { kind: "ok"; role: string; templates: TemplateRow[] };
export async function loadTemplates(kind: TemplateKind | null): Promise<TemplatesData> {
  const x = await context(TEMPLATE_WRITERS, false);
  if (x.kind !== "ok") return x;
  return withTenantContext(await appPool(), x.c, async (db) => ({ kind: "ok" as const, ...(await listTemplates(db, kind)) }));
}

export type TemplateData = Base | { kind: "not-found" } | { kind: "ok"; ctx: RenderedContext; role: string; template: TemplateDetail };
export async function loadTemplate(id: string): Promise<TemplateData> {
  const x = await context(TEMPLATE_WRITERS, false);
  if (x.kind !== "ok") return x;
  if (!UUID.test(id)) return { kind: "not-found" };
  try {
    return await withTenantContext(await appPool(), x.c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(x.c), role: x.c.actingRole, template: await getTemplate(db, id) }));
  } catch (e) {
    if (notFound(e)) return { kind: "not-found" };
    throw e;
  }
}

export type NewTemplateData = Base | { kind: "ok"; ctx: RenderedContext; role: string };
export async function loadNewTemplate(): Promise<NewTemplateData> {
  const x = await context(TEMPLATE_WRITERS, false);
  if (x.kind !== "ok") return x;
  return { kind: "ok", ctx: renderedContext(x.c), role: x.c.actingRole };
}

export type LettersData = Base | { kind: "ok"; role: string; letters: LetterRow[] };
export async function loadLetters(): Promise<LettersData> {
  const x = await context(LETTER_READERS, true);
  if (x.kind !== "ok") return x;
  return withTenantContext(await appPool(), x.c, async (db) => ({ kind: "ok" as const, ...(await listLetters(db)) }));
}

export type LetterData = Base | { kind: "not-found" } | { kind: "ok"; ctx: RenderedContext; letter: LetterDetail };
export async function loadLetter(id: string): Promise<LetterData> {
  const x = await context(LETTER_READERS, true);
  if (x.kind !== "ok") return x;
  if (!UUID.test(id)) return { kind: "not-found" };
  try {
    return await withTenantContext(await appPool(), x.c, async (db) => ({ kind: "ok" as const, ctx: renderedContext(x.c), letter: await getLetter(db, id) }));
  } catch (e) {
    if (notFound(e)) return { kind: "not-found" };
    throw e;
  }
}

export type NewLetterData = Base | { kind: "ok"; ctx: RenderedContext; options: LetterOptions; letters: LetterRow[] };
// Buat Surat (doctor only): today's visits at the branch, or the named one, and the letters already written for it.
export async function loadNewLetter(visit: string | null): Promise<NewLetterData> {
  const x = await context(new Set(["doctor"]), true);
  if (x.kind !== "ok") return x;
  const v = visit && UUID.test(visit) ? visit : null;
  return withTenantContext(await appPool(), x.c, async (db) => ({
    kind: "ok" as const, ctx: renderedContext(x.c), options: await letterOptions(db, v), letters: v ? (await listLetters(db, { visitId: v })).letters : [],
  }));
}
