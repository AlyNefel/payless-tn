import mongoose from "mongoose";
import connectDB from "./db";
import { Booking, Vehicle } from "@/models";
import type { IAssignedUnit } from "@/models/Booking";
import { computeRentalDays } from "./extras";
import { rentalDaysPrice } from "./seasonalPricing";
import { getRentalRules, priceSource } from "./rentalRules";
import { HOLDING_STATUSES } from "./bookingOverlap";
import { claimUnit, holdDays, listUnitAvailability, reassignBookingsOfUnit, segmentDays, syncBookingAssignment, unitLabel } from "./fleetUnits";
import { bookingMoney, resyncAfterPriceChange } from "./ledger";
import { notifyStaff } from "./notify";
import { fmtDay, notifyCustomerOfChange } from "./customerNotify";

export interface ChangeVehicleInput {
  /** Which car of the booking (0 for a single-car booking). */
  lineIndex: number;
  /** First day with the new car (YYYY-MM-DD). The pickup day = the whole rental. */
  effectiveDate: string;
  newVehicleId: string;
  /** Physical car; the free car with the lowest mileage when empty. */
  newUnitId?: string;
  /** "recalculate": the new model's price from the change date. "keep": the agency keeps the price. */
  priceMode: "recalculate" | "keep";
  oldCarMileage?: number;
  newCarMileage?: number;
  /** The replaced car goes to the garage (breakdown, accident). */
  oldCarToGarage?: boolean;
  reason: string;
  notifyCustomer: boolean;
  dryRun?: boolean;
}

export class ChangeError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const tnd = (m: number) => `${(m / 100).toFixed(3)} DT`;
const dayOf = (d: Date | string) => holdDays(d, d)[0];
const utcMidnight = (day: string) => new Date(`${day}T00:00:00.000Z`);

/**
 * Changes the car of a booking, possibly in the middle of the rental:
 *  - before the change date the old car is kept (its days stay held, it is history afterwards),
 *  - from the change date the new physical car is claimed atomically,
 *  - the price difference applies to the remaining days only, and the balance or the amount owed
 *    back to the customer comes from the payment ledger,
 *  - the customer is notified (email + WhatsApp link), the team too.
 * With `dryRun` nothing is written: the quote and the free cars are returned.
 */
