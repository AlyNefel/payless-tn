import mongoose from "mongoose";
import connectDB from "./db";
import { Booking, Payment } from "@/models";
import { readPrivateFileByUrl } from "@/lib/privateFiles";
import type { IBillingInfo, IBooking, IDriverIdentity } from "@/models/Booking";
import { nextNumber } from "@/models/Counter";
import { getCompanyInfo, type ContractData, type InvoiceData } from "./pdfDocs";
import { bookingMoney, getVatRate, splitVat, PAYMENT_METHOD_LABELS } from "./ledger";
import { getPublicSettings } from "./publicSettings";

type Populated = {
  customerId?: { firstName?: string; lastName?: string; phone?: string; address?: string; city?: string; country?: string; passportNumber?: string; dateOfBirth?: Date; drivingLicence?: { number?: string; country?: string; issueYear?: number } } | null;
  vehicleId?: { brand?: string; model?: string; fuelType?: string; transmission?: string; category?: string; categoryId?: { name?: { fr?: string } } } | null;
  pickupLocationId?: { name?: { fr?: string } | string } | null;
  returnLocationId?: { name?: { fr?: string } | string } | null;
};

const locName = (l: Populated["pickupLocationId"]) => (typeof l?.name === "string" ? l.name : l?.name?.fr || "");
const FUEL: Record<string, string> = { petrol: "Essence", essence: "Essence", gasoline: "Essence", diesel: "Diesel", hybrid: "Hybride", electric: "Électrique" };
const GEAR: Record<string, string> = { manual: "Manuelle", automatic: "Automatique" };

export async function loadBookingForDocs(id: string) {
  await connectDB();
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Booking.findById(id)
    .populate("customerId")
    .populate({ path: "vehicleId", populate: { path: "categoryId" } })
    .populate("pickupLocationId", "name")
    .populate("returnLocationId", "name");
}

/** Driver identity pre-filled from the customer record, overridden by what was typed for the contract. */
export function defaultDriver(booking: IBooking): IDriverIdentity {
  const c = (booking as unknown as Populated).customerId;
  const saved = (booking.contract?.driver || {}) as IDriverIdentity;
  const clean = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(saved))).filter(([, v]) => v !== "" && v != null));
  return {
    fullName: `${c?.firstName || ""} ${c?.lastName || ""}`.trim(),
    birthDate: c?.dateOfBirth ? new Date(c.dateOfBirth).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "",
    nationality: c?.country || "",
    address: [c?.address, c?.city].filter(Boolean).join(", "),
    phone: c?.phone || "",
    idType: c?.passportNumber ? "passport" : "cin",
    idNumber: c?.passportNumber || "",
    licenceNumber: c?.drivingLicence?.number || "",
    licenceIssuedAt: c?.drivingLicence?.issueYear ? String(c.drivingLicence.issueYear) : "",
    licenceIssuedIn: c?.drivingLicence?.country || "",
    ...clean,
  } as IDriverIdentity;
}

/** Gives the booking its contract number the first time (never changes afterwards). */
export async function ensureContractNumber(booking: IBooking, by: string): Promise<string> {
  if (booking.contract?.number) return booking.contract.number;
  const number = await nextNumber("CTR");
  // Guarded write: two simultaneous requests cannot both number the same booking.
  const res = await Booking.updateOne(
    { _id: booking._id, "contract.number": { $exists: false } },
    { $set: { "contract.number": number, "contract.issuedAt": new Date(), "contract.issuedBy": by } }
  );
  if (res.modifiedCount === 0) {
    const fresh = await Booking.findById(booking._id).select("contract.number").lean();
    return fresh?.contract?.number || number;
  }
  booking.contract = { ...(booking.contract || {}), number, issuedAt: new Date(), issuedBy: by } as IBooking["contract"];
  return number;
}

export async function ensureInvoiceNumber(booking: IBooking): Promise<string> {
  if (booking.invoiceNumber) return booking.invoiceNumber;
  const number = await nextNumber("FAC");
  const res = await Booking.updateOne({ _id: booking._id, invoiceNumber: { $exists: false } }, { $set: { invoiceNumber: number, invoiceIssuedAt: new Date() } });
  if (res.modifiedCount === 0) return (await Booking.findById(booking._id).select("invoiceNumber").lean())?.invoiceNumber || number;
  booking.invoiceNumber = number;
  booking.invoiceIssuedAt = new Date();
  return number;
}

async function signatureDataUrl(url?: string): Promise<string | undefined> {
  try {
    const file = await readPrivateFileByUrl(url);
    if (!file || file.doc.contentType !== "image/png") return undefined;
    return `data:image/png;base64,${file.data.toString("base64")}`;
  } catch (err) {
    // The contract still prints, with an empty signature box.
    console.error("Signature unavailable for the contract:", err);
    return undefined;
  }
}

