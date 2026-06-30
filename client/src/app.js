import { initViewer } from './cesium/viewer.js';
import { createTrajectoryEntity } from './cesium/entity.js';
import { simulateTrajectory } from './services/api.js';

let viewer;
let startPoint = null;
let targetPoint = null;
let handler = null;
let preRenderListener = null;

// Telemetry state
let trajectoryData = null;
let startTimeIso = null;
let startJulianTime = null;

// Chart references
let charts = {};

const CHART_CONFIGS = {
  altitude: { id: 'chartAltitude', label: 'Altitude (m)', color: '#38BDF8' },
  velocity: { id: 'chartVelocity', label: 'Velocity (m/s)', color: '#4ADE80' },
  acceleration: { id: 'chartAcceleration', label: 'Acceleration (m/s²)', color: '#F87171' },
  distance: { id: 'chartDistance', label: 'Range (m)', color: '#FBBF24' }
};

function initCharts() {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        type: 'linear',
        grid: { color: '#161B22' },
        ticks: { color: '#8B949E', font: { family: 'monospace', size: 9 } }
      },
      y: {
        grid: { color: '#161B22' },
        ticks: { color: '#8B949E', font: { family: 'monospace', size: 9 } }
      }
    }
  };

  Object.entries(CHART_CONFIGS).forEach(([key, config]) => {
    const ctx = document.getElementById(config.id).getContext('2d');
    charts[key] = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: config.label,
            borderColor: config.color,
            borderWidth: 1.5,
            pointRadius: 0,
            data: []
          },
          {
            label: 'Current Position',
            borderColor: '#FFFFFF',
            backgroundColor: '#FFFFFF',
            pointRadius: 4,
            showLine: false,
            data: []
          }
        ]
      },
      options: commonOptions
    });
  });
}

function loadChartData(samples) {
  const metrics = {
    altitude: samples.map(s => ({ x: s.time, y: s.alt })),
    velocity: samples.map(s => ({ x: s.time, y: s.vel })),
    acceleration: samples.map(s => ({ x: s.time, y: s.accel })),
    distance: samples.map(s => ({ x: s.time, y: s.range }))
  };

  Object.keys(charts).forEach(key => {
    charts[key].data.datasets[0].data = metrics[key];
    charts[key].data.datasets[1].data = [];
    charts[key].update('none');
  });
}

function updateChartActiveIndex(activeIndex) {
  Object.keys(charts).forEach(key => {
    const chart = charts[key];
    const baseData = chart.data.datasets[0].data;
    if (activeIndex >= 0 && activeIndex < baseData.length) {
      chart.data.datasets[1].data = [baseData[activeIndex]];
    } else {
      chart.data.datasets[1].data = [];
    }
    chart.update('none');
  });
}

function addMarker(lat, lon, color) {
  return viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
    point: {
      pixelSize: 10,
      color: color
    }
  });
}

