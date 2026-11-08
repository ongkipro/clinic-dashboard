"use client";
// Master Layanan form (UX-25, PR-88, T-034): one version of a service, grouped as the 19 row's tabs
// that exist now. The button names what will happen: Simpan (active at once) or Minta Review naming
// the review(s) the change needs (clinical: facility head; recipe: pharmacist; DEC-047). The staff
// options offer only modes inside the legal floor for the chosen category; the database decides.
import { useActionState, useId, useMemo, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import { allowedModes, type Category, CATEGORIES, MODE_RANK, type Profession, PROFESSIONS } from "../../../modules/catalog/service/floor";
import { CATEGORY_LABEL, DEVICE_LABEL, MODE_LABEL, PROFESSION_LABEL, ROOM_LABEL } from "../../../modules/catalog/service/labels";
import type { RenderedContext } from "../../../modules/org/context/context";
import { SCOPE_LABEL, TAX_LABEL } from "../katalog/labels";
import { type LayananState, publishServiceAction, withdrawServiceAction } from "./actions";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const area = "min-h-[6rem] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3 py-2";
const hintCls = "text-[0.88rem] text-[var(--label-2)]";

export type Recipe = { material: string; qty: number; unit: string }[];
export type Elig = { role: string | null; staffId: string | null; mode: string }[];
export type ServiceInitial = {
  name: string; tax_category: string; tax_basis: string; normal_price: string; control_count: string; control_validity_days: string;
  booking_dp_enabled: boolean; booking_dp_amount: string; min_dp_pct: string; installments_allowed: boolean; validity_days: string; commission_scope: string[];
  indications: string; contraindications: string; consent_template: string; delegation: string; aftercare_text: string;
  category: string; prep_min: string; treatment_min: string; buffer_min: string; online_bookable: boolean;
  resources: string[]; eligibility: Elig; recipe: Recipe;
};
// What the active version holds: the review baseline (DEC-047: always the active version).
export type Baseline = { clinical: Record<(typeof CLINICAL)[number], string>; eligibility: Elig; recipe: Recipe };
export type StaffOption = { id: string; name: string; roles: string[] };

const CLINICAL = ["indications", "contraindications", "consent_template", "delegation", "aftercare_text"] as const;
const eligKey = (e: Elig) => e.map((x) => `${x.role ?? ""}|${x.staffId ?? ""}|${x.mode}`).sort().join(";");
const recipeKey = (r: Recipe) => JSON.stringify(r.map((x) => [x.material.trim(), Number(x.qty), x.unit.trim()]));

function Text({ name, label, value, hint, numeric }: { name: string; label: string; value: string; hint?: string; numeric?: boolean }) {
  const id = useId();
  return (
    <label className="grid min-w-0 gap-1">
      <span className="font-semibold">{label}</span>
      <input className={input} name={name} defaultValue={value} inputMode={numeric ? "numeric" : undefined} aria-describedby={hint ? `${id}-h` : undefined} />
      {hint && <span id={`${id}-h`} className={hintCls}>{hint}</span>}
    </label>
  );
}
function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: (id: string, hintId?: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className="font-semibold">{label}</label>
      {children(id, hint ? `${id}-h` : undefined)}
      {hint && <span id={`${id}-h`} className={hintCls}>{hint}</span>}
    </div>
  );
}
function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid min-w-0 gap-3 rounded-[var(--radius-group)] border-0 bg-[var(--surface)] p-4">
      <legend className="float-left mb-1 w-full text-[1.1rem] font-semibold">{title}</legend>
      {note && <p className={`m-0 ${hintCls}`}>{note}</p>}
      {children}
    </fieldset>
  );
}

