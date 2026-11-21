import { jsPDF } from "jspdf";
import { STAMP_SIGNATURE_PNG, STAMP_SIGNATURE_RATIO } from "@/lib/brandAssets";
import { getPublicSettings } from "@/lib/publicSettings";

type RGB = [number, number, number];
const NAVY: RGB = [11, 31, 75];
const BLUE: RGB = [29, 78, 216];
const AMBER: RGB = [245, 179, 1];
const TINT: RGB = [238, 243, 255];
const BORDER: RGB = [203, 213, 225];
const INK: RGB = [15, 23, 42];
const MUTED: RGB = [71, 85, 105];

export interface CompanyInfo {
  name: string;
  legalName: string;
  address: string;
  phone: string;
  email: string;
  /** "RC … - MF …" exactly as entered in Paramètres → Agence. */
  registration: string;
}

/** Agency identity for legal documents, from Paramètres (never hard-coded in a document). */
export async function getCompanyInfo(): Promise<CompanyInfo> {
  const s = await getPublicSettings();
  const str = (...keys: string[]) => keys.map((k) => String(s[k] || "").trim()).find(Boolean) || "";
  return {
    name: str("agencyName", "agency_name") || "Payless Car Rental Tunisie",
    legalName: str("legalName", "legal_name") || "Houimli Rent a Car SARL",
    address: [str("address", "siege_social"), str("city", "ville")].filter(Boolean).join(", "),
    phone: str("phone", "phone_primary"),
    email: str("email", "contact_email"),
    registration: str("registration", "immatriculation") || "RC Ariana B0123452020 - MF 1234567/A/M/000",
  };
}

const money = (minor: number | undefined) =>
  (Math.round(Number(minor || 0)) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).replace(/ | /g, " ");
const frDate = (d?: Date | string | null) => (d ? new Date(d).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "");

