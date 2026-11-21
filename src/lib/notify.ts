import connectDB from "./db";
import Notification from "@/models/Notification";
import Vehicle from "@/models/Vehicle";
import Booking from "@/models/Booking";
import InsurancePolicy from "@/models/InsurancePolicy";
import AgencySetting from "@/models/AgencySetting";
import { ensureAllUnits } from "./fleetUnits";

type L10n = { fr: string; en: string; ar: string };

export interface StaffNotificationInput {
  type: string;
  category?: "booking" | "maintenance" | "payment" | "system" | "reminder";
  severity?: "info" | "success" | "warning" | "critical";
  title: L10n;
  message: L10n;
  link?: string;
  data?: Record<string, unknown>;
  /** Same key = same alert: it is created only once. */
  dedupeKey?: string;
  scheduledFor?: Date;
  createdBy?: string;
}

const PRIORITY: Record<string, "high" | "medium" | "low"> = {
  critical: "high",
  warning: "high",
  info: "medium",
  success: "low",
};

function inferCategory(type: string): StaffNotificationInput["category"] {
  if (/vidange|maintenance|inspection|insurance|garage/.test(type)) return "maintenance";
  if (/payment|paid/.test(type)) return "payment";
  if (/reminder/.test(type)) return "reminder";
  if (/booking|pickup|return|modification|extension/.test(type)) return "booking";
  return "system";
}

/**
 * Creates one notification shared by the whole back-office team.
 * Never throws: a notification failure must not break the business action that triggered it.
 */
export async function notifyStaff(input: StaffNotificationInput): Promise<boolean> {
  try {
    await connectDB();
    const severity = input.severity || "info";
    const doc = {
      recipientType: "staff" as const,
      type: input.type,
      category: input.category || inferCategory(input.type),
      severity,
      priority: PRIORITY[severity],
      title: input.title,
      message: input.message,
      link: input.link,
      data: input.data,
      isRead: false,
      scheduledFor: input.scheduledFor,
      createdBy: input.createdBy,
    };
    if (input.dedupeKey) {
      const res = await Notification.updateOne(
        { dedupeKey: input.dedupeKey },
        { $setOnInsert: { ...doc, dedupeKey: input.dedupeKey } },
        { upsert: true }
      );
      return res.upsertedCount > 0;
    }
    await Notification.create(doc);
    return true;
  } catch (err) {
    // Duplicate key on a concurrent upsert = alert already exists.
    if ((err as { code?: number })?.code !== 11000) console.error("notifyStaff failed:", err);
    return false;
  }
}

/* ───────────────────────── Alert thresholds (configurable) ───────────────────────── */

export interface AlertSettings {
  vidangeKmThreshold: number;
  inspectionDaysThreshold: number;
  insuranceDaysThreshold: number;
  enabled: {
    vidange: boolean;
    inspection: boolean;
    insurance: boolean;
    maintenance: boolean;
    pickups: boolean;
    returns: boolean;
  };
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  vidangeKmThreshold: 2000,
  inspectionDaysThreshold: 30,
  insuranceDaysThreshold: 30,
  enabled: { vidange: true, inspection: true, insurance: true, maintenance: true, pickups: true, returns: true },
};

export async function getAlertSettings(): Promise<AlertSettings> {
  await connectDB();
  const row = await AgencySetting.findOne({ key: "alertSettings" }).lean();
  const v = (row?.value || {}) as Partial<AlertSettings>;
  return {
    ...DEFAULT_ALERT_SETTINGS,
    ...v,
    enabled: { ...DEFAULT_ALERT_SETTINGS.enabled, ...(v.enabled || {}) },
  };
}

export async function saveAlertSettings(value: Partial<AlertSettings>, userId?: string): Promise<AlertSettings> {
  const current = await getAlertSettings();
  const next: AlertSettings = {
    vidangeKmThreshold: clampNum(value.vidangeKmThreshold, current.vidangeKmThreshold, 100, 50000),
    inspectionDaysThreshold: clampNum(value.inspectionDaysThreshold, current.inspectionDaysThreshold, 1, 365),
    insuranceDaysThreshold: clampNum(value.insuranceDaysThreshold, current.insuranceDaysThreshold, 1, 365),
    enabled: { ...current.enabled, ...(value.enabled || {}) },
  };
  await AgencySetting.findOneAndUpdate(
    { key: "alertSettings" },
    {
      $set: { value: next, group: "notifications", label: "Seuils des alertes", type: "json", ...(userId ? { updatedBy: userId } : {}) },
    },
    { upsert: true }
  );
  return next;
}