export async function changeVehicle(bookingId: string, input: ChangeVehicleInput, by: string) {
  await connectDB();
  if (!mongoose.Types.ObjectId.isValid(bookingId)) throw new ChangeError("Réservation introuvable", 404);
  if (!mongoose.Types.ObjectId.isValid(input.newVehicleId)) throw new ChangeError("Modèle invalide");
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new ChangeError("Réservation introuvable", 404);
  if (!(HOLDING_STATUSES as string[]).includes(booking.bookingStatus)) {
    throw new ChangeError("Seule une réservation en cours ou à venir peut changer de voiture.", 409);
  }

  // ── Which car is replaced ──
  const pb = booking.pricingBreakdown;
  const lines =
    booking.vehicles && booking.vehicles.length > 0
      ? booking.vehicles.map((v) => ({ vehicleId: String(v.vehicleId), dailyRate: v.dailyRate, subtotal: v.subtotal, depositAmount: v.depositAmount }))
      : [{ vehicleId: String(booking.vehicleId), dailyRate: pb.dailyRate, subtotal: pb.subtotal, depositAmount: pb.depositAmount }];
  const i = input.lineIndex;
  if (!Number.isInteger(i) || i < 0 || i >= lines.length) throw new ChangeError("Voiture de la réservation introuvable.");
  const oldModelId = lines[i].vehicleId;
  const nth = lines.slice(0, i).filter((l) => l.vehicleId === oldModelId).length;
  const current = (booking.assignedUnits || []).filter((a) => !a.to && String(a.vehicleId) === oldModelId)[nth];

  const [oldModel, newModel] = await Promise.all([
    Vehicle.findById(oldModelId).select("brand model pricing units").lean(),
    Vehicle.findById(input.newVehicleId),
  ]);
  if (!newModel || !newModel.isActive || ["archived", "unavailable"].includes(newModel.status)) {
    throw new ChangeError("Ce modèle n'est pas disponible à la location.", 409);
  }
  const oldName = `${oldModel?.brand || ""} ${oldModel?.model || ""}`.trim() || "Véhicule";
  const newName = `${newModel.brand} ${newModel.model}`;

  // ── Change date ──
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) throw new ChangeError("Date du changement invalide.");
  const pickupDay = dayOf(booking.pickupDate);
  const returnDay = dayOf(booking.returnDate);
  const eff = input.effectiveDate < pickupDay ? pickupDay : input.effectiveDate;
  if (eff >= returnDay) throw new ChangeError(`Le changement doit avoir lieu avant le jour du retour (${fmtDay(booking.returnDate, "fr")}).`);
  if (current?.from && eff <= dayOf(current.from)) {
    throw new ChangeError(`Cette voiture a déjà été changée le ${fmtDay(current.from, "fr")} : choisissez une date ultérieure.`);
  }
  const lastChange = (booking.vehicleChanges || []).filter((c) => c.lineIndex === i).slice(-1)[0];
  if (lastChange && eff <= dayOf(lastChange.effectiveDate)) {
    throw new ChangeError(`Un changement existe déjà le ${fmtDay(lastChange.effectiveDate, "fr")} : choisissez une date ultérieure.`);
  }
  // A split rental only when the old car was really used (or will be) for some days.
  const split = eff > pickupDay;
  const effDate = split ? utcMidnight(eff) : new Date(booking.pickupDate);

  // ── New physical car ──
  const candidates = (await listUnitAvailability(input.newVehicleId, effDate, booking.returnDate, bookingId)).filter(
    (u) => u.unitId !== String(current?.unitId || "")
  );
  const free = candidates.filter((u) => u.free).sort((a, b) => a.mileage - b.mileage);
  const unit = input.newUnitId ? candidates.find((u) => u.unitId === input.newUnitId) : free[0];
  if (input.newUnitId) {
    if (!unit) throw new ChangeError("Cette voiture n'appartient pas au modèle choisi ou c'est déjà la voiture actuelle.");
    if (!unit.free) throw new ChangeError(`${unit.label} n'est pas libre du ${fmtDay(effDate, "fr")} au ${fmtDay(booking.returnDate, "fr")}.`, 409, "UNIT_NOT_FREE");
  }
  if (String(input.newVehicleId) === oldModelId && !candidates.length) {
    throw new ChangeError("Ce modèle n'a pas d'autre voiture.", 409);
  }

  // ── Price ──
  const totalDays = pb.rentalDays || booking.rentalDuration || computeRentalDays(booking.pickupDate, booking.returnDate);
  const daysChanged = split ? computeRentalDays(eff, returnDay) : totalDays;
  const oldDaily = Number(lines[i].dailyRate || pb.dailyRate || 0);
  const rules = await getRentalRules();
  // Mixed price: each changed day at the rate of the period it falls in, with the model's
  // degressive tariff for the full duration of the rental.
  const firstChanged = Math.max(0, totalDays - daysChanged);
  const newList = rentalDaysPrice(priceSource(newModel, rules), pickupDay, firstChanged, totalDays, totalDays);
  // What the old car costs for those days: its stored average rate (custom prices kept), weighted
  // by the periods of the changed days versus the days that average covers.
  let oldSpan = oldDaily * daysChanged;
  if (oldModel) {
    const src = priceSource(oldModel, rules);
    const refFrom = lastChange ? Math.max(0, totalDays - computeRentalDays(lastChange.effectiveDate, booking.returnDate)) : 0;
    const refList = rentalDaysPrice(src, pickupDay, refFrom, totalDays, totalDays);
    const spanList = rentalDaysPrice(src, pickupDay, firstChanged, totalDays, totalDays);
    // Before any change the line's own subtotal is exact (the average rate is rounded).
    const refAmount = !lastChange && Number(lines[i].subtotal) > 0 ? Number(lines[i].subtotal) : oldDaily * (totalDays - refFrom);
    if (refList > 0) oldSpan = Math.round((refAmount * spanList) / refList);
  }
  const newSpan = input.priceMode === "keep" ? oldSpan : newList || Number(newModel.pricing?.daily || 0) * daysChanged;
  const listDaily = daysChanged > 0 ? Math.round((newList || Number(newModel.pricing?.daily || 0) * daysChanged) / daysChanged) : 0;
  const newDaily = daysChanged > 0 ? Math.round(newSpan / daysChanged) : oldDaily;
  const amount = newSpan - oldSpan;
  const newTotal = Math.max(0, (pb.totalAmount || 0) + amount);
  const before = await bookingMoney(bookingId, pb.totalAmount || 0);
  const paid = before.paid;
  const quote = {
    oldModel: oldName,
    newModel: newName,
    effectiveDate: eff,
    split,
    totalDays,
    daysChanged,
    oldDailyRate: oldDaily,
    newDailyRate: newDaily,
    listDailyRate: listDaily,
    amount,
    oldTotal: pb.totalAmount || 0,
    newTotal,
    paid,
    remaining: Math.max(0, newTotal - paid),
    refundDue: Math.max(0, paid - newTotal),
    newDeposit: input.priceMode === "recalculate" ? Number(newModel.pricing?.deposit || 0) : Number(lines[i].depositAmount || pb.depositAmount || 0),
    depositHeld: before.depositHeld,
    unit: unit ? { unitId: unit.unitId, label: unit.label } : null,
    units: candidates.map((u) => ({ unitId: u.unitId, label: u.label, free: u.free, status: u.status, mileage: u.mileage })),
  };
  if (input.dryRun) return { quote };
  if (!unit) {
    throw new ChangeError(`Aucune ${newName} n'est libre du ${fmtDay(effDate, "fr")} au ${fmtDay(booking.returnDate, "fr")}.`, 409, "NO_FREE_UNIT");
  }
  if (!input.reason.trim()) throw new ChangeError("Indiquez le motif du changement.");

  // ── Mileage checks ──
  const started = booking.bookingStatus === "active";
  if (typeof input.oldCarMileage === "number" && typeof booking.pickupMileage === "number" && input.oldCarMileage < booking.pickupMileage) {
    throw new ChangeError(`Kilométrage de la voiture rendue inférieur au départ (${booking.pickupMileage} km).`);
  }

  // ── Claim the new car first: nothing changes if another booking takes it meanwhile ──
  const newDays = segmentDays(booking, split ? { from: effDate } : {});
  if (!(await claimUnit(bookingId, input.newVehicleId, unit.unitId, newDays))) {
    throw new ChangeError(`${unit.label} vient d'être réservée par une autre réservation. Choisissez une autre voiture.`, 409, "UNIT_NOT_FREE");
  }

  const newUnitDoc = newModel.units?.find((u) => String(u._id) === unit!.unitId);
  const oldUnits = (oldModel?.units || []) as { _id: unknown; licensePlate?: string }[];
  const oldUnitIndex = oldUnits.findIndex((u) => String(u._id) === String(current?.unitId || ""));
  const oldLabel = current ? unitLabel(oldUnits[oldUnitIndex] as never, oldUnitIndex >= 0 ? oldUnitIndex : undefined) : "";

  // ── Assignments: old car keeps [pickup, change), new car takes [change, return) ──
  const assigned: IAssignedUnit[] = [...(booking.assignedUnits || [])];
  if (current) {
    const idx = assigned.indexOf(current);
    const plain = (current as unknown as { toObject?: () => IAssignedUnit }).toObject?.() || current;
    if (split) assigned[idx] = { ...plain, to: effDate };
    else assigned.splice(idx, 1);
  }
  assigned.push({
    vehicleId: newModel._id,
    unitId: new mongoose.Types.ObjectId(unit.unitId),
    licensePlate: newUnitDoc?.licensePlate || "",
    auto: false,
    assignedAt: new Date(),
    assignedBy: by,
    ...(split ? { from: effDate } : {}),
  } as IAssignedUnit);
  booking.assignedUnits = assigned as never;

  // ── Booking lines and price ──
  if (booking.vehicles && booking.vehicles.length > 0) {
    const line = booking.vehicles[i];
    line.vehicleId = newModel._id;
    line.brand = newModel.brand;
    line.model = newModel.model;
    line.dailyRate = newDaily;
    line.subtotal = Math.max(0, Number(line.subtotal || 0) + amount);
    line.depositAmount = quote.newDeposit;
  }
  if (i === 0) booking.vehicleId = newModel._id;
  pb.subtotal = Math.max(0, (pb.subtotal || 0) + amount);
  pb.totalAmount = newTotal;
  if (lines.length === 1 && !split) pb.dailyRate = newDaily;
  pb.depositAmount =
    booking.vehicles && booking.vehicles.length > 0
      ? booking.vehicles.reduce((acc, v) => acc + Number(v.depositAmount || 0), 0)
      : quote.newDeposit;
  booking.markModified("pricingBreakdown");
  booking.markModified("vehicles");

  // The odometer of the new car becomes the departure value for the return check.
  if (started && split) {
    booking.pickupMileage = typeof input.newCarMileage === "number" ? input.newCarMileage : undefined;
  }
  booking.vehicleChanges = [
    ...(booking.vehicleChanges || []),
    {
      at: new Date(),
      by,
      lineIndex: i,
      effectiveDate: effDate,
      fromVehicleId: new mongoose.Types.ObjectId(oldModelId),
      fromModel: oldName,
      fromUnitId: current?.unitId,
      fromLabel: oldLabel,
      toVehicleId: newModel._id,
      toModel: newName,
      toUnitId: new mongoose.Types.ObjectId(unit.unitId),
      toLabel: unit.label,
      priceMode: input.priceMode,
      oldDailyRate: oldDaily,
      newDailyRate: newDaily,
      daysChanged,
      amount,
      oldCarMileage: input.oldCarMileage,
      newCarMileage: input.newCarMileage,
      reason: input.reason.trim().slice(0, 500),
      customerNotified: input.notifyCustomer,
    },
  ] as never;
  booking.auditHistory.push({
    action: "Changement de voiture",
    performedBy: by,
    performedByRole: "staff",
    timestamp: new Date(),
    previousValue: { model: oldName, car: oldLabel },
    newValue: { model: newName, car: unit.label, from: eff },
    notes: `${input.reason.trim()} · ${input.priceMode === "keep" ? "prix conservé" : `${amount >= 0 ? "+" : "−"}${tnd(Math.abs(amount))}`}`,
  });
  await booking.save();

  // Old car: mileage, garage, its days after the change are freed.
  if (current?.unitId && typeof input.oldCarMileage === "number") {
    await Vehicle.updateOne(
      { _id: oldModelId, "units._id": current.unitId, "units.mileage": { $lt: input.oldCarMileage } },
      { $set: { "units.$.mileage": input.oldCarMileage } }
    ).catch(() => {});
  }
  if (typeof input.newCarMileage === "number") {
    await Vehicle.updateOne(
      { _id: newModel._id, "units._id": new mongoose.Types.ObjectId(unit.unitId), "units.mileage": { $lt: input.newCarMileage } },
      { $set: { "units.$.mileage": input.newCarMileage } }
    ).catch(() => {});
  }
  await syncBookingAssignment(bookingId);
  let movedElsewhere: { moved: string[]; unassigned: string[] } = { moved: [], unassigned: [] };
  if (input.oldCarToGarage && current?.unitId) {
    await Vehicle.updateOne({ _id: oldModelId, "units._id": current.unitId }, { $set: { "units.$.status": "maintenance" } });
    movedElsewhere = await reassignBookingsOfUnit(String(current.unitId));
  }
  await resyncAfterPriceChange(bookingId);
  const money = await bookingMoney(bookingId, newTotal);

  await notifyStaff({
    type: "vehicle_change",
    category: "booking",
    severity: movedElsewhere.unassigned.length ? "critical" : "info",
    title: {
      fr: `Changement de voiture — ${booking.bookingReference}`,
      en: `Car changed — ${booking.bookingReference}`,
      ar: `تغيير السيارة — ${booking.bookingReference}`,
    },
    message: {
      fr: `${oldName}${oldLabel ? ` (${oldLabel})` : ""} → ${newName} (${unit.label}) à partir du ${fmtDay(effDate, "fr")}. ${
        money.refundDue > 0 ? `À rembourser au client : ${tnd(money.refundDue)}.` : money.remaining > 0 ? `Reste à encaisser : ${tnd(money.remaining)}.` : "Location soldée."
      }${movedElsewhere.unassigned.length ? ` ⚠ Sans voiture après la mise au garage : ${movedElsewhere.unassigned.join(", ")}.` : ""}`,
      en: `${oldName} → ${newName} from ${eff}.`,
      ar: `${oldName} → ${newName}`,
    },
    link: `/admin/bookings/${bookingId}`,
    data: { bookingId, refundDue: money.refundDue, remaining: money.remaining },
  });

  let customer: { emailSent: boolean; whatsappUrl: string | null } = { emailSent: false, whatsappUrl: null };
  if (input.notifyCustomer) {
    const when = (l: "fr" | "en" | "ar") => fmtDay(effDate, l);
    customer = await notifyCustomerOfChange(bookingId, {
      kind: "vehicle_change",
      lines: {
        fr: [
          split
            ? `À partir du ${when("fr")}, votre ${oldName} est remplacée par une ${newName}.`
            : `Votre véhicule pour cette location est désormais une ${newName} (à la place de ${oldName}).`,
          input.priceMode === "keep" || amount === 0
            ? "Le prix de votre location ne change pas."
            : `Ajustement de prix : ${amount > 0 ? "+" : "−"}${tnd(Math.abs(amount))} (${daysChanged} jour(s) au tarif du nouveau véhicule).`,
        ],
        en: [
          split ? `From ${when("en")}, your ${oldName} is replaced by a ${newName}.` : `Your car for this rental is now a ${newName} (instead of ${oldName}).`,
          input.priceMode === "keep" || amount === 0
            ? "The price of your rental does not change."
            : `Price adjustment: ${amount > 0 ? "+" : "−"}${tnd(Math.abs(amount))} (${daysChanged} day(s) at the new car's rate).`,
        ],
        ar: [
          split ? `ابتداءً من ${when("ar")}، تم تعويض ${oldName} بسيارة ${newName}.` : `سيارتكم لهذا الإيجار أصبحت ${newName} عوضًا عن ${oldName}.`,
          input.priceMode === "keep" || amount === 0 ? "سعر الإيجار لا يتغير." : `تعديل السعر: ${amount > 0 ? "+" : "−"}${tnd(Math.abs(amount))}`,
        ],
      },
      total: money.total,
      paid: money.paid,
      remaining: money.remaining,
      refundDue: money.refundDue,
    });
  }
  return { quote, money, customer, movedElsewhere, booking };
}
