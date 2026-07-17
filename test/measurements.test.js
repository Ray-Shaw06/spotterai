import test from "node:test";
import assert from "node:assert/strict";
import { bodyweightKg, switchMeasurementSystem, validateMeasurements } from "../measurements.js";

test("metric values convert to explicit imperial fields and back", () => {
  const imperial = switchMeasurementSystem({ units: "kg", height: "178", weight: "75" }, "imperial");
  assert.deepEqual({ units: imperial.units, feet: imperial.heightFt, inches: imperial.heightIn }, { units: "lb", feet: "5", inches: "10" });
  assert.ok(Math.abs(Number(imperial.weight) - 165.3) < 0.1);
  const metric = switchMeasurementSystem(imperial, "metric");
  assert.ok(Math.abs(Number(metric.height) - 178) <= 1);
  assert.ok(Math.abs(Number(metric.weight) - 75) <= 0.1);
});

test("optional blanks pass while impossible values receive field errors", () => {
  assert.equal(validateMeasurements({ units: "kg" }).valid, true);
  assert.equal(validateMeasurements({ units: "kg", height: "80" }).errors.height, "Enter a height from 100 to 250 cm.");
  assert.equal(validateMeasurements({ units: "lb", heightFt: "5", heightIn: "12" }).errors.heightIn, "Inches must be from 0 to 11.");
  assert.equal(validateMeasurements({ units: "lb", weight: "20" }).errors.weight, "Enter a weight from 66 to 772 lb.");
});

test("nutrition always receives kilograms", () => {
  assert.equal(bodyweightKg({ units: "kg", weight: "80" }), 80);
  assert.ok(Math.abs(bodyweightKg({ units: "lb", weight: "220" }) - 99.79) < 0.1);
  assert.equal(bodyweightKg({ units: "kg", weight: "" }), null);
});