/** Small layout helper shared by the three documents. */
class Sheet {
  doc: jsPDF;
  y = 0;
  readonly w: number;
  readonly h: number;
  readonly m = 12;
  constructor() {
    this.doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    this.w = this.doc.internal.pageSize.getWidth();
    this.h = this.doc.internal.pageSize.getHeight();
  }
  get cw() {
    return this.w - 2 * this.m;
  }
  header(company: CompanyInfo, title: string, meta: [string, string][]) {
    const d = this.doc;
    d.setFillColor(...NAVY);
    d.rect(0, 0, this.w, 34, "F");
    d.setFillColor(...AMBER);
    d.rect(0, 34, this.w, 1.2, "F");
    d.setTextColor(255, 255, 255);
    d.setFont("helvetica", "bold");
    d.setFontSize(15);
    d.text(company.name.toUpperCase(), this.m, 12);
    d.setFont("helvetica", "normal");
    d.setFontSize(7.8);
    d.setTextColor(203, 213, 255);
    d.text(`${company.legalName} — Location de voitures`, this.m, 17);
    d.text(company.address, this.m, 21);
    d.text(`Tél : ${company.phone}  |  ${company.email}`, this.m, 25);
    d.text(company.registration, this.m, 29);
    // Meta box
    const bw = 62;
    const bx = this.w - this.m - bw;
    d.setFillColor(255, 255, 255);
    d.roundedRect(bx, 5, bw, 25, 1.5, 1.5, "F");
    d.setFillColor(...AMBER);
    d.roundedRect(bx, 5, bw, 7, 1.5, 1.5, "F");
    d.rect(bx, 9, bw, 3, "F");
    d.setTextColor(...NAVY);
    d.setFont("helvetica", "bold");
    d.setFontSize(9);
    d.text(title, bx + bw / 2, 10, { align: "center" });
    d.setFontSize(7.6);
    meta.slice(0, 3).forEach(([k, v], i) => {
      const yy = 16.5 + i * 4.6;
      d.setFont("helvetica", "normal");
      d.setTextColor(...MUTED);
      d.text(k, bx + 3, yy);
      d.setFont("helvetica", "bold");
      d.setTextColor(...INK);
      d.text(v, bx + bw - 3, yy, { align: "right" });
    });
    this.y = 40;
  }
  section(title: string, x = this.m, width = this.cw) {
    const d = this.doc;
    d.setFillColor(...BLUE);
    d.rect(x, this.y, width, 5.6, "F");
    d.setTextColor(255, 255, 255);
    d.setFont("helvetica", "bold");
    d.setFontSize(8);
    d.text(title.toUpperCase(), x + 2.5, this.y + 3.9);
  }
  /** Key/value grid inside a bordered box. Returns the box height. */
  fields(rows: [string, string][], x: number, width: number, top: number, cols = 1, lineH = 5.2): number {
    const d = this.doc;
    const perCol = Math.ceil(rows.length / cols);
    const height = perCol * lineH + 2.5;
    d.setDrawColor(...BORDER);
    d.setLineWidth(0.2);
    d.rect(x, top, width, height);
    const colW = width / cols;
    rows.forEach(([k, v], i) => {
      const c = Math.floor(i / perCol);
      const r = i % perCol;
      const xx = x + c * colW + 2.5;
      const yy = top + 4.6 + r * lineH;
      d.setFont("helvetica", "bold");
      d.setFontSize(7.6);
      d.setTextColor(...MUTED);
      d.text(`${k} :`, xx, yy);
      const kw = d.getTextWidth(`${k} : `);
      d.setFont("helvetica", "normal");
      d.setTextColor(...INK);
      const value = v || "…………………………………";
      d.text(d.splitTextToSize(value, colW - kw - 5)[0] || "", xx + kw, yy);
    });
    return height;
  }
  table(head: string[], rows: string[][], widths: number[], align: ("left" | "right" | "center")[] = []) {
    const d = this.doc;
    const x0 = this.m;
    d.setFillColor(...NAVY);
    d.rect(x0, this.y, this.cw, 6, "F");
    d.setTextColor(255, 255, 255);
    d.setFont("helvetica", "bold");
    d.setFontSize(7.6);
    let x = x0;
    head.forEach((t, i) => {
      const a = align[i] || "left";
      d.text(t, a === "right" ? x + widths[i] - 2 : a === "center" ? x + widths[i] / 2 : x + 2, this.y + 4.1, { align: a });
      x += widths[i];
    });
    this.y += 6;
    d.setFont("helvetica", "normal");
    d.setTextColor(...INK);
    rows.forEach((row, ri) => {
      if (ri % 2 === 1) {
        d.setFillColor(...TINT);
        d.rect(x0, this.y, this.cw, 5.6, "F");
      }
      x = x0;
      row.forEach((t, i) => {
        const a = align[i] || "left";
        const text = d.splitTextToSize(String(t), widths[i] - 3)[0] || "";
        d.text(text, a === "right" ? x + widths[i] - 2 : a === "center" ? x + widths[i] / 2 : x + 2, this.y + 3.9, { align: a });
        x += widths[i];
      });
      this.y += 5.6;
    });
    d.setDrawColor(...BORDER);
    d.rect(x0, this.y - rows.length * 5.6 - 6, this.cw, rows.length * 5.6 + 6);
  }
  footer(text: string) {
    const d = this.doc;
    const pages = d.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      d.setPage(p);
      d.setFillColor(...NAVY);
      d.rect(0, this.h - 9, this.w, 9, "F");
      d.setTextColor(255, 255, 255);
      d.setFont("helvetica", "normal");
      d.setFontSize(6.8);
      d.text(`${text} | Page ${p}/${pages}`, this.w / 2, this.h - 3.6, { align: "center" });
    }
  }
  stamp(x: number, y: number, width = 46) {
    try {
      this.doc.addImage(STAMP_SIGNATURE_PNG, "PNG", x, y, width, width / STAMP_SIGNATURE_RATIO, "agency-stamp", "SLOW");
    } catch {
      /* the document stays valid without the image */
    }
  }
  buffer(): Buffer {
    return Buffer.from(this.doc.output("arraybuffer"));
  }
}

/* ───────────────────────────── Rental contract ───────────────────────────── */

export interface ContractDriver {
  fullName?: string;
  birthDate?: string;
  birthPlace?: string;
  nationality?: string;
  address?: string;
  phone?: string;
  idType?: "cin" | "passport";
  idNumber?: string;
  idIssuedAt?: string;
  licenceNumber?: string;
  licenceIssuedAt?: string;
  licenceIssuedIn?: string;
}

