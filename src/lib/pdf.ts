import { jsPDF } from "jspdf";
import { extraLineTotal } from "@/lib/extras";
import { STAMP_SIGNATURE_PNG, STAMP_SIGNATURE_RATIO } from "@/lib/brandAssets";

/** Brand palette (matches the website: deep navy, Payless blue, amber accent). */
type RGB = [number, number, number];
const NAVY: RGB = [11, 31, 75];
const BLUE: RGB = [29, 78, 216];
const AMBER: RGB = [245, 179, 1];
const TINT: RGB = [238, 243, 255];
const BORDER: RGB = [203, 213, 225];
const INK: RGB = [15, 23, 42];
const MUTED: RGB = [71, 85, 105];

const STATUS_LABELS: Record<string, string> = {
  pending: "EN ATTENTE",
  confirmed: "CONFIRMÉE",
  awaiting_payment: "PAIEMENT ATTENDU",
  paid: "PAYÉE",
  active: "EN COURS",
  completed: "CLÔTURÉE",
  cancelled: "ANNULÉE",
  rejected: "REFUSÉE",
};

export interface PDFExtraItem {
  name: string;
  quantity: number;
  price?: number;
  lineTotal?: number;
  pricingType?: string;
}

export interface PDFVehicleItem {
  brand: string;
  model: string;
  dailyRate: number;
  subtotal: number;
  rentalDuration?: number;
  extrasTotal?: number;
  extras?: PDFExtraItem[];
  depositAmount?: number;
}

export interface PDFBookingData {
  bookingReference: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerCountry?: string;
  drivingLicenceYear?: string | number;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYear?: number;
  vehicles?: PDFVehicleItem[];
  pickupLocation: string;
  returnLocation: string;
  pickupDate: string;
  returnDate: string;
  rentalDuration: number;
  dailyRate: number;
  subtotal: number;
  extrasTotal?: number;
  extras?: PDFExtraItem[];
  discountAmount?: number;
  pickupLocationFee?: number;
  returnLocationFee?: number;
  differentLocationFee?: number;
  outOfTownFee?: number;
  timbreFiscal?: number;
  contributionLF2026?: number;
  taxAmount?: number;
  totalAmount: number;
  depositAmount?: number;
  currency?: string;
  agencyName?: string;
  agencyPhone?: string;
  agencyEmail?: string;
  agencyAddress?: string;
  createdAt?: string;
  /** Booking status shown in the header (defaults to "confirmed"). */
  bookingStatus?: string;
  /** Physical car(s) assigned (shown to the customer on the voucher). */
  licensePlates?: string;
}

/**
 * Booking voucher ("Bon de réservation") in the agency colours, with the agency stamp and
 * signature at the bottom right and a customer signature box at the bottom left.
 */