export async function contractData(booking: IBooking): Promise<ContractData> {
  const p = booking as unknown as Populated;
  const pb = booking.pricingBreakdown;
  const [company, money, settings] = await Promise.all([getCompanyInfo(), bookingMoney(String(booking._id), pb.totalAmount || 0), getPublicSettings()]);
  const v = p.vehicleId;
  const lines = booking.vehicles && booking.vehicles.length ? booking.vehicles : [{ vehicleId: booking.vehicleId, brand: v?.brand, model: v?.model }];
  // Current cars (a car replaced during the rental is listed in the change history).
  const plates = (booking.assignedUnits || []).filter((a) => !a.to);
  const cars = lines.map((l, i) => {
    const plate = plates.filter((a) => String(a.vehicleId) === String((l as { vehicleId?: unknown }).vehicleId))[
      lines.slice(0, i).filter((x) => String((x as { vehicleId?: unknown }).vehicleId) === String((l as { vehicleId?: unknown }).vehicleId)).length
    ];
    return {
      brand: (l as { brand?: string }).brand || v?.brand || "",
      model: (l as { model?: string }).model || v?.model || "",
      plate: plate?.licensePlate || "",
      category: v?.categoryId?.name?.fr || v?.category || "",
      fuel: FUEL[String(v?.fuelType || "").toLowerCase()] || v?.fuelType || "",
      gearbox: GEAR[String(v?.transmission || "").toLowerCase()] || v?.transmission || "",
    };
  });
  const insp = (x: IBooking["pickupInspection"], fallbackKm?: number) =>
    x?.at || fallbackKm !== undefined
      ? { mileage: x?.mileage ?? fallbackKm, fuelLevel: x?.fuelLevel, damages: x?.at ? (x.damages || []).map((d) => ({ zone: d.zone, description: d.description })) : undefined, checklist: x?.checklist, cleanliness: x?.cleanliness }
      : undefined;
  return {
    company,
    number: booking.contract?.number || "",
    issuedAt: booking.contract?.issuedAt || new Date(),
    bookingReference: booking.bookingReference,
    driver: defaultDriver(booking),
    secondDriver: booking.contract?.secondDriver ? JSON.parse(JSON.stringify(booking.contract.secondDriver)) : undefined,
    cars,
    pickupDate: booking.pickupDate,
    pickupTime: booking.pickupTime,
    pickupPlace: locName(p.pickupLocationId),
    returnDate: booking.returnDate,
    returnTime: booking.returnTime,
    returnPlace: locName(p.returnLocationId),
    days: pb.rentalDays || booking.rentalDuration,
    dailyRate: pb.dailyRate,
    rentalSubtotal: pb.subtotal,
    extras: (booking.extras || []).filter((e) => (e.quantity || 0) > 0).map((e) => ({ name: e.name, total: (e as { lineTotal?: number }).lineTotal ?? (e.price || 0) * (e.quantity || 1) })),
    fees: (pb.pickupLocationFee || 0) + (pb.returnLocationFee || 0) + (pb.differentLocationFee || 0) + (pb.outOfTownFee || 0),
    discount: pb.discountAmount || 0,
    stampDuty: pb.timbreFiscal || 0,
    contribution: pb.contributionLF2026 || 0,
    total: pb.totalAmount,
    deposit: pb.depositAmount || 0,
    paid: money.paid,
    out: insp(booking.pickupInspection, booking.pickupMileage),
    back: insp(booking.returnInspection, booking.returnMileage),
    vehicleChanges: (booking.vehicleChanges || []).map(
      (ch) => `Le ${new Date(ch.effectiveDate).toLocaleDateString("fr-FR", { timeZone: "UTC" })} : ${ch.fromModel}${ch.fromLabel ? ` (${ch.fromLabel})` : ""} → ${ch.toModel}${ch.toLabel ? ` (${ch.toLabel})` : ""}${ch.reason ? ` — ${ch.reason}` : ""}`
    ),
    customerSignature: await signatureDataUrl(booking.pickupInspection?.signatureUrl),
    notes: booking.contract?.notes || undefined,
    minAge: Number(settings.minRentalAge) || 21,
    assistancePhone: String(settings.phone || ""),
  };
}

/** Invoice recipient: the customer / main driver, overridden by what was typed for the invoice. */
export function billingDefaults(booking: IBooking): IBillingInfo {
  const c = (booking as unknown as Populated).customerId;
  const driver = defaultDriver(booking);
  const saved = JSON.parse(JSON.stringify(booking.billing || {})) as IBillingInfo;
  const clean = Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== "" && v != null));
  return {
    name: driver.fullName || `${c?.firstName || ""} ${c?.lastName || ""}`.trim(),
    address: driver.address || "",
    idNumber: driver.idNumber || "",
    taxId: "",
    notes: "",
    ...clean,
  };
}

