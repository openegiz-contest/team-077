import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeScenarioMetrics,
  computeScreenSpaceCalloutLayout,
  computeShovelKinematics,
  formatSimClock,
  getAssetCalloutTelemetry,
  getBenchRadius,
  type MineTelemetryState,
  type TruckTelemetry,
} from './mineSimulation';

const BASE_TRUCKS: TruckTelemetry[] = [
  { id: 'truck-01', name: 'CAT 793F #01', shovel: 'EX-01 (+280м, Малахит)', bench: '+280м', payload: 227, grade: 0.64, speed: 14.5, state: 'HAULING', oreType: 'malachite', tirePressureBar: 7.4, tkph: 518, fuelLph: 118, etaMin: 3.4 },
  { id: 'truck-02', name: 'CAT 793F #02', shovel: 'EX-01 (+280м, Малахит)', bench: '+280м', payload: 227, grade: 0.64, speed: 14.5, state: 'HAULING', oreType: 'malachite', tirePressureBar: 7.5, tkph: 509, fuelLph: 116, etaMin: 2.1 },
  { id: 'truck-03', name: 'CAT 793F #03', shovel: 'EX-02 (+220м, Халькопирит)', bench: '+220м', payload: 227, grade: 0.40, speed: 14.5, state: 'HAULING', oreType: 'sulfide', tirePressureBar: 7.4, tkph: 512, fuelLph: 121, etaMin: 3.8 },
  { id: 'truck-04', name: 'CAT 793F #04', shovel: 'EX-02 (+220м, Халькопирит)', bench: '+220м', payload: 0, grade: 0.40, speed: 38.0, state: 'RETURNING', oreType: 'sulfide', tirePressureBar: 7.3, tkph: 486, fuelLph: 64, etaMin: 4.6 },
  { id: 'truck-05', name: 'CAT 793F #05', shovel: 'EX-03 (+310м, Вскрыша)', bench: '+310м', payload: 227, grade: 0.08, speed: 14.5, state: 'HAULING', oreType: 'overburden', tirePressureBar: 7.4, tkph: 498, fuelLph: 114, etaMin: 2.5 },
];

const MOCK_STATE: MineTelemetryState = {
  simTimeMin: 124.5,
  feedGradeCu: 0.480,
  targetGradeCu: 0.480,
  minedTonnes: 4540,
  crusherTph: 2270,
  fleetFuelLph: 426,
  radarStatus: 'NORMAL',
  radarDispMmDay: 0.20,
  activeScenarios: { ex1Fail: false, roadBlock: false, dilution: false },
  logs: [],
  trucks: BASE_TRUCKS,
};

test('nominal operation maintains 0.480% Cu target and NORMAL radar status', () => {
  const res = computeScenarioMetrics(
    { ex1Fail: false, roadBlock: false, dilution: false },
    BASE_TRUCKS
  );
  assert.equal(res.feedGradeCu, 0.480);
  assert.equal(res.radarStatus, 'NORMAL');
  assert.equal(res.radarDispMmDay, 0.20);
  assert.equal(res.fleetFuelLph, 426);
  assert.equal(res.trucks[0].state, 'HAULING');
});

test('roadBlock scenario activates SSR collapse alert and reroutes EX-02 trucks', () => {
  const res = computeScenarioMetrics(
    { ex1Fail: false, roadBlock: true, dilution: false },
    BASE_TRUCKS
  );
  assert.equal(res.radarStatus, 'ALERT_COLLAPSE');
  assert.equal(res.radarDispMmDay, 14.80);
  assert.equal(res.fleetFuelLph, 498);
  assert.equal(res.trucks[2].state, 'REROUTED');
  assert.equal(res.trucks[3].state, 'REROUTED');
});

test('ex1Fail and dilution scenarios adjust Cu feed grade and reassign trucks', () => {
  const res = computeScenarioMetrics(
    { ex1Fail: true, roadBlock: false, dilution: true },
    BASE_TRUCKS
  );
  assert.equal(res.feedGradeCu, 0.365);
  assert.equal(res.trucks[0].shovel, 'EX-02 (+220м, Резерв)');
  assert.equal(res.trucks[0].grade, 0.22);
  assert.equal(res.trucks[0].state, 'REROUTED');
});

