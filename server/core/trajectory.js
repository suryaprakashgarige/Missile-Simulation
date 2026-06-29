const geo = require('./geo');
const kinematics = require('./kinematics');

function generateTrajectory(start, target, config) {
  const vehicleKey = config.vehicleType || 'rocket';
  const planetKey = config.planet || 'earth';
  const launchAngleDeg = Number(config.launchAngle) || 45;
  const initialVelocity = Number(config.velocity) || 100;
  const payloadMass = Number(config.payload) || 0;
  const windVelocity = Number(config.wind) || 0; // m/s (positive is tailwind)
  const maxSimTime = Number(config.simulationTime) || 300;

  const planet = kinematics.PLANETS[planetKey] || kinematics.PLANETS.earth;
  const vehicle = kinematics.VEHICLES[vehicleKey] || kinematics.VEHICLES.rocket;

  const totalDistance = geo.haversineDistance(start.lat, start.lon, target.lat, target.lon);
  const bearing = geo.initialBearing(start.lat, start.lon, target.lat, target.lon);

  // Simulation parameters
  const dt = 0.5; // step size in seconds
  let t = 0;
  
  // State variables
  let x = 0; // downrange distance (meters)
  let y = 0.1; // altitude (meters) (avoid exact 0 for density/sound calculations)
  
  // Velocity components relative to ground
  let theta = launchAngleDeg * Math.PI / 180; // flight path angle (rad)
  let v = initialVelocity; // m/s
  
  const samples = [];
  let fuelRemaining = vehicle.fuelMass;

  // Add initial sample
  samples.push({
    time: 0,
    lat: start.lat,
    lon: start.lon,
    alt: y,
    vel: v,
    accel: 0,
    mach: (v / kinematics.getSpeedOfSound(y, planetKey)),
    range: x,
    thetaDeg: launchAngleDeg
  });

  let lastV = v;

  while (t < maxSimTime && y >= 0) {
    t += dt;

    // Mass tracking
    const currentFuelBurned = vehicle.burnTime > 0 ? (vehicle.fuelMass / vehicle.burnTime) * dt : 0;
    if (t <= vehicle.burnTime && fuelRemaining > 0) {
      fuelRemaining = Math.max(0, fuelRemaining - currentFuelBurned);
    }
    const currentMass = vehicle.mass + payloadMass + fuelRemaining;

    // Thrust
    const thrust = (t <= vehicle.burnTime && fuelRemaining > 0) ? vehicle.thrust : 0;

    // Atmospheric Density and Speed of Sound
    const rho = kinematics.getDensity(y, planetKey);
    const speedOfSound = kinematics.getSpeedOfSound(y, planetKey);

    // Aerodynamics (Relative velocity to wind)
    const vRel = v - windVelocity * Math.cos(theta);
    const drag = 0.5 * rho * vRel * vRel * vehicle.Cd * vehicle.area;

    // Gravity (decreases slightly with altitude)
    const gLocal = planet.g * Math.pow(6371000 / (6371000 + y), 2);

    // Accelerations
    const aThrust = thrust / currentMass;
    const aDrag = drag / currentMass;
    
    // Equations of motion
    const dv = aThrust - aDrag - gLocal * Math.sin(theta);
    let dtheta = 0;
    if (v > 0.1) {
      dtheta = -(gLocal * Math.cos(theta)) / v;
    }

    // Update state
    v += dv * dt;
    theta += dtheta * dt;
    
    if (v < 0) v = 0;

    // Update positions
    const dx = v * Math.cos(theta) * dt;
    const dy = v * Math.sin(theta) * dt;

    x += dx;
    y += dy;

    // Acceleration magnitude
    const accel = dv / dt;
    const mach = v / speedOfSound;

    // Convert flat downrange distance back to lat/lon on spherical earth
    const pos = geo.destinationPoint(start.lat, start.lon, bearing, x);

    // Only record at integer steps for cleaner telemetry
    if (Math.abs(t % 1) < 0.01 || y < 0) {
      samples.push({
        time: Math.round(t),
        lat: pos.lat,
        lon: pos.lon,
        alt: Math.max(0, y),
        vel: v,
        accel: accel,
        mach: mach,
        range: x,
        thetaDeg: theta * 180 / Math.PI
      });
    }

    // Impact detection
    if (y < 0) {
      break;
    }
  }

  return {
    totalTime: t,
    totalDistance: x,
    samples
  };
}

module.exports = {
  generateTrajectory
};