export interface ContractCar {
  brand: string;
  model: string;
  plate: string;
  category?: string;
  fuel?: string;
  gearbox?: string;
  color?: string;
}

export interface ContractInspection {
  mileage?: number;
  fuelLevel?: number;
  damages?: { zone: string; description: string }[];
  checklist?: Record<string, boolean>;
  cleanliness?: string;
}

export interface ContractData {
  company: CompanyInfo;
  number: string;
  issuedAt: Date;
  bookingReference: string;
  driver: ContractDriver;
  secondDriver?: ContractDriver;
  cars: ContractCar[];
  pickupDate: Date;
  pickupTime?: string;
  pickupPlace: string;
  returnDate: Date;
  returnTime?: string;
  returnPlace: string;
  days: number;
  dailyRate: number;
  rentalSubtotal: number;
  extras: { name: string; total: number }[];
  fees: number;
  discount: number;
  stampDuty: number;
  contribution: number;
  total: number;
  deposit: number;
  paid: number;
  out?: ContractInspection;
  back?: ContractInspection;
  /** PNG data URL of the customer's signature (from the departure inspection). */
  customerSignature?: string;
  /** Car changes during the rental ("Le 03/04/2032 : Kia Picanto → Seat Ibiza (panne)"). */
  vehicleChanges?: string[];
  /** Special conditions agreed for this rental, printed above the acceptance box. */
  notes?: string;
  minAge?: number;
  assistancePhone?: string;
}

export const CHECKLIST_ITEMS: [string, string][] = [
  ["documents", "Carte grise, assurance, vignette"],
  ["spare", "Roue de secours"],
  ["jack", "Cric & clé de roue"],
  ["triangle", "Triangle & gilet"],
  ["radio", "Autoradio / écran"],
  ["mats", "Tapis"],
];

function driverRows(d: ContractDriver): [string, string][] {
  return [
    ["Nom & prénom", d.fullName || ""],
    ["Né(e) le / à", [d.birthDate, d.birthPlace].filter(Boolean).join(" à ")],
    ["Nationalité", d.nationality || ""],
    ["Adresse", d.address || ""],
    ["Téléphone", d.phone || ""],
    [d.idType === "passport" ? "Passeport n°" : "CIN n°", [d.idNumber, d.idIssuedAt ? `délivré(e) le ${d.idIssuedAt}` : ""].filter(Boolean).join(" — ")],
    ["Permis n°", d.licenceNumber || ""],
    ["Délivré le / à", [d.licenceIssuedAt, d.licenceIssuedIn].filter(Boolean).join(" à ")],
  ];
}

const gauge = (n?: number) => (typeof n === "number" ? `${n}/8` : "……/8");
const km = (n?: number) => (typeof n === "number" ? `${n.toLocaleString("fr-FR").replace(/ | /g, " ")} km` : "…………… km");

/**
 * Rental contract in the layout used by Tunisian car-rental agencies: parties, vehicle, period and
 * price, condition of the car at departure / return, then the general conditions and signatures.
 * Fields with no data are printed as dotted lines so the contract can be completed by hand.
 */
