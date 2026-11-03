// Shared server body of the three switch pages: gates, active context, and the choices.
import { redirect } from "next/navigation";
import { ROLE_LABEL } from "../../../components/shell/nav";
import { requestContext } from "../../../modules/org/context/store";
import { BlockedState } from "../../../components/ui/states";
import { type SwitchOption, SwitchForm } from "./switch-form";

export async function SwitchBody({ kind }: { kind: "clinic" | "role" | "branch" }) {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return <BlockedState reason="Akun Anda belum punya peran atau cabang aktif" unblock="Owner atau Admin Pusat klinik Anda dapat menambahkannya" />;
  const a = rc.active;
  let options: SwitchOption[];
  let label: string;
  if (kind === "branch") {
    label = "Pilih cabang";
    options = [
      ...(a.tenantWide ? [{ value: "semua", label: "Semua Cabang", detail: "Data seluruh cabang", current: !a.context.activeBranchId }] : []),
      ...a.branches.map((b) => ({ value: b.id, label: b.name, current: a.context.activeBranchId === b.id })),
    ];
  } else if (kind === "role") {
    label = "Pilih peran";
    options = a.roles.map((r) => ({ value: r, label: ROLE_LABEL[r], current: a.context.actingRole === r }));
  } else {
    label = "Pilih klinik";
    options = a.clinics.map((c) => ({ value: c.tenantId, label: c.name, current: a.context.tenantId === c.tenantId }));
  }
  const nothingToSwitch = options.length < 2;
  return (
    <div className="grid gap-4">
      <p className="m-0 text-[var(--label-2)]" data-slot="active-context">
        Aktif: {a.clinic.name} · {a.context.activeBranchId ? a.branches.find((b) => b.id === a.context.activeBranchId)?.name : "Semua Cabang"} · Sebagai {ROLE_LABEL[a.context.actingRole]}
      </p>
      {nothingToSwitch ? (
        <p role="status" className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[var(--label-2)]">
          {kind === "branch" ? "Anda hanya punya satu cabang." : kind === "role" ? "Anda hanya punya satu peran." : "Anda hanya terdaftar di satu klinik."}
        </p>
      ) : (
        <SwitchForm kind={kind} label={label} options={options} />
      )}
    </div>
  );
}
