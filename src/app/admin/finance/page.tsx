"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * The former finance page computed money from booking statuses (latest bookings only) and could
 * contradict the payment ledger. Every figure now comes from Comptabilité.
 */
export default function FinanceRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/accounting");
  }, [router]);
  return (
    <div className="py-20 flex flex-col items-center gap-2 text-sm text-slate-500">
      <Loader2 className="w-5 h-5 animate-spin" /> Redirection vers la comptabilité…
    </div>
  );
}
