// READ-ONLY health check of a real database before (and after) deploying a new version.
// It never writes: run it against production safely.
//
//   npm run check:data
//   MONGODB_URI="mongodb+srv://…" npm run check:data
//
// It reports what the automatic migration will find on the first start:
//   • physical cars shared by two overlapping reservations (the legacy bug)
//   • reservations with no physical car, or pointing to a car that no longer exists
//   • reservations marked "paid" by hand that have no payment in the ledger
//   • amounts that do not add up
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import mongoose from "mongoose";

loadEnvConfig(process.cwd(), false);
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set (put it in .env.local or pass it on the command line).");
  process.exit(1);
}
await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, readPreference: "secondaryPreferred" });
const db = mongoose.connection.db;
const HOLDING = ["pending", "confirmed", "awaiting_payment", "paid", "active"];
const day = (d) => new Date(d).toISOString().slice(0, 10);

const [vehicles, bookings, payments, holds, settings] = await Promise.all([
  db.collection("vehicles").find({}).project({ brand: 1, model: 1, units: 1, totalUnits: 1 }).toArray(),
  db.collection("bookings").find({}).project({ bookingReference: 1, bookingStatus: 1, paymentStatus: 1, pickupDate: 1, returnDate: 1, vehicleId: 1, vehicles: 1, assignedUnits: 1, pricingBreakdown: 1, amountPaid: 1, createdAt: 1 }).toArray(),
  db.collection("payments").countDocuments({}),
  db.collection("unitholds").countDocuments({}),
  db.collection("agencysettings").find({ key: { $in: ["unitHoldsVersion", "permissionsVersion", "registration"] } }).toArray(),
]);
const unitIds = new Set(vehicles.flatMap((v) => (v.units || []).map((u) => String(u._id))));
const unitName = new Map(vehicles.flatMap((v) => (v.units || []).map((u, i) => [String(u._id), `${v.brand} ${v.model} — ${u.licensePlate || `unité ${i + 1}`}`])));
const holding = bookings.filter((b) => HOLDING.includes(b.bookingStatus));

// Same car, overlapping days (a return and a departure on the same day are allowed).
const byUnit = new Map();
for (const b of holding) for (const a of b.assignedUnits || []) if (a.unitId) (byUnit.get(String(a.unitId)) || byUnit.set(String(a.unitId), []).get(String(a.unitId))).push(b);
const conflicts = [];
for (const [unit, list] of byUnit) {
  list.sort((a, b) => new Date(a.pickupDate) - new Date(b.pickupDate));
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      if (day(list[j].pickupDate) < day(list[i].returnDate) && day(list[j].returnDate) > day(list[i].pickupDate))
        conflicts.push(`${unitName.get(unit) || unit}: ${list[i].bookingReference} (${day(list[i].pickupDate)}→${day(list[i].returnDate)}) / ${list[j].bookingReference} (${day(list[j].pickupDate)}→${day(list[j].returnDate)})`);
}
const needed = (b) => (b.vehicles && b.vehicles.length ? b.vehicles.length : 1);
const unassigned = holding.filter((b) => (b.assignedUnits || []).filter((a) => a.unitId).length < needed(b));
const orphans = holding.filter((b) => (b.assignedUnits || []).some((a) => a.unitId && !unitIds.has(String(a.unitId))));
const modelsWithoutUnits = vehicles.filter((v) => !(v.units || []).length);
const paidByHand = bookings.filter((b) => b.paymentStatus === "paid" && !(b.amountPaid > 0));
const badTotals = bookings.filter((b) => {
  const p = b.pricingBreakdown || {};
  const sum = (p.subtotal || 0) + (p.extrasTotal || 0) + (p.pickupLocationFee || 0) + (p.returnLocationFee || 0) + (p.differentLocationFee || 0) + (p.outOfTownFee || 0) + (p.timbreFiscal || 0) + (p.contributionLF2026 || 0) + (p.taxAmount || 0) - (p.discountAmount || 0);
  return Math.abs(sum - (p.totalAmount || 0)) > 1;
});
const overlapByModel = () => {
  // Demand vs physical cars per model and day: more reservations than cars cannot be repaired automatically.
  const out = [];
  for (const v of vehicles) {
    const cars = Math.max((v.units || []).length, Number(v.totalUnits) || 0, 1);
    const days = new Map();
    for (const b of holding) {
      const ids = b.vehicles && b.vehicles.length ? b.vehicles.map((x) => String(x.vehicleId)) : [String(b.vehicleId)];
      const n = ids.filter((x) => x === String(v._id)).length;
      if (!n) continue;
      for (let t = new Date(day(b.pickupDate)).getTime(); t < new Date(day(b.returnDate)).getTime(); t += 86_400_000) days.set(t, (days.get(t) || 0) + n);
    }
    const worst = [...days].filter(([, n]) => n > cars).sort((a, b) => b[1] - a[1])[0];
    if (worst) out.push(`${v.brand} ${v.model}: ${worst[1]} réservations pour ${cars} voiture(s) le ${day(worst[0])}`);
  }
  return out;
};
const overbooked = overlapByModel();
const setting = (k) => settings.find((s) => s.key === k)?.value;

const line = (label, n, list = []) => {
  console.log(`${n ? "⚠" : "✓"} ${label}: ${n}`);
  list.slice(0, 15).forEach((x) => console.log(`    ${x}`));
  if (list.length > 15) console.log(`    … et ${list.length - 15} autre(s)`);
};
console.log(`\nBase "${db.databaseName}" — lecture seule, rien n'est modifié\n`);
console.log(`Modèles: ${vehicles.length} · voitures physiques: ${unitIds.size} · réservations: ${bookings.length} (dont ${holding.length} en cours ou à venir)`);
console.log(`Paiements au grand livre: ${payments} · jours réservés (unitholds): ${holds}`);
console.log(`Migration des affectations: ${setting("unitHoldsVersion") ? "déjà faite" : "PAS ENCORE faite (se fera au premier démarrage)"}`);
console.log(`Matricule (Paramètres → Agence): ${setting("registration") || "non renseigné — la valeur par défaut sera imprimée sur les documents"}\n`);
line("Voitures partagées par deux réservations qui se chevauchent", conflicts.length, conflicts);
line("Réservations sans voiture physique affectée", unassigned.length, unassigned.map((b) => `${b.bookingReference} (${day(b.pickupDate)}→${day(b.returnDate)})`));
line("Réservations pointant vers une voiture supprimée", orphans.length, orphans.map((b) => b.bookingReference));
line("Modèles sans voiture physique (créées au premier démarrage)", modelsWithoutUnits.length, modelsWithoutUnits.map((v) => `${v.brand} ${v.model}`));
line("Jours où il y a plus de réservations que de voitures (à traiter à la main)", overbooked.length, overbooked);
line("Réservations marquées payées sans paiement enregistré (resteront « payées », hors caisse)", paidByHand.length);
line("Réservations dont le total ne correspond pas au détail", badTotals.length, badTotals.map((b) => `${b.bookingReference}: total ${(b.pricingBreakdown?.totalAmount || 0) / 100} DT`));
const blocking = overbooked.length;
console.log(blocking ? "\n✗ À corriger avant le déploiement : les surréservations ci-dessus ne peuvent pas être réparées automatiquement." : "\n✓ Rien de bloquant. Les ⚠ ci-dessus seront corrigés par la réparation automatique ou sont de simples informations.");
await mongoose.disconnect();
process.exit(blocking ? 2 : 0);
