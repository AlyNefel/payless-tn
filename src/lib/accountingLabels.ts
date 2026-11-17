/** Client-safe labels shared by the accounting screens, exports and PDFs. */
export const EXPENSE_LABELS: Record<string, string> = {
  fuel: "Carburant",
  maintenance: "Entretien & réparations",
  insurance: "Assurance",
  taxes: "Vignette, taxes & visite technique",
  salaries: "Salaires & charges",
  rent: "Loyer",
  cleaning: "Lavage & nettoyage",
  fines: "Amendes & péages",
  leasing: "Leasing & crédits",
  marketing: "Publicité & marketing",
  utilities: "Eau, électricité, internet, téléphone",
  office: "Fournitures de bureau",
  bank: "Frais bancaires",
  other: "Autre",
};
export const METHOD_LABELS: Record<string, string> = {
  cash: "Espèces",
  card: "Carte bancaire",
  bank_transfer: "Virement",
  cheque: "Chèque",
  online: "Paiement en ligne",
  other: "Autre",
};
export const KIND_LABELS: Record<string, string> = {
  payment: "Paiement",
  deposit: "Caution encaissée",
  refund: "Remboursement",
  deposit_refund: "Caution restituée",
};
export const dt = (minor: number | undefined | null, digits = 3) =>
  `${(Math.round(Number(minor || 0)) / 100).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} DT`;