export async function invoiceData(booking: IBooking): Promise<InvoiceData> {
  const p = booking as unknown as Populated;
  const pb = booking.pricingBreakdown;
  const [company, vatRate, payments] = await Promise.all([
    getCompanyInfo(),
    getVatRate(),
    Payment.find({ bookingId: booking._id, status: "completed", kind: { $in: ["payment", "refund"] } }).sort({ paidAt: 1 }).lean(),
  ]);
  const days = pb.rentalDays || booking.rentalDuration;
  const v = p.vehicleId;
  const cars = booking.vehicles && booking.vehicles.length ? booking.vehicles : [{ brand: v?.brand, model: v?.model, dailyRate: pb.dailyRate, subtotal: pb.subtotal }];
  // A rental split by a car change is invoiced per car: days with the first car, then with the next.
  const changes = (booking.vehicleChanges || []).filter((c) => c.daysChanged < days || c.priceMode === "recalculate");
  let lines: InvoiceData["lines"];
  if (cars.length === 1 && changes.length > 0) {
    lines = [];
    let remainingDays = days;
    const segs = [...changes].sort((a, b) => new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime());
    // From the last change back to the start.
    const parts: { label: string; days: number; daily: number }[] = [];
    for (let k = segs.length - 1; k >= 0; k--) {
      const c = segs[k];
      const d = Math.min(remainingDays, c.daysChanged);
      parts.unshift({ label: `Location ${c.toModel} (à partir du ${new Date(c.effectiveDate).toLocaleDateString("fr-FR", { timeZone: "UTC" })})`, days: d, daily: c.newDailyRate });
      remainingDays -= d;
    }
    for (const p of parts) if (p.days > 0) lines.push({ label: p.label, qty: `${p.days} j`, unit: p.daily, total: p.daily * p.days });
    if (remainingDays > 0) {
      // Days with the first car: with a mixed price (two periods) they are not worth the booking's
      // average rate. Without any extension/reduction, they are exactly what is left of the subtotal.
      const after = lines.reduce((a, l) => a + l.total, 0);
      const firstTotal = (booking.extensions || []).length === 0 ? Math.max(0, pb.subtotal - after) : segs[0].oldDailyRate * remainingDays;
      lines.unshift({ label: `Location ${segs[0].fromModel}`, qty: `${remainingDays} j`, unit: Math.round(firstTotal / remainingDays), total: firstTotal });
    }
  } else {
    lines = cars.map((c) => {
      const x = c as { brand?: string; model?: string; dailyRate?: number; subtotal?: number };
      const total = x.subtotal ?? Math.round(pb.subtotal / cars.length);
      return { label: `Location ${x.brand || ""} ${x.model || ""}`.trim(), qty: `${days} j`, unit: Math.round(total / Math.max(1, days)), total };
    });
  }
  // Extensions added after the booking are part of the subtotal: one balancing line keeps the invoice exact.
  const carsTotal = lines.reduce((a, l) => a + l.total, 0);
  if (pb.subtotal !== carsTotal) lines.push({ label: "Ajustement de durée (prolongation / réduction)", qty: "1", unit: pb.subtotal - carsTotal, total: pb.subtotal - carsTotal });
  for (const e of (booking.extras || []).filter((x) => (x.quantity || 0) > 0)) {
    const total = (e as { lineTotal?: number }).lineTotal ?? (e.price || 0) * (e.quantity || 1);
    if (total > 0) lines.push({ label: `Option : ${e.name}`, qty: String(e.quantity || 1), unit: e.price || 0, total });
  }
  const fees = (pb.pickupLocationFee || 0) + (pb.returnLocationFee || 0) + (pb.differentLocationFee || 0) + (pb.outOfTownFee || 0);
  if (fees > 0) lines.push({ label: "Frais de livraison / restitution", qty: "1", unit: fees, total: fees });
  if ((pb.discountAmount || 0) > 0) lines.push({ label: "Remise", qty: "1", unit: -pb.discountAmount, total: -pb.discountAmount });
  const stampDuty = pb.timbreFiscal || 0;
  const contribution = pb.contributionLF2026 || 0;
  const taxableTTC = Math.max(0, pb.totalAmount - stampDuty - contribution);
  const { ht, vat } = splitVat(taxableTTC, vatRate);
  const c = p.customerId;
  const driver = defaultDriver(booking);
  const bill = billingDefaults(booking);
  return {
    company,
    number: booking.invoiceNumber || "",
    issuedAt: booking.invoiceIssuedAt || new Date(),
    bookingReference: booking.bookingReference,
    customerName: bill.name || `${c?.firstName || ""} ${c?.lastName || ""}`.trim(),
    customerAddress: bill.address || driver.address,
    customerId: bill.idNumber || driver.idNumber,
    customerTaxId: bill.taxId || undefined,
    notes: bill.notes || undefined,
    lines,
    taxableTTC,
    vatRate,
    ht,
    vat,
    stampDuty,
    contribution,
    total: pb.totalAmount,
    paid: payments.reduce((a, x) => a + (x.kind === "payment" ? x.amount : -x.amount), 0),
    payments: payments.filter((x) => x.kind === "payment").map((x) => ({ date: x.paidAt, method: PAYMENT_METHOD_LABELS[x.method] || x.method, amount: x.amount, receipt: x.receiptNumber })),
  };
}
