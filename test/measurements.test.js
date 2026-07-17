import test from "node:test";
import assert from "node:assert/strict";
import * as measurements from "../measurements.js";

const { bodyweightKg, switchMeasurementSystem, validateMeasurements } = measurements;

test("metric values convert to explicit imperial fields and back", () => {
  const imperial = switchMeasurementSystem({ units: "kg", height: "178", weight: "75" }, "imperial");
  assert.deepEqual({ units: imperial.units, feet: imperial.heightFt, inches: imperial.heightIn }, { units: "lb", feet: "5", inches: "10" });
  assert.ok(Math.abs(Number(imperial.weight) - 165.3) < 0.1);
  const metric = switchMeasurementSystem(imperial, "metric");
  assert.ok(Math.abs(Number(metric.height) - 178) <= 1);
  assert.ok(Math.abs(Number(metric.weight) - 75) <= 0.1);
});

test("published imperial boundaries clamp to valid metric boundaries", () => {
  const lowWeight = switchMeasurementSystem({ units: "lb", weight: "66" }, "metric");
  assert.equal(lowWeight.weight, "30");
  assert.equal(validateMeasurements(lowWeight).valid, true);
  assert.equal(bodyweightKg(lowWeight), 30);

  const highWeight = switchMeasurementSystem({ units: "lb", weight: "772" }, "metric");
  assert.equal(highWeight.weight, "350");
  assert.equal(validateMeasurements(highWeight).valid, true);
  assert.equal(bodyweightKg(highWeight), 350);

  const shortHeight = switchMeasurementSystem({ units: "lb", heightFt: "3", heightIn: "3" }, "metric");
  assert.equal(shortHeight.height, "100");
  assert.equal(validateMeasurements(shortHeight).valid, true);
});

test("boundary clamping is field-local and leaves ordinary valid conversions equivalent", () => {
  const ordinary = switchMeasurementSystem({ units: "lb", weight: "220", heightFt: "5", heightIn: "10" }, "metric");
  assert.deepEqual(
    { weight: ordinary.weight, height: ordinary.height },
    { weight: "99.8", height: "178" },
  );
  assert.equal(validateMeasurements(ordinary).valid, true);

  const mixed = switchMeasurementSystem({ units: "lb", weight: "66", heightFt: "2", heightIn: "0" }, "metric");
  assert.equal(mixed.weight, "30");
  assert.equal(validateMeasurements(mixed).errors.weight, undefined);
  assert.ok(validateMeasurements(mixed).errors.height);
});

test("boundary clamping never rescues source-invalid imperial measurements", () => {
  for (const [weight, converted] of [["65.9", "29.9"], ["772.1", "350.2"]]) {
    const metric = switchMeasurementSystem({ units: "lb", weight }, "metric");
    assert.equal(metric.weight, converted);
    assert.equal(validateMeasurements(metric).valid, false, `${weight} lb must remain invalid after conversion`);
    assert.match(validateMeasurements(metric).errors.weight, /edit the converted weight|30 to 350 kg/i);
    assert.equal(bodyweightKg(metric), null);
  }

  const metric = switchMeasurementSystem({ units: "lb", heightFt: "3", heightIn: "2.9" }, "metric");
  assert.equal(metric.height, "99");
  assert.equal(validateMeasurements(metric).valid, false);
  assert.match(validateMeasurements(metric).errors.height, /edit the converted height|100 to 250 cm/i);
});

test("unit switching leaves invalid measurement text correctable instead of producing NaN", () => {
  const imperial = switchMeasurementSystem({ units: "kg", height: "oops", weight: "-" }, "imperial");

  assert.equal(imperial.units, "lb");
  assert.equal(imperial.height, "oops");
  assert.equal(imperial.weight, "-");
  assert.equal(imperial.heightFt, undefined);
  assert.equal(imperial.heightIn, undefined);
  assert.doesNotMatch(JSON.stringify(imperial), /NaN/);
});

test("finite out-of-range weights convert without becoming valid nutrition inputs", () => {
  const metric = switchMeasurementSystem({ units: "lb", weight: "50" }, "metric");
  assert.equal(metric.weight, "22.7");
  assert.match(validateMeasurements(metric).errors.weight, /30 to 350 kg/);
  assert.equal(bodyweightKg(metric), null);

  const imperial = switchMeasurementSystem({ units: "kg", weight: "400" }, "imperial");
  assert.equal(imperial.weight, "881.8");
  assert.match(validateMeasurements(imperial).errors.weight, /66 to 772 lb/);
  assert.equal(bodyweightKg(imperial), null);
});

test("rounded weight conversions preserve source-invalid state at both metric boundaries", () => {
  for (const [weight, converted] of [["29.95", "66"], ["29.99", "66.1"], ["350.1", "771.8"]]) {
    const imperial = switchMeasurementSystem({ units: "kg", weight }, "imperial");
    assert.equal(imperial.weight, converted);
    assert.equal(validateMeasurements(imperial).valid, false, `${weight} kg must remain invalid after conversion`);
    assert.match(validateMeasurements(imperial).errors.weight, /edit the converted weight/i);
    assert.equal(bodyweightKg(imperial), null);
  }

  const roundTrip = switchMeasurementSystem(
    switchMeasurementSystem({ units: "kg", weight: "29.99" }, "imperial"),
    "metric",
  );
  assert.equal(roundTrip.weight, "30");
  assert.equal(validateMeasurements(roundTrip).valid, false);
  assert.equal(bodyweightKg(roundTrip), null);
});

test("rounded height conversions preserve source-invalid state across metric and imperial boundaries", () => {
  for (const [height, feet, inches] of [["99.9", "3", "3"], ["250.1", "8", "2"]]) {
    const imperial = switchMeasurementSystem({ units: "kg", height }, "imperial");
    assert.deepEqual([imperial.heightFt, imperial.heightIn], [feet, inches]);
    assert.equal(validateMeasurements(imperial).valid, false, `${height} cm must remain invalid after conversion`);
    assert.match(validateMeasurements(imperial).errors.heightFt, /edit the converted height/i);
  }

  const metric = switchMeasurementSystem({ units: "lb", heightFt: "8", heightIn: "2.1" }, "metric");
  assert.equal(metric.height, "249");
  assert.equal(validateMeasurements(metric).valid, false);
  assert.match(validateMeasurements(metric).errors.height, /edit the converted height/i);

  const roundTrip = switchMeasurementSystem(
    switchMeasurementSystem({ units: "kg", height: "250.1" }, "imperial"),
    "metric",
  );
  assert.equal(roundTrip.height, "249");
  assert.equal(validateMeasurements(roundTrip).valid, false);
});

test("editing an affected field clears only its carried correction state", () => {
  assert.equal(typeof measurements.clearMeasurementCorrection, "function");
  const converted = switchMeasurementSystem({ units: "kg", height: "99.9", weight: "29.99" }, "imperial");

  const weightEdited = {
    ...measurements.clearMeasurementCorrection(converted, "weight"),
    weight: "66.1",
  };
  assert.equal(validateMeasurements(weightEdited).errors.weight, undefined);
  assert.ok(validateMeasurements(weightEdited).errors.heightFt);

  const heightEdited = {
    ...measurements.clearMeasurementCorrection(weightEdited, "heightIn"),
    heightIn: "3",
  };
  assert.equal(validateMeasurements(heightEdited).valid, true);
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