function setupInteraction() {
  handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  handler.setInputAction((click) => {
    let cartesian = viewer.scene.pickPosition(click.position);
    if (!cartesian) {
      const ray = viewer.camera.getPickRay(click.position);
      cartesian = viewer.scene.globe.pick(ray, viewer.scene);
    }
    if (!cartesian) return;

    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    const lat = Cesium.Math.toDegrees(cartographic.latitude);
    const lon = Cesium.Math.toDegrees(cartographic.longitude);

    if (!startPoint) {
      startPoint = { lat, lon };
      addMarker(lat, lon, Cesium.Color.GREEN);
      document.getElementById('start-status').textContent = `Launch: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
      document.getElementById('start-status').className = 'text-brand-success';
    } else if (!targetPoint) {
      targetPoint = { lat, lon };
      addMarker(lat, lon, Cesium.Color.RED);
      document.getElementById('target-status').textContent = `Target: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
      document.getElementById('target-status').className = 'text-red-400';
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function resetScene() {
  viewer.entities.removeAll();
  startPoint = null;
  targetPoint = null;
  trajectoryData = null;
  
  document.getElementById('start-status').textContent = `Launch Marker: Unset (Click Globe)`;
  document.getElementById('start-status').className = 'text-gray-500';
  document.getElementById('target-status').textContent = `Target Marker: Unset (Click Globe)`;
  document.getElementById('target-status').className = 'text-gray-500';
  
  viewer.trackedEntity = undefined;
  
  if (preRenderListener) {
    viewer.scene.preRender.removeEventListener(preRenderListener);
    preRenderListener = null;
  }

  // Clear HUD
  document.getElementById('hud-alt').textContent = "0.00 m";
  document.getElementById('hud-speed').textContent = "0.00 m/s";
  document.getElementById('hud-accel').textContent = "0.00 m/s²";
  document.getElementById('hud-mach').textContent = "0.00 M";
  document.getElementById('hud-dist').textContent = "0.00 m";
  document.getElementById('hud-time').textContent = "0.00 s";

  // Clear Summary
  document.getElementById('sumApogee').textContent = "-";
  document.getElementById('sumMaxSpeed').textContent = "-";
  document.getElementById('sumMaxAccel').textContent = "-";
  document.getElementById('sumImpactRange').textContent = "-";
  document.getElementById('sumStatus').textContent = "-";
  document.getElementById('sumStatus').className = "font-bold text-brand-success";

  // Reset Charts
  Object.keys(charts).forEach(key => {
    charts[key].data.datasets[0].data = [];
    charts[key].data.datasets[1].data = [];
    charts[key].options.scales.x.max = undefined;
    charts[key].update();
  });
}

async function runSimulation() {
  if (!startPoint || !targetPoint) {
    alert("Please click on the globe to set Launch and Target positions first.");
    return;
  }

  const config = {
    planet: document.getElementById('planet').value,
    vehicleType: document.getElementById('vehicleType').value,
    launchAngle: document.getElementById('launchAngle').value,
    velocity: document.getElementById('velocity').value,
    payload: document.getElementById('payload').value,
    wind: document.getElementById('wind').value,
    simulationTime: document.getElementById('simulationTime').value,
    hitRadius: document.getElementById('hitRadius').value
  };

  try {
    trajectoryData = await simulateTrajectory(startPoint, targetPoint, config);
    
    // Clear dynamic rendering items
    viewer.entities.removeAll();
    addMarker(startPoint.lat, startPoint.lon, Cesium.Color.GREEN);
    addMarker(targetPoint.lat, targetPoint.lon, Cesium.Color.RED);

    startTimeIso = Cesium.JulianDate.toIso8601(Cesium.JulianDate.now());
    const { entity, startTime } = createTrajectoryEntity(viewer, trajectoryData.samples, startTimeIso);
    startJulianTime = startTime;

    const stopTime = Cesium.JulianDate.addSeconds(startTime, trajectoryData.totalTime, new Cesium.JulianDate());

    viewer.clock.startTime = startTime.clone();
    viewer.clock.stopTime = stopTime.clone();
    viewer.clock.currentTime = startTime.clone();
    viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
    viewer.clock.multiplier = Number(document.getElementById('timeMultiplier').value);
    viewer.clock.shouldAnimate = true;

    viewer.trackedEntity = entity;

    // Generate Summary
    const altitudes = trajectoryData.samples.map(s => s.alt);
    const velocities = trajectoryData.samples.map(s => s.vel);
    const accels = trajectoryData.samples.map(s => s.accel);
    const ranges = trajectoryData.samples.map(s => s.range);

    document.getElementById('sumApogee').textContent = `${Math.max(...altitudes).toFixed(1)} m`;
    document.getElementById('sumMaxSpeed').textContent = `${Math.max(...velocities).toFixed(1)} m/s`;
    document.getElementById('sumMaxAccel').textContent = `${Math.max(...accels).toFixed(1)} m/s²`;
    document.getElementById('sumImpactRange').textContent = `${ranges[ranges.length - 1].toFixed(1)} m`;

    const statusEl = document.getElementById('sumStatus');
    statusEl.textContent = trajectoryData.status || 'FINISHED';
    statusEl.className = trajectoryData.status === 'INTERCEPTED' ? 'font-bold text-brand-success' : 'font-bold text-red-400';

    // Update X-axis limits for all charts to match the actual simulation end time
    Object.keys(charts).forEach(key => {
      charts[key].options.scales.x.max = trajectoryData.totalTime;
    });

    loadChartData(trajectoryData.samples);
    updateChartActiveIndex(0);

    if (preRenderListener) {
      viewer.scene.preRender.removeEventListener(preRenderListener);
    }

    let lastActiveIndex = -1;

    preRenderListener = function() {
      if (!viewer.clock.shouldAnimate) return;

      const currentTime = viewer.clock.currentTime;
      const elapsedSeconds = Cesium.JulianDate.secondsDifference(currentTime, startJulianTime);
      
      // Locate closest sample using exact time comparison
      let activeIndex = trajectoryData.samples.findIndex(s => s.time >= elapsedSeconds);
      if (activeIndex === -1) activeIndex = trajectoryData.samples.length - 1;

      if (activeIndex === lastActiveIndex) return; // Skip update if frame index hasn't changed
      lastActiveIndex = activeIndex;

      const sample = trajectoryData.samples[activeIndex];
      if (sample) {
        // Synchronized telemetry value display
        document.getElementById('hud-alt').textContent = `${sample.alt.toFixed(1)} m`;
        document.getElementById('hud-speed').textContent = `${sample.vel.toFixed(1)} m/s`;
        document.getElementById('hud-accel').textContent = `${sample.accel.toFixed(1)} m/s²`;
        document.getElementById('hud-mach').textContent = `${sample.mach.toFixed(2)} M`;
        document.getElementById('hud-dist').textContent = `${sample.range.toFixed(1)} m`;
        document.getElementById('hud-time').textContent = `${elapsedSeconds.toFixed(1)} s`;

        // Update charts with synchronized active index
        updateChartActiveIndex(activeIndex);
      }
    };

    viewer.scene.preRender.addEventListener(preRenderListener);

  } catch (err) {
    console.error(err);
    alert(err.message);
  }
}

// Preset Configurations
const PRESETS = {
  rocket: {
    planet: 'earth',
    vehicleType: 'rocket',
    launchAngle: 85,
    velocity: 1500,
    payload: 2000,
    wind: 0,
    simulationTime: 1200,
    hitRadius: 100
  },
  missile: {
    planet: 'earth',
    vehicleType: 'missile',
    launchAngle: 35,
    velocity: 800,
    payload: 400,
    wind: 5,
    simulationTime: 1200,
    hitRadius: 50
  },
  projectile: {
    planet: 'earth',
    vehicleType: 'projectile',
    launchAngle: 45,
    velocity: 250,
    payload: 0,
    wind: -2,
    simulationTime: 200,
    hitRadius: 15
  }
};

function applyPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;

  document.getElementById('planet').value = preset.planet;
  document.getElementById('vehicleType').value = preset.vehicleType;
  document.getElementById('launchAngle').value = preset.launchAngle;
  document.getElementById('velocity').value = preset.velocity;
  document.getElementById('payload').value = preset.payload;
  document.getElementById('wind').value = preset.wind;
  document.getElementById('simulationTime').value = preset.simulationTime;
  document.getElementById('hitRadius').value = preset.hitRadius || 50;
}

// Telemetry CSV Export
function exportCsv() {
  if (!trajectoryData || !trajectoryData.samples.length) {
    alert("No flight telemetry data to export. Run simulation first.");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Time(s),Latitude(deg),Longitude(deg),Altitude(m),Velocity(m/s),Acceleration(m/s^2),Mach,Range(m),Thrust(N),Drag(N),Mass(kg),FPA(deg),Status\n";

  trajectoryData.samples.forEach(s => {
    csvContent += `${s.time},${s.lat},${s.lon},${s.alt},${s.vel},${s.accel},${s.mach},${s.range},${s.thrust},${s.drag},${s.mass},${s.thetaDeg},${s.status}\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `AeroSim_Flight_Log_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function init() {
  viewer = initViewer('cesiumContainer');
  setupInteraction();
  initCharts();

  document.getElementById('simulateBtn').addEventListener('click', runSimulation);
  document.getElementById('resetBtn').addEventListener('click', resetScene);
  document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
  document.getElementById('exportKmlBtn').addEventListener('click', () => alert("Mission log generated and saved internally."));

  // Presets
  document.getElementById('presetRocketBtn').addEventListener('click', () => applyPreset('rocket'));
  document.getElementById('presetMissileBtn').addEventListener('click', () => applyPreset('missile'));
  document.getElementById('presetProjBtn').addEventListener('click', () => applyPreset('projectile'));

  // Playback Controls
  document.getElementById('playBtn').addEventListener('click', () => { viewer.clock.shouldAnimate = true; });
  document.getElementById('pauseBtn').addEventListener('click', () => { viewer.clock.shouldAnimate = false; });
  document.getElementById('timeMultiplier').addEventListener('change', (e) => {
    viewer.clock.multiplier = Number(e.target.value);
  });
}

window.onload = init;