export function ServiceForm({ ctx, itemId, initial, baseline, staff }: {
  ctx: RenderedContext; itemId: string | null; initial: ServiceInitial; baseline: Baseline; staff: StaffOption[];
}) {
  const [state, action, pending] = useActionState<LayananState, FormData>(publishServiceAction, {});
  const sv = state.values;
  const v = (k: keyof ServiceInitial) => (sv?.[k] ?? String(initial[k] ?? ""));
  const on = (k: string, init: boolean) => (sv ? sv[k] === "1" : init);
  const [category, setCategory] = useState<string>(sv?.category ?? initial.category);
  const [clinical, setClinical] = useState<Record<string, string>>(() => Object.fromEntries(CLINICAL.map((k) => [k, sv?.[k] ?? initial[k]])));
  const initialElig = useMemo(() => {
    if (!sv) return initial.eligibility;
    const out: Elig = [];
    for (const [k, m] of Object.entries(sv)) {
      if (!m) continue;
      if (k.startsWith("elig_role_")) out.push({ role: k.slice(10), staffId: null, mode: m });
      if (k.startsWith("elig_staff_")) out.push({ role: null, staffId: k.slice(11), mode: m });
    }
    return out;
  }, [sv, initial.eligibility]);
  const [elig, setElig] = useState<Elig>(initialElig);
  // Opened once with named staff (or by the user); never snapped shut by a selection change.
  const [openStaff, setOpenStaff] = useState(() => initialElig.some((e) => e.staffId));
  const rows = Math.min(50, Math.max(initial.recipe.length + 2, 3));
  const [recipe, setRecipe] = useState<{ material: string; qty: string; unit: string }[]>(() =>
    Array.from({ length: rows }, (_, i) => ({
      material: sv?.[`bhp_material_${i}`] ?? initial.recipe[i]?.material ?? "",
      qty: sv?.[`bhp_qty_${i}`] ?? (initial.recipe[i] ? String(initial.recipe[i].qty).replace(".", ",") : ""),
      unit: sv?.[`bhp_unit_${i}`] ?? initial.recipe[i]?.unit ?? "",
    })));
  const resources = sv ? (sv.resource ?? "").split("\n").filter(Boolean) : initial.resources;
  const scopes = sv ? (sv.commission_scope ?? "").split("\n").filter(Boolean) : initial.commission_scope;

  const cat = (CATEGORIES as readonly string[]).includes(category) ? (category as Category) : null;
  const modeOf = (role: string | null, staffId: string | null) => elig.find((e) => e.role === role && e.staffId === staffId)?.mode ?? "";
  const setMode = (role: string | null, staffId: string | null, mode: string) =>
    setElig((cur) => [...cur.filter((e) => !(e.role === role && e.staffId === staffId)), ...(mode ? [{ role, staffId, mode }] : [])]);
  const staffModes = (s: StaffOption) => {
    if (!cat) return [];
    const best = s.roles.filter((r): r is Profession => (PROFESSIONS as readonly string[]).includes(r))
      .reduce((m, r) => Math.max(m, ...allowedModes(cat, r).map((x) => MODE_RANK[x])), 0);
    return (["performs", "supervised", "assists"] as const).filter((m) => MODE_RANK[m] <= best);
  };

  // Review round 1 (Argon): what the form will actually post. A row outside the floor for the chosen
  // category, or for a staff member no longer offered (ended membership), renders as "not set" and is
  // not posted, so the review decision and the button follow the posted rows, not the raw state.
  const eligNow: Elig = cat
    ? elig.filter((e) => e.role
        ? (PROFESSIONS as readonly string[]).includes(e.role) && allowedModes(cat, e.role as Profession).includes(e.mode as never)
        : staff.some((s) => s.id === e.staffId && staffModes(s).includes(e.mode as never)))
    : [];
  const recipeNow: Recipe = recipe.filter((r) => r.material.trim() || r.qty.trim() || r.unit.trim())
    .map((r) => ({ material: r.material, qty: Number(r.qty.replace(",", ".")), unit: r.unit }));
  const clinicalChanged = CLINICAL.some((k) => (clinical[k] ?? "").trim() !== (baseline.clinical[k] ?? "").trim()) || eligKey(eligNow) !== eligKey(baseline.eligibility);
  const recipeChanged = recipeKey(recipeNow) !== recipeKey(baseline.recipe);
  const label = clinicalChanged && recipeChanged ? "Minta Review Klinis & BHP" : clinicalChanged ? "Minta Review Klinis" : recipeChanged ? "Minta Review BHP" : "Simpan";

  return (
    <form action={action} className="grid min-w-0 gap-4" aria-label={itemId ? "Versi baru layanan" : "Layanan baru"}>
      <ContextFields ctx={ctx} />
      {itemId ? <input type="hidden" name="item" value={itemId} /> : null}
      <Group title="Umum">
        {!itemId && <Text name="code" label="Kode" value={sv?.code ?? ""} hint="Huruf besar, angka, tanda hubung; tidak bisa diubah." />}
        <Text name="name" label="Nama layanan" value={v("name")} />
        <Field label="Kategori" hint="Kategori menentukan batas delegasi yang diizinkan hukum.">
          {(id, h) => (
            <select id={id} aria-describedby={h} className={input} name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Pilih kategori</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          )}
        </Field>
        <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
          <Text name="normal_price" label="Harga normal (Rp)" value={v("normal_price")} numeric hint="Harga per cabang diatur di Harga Cabang (segera)." />
          <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
            <Text name="control_count" label="Kontrol gratis (kali)" value={v("control_count")} numeric />
            <Text name="control_validity_days" label="Berlaku kontrol (hari)" value={v("control_validity_days")} numeric />
          </div>
        </div>
        <fieldset className="grid min-w-0 gap-1 border-0 p-0">
          <legend className="font-semibold">Komisi untuk</legend>
          <div className="flex flex-wrap gap-x-5">
            {Object.entries(SCOPE_LABEL).map(([k, l]) => (
              <label key={k} className="flex min-h-[var(--target)] items-center gap-2">
                <input type="checkbox" name="commission_scope" value={k} className="size-5" defaultChecked={scopes.includes(k)} />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
      </Group>

      <Group title="Durasi & Sumber Daya" note="Dipakai saat mencari jadwal: layanan hanya ditawarkan di cabang yang punya ruang dan alatnya.">
        <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-3">
          <Text name="prep_min" label="Persiapan (menit)" value={v("prep_min")} numeric hint="0–120" />
          <Text name="treatment_min" label="Tindakan (menit)" value={v("treatment_min")} numeric hint="5–480" />
          <Text name="buffer_min" label="Jeda setelahnya (menit)" value={v("buffer_min")} numeric hint="0–120" />
        </div>
        <fieldset className="grid min-w-0 gap-1 border-0 p-0">
          <legend className="font-semibold">Ruang yang dibutuhkan</legend>
          <div className="flex flex-wrap gap-x-5">
            {Object.entries(ROOM_LABEL).map(([k, l]) => (
              <label key={k} className="flex min-h-[var(--target)] items-center gap-2">
                <input type="checkbox" name="resource" value={`room:${k}`} className="size-5" defaultChecked={resources.includes(`room:${k}`)} />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid min-w-0 gap-1 border-0 p-0">
          <legend className="font-semibold">Alat yang dibutuhkan</legend>
          <div className="flex flex-wrap gap-x-5">
            {Object.entries(DEVICE_LABEL).map(([k, l]) => (
              <label key={k} className="flex min-h-[var(--target)] items-center gap-2">
                <input type="checkbox" name="resource" value={`device:${k}`} className="size-5" defaultChecked={resources.includes(`device:${k}`)} />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
      </Group>

      <Group title="Staf & Delegasi" note="Perubahan di sini aktif setelah direview Penanggung Jawab Klinik. Pilihan dibatasi oleh batas hukum untuk kategori layanan.">
        {!cat ? (
          <p className="m-0">Pilih kategori di bagian Umum dulu.</p>
        ) : (
          <>
            {PROFESSIONS.map((r) => {
              const modes = allowedModes(cat, r);
              return (
                <Field key={r} label={PROFESSION_LABEL[r]}>
                  {(id) => (
                    <select id={id} className={input} name={`elig_role_${r}`} value={modes.includes(modeOf(r, null) as never) ? modeOf(r, null) : ""} onChange={(e) => setMode(r, null, e.target.value)} disabled={modes.length === 0}>
                      <option value="">{modes.length === 0 ? "Tidak boleh untuk kategori ini" : "Tidak ditetapkan"}</option>
                      {modes.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                    </select>
                  )}
                </Field>
              );
            })}
            {staff.length > 0 && (
              <details className="grid min-w-0 gap-2" open={openStaff} onToggle={(e) => setOpenStaff(e.currentTarget.open)}>
                <summary className="min-h-[var(--target)] cursor-pointer content-center font-semibold text-[var(--tint)]">Staf tertentu</summary>
                <div className="grid min-w-0 gap-3 pt-2">
                  {staff.map((s) => {
                    const modes = staffModes(s);
                    return (
                      <Field key={s.id} label={<>{s.name} <span className="font-normal text-[var(--label-2)]">· {s.roles.map((r) => PROFESSION_LABEL[r] ?? r).join(", ")}</span></>}>
                        {(id) => (
                          <select id={id} className={input} name={`elig_staff_${s.id}`} value={modes.includes(modeOf(null, s.id) as never) ? modeOf(null, s.id) : ""} onChange={(e) => setMode(null, s.id, e.target.value)} disabled={modes.length === 0}>
                            <option value="">{modes.length === 0 ? "Tidak boleh untuk kategori ini" : "Tidak ditetapkan"}</option>
                            {modes.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                          </select>
                        )}
                      </Field>
                    );
                  })}
                </div>
              </details>
            )}
          </>
        )}
      </Group>

      <Group title="Resep BHP" note="Bahan habis pakai per tindakan. Perubahan resep aktif setelah direview Apoteker.">
        <div className="grid min-w-0 gap-3">
          {recipe.map((r, i) => (
            <fieldset key={i} className="grid min-w-0 gap-2 border-0 p-0 min-[700px]:grid-cols-[minmax(0,1fr)_7rem_7rem]">
              <legend className="sr-only">Baris resep {i + 1}</legend>
              {(["material", "qty", "unit"] as const).map((k) => (
                <label key={k} className="grid min-w-0 gap-1">
                  <span className="text-[0.94rem]">{k === "material" ? `Bahan ${i + 1}` : k === "qty" ? "Jumlah" : "Satuan"}</span>
                  <input className={input} name={`bhp_${k}_${i}`} value={r[k]} inputMode={k === "qty" ? "decimal" : undefined}
                    onChange={(e) => setRecipe((cur) => cur.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </Group>

      <Group title="Persetujuan Tindakan" note="Data klinis aktif setelah direview Penanggung Jawab Klinik. Versi aktif tetap berlaku sampai disetujui.">
        {([["indications", "Indikasi"], ["contraindications", "Kontraindikasi"], ["consent_template", "Templat persetujuan tindakan"], ["delegation", "Catatan delegasi"]] as const).map(([k, l]) => (
          <label key={k} className="grid min-w-0 gap-1">
            <span className="font-semibold">{l}</span>
            <textarea className={area} name={k} value={clinical[k]} onChange={(e) => setClinical((c) => ({ ...c, [k]: e.target.value }))} />
          </label>
        ))}
      </Group>

      <Group title="Aftercare">
        <label className="grid min-w-0 gap-1">
          <span className="font-semibold">Petunjuk setelah tindakan</span>
          <textarea className={area} name="aftercare_text" value={clinical.aftercare_text} onChange={(e) => setClinical((c) => ({ ...c, aftercare_text: e.target.value }))} />
        </label>
      </Group>

      <Group title="Booking Online & DP">
        <label className="flex min-h-[var(--target)] items-center gap-3">
          <input type="checkbox" name="online_bookable" value="1" className="size-5" defaultChecked={on("online_bookable", initial.online_bookable)} />
          <span className="font-semibold">Bisa dibooking online</span>
        </label>
        <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
          <label className="flex min-h-[var(--target)] items-center gap-3">
            <input type="checkbox" name="booking_dp_enabled" value="1" className="size-5" defaultChecked={on("booking_dp_enabled", initial.booking_dp_enabled)} />
            <span className="font-semibold">DP booking</span>
          </label>
          <Text name="booking_dp_amount" label="Nominal DP booking (Rp)" value={v("booking_dp_amount")} numeric />
        </div>
      </Group>

      <Group title="Pajak">
        <Field label="Kategori pajak">
          {(id) => (
            <select id={id} className={input} name="tax_category" defaultValue={v("tax_category")}>
              <option value="">Pilih</option>
              {Object.entries(TAX_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
        </Field>
        <Text name="tax_basis" label="Dasar kategori pajak" value={v("tax_basis")} hint="Mengapa kategori ini berlaku (dicatat untuk penasihat pajak)." />
      </Group>

      {/* Package fields stay with the Katalog form; kept unchanged here. */}
      <input type="hidden" name="min_dp_pct" value={v("min_dp_pct")} />
      <input type="hidden" name="validity_days" value={v("validity_days")} />
      {initial.installments_allowed && <input type="hidden" name="installments_allowed" value="1" />}

      <label className="grid min-w-0 gap-1">
        <span className="font-semibold">Alasan perubahan</span>
        <input className={input} name="reason" defaultValue={sv?.reason ?? ""} />
      </label>
      {(clinicalChanged || recipeChanged) && (
        <p className={`m-0 ${hintCls}`} aria-live="polite">
          {clinicalChanged && recipeChanged ? "Perlu review Penanggung Jawab Klinik dan Apoteker; aktif setelah keduanya menyetujui." : clinicalChanged ? "Perlu review Penanggung Jawab Klinik sebelum aktif." : "Perlu review Apoteker sebelum aktif."}
        </p>
      )}
      {state.error && <p role="alert" className="m-0 text-[var(--danger)]">{state.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" aria-disabled={pending}>{label}</Button>
      </div>
    </form>
  );
}

export function WithdrawReview({ ctx, itemId, approvalId }: { ctx: RenderedContext; itemId: string; approvalId: string }) {
  const [state, action, pending] = useActionState<LayananState, FormData>(withdrawServiceAction, {});
  return (
    <form action={action} className="grid gap-2" aria-label="Tarik ajuan perubahan layanan">
      <ContextFields ctx={ctx} />
      <input type="hidden" name="item" value={itemId} />
      <input type="hidden" name="approval" value={approvalId} />
      <div><Button type="submit" variant="plain" aria-disabled={pending}>Tarik Ajuan</Button></div>
      {state.error && <p role="alert" className="m-0 text-[var(--danger)]">{state.error}</p>}
      {state.ok && <p role="status" className="m-0 text-[var(--success)]">{state.ok}</p>}
    </form>
  );
}
