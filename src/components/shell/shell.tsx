"use client";
// Clinic app shell (PR-86, NAV-1–NAV-3, NAV-7, DESIGN.md Layout, UI-11, UI-14).
// Compact (< 700 px): top bar + content + glass bottom tab bar (4 role tabs + Menu);
// Menu is a full-height sheet with Saya first, search, pinned and recent pages and the
// role-filtered tree. Regular (≥ 700 px): leading sidebar with the same tree (two
// levels, collapsible groups, current page highlighted) + top bar. Both widths: branch
// switcher (> 1 branch), global search slot (PR-76), quick actions, notifications, inbox
// badge and user menu; Ctrl/⌘+K opens the command palette. Menu links do not
// prefetch (about 100 per role); the 4 tabs do.
import {
  BedDouble,
  Bell,
  Building2,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  Landmark,
  LayoutDashboard,
  Megaphone,
  Package,
  Pill,
  Plug,
  Settings,
  ShieldCheck,
  Stethoscope,
  UserCog,
  Users,
  Wallet,
  ChevronDown,
  CircleUser,
  Clock,
  Menu as MenuIcon,
  MessageCircle,
  Pin,
  PinOff,
  Plus,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Role } from "../../auth/policy";
import { currentPageId, hasInbox, menuFor, type NavGroup, type NavPage, quickActionsFor, sayaFor, tabsFor } from "./nav";
import s from "./shell.module.css";

export type ShellProps = {
  staffId: string;
  role: Role;
  roleLabel: string;
  name: string;
  clinic: string;
  branches: { id: string; name: string }[];
  activeBranchId: string | null;
  tenantWide: boolean;
  children: React.ReactNode;
};

// Pinned and recent pages stay on this device only (no server state, no analytics),
// keyed by staff membership so a shared device keeps each person's lists apart; sign-out
// clears this membership's lists.
const pinKey = (staffId: string) => `shell.pinned.${staffId}`;
const recentKey = (staffId: string) => `shell.recent.${staffId}`;
function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}
const listeners = new Set<() => void>();
function writeList(key: string, value: string[] | null) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
  cache.delete(key);
  listeners.forEach((l) => l());
}
const cache = new Map<string, string[]>();
function useList(key: string): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      if (!cache.has(key)) cache.set(key, readList(key));
      return cache.get(key)!;
    },
    () => EMPTY,
  );
}
const EMPTY: string[] = [];


function matchPages(pages: NavPage[], q: string): NavPage[] {
  const t = q.trim().toLocaleLowerCase("id");
  return t ? pages.filter((p) => p.label.toLocaleLowerCase("id").includes(t)) : pages;
}

