const KG_TO_LB = 2.2046226218;
const CM_PER_IN = 2.54;
const round1 = (n) => Math.round(n * 10) / 10;
const present = (v) => String(v ?? "").trim() !== "";
const finite = (v) => present(v) && Number.isFinite(Number(v));
const finiteIfPresent = (v) => !present(v) || Number.isFinite(Number(v));
const clamp = (value, min, max, allowed) => allowed ? Math.min(max, Math.max(min, value)) : value;
const CORRECTIONS_KEY = "__measurementCorrections";
const correctionState = (data) => data?.[CORRECTIONS_KEY] && typeof data[CORRECTIONS_KEY] === "object" ? data[CORRECTIONS_KEY] : {};

export const measurementSystem = (data = {}) => data.units === "lb" ? "imperial" : "metric";

export function clearMeasurementCorrection(data = {}, field) {
  const correction = field === "weight" ? "weight" : ["height", "heightFt", "heightIn"].includes(field) ? "height" : null;
  const corrections = correctionState(data);
  if (!correction || !corrections[correction]) return data;
  const next = { ...data };
  const remaining = { ...corrections };
  delete remaining[correction];
  if (Object.keys(remaining).length) next[CORRECTIONS_KEY] = remaining;
  else delete next[CORRECTIONS_KEY];
  return next;
}

export function switchMeasurementSystem(data = {}, target = "metric") {
  const next = { ...data };
  const targetSystem = target === "imperial" ? "imperial" : "metric";
  let sourceErrors = {};
  if (measurementSystem(data) !== targetSystem) {
    sourceErrors = validateMeasurements(data).errors;
    const corrections = { ...correctionState(data) };
    if (sourceErrors.weight) corrections.weight = true;
    if (sourceErrors.height || sourceErrors.heightFt || sourceErrors.heightIn) corrections.height = true;
    if (Object.keys(corrections).length) next[CORRECTIONS_KEY] = corrections;
  }
  const sourceWeightValid = !sourceErrors.weight;
  const sourceHeightValid = !sourceErrors.height && !sourceErrors.heightFt && !sourceErrors.heightIn;
  if (target === "imperial") {
    if (measurementSystem(data) === "metric" && finite(data.height)) {
      const totalInches = clamp(Math.round(Number(data.height) / CM_PER_IN), 39, 98, sourceHeightValid);
      next.heightFt = String(Math.floor(totalInches / 12));
      next.heightIn = String(totalInches % 12);
    } else if (measurementSystem(data) === "metric" && present(data.height)) {
      delete next.heightFt;
      delete next.heightIn;
    }
    if (measurementSystem(data) === "metric" && finite(data.weight)) {
      next.weight = String(clamp(round1(Number(data.weight) * KG_TO_LB), 66, 772, sourceWeightValid));
    }
    next.units = "lb";
    return next;
  }
  if (measurementSystem(data) === "imperial" && (present(data.heightFt) || present(data.heightIn)) && finiteIfPresent(data.heightFt) && finiteIfPresent(data.heightIn)) {
    const height = Math.round(((Number(data.heightFt) || 0) * 12 + (Number(data.heightIn) || 0)) * CM_PER_IN);
    next.height = String(clamp(height, 100, 250, sourceHeightValid));
  } else if (measurementSystem(data) === "imperial" && (present(data.heightFt) || present(data.heightIn))) {
    delete next.height;
  }
  if (measurementSystem(data) === "imperial" && finite(data.weight)) {
    next.weight = String(clamp(round1(Number(data.weight) / KG_TO_LB), 30, 350, sourceWeightValid));
  }
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
  const corrections = correctionState(data);
  if (corrections.height && measurementSystem(data) === "metric" && !errors.height) errors.height = "Edit the converted height to confirm a value from 100 to 250 cm.";
  if (corrections.height && measurementSystem(data) === "imperial" && !errors.heightFt && !errors.heightIn) errors.heightFt = "Edit the converted height to confirm a value from 3 ft 3 in to 8 ft 2 in.";
  if (corrections.weight && !errors.weight) {
    errors.weight = measurementSystem(data) === "imperial"
      ? "Edit the converted weight to confirm a value from 66 to 772 lb."
      : "Edit the converted weight to confirm a value from 30 to 350 kg.";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function bodyweightKg(data = {}) {
  if (!present(data.weight)) return null;
  if (validateMeasurements(data).errors.weight) return null;
  const value = Number(data.weight);
  if (!Number.isFinite(value) || value <= 0) return null;
  return measurementSystem(data) === "imperial" ? value / KG_TO_LB : value;
}