function clampNum(v: unknown, fallback: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/* ───────────────────────── Automatic fleet & booking alerts ───────────────────────── */

const DAY = 86_400_000;
let lastRun = 0;
let running: Promise<number> | null = null;

function fmtDate(d: Date) {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Scans the fleet and the bookings and raises alerts that do not exist yet.
 * Throttled (default once per 2 minutes per server instance); deduplicated in the database,
 * so concurrent instances never create the same alert twice.
 */
export async function runFleetAlerts(opts: { force?: boolean; minIntervalMs?: number } = {}): Promise<number> {
  const interval = opts.minIntervalMs ?? 120_000;
  if (!opts.force && Date.now() - lastRun < interval) return 0;
  if (running) return running;
  lastRun = Date.now();
  // Customer reminders piggy-back on the same heartbeat (at most hourly) when no cron calls them.
  import("./reminders").then((m) => m.runRemindersThrottled()).catch(() => {});
  running = doRunFleetAlerts().finally(() => {
    running = null;
  });
  return running;
}

async function doRunFleetAlerts(): Promise<number> {
  await connectDB();
  const settings = await getAlertSettings();
  let created = 0;
  const now = new Date();

  await ensureAllUnits();
  const vehicles = await Vehicle.find({ status: { $ne: "archived" }, isActive: true })
    .select("brand model units")
    .lean();

  // Current insurance policy (latest, not renewed, not cancelled) of each car.
  const policies = await InsurancePolicy.find({ cancelled: { $ne: true }, renewedBy: { $exists: false } })
    .select("unitId endDate")
    .sort({ endDate: -1 })
    .lean();
  const policyEnd = new Map<string, Date>();
  for (const p of policies) if (!policyEnd.has(String(p.unitId))) policyEnd.set(String(p.unitId), p.endDate);

  for (const v of vehicles) {
    const name = `${v.brand} ${v.model}`;
    for (const [i, u] of (v.units || []).entries()) {
      if (u.status === "out_of_service") continue;
      const plate = u.licensePlate || `${name} #${i + 1}`;
      const uid = String(u._id);
      const link = `/admin/garage?unit=${uid}`;

      // ── Vidange (oil change) by mileage
      if (settings.enabled.vidange) {
        const next = Number(u.nextVidangeMileage || 0);
        const remaining = next - Number(u.mileage || 0);
        if (next > 0 && remaining <= 0) {
          created += Number(
            await notifyStaff({
              type: "vidange_overdue",
              severity: "critical",
              dedupeKey: `vidange:${uid}:${next}:overdue`,
              title: { fr: `Vidange dépassée — ${plate}`, en: `Oil change overdue — ${plate}`, ar: `تجاوز موعد تغيير الزيت — ${plate}` },
              message: {
                fr: `${name} (${plate}) a dépassé sa vidange de ${Math.abs(remaining).toLocaleString("fr-FR")} km (prévue à ${next.toLocaleString("fr-FR")} km).`,
                en: `${name} (${plate}) is ${Math.abs(remaining).toLocaleString("en-US")} km past its oil change (due at ${next.toLocaleString("en-US")} km).`,
                ar: `${name} (${plate}) تجاوزت موعد تغيير الزيت بـ ${Math.abs(remaining)} كم.`,
              },
              link,
              data: { vehicleId: String(v._id), unitId: uid, licensePlate: plate, remainingKm: remaining },
            })
          );
        } else if (next > 0 && remaining <= settings.vidangeKmThreshold) {
          created += Number(
            await notifyStaff({
              type: "vidange_due",
              severity: "warning",
              dedupeKey: `vidange:${uid}:${next}:soon`,
              title: { fr: `Vidange dans ${remaining.toLocaleString("fr-FR")} km — ${plate}`, en: `Oil change in ${remaining.toLocaleString("en-US")} km — ${plate}`, ar: `تغيير الزيت خلال ${remaining} كم — ${plate}` },
              message: {
                fr: `Le véhicule ${name} immatriculé ${plate} nécessite une vidange dans ${remaining.toLocaleString("fr-FR")} km (à ${next.toLocaleString("fr-FR")} km).`,
                en: `${name} plate ${plate} needs an oil change in ${remaining.toLocaleString("en-US")} km (at ${next.toLocaleString("en-US")} km).`,
                ar: `السيارة ${name} رقم ${plate} تحتاج إلى تغيير الزيت خلال ${remaining} كم.`,
              },
              link,
              data: { vehicleId: String(v._id), unitId: uid, licensePlate: plate, remainingKm: remaining },
            })
          );
        }
      }

      // ── Visite technique
      if (settings.enabled.inspection && u.technicalInspectionDate) {
        const due = new Date(u.technicalInspectionDate);
        const days = Math.ceil((due.getTime() - now.getTime()) / DAY);
        if (days < 0) {
          created += Number(
            await notifyStaff({
              type: "inspection_overdue",
              severity: "critical",
              dedupeKey: `inspection:${uid}:${dayKey(due)}:overdue`,
              title: { fr: `Visite technique expirée — ${plate}`, en: `Technical inspection expired — ${plate}`, ar: `انتهت صلاحية الفحص الفني — ${plate}` },
              message: {
                fr: `La visite technique de ${name} (${plate}) a expiré le ${fmtDate(due)}. Le véhicule ne doit pas circuler.`,
                en: `Technical inspection of ${name} (${plate}) expired on ${fmtDate(due)}.`,
                ar: `انتهى الفحص الفني لـ ${name} (${plate}) بتاريخ ${fmtDate(due)}.`,
              },
              link: `/admin/garage?tab=inspection&unit=${uid}`,
              data: { vehicleId: String(v._id), unitId: uid, licensePlate: plate },
            })
          );
        } else if (days <= settings.inspectionDaysThreshold) {
          created += Number(
            await notifyStaff({
              type: "inspection_due",
              severity: "warning",
              dedupeKey: `inspection:${uid}:${dayKey(due)}:soon`,
              title: { fr: `Visite technique dans ${days} j — ${plate}`, en: `Inspection in ${days} days — ${plate}`, ar: `الفحص الفني خلال ${days} يوم — ${plate}` },
              message: {
                fr: `La visite technique de ${name} (${plate}) est à faire avant le ${fmtDate(due)}.`,
                en: `Technical inspection of ${name} (${plate}) is due before ${fmtDate(due)}.`,
                ar: `يجب إجراء الفحص الفني لـ ${name} (${plate}) قبل ${fmtDate(due)}.`,
              },
              link: `/admin/garage?tab=inspection&unit=${uid}`,
              data: { vehicleId: String(v._id), unitId: uid, licensePlate: plate, daysLeft: days },
            })
          );
        }
      }

      // ── Assurance: 90 / 60 / 30 days before the end of the current policy, then "expired"
      const insuranceEnd = policyEnd.get(uid) || u.insuranceExpiryDate;
      if (settings.enabled.insurance && insuranceEnd) {
        const due = new Date(insuranceEnd);
        const days = Math.ceil((due.getTime() - now.getTime()) / DAY);
        const expired = days < 0;
        const step = expired ? "expired" : [30, 60, 90].find((t) => days <= t);
        if (step !== undefined) {
          created += Number(
            await notifyStaff({
              type: expired ? "insurance_expired" : "insurance_due",
              severity: expired ? "critical" : step === 90 ? "info" : "warning",
              dedupeKey: `insurance:${uid}:${dayKey(due)}:${step}`,
              title: {
                fr: expired ? `Assurance expirée — ${plate}` : `Assurance expire dans ${days} j — ${plate}`,
                en: expired ? `Insurance expired — ${plate}` : `Insurance expires in ${days} days — ${plate}`,
                ar: expired ? `انتهى التأمين — ${plate}` : `ينتهي التأمين خلال ${days} يوم — ${plate}`,
              },
              message: {
                fr: expired
                  ? `L'assurance de ${name} (${plate}) a expiré le ${fmtDate(due)}. Le véhicule ne doit pas circuler.`
                  : `Assurance de ${name} (${plate}) : échéance le ${fmtDate(due)}. Pensez au renouvellement.`,
                en: `Insurance of ${name} (${plate}) ends on ${fmtDate(due)}.`,
                ar: `تأمين ${name} (${plate}) ينتهي في ${fmtDate(due)}.`,
              },
              link: `/admin/garage?tab=assurance&unit=${uid}`,
              data: { vehicleId: String(v._id), unitId: uid, licensePlate: plate, daysLeft: days },
            })
          );
        }
      }

      // ── Maintenance planned
      if (settings.enabled.maintenance && u.nextMaintenanceDate) {
        const due = new Date(u.nextMaintenanceDate);
        const days = Math.ceil((due.getTime() - now.getTime()) / DAY);
        if (days <= 3) {
          created += Number(
            await notifyStaff({
              type: "maintenance_due",
              severity: days < 0 ? "critical" : "warning",
              dedupeKey: `maintenance:${uid}:${dayKey(due)}`,
              title: { fr: `Entretien prévu — ${plate}`, en: `Maintenance due — ${plate}`, ar: `صيانة مبرمجة — ${plate}` },
              message: {
                fr: `Entretien de ${name} (${plate}) prévu le ${fmtDate(due)}.`,
                en: `Maintenance of ${name} (${plate}) scheduled on ${fmtDate(due)}.`,
                ar: `صيانة ${name} (${plate}) مبرمجة في ${fmtDate(due)}.`,
              },
              link: `/admin/garage?tab=maintenance&unit=${uid}`,
              data: { vehicleId: String(v._id), unitId: uid, licensePlate: plate },
            })
          );
        }
      }
    }
  }

  // ── Bookings: departures / returns today, late returns
  if (settings.enabled.pickups || settings.enabled.returns) {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay.getTime() + DAY);

    const bookings = await Booking.find({
      bookingStatus: { $in: ["confirmed", "awaiting_payment", "paid", "active"] },
      $or: [
        { pickupDate: { $gte: startOfDay, $lt: endOfDay } },
        { returnDate: { $lt: endOfDay, $gte: new Date(now.getTime() - 60 * DAY) } },
      ],
    })
      .select("bookingReference pickupDate returnDate pickupTime returnTime bookingStatus assignedUnits vehicleId")
      .populate("vehicleId", "brand model")
      .lean();

    for (const b of bookings) {
      const veh = b.vehicleId as unknown as { brand?: string; model?: string } | null;
      const name = veh ? `${veh.brand} ${veh.model}` : "Véhicule";
      const plates = (b.assignedUnits || []).filter((a) => !a.to).map((a) => a.licensePlate).filter(Boolean).join(", ");
      const carLabel = plates ? `${name} (${plates})` : name;
      const link = `/admin/bookings/${b._id}`;
      const ref = b.bookingReference;

      if (
        settings.enabled.pickups &&
        b.bookingStatus !== "active" &&
        b.pickupDate >= startOfDay &&
        b.pickupDate < endOfDay
      ) {
        created += Number(
          await notifyStaff({
            type: "pickup_today",
            severity: "info",
            dedupeKey: `pickup:${b._id}:${dayKey(startOfDay)}`,
            title: { fr: `Départ aujourd'hui — ${ref}`, en: `Pickup today — ${ref}`, ar: `استلام اليوم — ${ref}` },
            message: {
              fr: `${carLabel} à remettre aujourd'hui${b.pickupTime ? ` à ${b.pickupTime}` : ""}.`,
              en: `${carLabel} to hand over today${b.pickupTime ? ` at ${b.pickupTime}` : ""}.`,
              ar: `${carLabel} للتسليم اليوم.`,
            },
            link,
            data: { bookingId: String(b._id), bookingReference: ref, licensePlate: plates },
          })
        );
      }

      if (settings.enabled.returns && b.returnDate < endOfDay) {
        const late = b.bookingStatus === "active" && b.returnDate < startOfDay;
        if (b.returnDate >= startOfDay || late) {
          created += Number(
            await notifyStaff({
              type: late ? "return_late" : "return_today",
              severity: late ? "critical" : "info",
              dedupeKey: `return:${b._id}:${late ? "late:" + dayKey(startOfDay) : dayKey(startOfDay)}`,
              title: {
                fr: late ? `Retour en retard — ${ref}` : `Retour aujourd'hui — ${ref}`,
                en: late ? `Late return — ${ref}` : `Return today — ${ref}`,
                ar: late ? `تأخر في الإرجاع — ${ref}` : `إرجاع اليوم — ${ref}`,
              },
              message: {
                fr: late
                  ? `${carLabel} devait être restitué le ${fmtDate(new Date(b.returnDate))}.`
                  : `${carLabel} doit être restitué aujourd'hui${b.returnTime ? ` à ${b.returnTime}` : ""}.`,
                en: late
                  ? `${carLabel} was due back on ${fmtDate(new Date(b.returnDate))}.`
                  : `${carLabel} is due back today${b.returnTime ? ` at ${b.returnTime}` : ""}.`,
                ar: `${carLabel}`,
              },
              link,
              data: { bookingId: String(b._id), bookingReference: ref, licensePlate: plates },
            })
          );
        }
      }
    }
  }

  return created;
}