export function generateContractPDF(c: ContractData): Buffer {
  const s = new Sheet();
  const d = s.doc;
  s.header(c.company, "CONTRAT DE LOCATION", [
    ["N° contrat :", c.number],
    ["Date :", frDate(c.issuedAt)],
    ["Réservation :", c.bookingReference],
  ]);

  // 1 + 2: drivers
  const half = (s.cw - 4) / 2;
  s.section("1. Locataire (conducteur principal)", s.m, half);
  s.section("2. Conducteur additionnel", s.m + half + 4, half);
  s.y += 5.6;
  const h1 = s.fields(driverRows(c.driver), s.m, half, s.y);
  s.fields(driverRows(c.secondDriver || {}), s.m + half + 4, half, s.y);
  s.y += h1 + 3;

  // 3: vehicle(s)
  s.section("3. Véhicule loué");
  s.y += 5.6;
  s.table(
    ["Marque & modèle", "Immatriculation", "Catégorie", "Carburant", "Boîte"],
    c.cars.map((car) => [`${car.brand} ${car.model}`, car.plate || "……………………", car.category || "", car.fuel || "", car.gearbox || ""]),
    [62, 38, 36, 26, 24]
  );
  if (c.vehicleChanges?.length) {
    d.setFont("helvetica", "bold");
    d.setFontSize(7.4);
    d.setTextColor(...NAVY);
    s.y += 3.5;
    d.text("Changement(s) de véhicule pendant la location :", s.m, s.y);
    d.setFont("helvetica", "normal");
    d.setTextColor(...INK);
    for (const line of c.vehicleChanges.slice(0, 3)) {
      s.y += 3.6;
      d.text(d.splitTextToSize(`• ${line}`, s.cw)[0], s.m, s.y);
    }
    s.y += 1;
  }
  s.y += 3;

  // 4: period
  s.section("4. Durée & lieux");
  s.y += 5.6;
  const h4 = s.fields(
    [
      ["Départ", `${frDate(c.pickupDate)}${c.pickupTime ? ` à ${c.pickupTime}` : ""}`],
      ["Lieu de départ", c.pickupPlace],
      ["Durée", `${c.days} jour${c.days > 1 ? "s" : ""}`],
      ["Retour prévu", `${frDate(c.returnDate)}${c.returnTime ? ` à ${c.returnTime}` : ""}`],
      ["Lieu de retour", c.returnPlace],
      ["Kilométrage", "Illimité sur le territoire tunisien"],
    ],
    s.m,
    s.cw,
    s.y,
    2
  );
  s.y += h4 + 3;

  // 5: price
  s.section("5. Prix & règlement (en dinars tunisiens, TTC)");
  s.y += 5.6;
  const lines: string[][] = [[`Location ${c.days} j × ${money(c.dailyRate)}`, money(c.rentalSubtotal)]];
  for (const e of c.extras) lines.push([`Option : ${e.name}`, money(e.total)]);
  if (c.fees > 0) lines.push(["Frais de livraison / restitution", money(c.fees)]);
  if (c.discount > 0) lines.push(["Remise", `- ${money(c.discount)}`]);
  if (c.contribution > 0) lines.push(["Contribution fiscale", money(c.contribution)]);
  if (c.stampDuty > 0) lines.push(["Timbre fiscal", money(c.stampDuty)]);
  s.table(["Désignation", "Montant (DT)"], lines, [s.cw - 40, 40], ["left", "right"]);
  const boxY = s.y + 1.5;
  const cell = s.cw / 4;
  const totals: [string, string, boolean][] = [
    ["TOTAL TTC", money(c.total), true],
    ["Déjà réglé", money(c.paid), false],
    ["Reste à payer", money(Math.max(0, c.total - c.paid)), false],
    ["Caution (garantie)", money(c.deposit), false],
  ];
  totals.forEach(([k, v, strong], i) => {
    const x = s.m + i * cell;
    if (strong) d.setFillColor(...NAVY);
    else d.setFillColor(...TINT);
    d.rect(x, boxY, cell, 10, "F");
    d.setDrawColor(...BORDER);
    d.rect(x, boxY, cell, 10);
    d.setFont("helvetica", "normal");
    d.setFontSize(6.8);
    if (strong) d.setTextColor(255, 255, 255);
    else d.setTextColor(...MUTED);
    d.text(k, x + cell / 2, boxY + 3.6, { align: "center" });
    d.setFont("helvetica", "bold");
    d.setFontSize(9.5);
    if (strong) d.setTextColor(...AMBER);
    else d.setTextColor(...INK);
    d.text(`${v} DT`, x + cell / 2, boxY + 8, { align: "center" });
  });
  s.y = boxY + 13;

  // 6: condition of the car
  s.section("6. État du véhicule (départ / retour)");
  s.y += 5.6;
  const yes = (v: boolean | undefined) => (v === undefined ? "☐" : v ? "Oui" : "NON");
  const rows: string[][] = [
    ["Kilométrage", km(c.out?.mileage), km(c.back?.mileage)],
    ["Niveau de carburant", gauge(c.out?.fuelLevel), gauge(c.back?.fuelLevel)],
    ...CHECKLIST_ITEMS.map(([k, label]) => [label, yes(c.out?.checklist?.[k]).replace("☐", "Oui / Non"), yes(c.back?.checklist?.[k]).replace("☐", "Oui / Non")]),
  ];
  s.table(["Contrôle", "Au départ", "Au retour"], rows, [s.cw - 90, 45, 45], ["left", "center", "center"]);
  const dmg = (list?: { zone: string; description: string }[]) =>
    list === undefined ? "" : list.length === 0 ? "Aucun dommage constaté" : list.map((x) => `${x.zone} : ${x.description}`).join(" ; ");
  s.y += 1.5;
  const dmgH = 13;
  d.setDrawColor(...BORDER);
  d.rect(s.m, s.y, half, dmgH);
  d.rect(s.m + half + 4, s.y, half, dmgH);
  d.setFont("helvetica", "bold");
  d.setFontSize(7.2);
  d.setTextColor(...MUTED);
  d.text("Dommages / rayures au départ :", s.m + 2, s.y + 3.6);
  d.text("Dommages / rayures au retour :", s.m + half + 6, s.y + 3.6);
  d.setFont("helvetica", "normal");
  d.setTextColor(...INK);
  d.text(d.splitTextToSize(dmg(c.out?.damages), half - 4).slice(0, 2), s.m + 2, s.y + 7.4);
  d.text(d.splitTextToSize(dmg(c.back?.damages), half - 4).slice(0, 2), s.m + half + 6, s.y + 7.4);
  s.y += dmgH + 4;

  // Signatures (page 1)
  const sigH = Math.max(26, Math.min(34, s.h - 12 - s.y));
  d.setDrawColor(...BORDER);
  d.rect(s.m, s.y, half, sigH);
  d.rect(s.m + half + 4, s.y, half, sigH);
  d.setFont("helvetica", "bold");
  d.setFontSize(7.6);
  d.setTextColor(...NAVY);
  d.text("LE LOCATAIRE", s.m + 2.5, s.y + 4.2);
  d.text("L'AGENCE (cachet & signature)", s.m + half + 6.5, s.y + 4.2);
  d.setFont("helvetica", "normal");
  d.setFontSize(6.6);
  d.setTextColor(...MUTED);
  d.text("Signature précédée de la mention « Lu et approuvé »", s.m + 2.5, s.y + 7.6);
  if (c.customerSignature) {
    try {
      d.addImage(c.customerSignature, "PNG", s.m + 8, s.y + 9, half - 16, sigH - 11, "customer-sign", "FAST");
    } catch {
      /* unreadable signature image: the box stays empty for a handwritten signature */
    }
  }
  const stampW = Math.min(40, (sigH - 6) * STAMP_SIGNATURE_RATIO);
  s.stamp(s.m + half + 4 + (half - stampW) / 2, s.y + 5.5, stampW);

  // Page 2: general conditions
  d.addPage();
  s.y = 14;
  d.setFont("helvetica", "bold");
  d.setFontSize(11);
  d.setTextColor(...NAVY);
  d.text("CONDITIONS GÉNÉRALES DE LOCATION", s.w / 2, s.y, { align: "center" });
  d.setFontSize(7.4);
  d.setTextColor(...MUTED);
  d.setFont("helvetica", "normal");
  d.text(`Contrat n° ${c.number} — ${c.company.legalName}`, s.w / 2, s.y + 4.5, { align: "center" });
  s.y += 11;
  const age = c.minAge || 21;
  const articles: [string, string][] = [
    ["Article 1 — Conducteur", `Le véhicule ne peut être conduit que par le locataire et le conducteur additionnel désignés au présent contrat, âgés d'au moins ${age} ans et titulaires d'un permis de conduire valide depuis plus d'un an. Le locataire reste responsable du véhicule quel que soit le conducteur.`],
    ["Article 2 — Utilisation", "Le véhicule est loué pour un usage privé sur le territoire tunisien. Il est interdit de le sous-louer, de transporter des personnes ou des marchandises à titre onéreux, de participer à des compétitions, de remorquer un autre véhicule, de circuler hors des voies carrossables ou de conduire sous l'emprise de l'alcool ou de stupéfiants. Le véhicule ne peut pas quitter le territoire tunisien."],
    ["Article 3 — État du véhicule", "Le véhicule est remis en bon état de marche et de propreté, avec ses documents et équipements, tels que décrits dans l'état des lieux de départ signé par les deux parties. Il doit être restitué dans le même état. Tout dommage, équipement ou document manquant non mentionné au départ est à la charge du locataire."],
    ["Article 4 — Carburant", "Le véhicule est remis avec le niveau de carburant indiqué au départ et doit être restitué avec le même niveau. Le carburant manquant est facturé au tarif en vigueur, majoré des frais de service. Le carburant en excédent n'est pas remboursé."],
    ["Article 5 — Durée, prolongation, restitution", "La location est consentie pour la durée indiquée au contrat. Toute prolongation doit être demandée et acceptée par l'agence avant la date de retour prévue ; elle est facturée au tarif en vigueur. À défaut d'accord, le véhicule est considéré comme détourné et l'agence se réserve le droit d'engager toute poursuite. Tout retard de plus d'une heure peut être facturé une journée supplémentaire."],
    ["Article 6 — Prix, caution et paiement", "Le prix de la location, des options et des frais figure au présent contrat. Une caution est exigée au départ ; elle est restituée au retour du véhicule, déduction faite des sommes éventuellement dues (dommages, franchise, carburant, amendes, jours supplémentaires)."],
    ["Article 7 — Assurance et franchise", "Le véhicule est couvert par une assurance responsabilité civile conformément à la réglementation tunisienne. Sauf option contraire souscrite, le locataire supporte une franchise en cas de dommage, de vol ou d'incendie. L'assurance ne couvre pas : les pneumatiques, jantes, vitres, bas de caisse et intérieur, la perte des clés ou des documents, ni les dommages causés en violation de l'article 2."],
    ["Article 8 — Accident, vol, panne", `En cas d'accident, le locataire doit établir un constat amiable, prévenir les autorités si nécessaire et informer l'agence dans les 24 heures. En cas de vol, une déclaration doit être faite sans délai auprès des autorités et remise à l'agence avec les clés et documents. Aucune réparation ne peut être engagée sans l'accord de l'agence. Assistance 24h/24 : ${c.assistancePhone || c.company.phone}.`],
    ["Article 9 — Infractions", "Le locataire est seul responsable des amendes, contraventions et procès-verbaux relatifs à la période de location. Leur montant, majoré des frais de traitement, lui est facturé même après la restitution du véhicule."],
    ["Article 10 — Annulation", "Les conditions d'annulation et de modification sont celles communiquées lors de la réservation."],
    ["Article 11 — Données personnelles", "Les informations recueillies sont nécessaires à l'exécution du contrat. Elles sont traitées conformément à la loi organique n° 2004-63 relative à la protection des données à caractère personnel et ne sont communiquées qu'aux autorités et assureurs lorsque la loi l'exige."],
    ["Article 12 — Litiges", "Le présent contrat est soumis au droit tunisien. À défaut d'accord amiable, tout litige relève de la compétence des tribunaux du siège de l'agence."],
  ];
  for (const [title, body] of articles) {
    d.setFont("helvetica", "bold");
    d.setFontSize(8);
    d.setTextColor(...NAVY);
    d.text(title, s.m, s.y);
    d.setFont("helvetica", "normal");
    d.setFontSize(7.6);
    d.setTextColor(...INK);
    const wrapped = d.splitTextToSize(body, s.cw) as string[];
    d.text(wrapped, s.m, s.y + 3.8);
    s.y += 3.8 + wrapped.length * 3.4 + 2.6;
  }
  if (c.notes?.trim()) {
    d.setFont("helvetica", "bold");
    d.setFontSize(8);
    d.setTextColor(...NAVY);
    d.text("Conditions particulières", s.m, s.y);
    d.setFont("helvetica", "normal");
    d.setFontSize(7.6);
    d.setTextColor(...INK);
    const wrapped = (d.splitTextToSize(c.notes.trim(), s.cw) as string[]).slice(0, 8);
    d.text(wrapped, s.m, s.y + 3.8);
    s.y += 3.8 + wrapped.length * 3.4 + 2.6;
  }
  s.y += 2;
  d.setDrawColor(...BORDER);
  d.rect(s.m, s.y, s.cw, 22);
  d.setFont("helvetica", "bold");
  d.setFontSize(7.8);
  d.setTextColor(...NAVY);
  d.text("Le locataire reconnaît avoir pris connaissance des conditions générales et les accepte sans réserve.", s.m + 2.5, s.y + 4.5);
  d.setFont("helvetica", "normal");
  d.setTextColor(...MUTED);
  d.text(`Fait à ……………………………, le ${frDate(c.issuedAt)}, en deux exemplaires.`, s.m + 2.5, s.y + 9.5);
  d.text("Signature du locataire :", s.m + 2.5, s.y + 16);
  d.text("Signature du conducteur additionnel :", s.m + s.cw / 2, s.y + 16);

  s.footer(`Contrat ${c.number} — ${c.company.name} — ${c.company.legalName}`);
  return s.buffer();
}

