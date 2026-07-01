const assert = require('node:assert/strict');
const { generateTrajectory } = require('../core/trajectory');

function maxBy(samples, key) {
  return Math.max(...samples.map((sample) => sample[key]));
}

function runMissile(config = {}) {
  return generateTrajectory(
    { lat: 0, lon: 0 },
    { lat: 0, lon: 1 },
    {
      vehicleType: 'missile',
      launchAngle: 35,
      velocity: 800,
      payload: 400,
      wind: 5,
      simulationTime: 400,
      hitRadius: 50,
      ...config
    }
  );
}

{
  const result = runMissile();
  assert.ok(result.samples.length > 2, 'simulation should produce telemetry samples');
  assert.equal(result.status, 'INTERCEPTED');
  assert.ok(maxBy(result.samples, 'alt') > 1000, 'missile should climb before impact');
  assert.ok(maxBy(result.samples, 'vel') > result.samples[0].vel, 'powered missile should accelerate during boost');
  assert.ok(result.totalDistance > 0, 'range should accumulate as a positive distance');
}

{
  const result = runMissile({ hitRadius: 120000 });
  assert.equal(result.status, 'INTERCEPTED', 'large hit radius should trigger intercept');
}

{
  const result = generateTrajectory(
    { lat: 0, lon: 0 },
    { lat: 0, lon: 10 },
    {
      vehicleType: 'projectile',
      launchAngle: 45,
      velocity: 250,
      payload: 0,
      wind: 0,
      simulationTime: 5,
      hitRadius: 1
    }
  );
  assert.equal(result.status, 'TIMEOUT', 'unfinished flight should not be reported as crashed');
}

console.log('trajectory tests passed');