test('shovel kinematics returns static parked pose when halted and dynamic swing when active', () => {
  const haltedPose = computeShovelKinematics(10, 0, true);
  assert.equal(haltedPose.swingAngle, -0.25);

  const p1 = computeShovelKinematics(0.2, 0, false);
  const p2 = computeShovelKinematics(1.0, 0, false);
  assert.notEqual(p1.swingAngle, p2.swingAngle);
});

test('formatSimClock formats shift minutes from 08:00 start', () => {
  assert.equal(formatSimClock(0), '08:00');
  assert.equal(formatSimClock(125), '10:05');
});

test('computeScreenSpaceCalloutLayout handles behind-camera clipping and right/left quadrant switching', () => {
  const behind = computeScreenSpaceCalloutLayout({
    ndcX: 0,
    ndcY: 0,
    ndcZ: 0.5,
    isInFront: false,
    canvasWidth: 1440,
    canvasHeight: 900,
  });
  assert.equal(behind.isVisible, false);

  // Center-left point -> places card on the right
  const centerLeft = computeScreenSpaceCalloutLayout({
    ndcX: -0.2,
    ndcY: 0.1,
    ndcZ: 0.5,
    isInFront: true,
    canvasWidth: 1440,
    canvasHeight: 900,
  });
  assert.equal(centerLeft.isVisible, true);
  assert.equal(centerLeft.placeLeft, false);
  assert.ok(centerLeft.cardX > centerLeft.screenX);

  // Far-right point (> 0.65 width) -> places card on the left
  const farRight = computeScreenSpaceCalloutLayout({
    ndcX: 0.6,
    ndcY: -0.6,
    ndcZ: 0.5,
    isInFront: true,
    canvasWidth: 1440,
    canvasHeight: 900,
  });
  assert.equal(farRight.isVisible, true);
  assert.equal(farRight.placeLeft, true);
  assert.ok(farRight.cardX < farRight.screenX);
});

test('getAssetCalloutTelemetry returns domain-accurate telemetry for trucks, shovels, crusher, drill, radar, and waste dump', () => {
  const truck3 = getAssetCalloutTelemetry('truck-03', MOCK_STATE);
  assert.equal(truck3.category, 'truck');
  assert.equal(truck3.title, 'CAT 793F #03');
  assert.ok(truck3.rows.some((r) => r.value.includes('512 TKPH')));

  const ex1 = getAssetCalloutTelemetry('ex-01', MOCK_STATE);
  assert.equal(ex1.category, 'shovel');
  assert.ok(ex1.subtitle.includes('CAT 7495'));

  const drill1 = getAssetCalloutTelemetry('drill-01', MOCK_STATE);
  assert.equal(drill1.category, 'drill');
  assert.ok(drill1.subtitle.includes('CAT MD6250'));

  const crusher = getAssetCalloutTelemetry('crusher', MOCK_STATE);
  assert.equal(crusher.category, 'crusher');
  assert.ok(crusher.subtitle.includes('Metso 60-89'));

  const radar = getAssetCalloutTelemetry('radar', MOCK_STATE);
  assert.equal(radar.category, 'radar');
  assert.ok(radar.rows.some((r) => r.value.includes('0.20 мм/сут')));

  const waste = getAssetCalloutTelemetry('waste-dump', MOCK_STATE);
  assert.equal(waste.category, 'waste');
  assert.ok(waste.rows.some((r) => r.value.includes('CAT D11T')));
});

test('getBenchRadius produces continuous 2*PI-periodic asymmetric NE-SW pit geometry', () => {
  const r0 = getBenchRadius(152, 0.45, 38.0);
  const rPerp = getBenchRadius(152, 0.45 + Math.PI, 38.0);
  assert.ok(r0 > rPerp, 'NE strike axis should elongate radius compared to opposite azimuth');

  const wrapDiff = Math.abs(
    getBenchRadius(122, -Math.PI, 28.0) - getBenchRadius(122, Math.PI, 28.0)
  );
  assert.ok(wrapDiff < 1e-9, 'Polar bench radius must be C-infinity continuous across -PI/+PI seam');
});
