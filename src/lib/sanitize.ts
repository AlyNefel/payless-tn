/**
 * Data Sanitization Module
 * Enforces strict confidentiality by stripping internal fleet management data,
 * vehicle license plates, mileage, colors, and administrative notes from client-facing responses.
 */

export function sanitizeVehicleForClient<T extends Record<string, any>>(vehicle: T): Partial<T> {
  if (!vehicle || typeof vehicle !== "object") return vehicle;

  const sanitized = { ...vehicle };

  // Strip sensitive client-facing vehicle information (visible exclusively to admins)
  delete sanitized.year;
  delete sanitized.licensePlate;
  delete sanitized.mileage;
  delete sanitized.lastVidangeMileage;
  delete sanitized.nextVidangeMileage;
  delete sanitized.vidangeInterval;
  delete sanitized.color;
  delete sanitized.vin;
  delete sanitized.garageNotes;
  delete sanitized.maintenanceNotes;
  delete sanitized.technicalInspectionDate;
  delete sanitized.insuranceInfo;
  // Physical cars (plates, mileage, maintenance) are back-office data.
  delete sanitized.units;

  return sanitized;
}

export function sanitizeBookingForClient<T extends Record<string, any>>(booking: T): Partial<T> {
  if (!booking || typeof booking !== "object") return booking;

  const sanitized: Record<string, any> = { ...booking };

  // Strip internal administrator notes and sensitive audits
  delete sanitized.internalNotes;
  // Internal fleet / operations data never leaves the back-office.
  delete sanitized.assignedUnits;
  delete sanitized.auditHistory;
  delete sanitized.pickupMileage;
  delete sanitized.returnMileage;
  delete sanitized.extensions;
  delete sanitized.createdBy;
  if (Array.isArray(sanitized.vehicles)) {
    sanitized.vehicles = sanitized.vehicles.map((v: any) =>
      v && typeof v.vehicleId === "object" && v.vehicleId ? { ...v, vehicleId: sanitizeVehicleForClient(v.vehicleId) } : v
    );
  }

  // Sanitize nested vehicle if populated
  if (sanitized.vehicleId && typeof sanitized.vehicleId === "object") {
    sanitized.vehicleId = sanitizeVehicleForClient(sanitized.vehicleId);
  }

  return sanitized as Partial<T>;
}

