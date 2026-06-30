const geo = require('./geo');
const kinematics = require('./kinematics');

function generateTrajectory(start, target, config) {
  const vehicleKey = config.vehicleType || 'rocket';
  const planetKey = config.planet || 'earth';
  const launchAngleDeg = Number(config.launchAngle) || 45;
  const initialVelocity = Number(config.velocity) || 100;
  const payloadMass = Number(config.payload) || 0;
  const windVelocity = Number(config.wind) || 0; // m/s (positive is tailwind)
  const maxSimTime = Number(config.simulationTime) || 600;
  const hitRadius = Number(config.hitRadius) || 50; // meters

  const planet = kinematics.PLANETS[planetKey] || kinematics.PLANETS.earth;
  const vehicle = kinematics.VEHICLES[vehicleKey] || kinematics.VEHICLES.rocket;

  // Initial geographic parameters
  const initialBearing = geo.initialBearing(start.lat, start.lon, target.lat, target.lon);
  const initialGroundDistance = geo.haversineDistance(start.lat, start.lon, target.lat, target.lon);
  const estimatedFlightTime = initialGroundDistance / Math.max(initialVelocity, 1);
  const autoSimTime = vehicleKey === 'projectile'
    ? maxSimTime
    : Math.max(maxSimTime, vehicle.burnTime + estimatedFlightTime * 3 + 120);

  // Simulation parameters
  const dt = 0.5; // step size in seconds
  let t = 0;
  
  // 3D Geodesic state
  let currLat = start.lat;
  let currLon = start.lon;
  let currAlt = 0.1; // initial altitude (meters)
  
  // Velocity and guidance state
  let psi = initialBearing; // current heading bearing (radians)
  let theta = launchAngleDeg * Math.PI / 180; // current flight path angle (radians)
  let v = initialVelocity; // current velocity magnitude (m/s)
  
  const samples = [];
  let fuelRemaining = vehicle.fuelMass;

  // Maximum steering rates (degrees per second to radians per second)
  const maxTurnRate = (vehicleKey === 'missile' ? 30 : vehicleKey === 'rocket' ? 8 : 15) * Math.PI / 180;

  let totalGroundRange = 0;
  let hitDetected = false;
  let groundImpact = false;

  // Add initial sample
  samples.push({
    time: 0,
    lat: currLat,
    lon: currLon,
    alt: currAlt,
    vel: v,
    accel: 0,
    mach: (v / kinematics.getSpeedOfSound(currAlt, planetKey)),
    range: 0,
    thetaDeg: launchAngleDeg,
    bearingDeg: psi * 180 / Math.PI,
    thrust: (vehicle.burnTime > 0) ? vehicle.thrust : 0,
    drag: 0,
    mass: vehicle.mass + payloadMass + fuelRemaining,
    status: 'Launched'
  });

  while (t < autoSimTime) {
    t += dt;

    // 1. Check distance to target
    const dGround = geo.haversineDistance(currLat, currLon, target.lat, target.lon);
    const d3d = Math.sqrt(dGround * dGround + currAlt * currAlt);

    if (d3d <= hitRadius) {
      hitDetected = true;
      break;
    }

    // 2. Propulsion and Mass
    const currentFuelBurned = vehicle.burnTime > 0 ? (vehicle.fuelMass / vehicle.burnTime) * dt : 0;
    const isBurning = t <= vehicle.burnTime && fuelRemaining > 0;
    if (isBurning) {
      fuelRemaining = Math.max(0, fuelRemaining - currentFuelBurned);
    }
    const currentMass = vehicle.mass + payloadMass + fuelRemaining;
    const thrust = isBurning ? vehicle.thrust : 0;

    // 3. Atmosphere & Drag
    const rho = kinematics.getDensity(currAlt, planetKey);
    const speedOfSound = kinematics.getSpeedOfSound(currAlt, planetKey);
    const vRel = v - windVelocity * Math.cos(theta);
    const dragMagnitude = 0.5 * rho * vRel * vRel * vehicle.Cd * vehicle.area;
    const dragDirection = Math.sign(vRel);
    const drag = dragMagnitude * dragDirection;
    const gLocal = planet.g * Math.pow(geo.R / (geo.R + currAlt), 2);

    // 4. Guidance & Controls
    // Guided vehicles steer toward the target throughout flight. Projectiles remain ballistic.
    const isGuidanceActive = vehicleKey !== 'projectile';
    
    const psiTarget = geo.initialBearing(currLat, currLon, target.lat, target.lon);
    const terminalDiveAngle = Math.atan2(-currAlt, dGround);
    const loftAngle = launchAngleDeg * Math.PI / 180;
    const thetaTarget = isBurning && dGround > 5000
      ? Math.max(terminalDiveAngle, loftAngle * 0.35)
      : terminalDiveAngle;

    let dPsi = 0;
    let dTheta = 0;

    if (isGuidanceActive) {
      // Homing phase
      let psiErr = psiTarget - psi;
      while (psiErr < -Math.PI) psiErr += 2 * Math.PI;
      while (psiErr > Math.PI) psiErr -= 2 * Math.PI;
      dPsi = Math.max(-maxTurnRate * dt, Math.min(maxTurnRate * dt, psiErr));

      let thetaErr = thetaTarget - theta;
      dTheta = Math.max(-maxTurnRate * dt, Math.min(maxTurnRate * dt, thetaErr));
    } else {
      // Boost phase: Head towards target bearing, bend under gravity
      let psiErr = psiTarget - psi;
      while (psiErr < -Math.PI) psiErr += 2 * Math.PI;
      while (psiErr > Math.PI) psiErr -= 2 * Math.PI;
      dPsi = Math.max(-maxTurnRate * dt, Math.min(maxTurnRate * dt, psiErr));

      if (v > 0.1) {
        dTheta = (-(gLocal * Math.cos(theta)) / v) * dt; // ballistic gravity turn component
      }
    }

    psi += dPsi;
    theta += dTheta;

    // 5. Accelerations and Updates
    const aThrust = thrust / currentMass;
    const aDrag = drag / currentMass;
    const dv = aThrust - aDrag - gLocal * Math.sin(theta);

    v += dv * dt;
    if (v < 0) v = 0;

    // Update coordinates
    const ds = v * Math.cos(theta) * dt;
    const newPos = geo.destinationPoint(currLat, currLon, psi, ds);
    
    currLat = newPos.lat;
    currLon = newPos.lon;
    currAlt += v * Math.sin(theta) * dt;
    totalGroundRange += Math.abs(ds);

    const updatedDGround = geo.haversineDistance(currLat, currLon, target.lat, target.lon);
    const updatedD3d = Math.sqrt(updatedDGround * updatedDGround + currAlt * currAlt);
    const passedTarget = updatedDGround > dGround && Math.min(dGround, updatedDGround) <= Math.max(hitRadius, Math.abs(ds));
    const closeToGroundTarget = currAlt <= Math.max(hitRadius, Math.abs(v * Math.sin(theta) * dt) + hitRadius);
    const impactNearTarget = currAlt <= 0 && updatedDGround <= Math.max(hitRadius, Math.abs(ds));
    if (updatedD3d <= hitRadius || (passedTarget && closeToGroundTarget) || impactNearTarget) {
      hitDetected = true;
      break;
    }

    const accel = dv; // instantaneous acceleration (m/s^2)
    const mach = v / speedOfSound;

    // Record every single timestep for synchronized charts
    samples.push({
      time: Number(t.toFixed(1)),
      lat: currLat,
      lon: currLon,
      alt: Math.max(0, currAlt),
      vel: v,
      accel: accel,
      mach: mach,
      range: totalGroundRange,
      thetaDeg: theta * 180 / Math.PI,
      bearingDeg: psi * 180 / Math.PI,
      thrust: thrust,
      drag: drag,
      mass: currentMass,
      status: currAlt < 0 ? 'Ground Impact' : (isGuidanceActive ? 'Terminal Guidance' : 'Booster Phase')
    });

    if (currAlt < 0) {
      groundImpact = true;
      break;
    }
  }

  if (hitDetected) {
    samples.push({
      time: Number(t.toFixed(1)),
      lat: target.lat,
      lon: target.lon,
      alt: 0,
      vel: v,
      accel: 0,
      mach: v / kinematics.getSpeedOfSound(0, planetKey),
      range: totalGroundRange,
      thetaDeg: theta * 180 / Math.PI,
      bearingDeg: psi * 180 / Math.PI,
      thrust: 0,
      drag: 0,
      mass: vehicle.mass + payloadMass,
      status: 'Target Intercepted'
    });
  }

  return {
    totalTime: t,
    requestedMaxTime: maxSimTime,
    simulationLimit: autoSimTime,
    totalDistance: totalGroundRange,
    samples,
    status: hitDetected ? 'INTERCEPTED' : (groundImpact ? 'CRASHED' : 'TIMEOUT')
  };
}

module.exports = {
  generateTrajectory
};
