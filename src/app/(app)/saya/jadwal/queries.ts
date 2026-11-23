// Jadwal Saya reads (HYG-NAV-1): the caller's own shifts and leave, every branch, under RLS (staff_shifts_read / staff_leave_read allow
// staff_id = app_staff_id() for every role, migration 0060). Shared by data.ts and the isolation case (tests/isolation/cases/hyg-nav-1).
import type pg from "pg";
import type { Leave, Shift } from "./model";

export async function myShifts(db: pg.ClientBase, from: string, to: string): Promise<Shift[]> {
  return (await db.query<Shift>(
    `select to_char(s.shift_date, 'YYYY-MM-DD') as date, to_char(s.starts, 'HH24:MI') as starts,
            case when s.ends = time '23:59:59.999999' then '24:00' else to_char(s.ends, 'HH24:MI') end as ends, s.kind, b.name as branch
       from staff_shifts s join branches b on b.tenant_id = s.tenant_id and b.id = s.branch_id
      where s.staff_id = app_staff_id() and s.shift_date between $1::date and $2::date order by s.shift_date, s.starts`, [from, to])).rows;
}
export async function myLeave(db: pg.ClientBase, from: string, to: string): Promise<Leave[]> {
  return (await db.query<Leave>(
    `select to_char(l.from_date, 'YYYY-MM-DD') as "from", to_char(l.to_date, 'YYYY-MM-DD') as "to", l.kind, b.name as branch
       from staff_leave l join branches b on b.tenant_id = l.tenant_id and b.id = l.branch_id
      where l.staff_id = app_staff_id() and l.cancelled_at is null and l.from_date <= $2::date and l.to_date >= $1::date order by l.from_date`, [from, to])).rows;
}
