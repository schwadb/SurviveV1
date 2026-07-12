import { Bill } from '../types';
import { addMonths, monthKeyOfIso } from '../utils/dates';
import { fmt } from '../utils/money';

export interface ReminderEntry {
  billId: string;
  /** yyyy-mm-dd the notification should fire (at `hour`:00 local). */
  dateIso: string;
  hour: number;
  title: string;
  body: string;
}

const FIRE_HOUR = 9;

/**
 * Pure reminder planner. Emits a due-date reminder for every unpaid bill
 * occurrence within the horizon, plus a 3-days-before heads-up for bills
 * that are not on autopay. `todayIso`/`nowHour` are injected so scheduling
 * and tests are deterministic; entries in the past (or today once past the
 * fire hour) are never emitted.
 */
export function planBillReminders(
  bills: Bill[],
  todayIso: string,
  nowHour: number,
  horizonDays = 60,
): ReminderEntry[] {
  const out: ReminderEntry[] = [];
  const thisMonth = monthKeyOfIso(todayIso);
  const horizonMs = new Date(todayIso).getTime() + horizonDays * 86400000;

  const isFireable = (dateIso: string) =>
    dateIso > todayIso || (dateIso === todayIso && nowHour < FIRE_HOUR);

  for (const bill of bills) {
    // Clamp defensively: restored backups are not re-validated per-field.
    const dueDay = Math.min(28, Math.max(1, Math.round(bill.dueDay)));
    for (let i = 0; i < 3; i++) {
      const m = addMonths(thisMonth, i);
      if (bill.paidMonths.includes(m)) continue;
      const dueIso = `${m}-${String(dueDay).padStart(2, '0')}`;
      if (new Date(dueIso).getTime() > horizonMs) break;
      if (dueIso < todayIso) continue; // overdue: visible in-app, not re-notified

      if (!bill.autopay) {
        const due = new Date(dueIso);
        const headsUp = new Date(due.getTime() - 3 * 86400000);
        const headsUpIso = headsUp.toISOString().slice(0, 10);
        if (isFireable(headsUpIso)) {
          out.push({
            billId: bill.id,
            dateIso: headsUpIso,
            hour: FIRE_HOUR,
            title: 'Bill coming up',
            body: `${bill.name} · ${fmt(bill.amount)} due in 3 days`,
          });
        }
      }

      if (isFireable(dueIso)) {
        out.push({
          billId: bill.id,
          dateIso: dueIso,
          hour: FIRE_HOUR,
          title: 'Bill due today',
          body: `${bill.name} · ${fmt(bill.amount)} is due today${bill.autopay ? ' (autopay)' : ''}`,
        });
      }
      break; // only the next unpaid occurrence per bill
    }
  }
  return out.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}
