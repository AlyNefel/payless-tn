import { isStaffRequest } from "./apiAuth";

/**
 * Customer-facing booking endpoints are protected by "something you know":
 * the booking reference AND the email address used at booking time.
 * Back-office staff (verified session) bypass the email proof.
 */
export async function canAccessBooking(
  booking: { customerId?: unknown } | null | undefined,
  emailProof: string | null | undefined
): Promise<boolean> {
  if (!booking) return false;
  if (await isStaffRequest()) return true;

  const customer = booking.customerId as { email?: string } | null | undefined;
  const expected = customer?.email?.toLowerCase().trim();
  const provided = emailProof?.toLowerCase().trim();
  return Boolean(expected && provided && expected === provided);
}

export const BOOKING_ACCESS_DENIED = {
  success: false,
  error: "Référence ou adresse email incorrecte.",
};