export function generateBookingPDF(data: PDFBookingData): Buffer {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    // Deflate streams: keeps the voucher light enough for email / WhatsApp.
    compress: true,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLeft = 14;
  const marginRight = 14;
  const contentWidth = pageWidth - marginLeft - marginRight; // 182 mm
  const currency = data.currency || "TND";
  const agencyName = (data.agencyName || "Payless Car Rental Tunisie").toUpperCase();
  const agencyPhone = data.agencyPhone || "+216 80 80 80 80";
  const agencyEmail = data.agencyEmail || "contact@paylesscarrental.tn";
  const agencyAddress = data.agencyAddress || "60, Avenue de l'UMA, Chotrana 1, La Soukra, Ariana";
  // createdAt may arrive already formatted ("16/11/2026"): never re-parse it into "Invalid Date".
  const parsedCreated = data.createdAt ? new Date(data.createdAt) : new Date();
  const formattedDate =
    data.createdAt && Number.isNaN(parsedCreated.getTime())
      ? data.createdAt
      : parsedCreated.toLocaleDateString("fr-FR");

  // ==========================================
  // 1. TOP HEADER & INVOICE META TABLE
  // ==========================================
  let y = 14;

  // Navy header band with amber accent line
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 44, "F");
  doc.setFillColor(...AMBER);
  doc.rect(0, 44, pageWidth, 1.4, "F");

  // Left Side: Company Identity
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(agencyName, marginLeft, y + 5);

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(203, 213, 255);
  doc.text("HOUIMLI RENT A CAR SARL — Location de Véhicules Touristiques", marginLeft, y + 10.5);
  doc.text(`Adresse : ${agencyAddress}`, marginLeft, y + 15, { maxWidth: 104 });
  doc.text(`Tél : ${agencyPhone}  |  Email : ${agencyEmail}`, marginLeft, y + 19.5);
  doc.text("Matricule Fiscale : 1678942/A/P/000  |  Code TVA : 1678942 A", marginLeft, y + 24);

  // Right Side: white meta card on the band
  const metaBoxWidth = 72;
  const metaBoxX = pageWidth - marginRight - metaBoxWidth;
  const metaBoxY = y - 4;

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(metaBoxX, metaBoxY, metaBoxWidth, 32, 2, 2, "F");
  doc.setFillColor(...AMBER);
  doc.roundedRect(metaBoxX, metaBoxY, metaBoxWidth, 8, 2, 2, "F");
  doc.rect(metaBoxX, metaBoxY + 5, metaBoxWidth, 3, "F");
  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("BON DE RÉSERVATION", metaBoxX + metaBoxWidth / 2, metaBoxY + 5.6, { align: "center" });

  doc.setFontSize(8);
  doc.setTextColor(...INK);
  const metaRow = (label: string, value: string, ry: number, bold = false) => {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(label, metaBoxX + 3, ry);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...(bold ? BLUE : INK));
    doc.text(value, metaBoxX + metaBoxWidth - 3, ry, { align: "right" });
  };
  metaRow("N° Réf :", data.bookingReference, metaBoxY + 14, true);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.line(metaBoxX + 2, metaBoxY + 16, metaBoxX + metaBoxWidth - 2, metaBoxY + 16);
  metaRow("Date d'émission :", formattedDate, metaBoxY + 21);
  doc.line(metaBoxX + 2, metaBoxY + 23, metaBoxX + metaBoxWidth - 2, metaBoxY + 23);
  metaRow("Statut :", STATUS_LABELS[data.bookingStatus || "confirmed"] || "CONFIRMÉE", metaBoxY + 28);

  y = 51;

  // ==========================================
  // 2. TWO-COLUMN TABLE: CLIENT & VEHICLE
  // ==========================================
  const colWidth = (contentWidth - 4) / 2;
  const colHeight = 32;

  // --- Left Table: Client / Driver ---
  doc.setFillColor(...BLUE);
  doc.rect(marginLeft, y, colWidth, 6, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("1. INFORMATIONS DU CONDUCTEUR", marginLeft + 3, y + 4.2);

  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.rect(marginLeft, y + 6, colWidth, colHeight - 6, "D");

  doc.setTextColor(...INK);
  doc.setFontSize(8);

  const leftY = y + 10.5;
  doc.setFont("helvetica", "bold");
  doc.text("Nom & Prénom :", marginLeft + 3, leftY);
  doc.setFont("helvetica", "normal");
  doc.text(data.customerName || "Client", marginLeft + 28, leftY, { maxWidth: colWidth - 30 });

  doc.setFont("helvetica", "bold");
  doc.text("Tél / WhatsApp :", marginLeft + 3, leftY + 5);
  doc.setFont("helvetica", "normal");
  doc.text(data.customerPhone || "-", marginLeft + 28, leftY + 5, { maxWidth: colWidth - 30 });

  doc.setFont("helvetica", "bold");
  doc.text("Adresse Email :", marginLeft + 3, leftY + 10);
  doc.setFont("helvetica", "normal");
  doc.text(data.customerEmail || "-", marginLeft + 28, leftY + 10, { maxWidth: colWidth - 30 });

  doc.setFont("helvetica", "bold");
  doc.text("Permis de conduire :", marginLeft + 3, leftY + 15);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Validé${data.drivingLicenceYear ? ` (Année : ${data.drivingLicenceYear})` : ""}`,
    marginLeft + 32,
    leftY + 15
  );

  doc.setFont("helvetica", "bold");
  doc.text("Pays de résidence :", marginLeft + 3, leftY + 20);
  doc.setFont("helvetica", "normal");
  doc.text(data.customerCountry || "Tunisie", marginLeft + 32, leftY + 20);

  // --- Right Table: Vehicle Info ---
  const rightX = marginLeft + colWidth + 4;
  doc.setFillColor(...BLUE);
  doc.rect(rightX, y, colWidth, 6, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const isMultiCar = Boolean(data.vehicles && data.vehicles.length > 1);
  doc.text(
    isMultiCar
      ? `2. VÉHICULES RÉSERVÉS (${data.vehicles!.length} VÉHICULES)`
      : "2. VÉHICULE RÉSERVÉ",
    rightX + 3,
    y + 4.2
  );

  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.rect(rightX, y + 6, colWidth, colHeight - 6, "D");

  doc.setTextColor(...INK);
  const rightY = y + 10.5;

  doc.setFont("helvetica", "bold");
  doc.text(isMultiCar ? "Modèles réservés :" : "Modèle réservé :", rightX + 3, rightY);
  doc.setFont("helvetica", "bold");
  // Vehicle year is strictly hidden from client invoice
  const vehicleNameText = isMultiCar
    ? data.vehicles!.map((v) => `${v.brand} ${v.model}`).join(" + ")
    : `${data.vehicleBrand} ${data.vehicleModel}`;
  doc.text(vehicleNameText, rightX + 28, rightY, { maxWidth: colWidth - 30 });

  doc.setFont("helvetica", "bold");
  doc.text(data.licensePlates ? "Immatriculation :" : "Catégorie :", rightX + 3, rightY + 5);
  doc.setFont("helvetica", "normal");
  doc.text(data.licensePlates || "Économique / Standard Garantie", rightX + 28, rightY + 5, { maxWidth: colWidth - 30 });

  doc.setFont("helvetica", "bold");
  doc.text("Durée facturée :", rightX + 3, rightY + 10);
  doc.setFont("helvetica", "bold");
  doc.text(`${data.rentalDuration} Jour(s)`, rightX + 28, rightY + 10);

  doc.setFont("helvetica", "bold");
  doc.text("Kilométrage :", rightX + 3, rightY + 15);
  doc.setFont("helvetica", "normal");
  doc.text("Illimité sur toute la Tunisie", rightX + 28, rightY + 15);

  y += colHeight + 3.5;

  // ==========================================
  // 3. FULL-WIDTH TABLE: ITINERARY & SCHEDULE (PRISE EN CHARGE & RESTITUTION)
  // ==========================================

  // Clean location labels (stripping leading "1. ", "2. ", etc.)
  const cleanPickupLoc = (data.pickupLocation || "Aéroport Tunis-Carthage").replace(/^\d+[\.\s\-]+\s*/, "").trim();
  const cleanReturnLoc = (data.returnLocation || "Aéroport Tunis-Carthage").replace(/^\d+[\.\s\-]+\s*/, "").trim();

  // Layout constants
  const halfWidth = (contentWidth - 4) / 2;
  const ITIN_HEADER_H = 6;
  const ITIN_ROW_H = 8;    // per data row — tall enough for wrapped location text
  const ITIN_ROWS = 2;     // "Date & Heure" + "Lieu / Agence"
  const itinBodyH = ITIN_ROWS * ITIN_ROW_H;
  const itinTotalH = ITIN_HEADER_H + itinBodyH;

  const LABEL_W = 26;                          // mm for the bold label
  const VALUE_MAX_W = halfWidth - LABEL_W - 6; // remaining for value text

  // Headers (Solid Black with White Text)
  doc.setFillColor(...BLUE);
  doc.rect(marginLeft, y, halfWidth, ITIN_HEADER_H, "F");
  doc.rect(marginLeft + halfWidth + 4, y, halfWidth, ITIN_HEADER_H, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("3. PRISE EN CHARGE DU VÉHICULE", marginLeft + 3, y + 4.2);
  doc.text("4. RESTITUTION DU VÉHICULE", marginLeft + halfWidth + 7, y + 4.2);

  // Bordered Content Boxes
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.rect(marginLeft, y + ITIN_HEADER_H, halfWidth, itinBodyH, "D");
  doc.rect(marginLeft + halfWidth + 4, y + ITIN_HEADER_H, halfWidth, itinBodyH, "D");

  // Inner horizontal divider between row A and row B
  const innerDivY = y + ITIN_HEADER_H + ITIN_ROW_H;
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.line(marginLeft + 1, innerDivY, marginLeft + halfWidth - 1, innerDivY);
  doc.line(marginLeft + halfWidth + 5, innerDivY, marginLeft + halfWidth + 4 + halfWidth - 1, innerDivY);

  doc.setTextColor(...INK);
  doc.setFontSize(8);

  // ---- Left column: Prise en charge ----
  const leftBodyStartY = y + ITIN_HEADER_H;

  // Row A: Date & Heure
  doc.setFont("helvetica", "bold");
  doc.text("Date & Heure :", marginLeft + 3, leftBodyStartY + 5.2);
  doc.setFont("helvetica", "normal");
  doc.text(data.pickupDate, marginLeft + 3 + LABEL_W, leftBodyStartY + 5.2, { maxWidth: VALUE_MAX_W });

  // Row B: Lieu / Agence — starts after first row
  doc.setFont("helvetica", "bold");
  doc.text("Lieu / Agence :", marginLeft + 3, leftBodyStartY + ITIN_ROW_H + 5.2);
  doc.setFont("helvetica", "normal");
  doc.text(cleanPickupLoc, marginLeft + 3 + LABEL_W, leftBodyStartY + ITIN_ROW_H + 5.2, { maxWidth: VALUE_MAX_W });

  // ---- Right column: Restitution ----
  const rightItinX = marginLeft + halfWidth + 4;
  const rightBodyStartY = y + ITIN_HEADER_H;

  // Row A: Date & Heure
  doc.setFont("helvetica", "bold");
  doc.text("Date & Heure :", rightItinX + 3, rightBodyStartY + 5.2);
  doc.setFont("helvetica", "normal");
  doc.text(data.returnDate, rightItinX + 3 + LABEL_W, rightBodyStartY + 5.2, { maxWidth: VALUE_MAX_W });

  // Row B: Lieu / Agence
  doc.setFont("helvetica", "bold");
  doc.text("Lieu / Agence :", rightItinX + 3, rightBodyStartY + ITIN_ROW_H + 5.2);
  doc.setFont("helvetica", "normal");
  doc.text(cleanReturnLoc, rightItinX + 3 + LABEL_W, rightBodyStartY + ITIN_ROW_H + 5.2, { maxWidth: VALUE_MAX_W });

  y += itinTotalH + 3.5;

  // ==========================================
  // 3. DETAILED INVOICE TABLE (BLACK & WHITE)
  // ==========================================
  const col1W = 96;  // Description
  const col2W = 24;  // Qty / Duration
  const col3W = 28;  // Unit Price
  const col4W = 34;  // Total

  const col1X = marginLeft;
  const col2X = col1X + col1W;
  const col3X = col2X + col2W;
  const col4X = col3X + col3W;

  // Table Header
  doc.setFillColor(...BLUE);
  doc.rect(marginLeft, y, contentWidth, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("DÉSIGNATION DE LA PRESTATION", col1X + 3, y + 4.8);
  doc.text("QTÉ / DURÉE", col2X + col2W / 2, y + 4.8, { align: "center" });
  doc.text(`P.U. (${currency})`, col3X + col3W - 3, y + 4.8, { align: "right" });
  doc.text(`TOTAL (${currency})`, col4X + col4W - 3, y + 4.8, { align: "right" });

  y += 7;

  // Items Rows
  interface InvoiceRow {
    desc: string;
    qty: string;
    unitPrice: string;
    total: string;
    isOption?: boolean;
  }

  const invoiceRows: InvoiceRow[] = [];

  if (data.vehicles && data.vehicles.length > 0) {
    data.vehicles.forEach((vItem, idx) => {
      const dur = vItem.rentalDuration || data.rentalDuration;
      const vehicleExtras =
        vItem.extras?.length ? vItem.extras : data.vehicles?.length === 1 ? data.extras : undefined;
      invoiceRows.push({
        desc: `Location #${idx + 1} — ${vItem.brand} ${vItem.model}`,
        qty: `${dur} j`,
        unitPrice: (vItem.dailyRate / 100).toFixed(2),
        total: (vItem.subtotal / 100).toFixed(2),
      });

      if (vehicleExtras?.length) {
        vehicleExtras.forEach((extra) => {
          const lineTotal =
            typeof extra.lineTotal === "number"
              ? extra.lineTotal
              : extraLineTotal(extra.price || 0, extra.quantity, vItem.rentalDuration || data.rentalDuration, extra.pricingType);
          invoiceRows.push({
            desc: isMultiCar ? `${extra.name} (${vItem.brand} ${vItem.model})` : extra.name,
            qty: `x${extra.quantity}`,
            unitPrice: typeof extra.price === "number" ? (extra.price / 100).toFixed(2) : "-",
            total: (lineTotal / 100).toFixed(2),
            isOption: true,
          });
        });
      } else if (vItem.extrasTotal && vItem.extrasTotal > 0) {
        invoiceRows.push({
          desc: isMultiCar ? `Options & Équipements (${vItem.brand} ${vItem.model})` : "Options & Équipements",
          qty: "1 forfait",
          unitPrice: (vItem.extrasTotal / 100).toFixed(2),
          total: (vItem.extrasTotal / 100).toFixed(2),
        });
      }
    });
  } else {
    invoiceRows.push({
      desc: `Location de base — ${data.vehicleBrand} ${data.vehicleModel}`,
      qty: `${data.rentalDuration} j`,
      unitPrice: (data.dailyRate / 100).toFixed(2),
      total: (data.subtotal / 100).toFixed(2),
    });

    if (data.extras?.length) {
      data.extras.forEach((extra) => {
        const lineTotal =
          typeof extra.lineTotal === "number"
            ? extra.lineTotal
            : extraLineTotal(extra.price || 0, extra.quantity, data.rentalDuration, extra.pricingType);
        invoiceRows.push({
          desc: extra.name,
          qty: `x${extra.quantity}`,
          unitPrice: typeof extra.price === "number" ? (extra.price / 100).toFixed(2) : "-",
          total: (lineTotal / 100).toFixed(2),
          isOption: true,
        });
      });
    } else if (data.extrasTotal && data.extrasTotal > 0) {
      invoiceRows.push({
        desc: "Options & Équipements supplémentaires",
        qty: "1 forfait",
        unitPrice: (data.extrasTotal / 100).toFixed(2),
        total: (data.extrasTotal / 100).toFixed(2),
      });
    }
  }

  if (data.pickupLocationFee && data.pickupLocationFee > 0) {
    invoiceRows.push({
      desc: `Frais de livraison / prise en charge (${data.pickupLocation})`,
      qty: "1 service",
      unitPrice: (data.pickupLocationFee / 100).toFixed(2),
      total: (data.pickupLocationFee / 100).toFixed(2),
    });
  }

  if (data.returnLocationFee && data.returnLocationFee > 0) {
    invoiceRows.push({
      desc: `Frais de ramassage / restitution (${data.returnLocation})`,
      qty: "1 service",
      unitPrice: (data.returnLocationFee / 100).toFixed(2),
      total: (data.returnLocationFee / 100).toFixed(2),
    });
  } else if (data.outOfTownFee && data.outOfTownFee > 0) {
    invoiceRows.push({
      desc: `Frais de restitution hors Tunis (${data.returnLocation})`,
      qty: "1 service",
      unitPrice: (data.outOfTownFee / 100).toFixed(2),
      total: (data.outOfTownFee / 100).toFixed(2),
    });
  }

  if (data.differentLocationFee && data.differentLocationFee > 0) {
    invoiceRows.push({
      desc: "Frais de retour en agence différente (Aller-simple)",
      qty: "1 service",
      unitPrice: (data.differentLocationFee / 100).toFixed(2),
      total: (data.differentLocationFee / 100).toFixed(2),
    });
  }

  if (data.timbreFiscal && data.timbreFiscal > 0) {
    invoiceRows.push({
      desc: "Timbre fiscal légal obligatoire",
      qty: "1 unité",
      unitPrice: (data.timbreFiscal / 100).toFixed(2),
      total: (data.timbreFiscal / 100).toFixed(2),
    });
  }

  if (data.contributionLF2026 && data.contributionLF2026 > 0) {
    invoiceRows.push({
      desc: `Contribution Fiscale LF 2026 (${data.rentalDuration} jours)`,
      qty: `${data.rentalDuration} j`,
      unitPrice: (data.contributionLF2026 / data.rentalDuration / 100).toFixed(2),
      total: (data.contributionLF2026 / 100).toFixed(2),
    });
  }

  if (data.discountAmount && data.discountAmount > 0) {
    invoiceRows.push({
      desc: "Remise promotionnelle / Code de réduction appliqué",
      qty: "1 remise",
      unitPrice: `-${(data.discountAmount / 100).toFixed(2)}`,
      total: `-${(data.discountAmount / 100).toFixed(2)}`,
    });
  }

  // Filter out any line items that are 0 DT or empty
  const filteredInvoiceRows = invoiceRows.filter((r) => {
    const val = parseFloat(r.total.replace("-", ""));
    return !isNaN(val) && (val > 0 || Boolean(r.isOption));
  });

  const tableStartY = y;
  const rowLineHeight = 3.5;
  doc.setFontSize(8);

  filteredInvoiceRows.forEach((row, index) => {
    const descriptionLines = doc.splitTextToSize(row.desc, col1W - 6) as string[];
    const rowHeight = Math.max(6.2, descriptionLines.length * rowLineHeight + 2.5);

    // Alternating rows in white and very light grey
    if (index % 2 === 1) {
      doc.setFillColor(...TINT);
      doc.rect(marginLeft, y, contentWidth, rowHeight, "F");
    }

    // Outer and inner borders
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.2);
    doc.line(marginLeft, y + rowHeight, marginLeft + contentWidth, y + rowHeight);

    // Vertical column grid lines
    doc.line(col2X, y, col2X, y + rowHeight);
    doc.line(col3X, y, col3X, y + rowHeight);
    doc.line(col4X, y, col4X, y + rowHeight);

    // Text cells
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "normal");
    const textY = y + rowHeight / 2 - ((descriptionLines.length - 1) * rowLineHeight) / 2 + 1.2;
    doc.text(descriptionLines, col1X + 3, textY);
    const valueY = y + rowHeight / 2 + 1.2;
    doc.text(row.qty, col2X + col2W / 2, valueY, { align: "center" });
    doc.text(row.unitPrice, col3X + col3W - 3, valueY, { align: "right" });
    doc.text(row.total, col4X + col4W - 3, valueY, { align: "right" });

    y += rowHeight;
  });

  // Table outer border
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.rect(marginLeft, tableStartY, contentWidth, y - tableStartY, "D");

  y += 3;

  // ==========================================
  // 4. TOTALS TABLE (SUMMARY BOX - RIGHT ALIGNED)
  // ==========================================
  const totalBoxWidth = 86;
  const totalBoxX = pageWidth - marginRight - totalBoxWidth;

  // TOTAL TTC ROW (SOLID BLACK BACKGROUND WITH WHITE TEXT)
  doc.setFillColor(...NAVY);
  doc.rect(totalBoxX, y, totalBoxWidth, 9, "F");
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.rect(totalBoxX, y, totalBoxWidth, 9, "D");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("TOTAL NET TTC À PAYER :", totalBoxX + 3, y + 6);
  doc.setTextColor(...AMBER);
  doc.setFontSize(11);
  doc.text(`${(data.totalAmount / 100).toFixed(2)} ${currency}`, totalBoxX + totalBoxWidth - 3, y + 6.2, {
    align: "right",
  });

  y += 12;

  // Deposit note (Bordered Table Row)
  if (data.depositAmount && data.depositAmount > 0) {
    doc.setFillColor(255, 248, 225);
    doc.setDrawColor(...AMBER);
    doc.setLineWidth(0.3);
    doc.rect(marginLeft, y, contentWidth, 7, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text(
      `Dépôt de garantie / Caution : ${(data.depositAmount / 100).toFixed(2)} ${currency} (empreinte bancaire non débitée, restituée au retour) ou par Cash.`,
      marginLeft + 3,
      y + 4.7
    );
    y += 10;
  } else {
    y += 2;
  }

  // ==========================================
  // 5. TERMS & CONDITIONS (BORDERED TABLE)
  // ==========================================
  const termsBoxHeight = 24;
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.rect(marginLeft, y, contentWidth, termsBoxHeight, "D");

  // Title of terms
  doc.setFillColor(...TINT);
  doc.rect(marginLeft, y, contentWidth, 5, "F");
  doc.line(marginLeft, y + 5, marginLeft + contentWidth, y + 5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...INK);
  doc.setTextColor(...NAVY);
  doc.text("CONDITIONS GÉNÉRALES & PIÈCES EXIGÉES LORS DU DÉPART :", marginLeft + 3, y + 3.7);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(40, 40, 40);

  const tY = y + 8.5;
  doc.text(
    "1. Présentation obligatoire de l'original du permis de conduire valide (minimum 1 an d'ancienneté) et passeport ou CIN.",
    marginLeft + 3,
    tY
  );
  doc.text(
    "2. Le règlement s'effectue à la prise en charge du véhicule (Espèces en TND, devises convertibles, ou carte bancaire).",
    marginLeft + 3,
    tY + 4
  );
  doc.text(
    "3. Le véhicule doit être restitué avec le même niveau de carburant qu'à la livraison et dans le même état de propreté.",
    marginLeft + 3,
    tY + 8
  );
  doc.text(
    `4. Assistance dépannage et remorquage 24h/24 & 7j/7 disponible sur l'ensemble de la Tunisie au : ${agencyPhone}.`,
    marginLeft + 3,
    tY + 12
  );

  y += termsBoxHeight + 5;

  // ==========================================
  // 6. SIGNATURES — customer (left) / agency stamp & signature (right)
  // ==========================================
  const stampW = 62;
  const stampH = stampW / STAMP_SIGNATURE_RATIO;
  const blockH = stampH + 7;
  const footerTop = pageHeight - 13;
  if (y + blockH > footerTop) {
    doc.addPage();
    y = 16;
  }
  // Anchor the block at the bottom of the page for a consistent look.
  const blockY = Math.max(y, footerTop - blockH - 2);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...NAVY);
  doc.text("BON POUR ACCORD — LE CLIENT", marginLeft, blockY + 3);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.roundedRect(marginLeft, blockY + 5, 70, stampH - 2, 2, 2, "D");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text("Signature précédée de « Lu et approuvé »", marginLeft + 3, blockY + stampH);

  const stampX = pageWidth - marginRight - stampW;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...NAVY);
  doc.text("CACHET & SIGNATURE DE L'AGENCE", stampX + stampW, blockY + 3, { align: "right" });
  try {
    doc.addImage(STAMP_SIGNATURE_PNG, "PNG", stampX, blockY + 5, stampW, stampH, "agency-stamp", "SLOW");
  } catch (err) {
    console.error("Stamp image could not be embedded:", err);
  }

  // ==========================================
  // 7. FOOTER (every page)
  // ==========================================
  const pages = doc.getNumberOfPages();
  for (let pg = 1; pg <= pages; pg++) {
    doc.setPage(pg);
    doc.setFillColor(...NAVY);
    doc.rect(0, pageHeight - 10, pageWidth, 10, "F");
    doc.setFillColor(...AMBER);
    doc.rect(0, pageHeight - 10, pageWidth, 0.8, "F");
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(203, 213, 255);
    doc.text(
      `Document généré le ${new Date().toLocaleString("fr-FR")} | ${agencyName} — Houimli Rent a Car SARL | Page ${pg}/${pages}`,
      pageWidth / 2,
      pageHeight - 4,
      { align: "center" }
    );
  }

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
