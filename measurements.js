const KG_TO_LB = 2.2046226218;
const CM_PER_IN = 2.54;
const round1 = (n) => Math.round(n * 10) / 10;
const present = (v) => String(v ?? "").trim() !== "";

export const measurementSystem = (data = {}) => data.units === "lb" ? "imperial" : "metric";

export function switchMeasurementSystem(data = {}, target = "metric") {
  const next = { ...data };
  if (target === "imperial") {
    if (measurementSystem(data) === "metric" && present(data.height)) {
      const totalInches = Math.round(Number(data.height) / CM_PER_IN);
      next.heightFt = String(Math.floor(totalInches / 12));
      next.heightIn = String(totalInches % 12);
    }
    if (measurementSystem(data) === "metric" && present(data.weight)) next.weight = String(round1(Number(data.weight) * KG_TO_LB));
    next.units = "lb";
    return next;
  }
  if (measurementSystem(data) === "imperial" && (present(data.heightFt) || present(data.heightIn))) {
    next.height = String(Math.round(((Number(data.heightFt) || 0) * 12 + (Number(data.heightIn) || 0)) * CM_PER_IN));
  }
  if (measurementSystem(data) === "imperial" && present(data.weight)) next.weight = String(round1(Number(data.weight) / KG_TO_LB));
  next.units = "kg";
  return next;
}

export function validateMeasurements(data = {}) {
  const errors = {};
  if (measurementSystem(data) === "metric") {
    if (present(data.height) && !(Number(data.height) >= 100 && Number(data.height) <= 250)) errors.height = "Enter a height from 100 to 250 cm.";
    if (present(data.weight) && !(Number(data.weight) >= 30 && Number(data.weight) <= 350)) errors.weight = "Enter a weight from 30 to 350 kg.";
  } else {
    if (present(data.heightIn) && !(Number(data.heightIn) >= 0 && Number(data.heightIn) <= 11)) errors.heightIn = "Inches must be from 0 to 11.";
    const total = (Number(data.heightFt) || 0) * 12 + (Number(data.heightIn) || 0);
    if ((present(data.heightFt) || present(data.heightIn)) && !(total >= 39 && total <= 98)) errors.heightFt = "Enter a height from 3 ft 3 in to 8 ft 2 in.";
    if (present(data.weight) && !(Number(data.weight) >= 66 && Number(data.weight) <= 772)) errors.weight = "Enter a weight from 66 to 772 lb.";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function bodyweightKg(data = {}) {
  if (!present(data.weight)) return null;
  const value = Number(data.weight);
  if (!Number.isFinite(value) || value <= 0) return null;
  return measurementSystem(data) === "imperial" ? value / KG_TO_LB : value;
}