export function Shell(props: ShellProps) {
  const { role, children } = props;
  const path = usePathname();
  const groups = useMemo(() => menuFor(role), [role]);
  const saya = useMemo(() => sayaFor(role), [role]);
  const tabs = useMemo(() => tabsFor(role), [role]);
  const all = useMemo(() => [...groups.flatMap((g) => g.pages), ...saya], [groups, saya]);
  // Exactly one current page (longest matching href); tabs share it.
  const current = currentPageId(path, all);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Sheets opened without a Radix trigger return focus to what opened them (WCAG 2.4.3).
  const opener = useRef<HTMLElement | null>(null);
  // Only a real control counts as the opener (a click can leave focus on the body or a
  // wrapper); otherwise the fallback is used.
  const remember = () => {
    const a = document.activeElement;
    opener.current = a instanceof HTMLElement && a.matches("a[href], button, input, [tabindex='0']") ? a : null;
  };
  const menuButton = useRef<HTMLButtonElement>(null);
  // The tab bar's Menu button is the fallback when the opener left the page.
  const restoreFocus = (e: Event, fallback: HTMLElement | null) => {
    const target = opener.current?.isConnected ? opener.current : fallback;
    if (target) {
      e.preventDefault();
      target.focus();
    }
  };
  const onMenuClosed = (e: Event) => restoreFocus(e, menuButton.current);
  const onPaletteClosed = (e: Event) => restoreFocus(e, document.querySelector<HTMLElement>("[data-shell-search]"));

  // Recent pages: the menu pages this device opened, newest first.
  const RECENT_KEY = recentKey(props.staffId);
  const recent = useList(RECENT_KEY);
  useEffect(() => {
    if (!current) return;
    const next = [current, ...readList(RECENT_KEY).filter((x) => x !== current)].slice(0, 5);
    if (next.join() !== readList(RECENT_KEY).join()) writeList(RECENT_KEY, next);
  }, [current, RECENT_KEY]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        remember();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const menuTabActive = !tabs.some((t) => t.id === current);

  return (
    <div className={s.shell}>
      <a className={s.skip} href="#konten">Lewati ke konten</a>
      <nav className={s.sidebar} aria-label="Menu utama">
        <div className={s.brand}>{props.clinic}</div>
        <Tree groups={groups} saya={saya} current={current} staffId={props.staffId} />
      </nav>
      <div className={s.main}>
        <TopBar
          {...props}
          onSearch={() => {
            remember();
            setPaletteOpen(true);
          }}
        />
        {/* Each page renders its own <main> (one landmark per page). */}
        <div id="konten" className={s.content} tabIndex={-1}>
          {children}
        </div>
      </div>
      <nav className={`${s.tabbar} bar-glass`} aria-label="Tab">
        {tabs.map((t) => {
          const on = t.id === current;
          return (
            <Link key={t.id} href={t.href} className={s.tab} aria-current={on ? "page" : undefined}>
              <TabIcon group={t.group} filled={on} />
              <span className={s.tabLabel}>{t.label}</span>
            </Link>
          );
        })}
        <button ref={menuButton} type="button" className={s.tab} aria-haspopup="dialog" data-active={menuTabActive} onClick={(e) => {
            opener.current = e.currentTarget;
            setMenuOpen(true);
          }}>
          <MenuIcon aria-hidden="true" strokeWidth={menuTabActive ? 2.5 : 1.75} />
          <span className={s.tabLabel}>Menu</span>
        </button>
      </nav>
      <MenuSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        groups={groups}
        saya={saya}
        all={all}
        recent={recent}
        current={current}
        staffId={props.staffId}
        onCloseAutoFocus={onMenuClosed}
      />
      <Palette open={paletteOpen} onOpenChange={setPaletteOpen} all={all} quick={quickActionsFor(role)} onCloseAutoFocus={onPaletteClosed} />
    </div>
  );
}

function TabIcon({ group, filled }: { group: string; filled: boolean }) {
  // Lucide has no filled variants; the selected tab uses a heavier stroke plus tint
  // (DESIGN.md Icons: "filled-style variant for the selected tab").
  const Icon = GROUP_ICON[group] ?? CircleUser;
  return <Icon aria-hidden="true" strokeWidth={filled ? 2.5 : 1.75} />;
}

const GROUP_ICON: Record<string, typeof Bell> = {
  dashboard: LayoutDashboard,
  "front-office": ClipboardList,
  jadwal: CalendarDays,
  pasien: Users,
  klinis: Stethoscope,
  ruang: BedDouble,
  kasir: Wallet,
  paket: Package,
  apotek: Pill,
  staf: UserCog,
  marketing: Megaphone,
  keuangan: Landmark,
  laporan: ChartColumn,
  persetujuan: ShieldCheck,
  integrasi: Plug,
  pengaturan: Settings,
  saya: CircleUser,
};

type TreeProps = { groups: NavGroup[]; saya: NavPage[]; current?: string; staffId: string; onNavigate?: () => void };

function Tree({ groups, saya, current, staffId, onNavigate }: TreeProps) {
  return (
    <div className={s.tree}>
      <Group id="saya" label="Saya" pages={saya} current={current} onNavigate={onNavigate}>
        <li>
          <SignOut staffId={staffId} />
        </li>
      </Group>
      {groups.map((g) => (
        <Group key={g.id} id={g.id} label={g.label} pages={[...g.pages]} current={current} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

// §2.16 Keluar: ends the session (Better Auth sign-out, same origin). Only a confirmed
// sign-out clears this membership's device lists and leaves the page; a refused or failed
// request keeps the user here with an error, so nobody walks away from a shared device
// believing they signed out.
export function SignOut({ staffId, className }: { staffId?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        className={className ?? `${s.pageLink} ${s.signOut}`}
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          const ok = await fetch("/api/auth/sign-out", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: "{}",
          }).then(
            (r) => r.ok,
            () => false,
          );
          if (!ok) return setState("failed");
          if (staffId) {
            writeList(pinKey(staffId), null);
            writeList(recentKey(staffId), null);
          }
          router.replace("/masuk");
          router.refresh(); // drop the client router cache of clinic pages
        }}
      >
        Keluar
      </button>
      {state === "failed" && (
        <p role="alert" className={s.signOutError}>
          Gagal keluar. Periksa koneksi lalu coba lagi.
        </p>
      )}
    </>
  );
}

function Group({
  id,
  label,
  pages,
  current,
  onNavigate,
  children,
}: {
  id: string;
  label: string;
  pages: NavPage[];
  current?: string;
  onNavigate?: () => void;
  children?: React.ReactNode;
}) {
  const hasCurrent = pages.some((p) => p.id === current);
  const [open, setOpen] = useState(hasCurrent || id !== "saya");
  const Icon = GROUP_ICON[id] ?? CircleUser;
  const listId = `grup-${id}-${useId()}`;
  return (
    <section className={s.group}>
      <button type="button" className={s.groupHead} aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen(!open)}>
        <Icon aria-hidden="true" className={s.groupIcon} />
        <span>{label}</span>
        <ChevronDown aria-hidden="true" className={s.chevron} data-open={open} />
      </button>
      {open && (
        <ul id={listId} className={s.pages}>
          {pages.map((p) => (
            <li key={p.id}>
              <Link href={p.href} prefetch={false} className={s.pageLink} aria-current={p.id === current ? "page" : undefined} onClick={onNavigate}>
                {p.label}
              </Link>
            </li>
          ))}
          {children}
        </ul>
      )}
    </section>
  );
}


function TopBar(props: ShellProps & { onSearch: () => void }) {
  const { branches, activeBranchId, tenantWide } = props;
  const current = branches.find((b) => b.id === activeBranchId);
  const branchLabel = current?.name ?? (tenantWide ? "Semua Cabang" : (branches[0]?.name ?? ""));
  return (
    <header className={s.topbar}>
      <div className={s.context}>
        {branches.length > 1 ? (
          <Link className={s.branch} href="/saya/cabang" aria-label={`Ganti cabang. Cabang aktif: ${branchLabel}`}>
            <Building2 aria-hidden="true" />
            <span className={s.branchName}>{branchLabel}</span>
            <ChevronDown aria-hidden="true" />
          </Link>
        ) : (
          <span className={s.branchStatic}>
            <Building2 aria-hidden="true" />
            <span className={s.branchName}>{branchLabel}</span>
          </span>
        )}
        <span className={s.roleLine}>
          {props.name} · {props.roleLabel}
        </span>
      </div>
      <div className={s.actions}>
        <button type="button" data-shell-search className={s.searchSlot} onClick={props.onSearch} aria-label="Cari halaman, pasien atau aksi" aria-keyshortcuts="Control+K Meta+K">
          <Search aria-hidden="true" />
          <span className={s.searchText}>Cari</span>
          <kbd className={s.kbd}>⌘K</kbd>
        </button>
        {quickActionsFor(props.role).length > 0 && (
          <button type="button" className={s.iconButton} onClick={props.onSearch} aria-label="Aksi cepat">
            <Plus aria-hidden="true" />
          </button>
        )}
        {hasInbox(props.role) && (
          <Link className={s.iconButton} href="/pesan" aria-label="Pesan">
            <MessageCircle aria-hidden="true" />
          </Link>
        )}
        <Link className={s.iconButton} href="/saya/notifikasi" aria-label="Notifikasi">
          <Bell aria-hidden="true" />
        </Link>
        <Link className={s.iconButton} href="/saya/keamanan" aria-label={`Akun ${props.name}`}>
          <CircleUser aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}

function MenuSheet(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groups: NavGroup[];
  saya: NavPage[];
  all: NavPage[];
  recent: string[];
  current?: string;
  staffId: string;
  onCloseAutoFocus: (e: Event) => void;
}) {
  const [q, setQ] = useState("");
  const PIN_KEY = pinKey(props.staffId);
  const pinned = useList(PIN_KEY);
  const byId = new Map(props.all.map((p) => [p.id, p]));
  const pinnedPages = pinned.map((id) => byId.get(id)).filter((p): p is NavPage => !!p);
  const recentPages = props.recent.map((id) => byId.get(id)).filter((p): p is NavPage => !!p);
  const close = () => props.onOpenChange(false);
  const togglePin = (id: string) =>
    writeList(PIN_KEY, pinned.includes(id) ? pinned.filter((x) => x !== id) : [id, ...pinned].slice(0, 8));
  const hits = matchPages(props.all, q);
  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={s.overlay} />
        <DialogPrimitive.Content className={s.sheet} aria-describedby={undefined} onCloseAutoFocus={props.onCloseAutoFocus}>
          <div className={s.sheetHead}>
            <DialogPrimitive.Title className={s.sheetTitle}>Menu</DialogPrimitive.Title>
            <DialogPrimitive.Close className={s.iconButton} aria-label="Tutup menu">
              <X aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <label className={s.searchField}>
            <Search aria-hidden="true" />
            <input type="search" placeholder="Cari halaman" aria-label="Cari halaman" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className={s.sheetBody}>
            {q.trim() ? (
              hits.length === 0 ? (
                <p className={s.empty} role="status">Tidak ada halaman untuk pencarian ini.</p>
              ) : (
                <PageList title="Hasil" pages={hits} pinned={pinned} onPin={togglePin} onNavigate={close} current={props.current} />
              )
            ) : (
              <>
                {pinnedPages.length > 0 && <PageList title="Disematkan" pages={pinnedPages} pinned={pinned} onPin={togglePin} onNavigate={close} current={props.current} />}
                {recentPages.length > 0 && <PageList title="Terakhir dibuka" icon pages={recentPages} onNavigate={close} current={props.current} />}
                <Tree groups={props.groups} saya={props.saya} current={props.current} staffId={props.staffId} onNavigate={close} />
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PageList(props: {
  title: string;
  pages: NavPage[];
  current?: string;
  pinned?: string[];
  icon?: boolean;
  onPin?: (id: string) => void;
  onNavigate: () => void;
}) {
  return (
    <section className={s.group}>
      <h2 className={s.listTitle}>{props.title}</h2>
      <ul className={s.pages}>
        {props.pages.map((p) => {
          const isPinned = props.pinned?.includes(p.id);
          return (
            <li key={p.id} className={s.pinRow}>
              <Link href={p.href} prefetch={false} className={s.pageLink} aria-current={p.id === props.current ? "page" : undefined} onClick={props.onNavigate}>
                {props.icon && <Clock aria-hidden="true" className={s.groupIcon} />}
                {p.label}
              </Link>
              {props.onPin && (
                <button type="button" className={s.iconButton} aria-pressed={isPinned} aria-label={`${isPinned ? "Lepas sematan" : "Sematkan"} ${p.label}`} onClick={() => props.onPin!(p.id)}>
                  {isPinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Command palette (NAV-2): pages and quick actions now; patients (PR-76) join when the
// patient search exists.
function Palette(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  all: NavPage[];
  quick: { id: string; label: string; href: string }[];
  onCloseAutoFocus: (e: Event) => void;
}) {
  const [q, setQ] = useState("");
  const hits = matchPages(props.all, q).slice(0, 12);
  const actions = props.quick.filter((a) => a.label.toLocaleLowerCase("id").includes(q.trim().toLocaleLowerCase("id")));
  const close = () => props.onOpenChange(false);
  return (
    <DialogPrimitive.Root
      open={props.open}
      onOpenChange={(o) => {
        if (!o) setQ("");
        props.onOpenChange(o);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={s.overlay} />
        <DialogPrimitive.Content className={s.palette} aria-describedby={undefined} onCloseAutoFocus={props.onCloseAutoFocus}>
          <DialogPrimitive.Title className={s.srOnly}>Cari</DialogPrimitive.Title>
          <label className={s.searchField}>
            <Search aria-hidden="true" />
            <input autoFocus type="search" placeholder="Cari halaman atau aksi" aria-label="Cari halaman atau aksi" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className={s.paletteBody}>
            {actions.length > 0 && (
              <section className={s.group}>
                <h2 className={s.listTitle}>Aksi cepat</h2>
                <ul className={s.pages}>
                  {actions.map((a) => (
                    <li key={a.id}>
                      <Link href={a.href} prefetch={false} className={s.pageLink} onClick={close}>
                        <Plus aria-hidden="true" className={s.groupIcon} />
                        {a.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {hits.length > 0 ? (
              <section className={s.group}>
                <h2 className={s.listTitle}>Halaman</h2>
                <ul className={s.pages}>
                  {hits.map((p) => (
                    <li key={p.id}>
                      <Link href={p.href} prefetch={false} className={s.pageLink} onClick={close}>
                        {p.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              actions.length === 0 && <p className={s.empty} role="status">Tidak ada hasil untuk pencarian ini.</p>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