/* ───────────────────────────── Invoice ───────────────────────────── */

export interface InvoiceData {
  company: CompanyInfo;
  number: string;
  issuedAt: Date;
  bookingReference: string;
  customerName: string;
  customerAddress?: string;
  customerId?: string;
  /** Tax identifier of a business customer (matricule fiscal). */
  customerTaxId?: string;
  /** Free text printed under the totals. */
  notes?: string;
  lines: { label: string; qty: string; unit: number; total: number }[];
  /** Tax-included amounts in minor units. */
  taxableTTC: number;
  vatRate: number;
  ht: number;
  vat: number;
  stampDuty: number;
  contribution: number;
  total: number;
  paid: number;
  payments: { date: Date; method: string; amount: number; receipt: string }[];
}

/** Invoice: lines, HT / TVA / timbre fiscal / TTC, payments received and balance. */
export function generateInvoicePDF(v: InvoiceData): Buffer {
  const s = new Sheet();
  const d = s.doc;
  s.header(v.company, "FACTURE", [
    ["N° facture :", v.number],
    ["Date :", frDate(v.issuedAt)],
    ["Réservation :", v.bookingReference],
  ]);
  s.section("Client");
  s.y += 5.6;
  const h = s.fields(
    [
      ["Nom / raison sociale", v.customerName],
      ["Adresse", v.customerAddress || ""],
      ["CIN / passeport", v.customerId || ""],
      ["Matricule fiscal", v.customerTaxId || "—"],
    ],
    s.m,
    s.cw,
    s.y,
    2
  );
  s.y += h + 4;
  s.table(
    ["Désignation", "Qté", "P.U. TTC (DT)", "Total TTC (DT)"],
    v.lines.map((l) => [l.label, l.qty, money(l.unit), money(l.total)]),
    [s.cw - 86, 22, 32, 32],
    ["left", "center", "right", "right"]
  );
  s.y += 4;
  const bx = s.w - s.m - 82;
  const rows: [string, string, boolean][] = [
    ["Total HT", money(v.ht), false],
    [`TVA ${v.vatRate} %`, money(v.vat), false],
  ];
  if (v.contribution > 0) rows.push(["Contribution fiscale", money(v.contribution), false]);
  if (v.stampDuty > 0) rows.push(["Timbre fiscal", money(v.stampDuty), false]);
  rows.push(["TOTAL TTC", money(v.total), true]);
  rows.forEach(([k, val, strong]) => {
    if (strong) {
      d.setFillColor(...NAVY);
      d.rect(bx, s.y, 82, 8, "F");
      d.setTextColor(255, 255, 255);
      d.setFont("helvetica", "bold");
      d.setFontSize(9.5);
      d.text(k, bx + 3, s.y + 5.4);
      d.setTextColor(...AMBER);
      d.text(`${val} DT`, bx + 79, s.y + 5.4, { align: "right" });
      s.y += 8;
    } else {
      d.setDrawColor(...BORDER);
      d.rect(bx, s.y, 82, 6);
      d.setFont("helvetica", "normal");
      d.setFontSize(8.2);
      d.setTextColor(...MUTED);
      d.text(k, bx + 3, s.y + 4.1);
      d.setTextColor(...INK);
      d.text(`${val} DT`, bx + 79, s.y + 4.1, { align: "right" });
      s.y += 6;
    }
  });
  s.y += 6;
  if (v.payments.length) {
    s.section("Règlements reçus");
    s.y += 5.6;
    s.table(
      ["Date", "Reçu n°", "Mode", "Montant (DT)"],
      v.payments.map((p) => [frDate(p.date), p.receipt, p.method, money(p.amount)]),
      [36, 56, s.cw - 132, 40],
      ["left", "left", "left", "right"]
    );
    s.y += 3;
  }
  const remaining = Math.max(0, v.total - v.paid);
  d.setFont("helvetica", "bold");
  d.setFontSize(9);
  d.setTextColor(...(remaining > 0 ? ([185, 28, 28] as RGB) : ([21, 128, 61] as RGB)));
  d.text(remaining > 0 ? `Reste à payer : ${money(remaining)} DT` : "Facture acquittée", s.m, s.y + 4);
  s.y += 12;
  d.setFont("helvetica", "normal");
  d.setFontSize(7.4);
  d.setTextColor(...MUTED);
  d.text("Arrêtée la présente facture à la somme indiquée ci-dessus (toutes taxes comprises).", s.m, s.y);
  if (v.notes?.trim()) {
    const wrapped = (d.splitTextToSize(v.notes.trim(), s.cw - 56) as string[]).slice(0, 6);
    d.setTextColor(...INK);
    d.text(wrapped, s.m, s.y + 5);
    s.y += wrapped.length * 3.4;
  }
  s.stamp(s.w - s.m - 48, Math.min(s.y + 4, s.h - 50), 46);
  s.footer(`Facture ${v.number} — ${v.company.legalName} — ${v.company.registration}`);
  return s.buffer();
}

