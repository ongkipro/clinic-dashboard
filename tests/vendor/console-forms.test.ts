// T-129 + HYG-024: Interactive form-submission tests for AuditExportForm and TemplateSaveForm.
// Intercepts strictly at the HTTP boundary (globalThis.fetch) — never stubs post() or form helpers —
// verifies serialized HTML DOM output via renderToStaticMarkup, and splits every scenario into an independent test.
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  refresh: vi.fn(),
}));

vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const idx = hookState.cursor++;
      if (!(idx in hookState.slots)) {
        hookState.slots[idx] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      const set = (next: T | ((prev: T) => T)) => {
        hookState.slots[idx] = typeof next === "function" ? (next as (prev: T) => T)(hookState.slots[idx] as T) : next;
      };
      return [hookState.slots[idx] as T, set] as const;
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: hookState.refresh }),
}));

import { AuditExportForm } from "../../src/app/vendor/audit/actions";
import { TemplateSaveForm } from "../../src/app/vendor/templat/actions";

type AnyEl = ReactElement<Record<string, unknown>>;

function renderTree<P>(Component: (props: P) => ReactElement, props: P): AnyEl {
  hookState.cursor = 0;
  return Component(props) as AnyEl;
}

function htmlOf(el: ReactElement): string {
  return renderToStaticMarkup(el);
}

function findAll(node: ReactNode, pred: (el: AnyEl) => boolean): AnyEl[] {
  const out: AnyEl[] = [];
  const walk = (n: ReactNode) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    const el = n as AnyEl;
    if ("type" in el && "props" in el) {
      if (pred(el)) out.push(el);
      if (el.props?.children) walk(el.props.children as ReactNode);
    }
  };
  walk(node);
  return out;
}

const T1 = "0193a000-0000-7000-8000-000000000001";

function stubDownloadDom() {
  const createdLinks: { href: string; download: string; clicked: boolean }[] = [];
  const revokedUrls: string[] = [];
  const capturedBlobs: Blob[] = [];
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: (b: Blob) => {
      capturedBlobs.push(b);
      return "blob:audit-export-1";
    },
    revokeObjectURL: (u: string) => revokedUrls.push(u),
  });
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      expect(tag).toBe("a");
      const link = { href: "", download: "", clicked: false, click() { link.clicked = true; } };
      createdLinks.push(link);
      return link;
    },
  });
  return { createdLinks, revokedUrls, capturedBlobs };
}

describe("T-129 + HYG-024: AuditExportForm HTTP-boundary submissions", () => {
  beforeEach(() => {
    hookState.slots = [];
    hookState.cursor = 0;
    hookState.refresh.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits exact full-day microsecond bounds, triggers CSV download, and renders status notice in HTML", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const { createdLinks, revokedUrls, capturedBlobs } = stubDownloadDom();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return new Response("id,at\r\n1,2026-11-26T00:00:00Z\r\n", {
          status: 200,
          headers: { "content-type": "text/csv; charset=utf-8" },
        });
      }),
    );

    let tree = renderTree(AuditExportForm, { tenantId: T1 });
    (findAll(tree, (el) => el.props.id === "audit-from")[0].props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "2026-11-26" },
    });
    (findAll(tree, (el) => el.props.id === "audit-to")[0].props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "2026-11-26" },
    });

    tree = renderTree(AuditExportForm, { tenantId: T1 });
    await (tree.props.onSubmit as (e: { preventDefault: () => void }) => Promise<void>)({ preventDefault: () => {} });
    const html = htmlOf(renderTree(AuditExportForm, { tenantId: T1 }));

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/vendor/api/console/audit-export");
    expect(requests[0].init?.method).toBe("POST");
    expect(requests[0].init?.credentials).toBe("same-origin");
    expect(requests[0].init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      tenantId: T1,
      from: "2026-11-26T00:00:00+07:00",
      to: "2026-11-26T23:59:59.999999+07:00",
    });
    expect(createdLinks).toMatchObject([{ href: "blob:audit-export-1", download: "audit-vendor.csv", clicked: true }]);
    expect(revokedUrls).toEqual(["blob:audit-export-1"]);
    expect(await capturedBlobs[0].text()).toBe("id,at\r\n1,2026-11-26T00:00:00Z\r\n");
    expect(html).toContain('role="status">File audit-vendor.csv berhasil diunduh.</p>');
    expect(html).not.toContain('role="alert"');
  });

  it("refuses reversed date range client-side with zero HTTP requests and renders alert in HTML", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    let tree = renderTree(AuditExportForm, { tenantId: null });
    (findAll(tree, (el) => el.props.id === "audit-from")[0].props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "2026-11-27" },
    });
    (findAll(tree, (el) => el.props.id === "audit-to")[0].props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "2026-11-26" },
    });

    tree = renderTree(AuditExportForm, { tenantId: null });
    await (tree.props.onSubmit as (e: { preventDefault: () => void }) => Promise<void>)({ preventDefault: () => {} });
    const html = htmlOf(renderTree(AuditExportForm, { tenantId: null }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(html).toContain('role="alert">Tanggal mulai tidak boleh lebih akhir dari tanggal selesai.</p>');
    expect(html).not.toContain('role="status"');
  });

  it("renders Indonesian step-up alert in HTML on HTTP 403 totp_not_verified without downloading", async () => {
    const { createdLinks } = stubDownloadDom();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, code: "ERR_FORBIDDEN", reason: "totp_not_verified" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const tree = renderTree(AuditExportForm, { tenantId: T1 });
    await (tree.props.onSubmit as (e: { preventDefault: () => void }) => Promise<void>)({ preventDefault: () => {} });
    const html = htmlOf(renderTree(AuditExportForm, { tenantId: T1 }));

    expect(createdLinks).toHaveLength(0);
    expect(html).toContain(
      'role="alert">Verifikasi dua langkah Anda sudah lebih dari 10 menit. Keluar lalu masuk kembali untuk melanjutkan.</p>',
    );
    expect(html).not.toContain('role="status"');
  });

  it("catches mid-stream response-body read failure after HTTP 200 headers and renders connection error alert", async () => {
    const { createdLinks } = stubDownloadDom();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => {
          throw new Error("socket hang up");
        },
      })),
    );

    const tree = renderTree(AuditExportForm, { tenantId: T1 });
    await expect(
      (tree.props.onSubmit as (e: { preventDefault: () => void }) => Promise<void>)({ preventDefault: () => {} }),
    ).resolves.toBeUndefined();
    const html = htmlOf(renderTree(AuditExportForm, { tenantId: T1 }));

    expect(createdLinks).toHaveLength(0);
    expect(html).toContain('role="alert">Koneksi terputus. Coba Lagi.</p>');
    expect(html).not.toContain('role="status"');
  });
});

