const PLANETS = {
  earth: {
    g: 9.81,
    rho0: 1.225, // sea level density, kg/m^3
    H: 8500,     // scale height, meters
    c0: 343      // speed of sound, m/s
  },
  moon: {
    g: 1.62,
    rho0: 0.0,
    H: 1,
    c0: 1 // vacuum
  },
  mars: {
    g: 3.71,
    rho0: 0.020,
    H: 11100,
    c0: 240
  }
};

const VEHICLES = {
  rocket: {
    mass: 50000,      // dry mass, kg
    fuelMass: 100000, // fuel mass, kg
    thrust: 3000000,  // Newtons
    burnTime: 80,     // seconds
    Cd: 0.2,          // Drag coefficient
    area: 7.0         // cross sectional area, m^2
  },
  missile: {
    mass: 1500,
    fuelMass: 14000,
    thrust: 130000,
    burnTime: 140,
    Cd: 0.15,
    area: 0.5
  },
  projectile: {
    mass: 50,
    fuelMass: 0,
    thrust: 0,
    burnTime: 0,
    Cd: 0.3,
    area: 0.02
  }
};

function getDensity(alt, planetKey) {
  const planet = PLANETS[planetKey] || PLANETS.earth;
  if (planet.rho0 === 0) return 0;
  return planet.rho0 * Math.exp(-alt / planet.H);
}

function getSpeedOfSound(alt, planetKey) {
  const planet = PLANETS[planetKey] || PLANETS.earth;
  // Simple speed of sound decrease with altitude model (only for earth/mars)
  if (planetKey === 'moon') return 1;
  const tempRatio = Math.max(0.5, 1 - (0.0065 * alt) / 288.15); // standard lapse rate
  return planet.c0 * Math.sqrt(tempRatio);
}

module.exports = {
  PLANETS,
  VEHICLES,
  getDensity,
  getSpeedOfSound
};