/* ───────────────────────────── Payment receipt ───────────────────────────── */

export interface ReceiptData {
  company: CompanyInfo;
  number: string;
  date: Date;
  kindLabel: string;
  customerName: string;
  bookingReference: string;
  amount: number;
  method: string;
  reference?: string;
  recordedBy: string;
  total: number;
  paid: number;
  depositHeld: number;
  voided?: boolean;
}

/** Receipt handed to the customer for each money movement. */
export function generateReceiptPDF(r: ReceiptData): Buffer {
  const s = new Sheet();
  const d = s.doc;
  s.header(r.company, "REÇU", [
    ["N° :", r.number],
    ["Date :", frDate(r.date)],
    ["Réservation :", r.bookingReference],
  ]);
  s.section(r.kindLabel);
  s.y += 5.6;
  const h = s.fields(
    [
      ["Reçu de / remis à", r.customerName],
      ["Mode de règlement", r.method],
      ["Référence", r.reference || "—"],
      ["Enregistré par", r.recordedBy],
    ],
    s.m,
    s.cw,
    s.y,
    2
  );
  s.y += h + 5;
  d.setFillColor(...NAVY);
  d.rect(s.m, s.y, s.cw, 16, "F");
  d.setTextColor(255, 255, 255);
  d.setFont("helvetica", "bold");
  d.setFontSize(10);
  d.text("MONTANT", s.m + 5, s.y + 9.8);
  d.setFontSize(16);
  d.setTextColor(...AMBER);
  d.text(`${money(r.amount)} DT`, s.w - s.m - 5, s.y + 10.6, { align: "right" });
  s.y += 22;
  const h2 = s.fields(
    [
      ["Total de la location", `${money(r.total)} DT`],
      ["Total encaissé à ce jour", `${money(r.paid)} DT`],
      ["Reste à payer", `${money(Math.max(0, r.total - r.paid))} DT`],
      ["Caution détenue", `${money(r.depositHeld)} DT`],
    ],
    s.m,
    s.cw,
    s.y,
    2
  );
  s.y += h2 + 8;
  if (r.voided) {
    d.setFont("helvetica", "bold");
    d.setFontSize(28);
    d.setTextColor(220, 38, 38);
    d.text("ANNULÉ", s.w / 2, s.y + 10, { align: "center" });
  }
  s.stamp(s.w - s.m - 48, s.y, 46);
  s.footer(`Reçu ${r.number} — ${r.company.legalName} — ${r.company.registration}`);
  return s.buffer();
}