describe("T-129 + HYG-024: TemplateSaveForm HTTP-boundary submissions (via real post())", () => {
  beforeEach(() => {
    hookState.slots = [];
    hookState.cursor = 0;
    hookState.refresh.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts JSON payload via real post(), clears textarea, refreshes router, and renders save/activate status in HTML", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({ ok: true, version: 2, isActive: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    let tree = renderTree(TemplateSaveForm, {});
    (findAll(tree, (el) => el.props.id === "tpl-kind")[0].props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "syarat-ketentuan" },
    });
    (findAll(tree, (el) => el.props.id === "tpl-body")[0].props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "Syarat dan ketentuan resmi {{klinik.nama}} untuk pasien." },
    });
    (
      findAll(tree, (el) => el.type === "input" && el.props.type === "checkbox")[0].props.onChange as (e: {
        target: { checked: boolean };
      }) => void
    )({ target: { checked: true } });

    tree = renderTree(TemplateSaveForm, {});
    await (tree.props.onSubmit as (e: { preventDefault: () => void }) => Promise<void>)({ preventDefault: () => {} });
    const afterTree = renderTree(TemplateSaveForm, {});
    const html = htmlOf(afterTree);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/vendor/api/console/template-save");
    expect(requests[0].init?.method).toBe("POST");
    expect(requests[0].init?.credentials).toBe("same-origin");
    expect(requests[0].init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      kind: "syarat-ketentuan",
      body: "Syarat dan ketentuan resmi {{klinik.nama}} untuk pasien.",
      activate: true,
    });
    expect(hookState.refresh).toHaveBeenCalledTimes(1);
    expect(findAll(afterTree, (el) => el.props.id === "tpl-body")[0].props.value).toBe("");
    expect(html).toContain('role="status">Templat v2 berhasil disimpan dan diaktifkan.</p>');
    expect(html).not.toContain('role="alert"');
  });

  it("translates HTTP 403 totp_not_verified through real post.ts and renders step-up alert without refreshing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, code: "ERR_FORBIDDEN", reason: "totp_not_verified" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    let tree = renderTree(TemplateSaveForm, {});
    (findAll(tree, (el) => el.props.id === "tpl-body")[0].props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "Syarat dan ketentuan versi tiga {{klinik.nama}}." },
    });
    tree = renderTree(TemplateSaveForm, {});
    await (tree.props.onSubmit as (e: { preventDefault: () => void }) => Promise<void>)({ preventDefault: () => {} });
    const html = htmlOf(renderTree(TemplateSaveForm, {}));

    expect(hookState.refresh).not.toHaveBeenCalled();
    expect(html).toContain(
      'role="alert">Verifikasi dua langkah Anda sudah lebih dari 10 menit. Keluar lalu masuk kembali untuk melanjutkan.</p>',
    );
    expect(html).not.toContain('role="status"');
  });
});
