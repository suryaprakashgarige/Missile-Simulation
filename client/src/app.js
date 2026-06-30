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

// Telemetry PDF Report Generation
function exportPdf() {
  if (!trajectoryData || !trajectoryData.samples.length) {
    alert("No flight telemetry data to export. Run simulation first.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: 'a4'
  });

  // Page 1: Parameters and Metrics
  // Set dark background for a premium dark engineering theme matching AeroSim UI
  pdf.setFillColor(5, 7, 10); // #05070A
  pdf.rect(0, 0, 210, 297, 'F');

  // Header Banner
  pdf.setFillColor(13, 17, 23); // #0D1117
  pdf.rect(10, 10, 190, 25, 'F');
  
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(56, 189, 248); // #38BDF8 (Cyan)
  pdf.text("AEROSIM // FLIGHT SIMULATION REPORT", 15, 20);
  
  pdf.setFont('courier', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(139, 148, 158); // #8B949E
  pdf.text("PRE-LAUNCH AEROSPACE TRAJECTORY ANALYSIS ENGINE", 15, 26);
  
  // Format Date
  const dateStr = new Date().toLocaleString('en-US', { hour12: false }).replace(',', '');
  pdf.text(`GEN_TIME: ${dateStr}`, 142, 20);

  // Flight Status Badge
  const status = trajectoryData.status || 'FINISHED';
  if (status === 'INTERCEPTED') {
    pdf.setFillColor(74, 222, 128); // #4ADE80 (Green)
    pdf.setTextColor(5, 7, 10);
  } else {
    pdf.setFillColor(248, 113, 113); // #F87171 (Red)
    pdf.setTextColor(255, 255, 255);
  }
  pdf.rect(142, 23, 53, 8, 'F');
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(9);
  pdf.text(`STATUS: ${status}`, 145, 28);

  // Left Box: Simulation Parameters
  pdf.setFillColor(13, 17, 23); // #0D1117
  pdf.rect(10, 40, 92, 95, 'F');
  
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(56, 189, 248);
  pdf.text("MISSION CONFIGURATION", 15, 48);
  
  // divider line
  pdf.setDrawColor(33, 38, 45); // #21262D
  pdf.line(15, 52, 97, 52);

  const planetVal = document.getElementById('planet').value;
  const planetName = planetVal.charAt(0).toUpperCase() + planetVal.slice(1);
  const vehicleVal = document.getElementById('vehicleType').value;
  const vehicleName = vehicleVal === 'rocket' ? 'Heavy Orbital Booster' : 
                      vehicleVal === 'missile' ? 'Hypersonic Cruise Missile' : 'Artillery Projectile';
  
  const configItems = [
    ["Target Planet", planetName],
    ["Vehicle Type", vehicleName],
    ["Launch Angle", `${document.getElementById('launchAngle').value}°`],
    ["Initial Vel", `${document.getElementById('velocity').value} m/s`],
    ["Payload Mass", `${document.getElementById('payload').value} kg`],
    ["Wind Speed", `${document.getElementById('wind').value} m/s`],
    ["Safety Limit", `${document.getElementById('simulationTime').value} s`],
    ["Hit Radius", `${document.getElementById('hitRadius').value} m`]
  ];

  pdf.setFont('courier', 'normal');
  pdf.setFontSize(9);
  let paramY = 60;
  configItems.forEach(([label, value]) => {
    pdf.setTextColor(139, 148, 158);
    pdf.text(label.padEnd(16, '.'), 15, paramY);
    pdf.setTextColor(240, 246, 252);
    pdf.text(value, 52, paramY);
    paramY += 9;
  });

  // Right Box: Geospatial Positions
  pdf.setFillColor(13, 17, 23); // #0D1117
  pdf.rect(108, 40, 92, 95, 'F');
  
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(56, 189, 248);
  pdf.text("GEOSPATIAL COORDINATES", 113, 48);
  
  pdf.line(113, 52, 195, 52);

  const startLat = startPoint ? startPoint.lat.toFixed(6) : "N/A";
  const startLon = startPoint ? startPoint.lon.toFixed(6) : "N/A";
  const targetLat = targetPoint ? targetPoint.lat.toFixed(6) : "N/A";
  const targetLon = targetPoint ? targetPoint.lon.toFixed(6) : "N/A";

  const geoItems = [
    ["LAUNCH SITE", ""],
    ["  Latitude", `${startLat}°`],
    ["  Longitude", `${startLon}°`],
    ["", ""],
    ["TARGET SITE", ""],
    ["  Latitude", `${targetLat}°`],
    ["  Longitude", `${targetLon}°`]
  ];

  pdf.setFont('courier', 'normal');
  pdf.setFontSize(9);
  let geoY = 60;
  geoItems.forEach(([label, value]) => {
    if (value === "") {
      pdf.setFont('courier', 'bold');
      pdf.setTextColor(56, 189, 248);
      pdf.text(label, 113, geoY);
    } else {
      pdf.setFont('courier', 'normal');
      pdf.setTextColor(139, 148, 158);
      pdf.text(label.padEnd(14, '.'), 113, geoY);
      pdf.setTextColor(240, 246, 252);
      pdf.text(value, 152, geoY);
    }
    geoY += 9;
  });

  // Bottom Box: Mission Summary Telemetry
  pdf.setFillColor(13, 17, 23); // #0D1117
  pdf.rect(10, 145, 190, 135, 'F');

  pdf.setFont('courier', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(56, 189, 248);
  pdf.text("FINAL FLIGHT PERFORMANCE METRICS", 15, 153);
  pdf.line(15, 157, 195, 157);

  const altitudes = trajectoryData.samples.map(s => s.alt);
  const velocities = trajectoryData.samples.map(s => s.vel);
  const accels = trajectoryData.samples.map(s => s.accel);
  const ranges = trajectoryData.samples.map(s => s.range);

  const maxAlt = Math.max(...altitudes);
  const maxVel = Math.max(...velocities);
  const maxAccel = Math.max(...accels);
  const finalRange = ranges[ranges.length - 1];
  const finalTime = trajectoryData.totalTime;

  const summaryItems = [
    ["Apogee (Max Altitude)", `${maxAlt.toFixed(2)} m`, "Highest point in trajectory"],
    ["Maximum Flight Speed", `${maxVel.toFixed(2)} m/s (Mach ${(maxVel / 343).toFixed(2)})`, "Peak velocity achieved"],
    ["Maximum Acceleration", `${maxAccel.toFixed(2)} m/s²`, "Peak acceleration level"],
    ["Downrange Distance", `${finalRange.toFixed(2)} m`, "Ground distance covered to impact"],
    ["Total Flight Duration", `${finalTime.toFixed(2)} s`, "Elapsed simulation time"]
  ];

  pdf.setFont('courier', 'normal');
  let summaryY = 168;
  summaryItems.forEach(([metric, val, desc]) => {
    pdf.setFont('courier', 'bold');
    pdf.setTextColor(240, 246, 252);
    pdf.text(metric, 15, summaryY);

    pdf.setFont('courier', 'bold');
    pdf.setTextColor(74, 222, 128); // Success green for values
    pdf.text(val, 85, summaryY);

    pdf.setFont('courier', 'normal');
    pdf.setTextColor(139, 148, 158);
    pdf.text(`// ${desc}`, 142, summaryY);

    pdf.setDrawColor(33, 38, 45); // #21262D
    pdf.line(15, summaryY + 4, 195, summaryY + 4);

    summaryY += 20;
  });

  // Page 2: Performance Graphs
  pdf.addPage();
  pdf.setFillColor(5, 7, 10); // #05070A
  pdf.rect(0, 0, 210, 297, 'F');

  // Header Banner
  pdf.setFillColor(13, 17, 23); // #0D1117
  pdf.rect(10, 10, 190, 15, 'F');
  
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(56, 189, 248);
  pdf.text("AEROSIM // TELEMETRY PERFORMANCE GRAPHICAL ANALYSIS", 15, 19);

  // Convert chart canvases to base64 images
  const altImg = charts.altitude.canvas.toDataURL('image/png');
  const velImg = charts.velocity.canvas.toDataURL('image/png');
  const accelImg = charts.acceleration.canvas.toDataURL('image/png');
  const distImg = charts.distance.canvas.toDataURL('image/png');

  // Grid layout for 4 graphs (2x2)
  const boxW = 92;
  const boxH = 110;
  const imgW = boxW - 6;
  const imgH = boxH - 18;

  // Row 1: Left
  pdf.setFillColor(13, 17, 23);
  pdf.rect(10, 35, boxW, boxH, 'F');
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(139, 148, 158);
  pdf.text("ALTITUDE (m) vs TIME (s)", 13, 41);
  pdf.addImage(altImg, 'PNG', 13, 46, imgW, imgH);

  // Row 1: Right
  pdf.setFillColor(13, 17, 23);
  pdf.rect(108, 35, boxW, boxH, 'F');
  pdf.text("VELOCITY (m/s) vs TIME (s)", 111, 41);
  pdf.addImage(velImg, 'PNG', 111, 46, imgW, imgH);

  // Row 2: Left
  pdf.setFillColor(13, 17, 23);
  pdf.rect(10, 155, boxW, boxH, 'F');
  pdf.text("ACCELERATION (m/s^2) vs TIME (s)", 13, 161);
  pdf.addImage(accelImg, 'PNG', 13, 166, imgW, imgH);

  // Row 2: Right
  pdf.setFillColor(13, 17, 23);
  pdf.rect(108, 155, boxW, boxH, 'F');
  pdf.text("DOWNRANGE DISTANCE (m) vs TIME (s)", 111, 161);
  pdf.addImage(distImg, 'PNG', 111, 166, imgW, imgH);

  // Page 3: Detailed Telemetry Table & Regime Analysis
  pdf.addPage();
  pdf.setFillColor(5, 7, 10); // #05070A
  pdf.rect(0, 0, 210, 297, 'F');

  // Header Banner
  pdf.setFillColor(13, 17, 23); // #0D1117
  pdf.rect(10, 10, 190, 15, 'F');
  
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(56, 189, 248);
  pdf.text("AEROSIM // FLIGHT TELEMETRY DATA LOG (INTERVAL SAMPLES)", 15, 19);

  // Table Column Headers
  const colY = 35;
  pdf.setFillColor(22, 27, 34); // #161B22
  pdf.rect(10, colY, 190, 8, 'F');

  pdf.setFont('courier', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(56, 189, 248); // Cyan
  
  pdf.text("TIME (s)", 15, colY + 5);
  pdf.text("ALTITUDE (m)", 35, colY + 5);
  pdf.text("VEL (m/s)", 68, colY + 5);
  pdf.text("MACH", 100, colY + 5);
  pdf.text("THRUST (N)", 122, colY + 5);
  pdf.text("DRAG (N)", 152, colY + 5);
  pdf.text("MASS (kg)", 178, colY + 5);

  // Downsample to 15 key records
  const totalSamples = trajectoryData.samples.length;
  const numRows = 15;
  const step = Math.max(1, Math.floor(totalSamples / (numRows - 1)));
  const tableSamples = [];
  
  for (let i = 0; i < totalSamples; i += step) {
    tableSamples.push(trajectoryData.samples[i]);
  }
  if (tableSamples[tableSamples.length - 1] !== trajectoryData.samples[totalSamples - 1]) {
    tableSamples.push(trajectoryData.samples[totalSamples - 1]);
  }

  // Draw rows
  let rowY = colY + 8;
  pdf.setFont('courier', 'normal');
  pdf.setFontSize(8);

  tableSamples.forEach((s, idx) => {
    // Alternating row background
    if (idx % 2 === 0) {
      pdf.setFillColor(13, 17, 23); // #0D1117
    } else {
      pdf.setFillColor(5, 7, 10); // #05070A
    }
    pdf.rect(10, rowY, 190, 8, 'F');

    // Horizontal divider
    pdf.setDrawColor(33, 38, 45); // #21262D
    pdf.line(10, rowY + 8, 200, rowY + 8);

    pdf.setTextColor(240, 246, 252);
    pdf.text(s.time.toFixed(1), 15, rowY + 5);
    pdf.text(s.alt.toFixed(1), 35, rowY + 5);
    pdf.text(s.vel.toFixed(1), 68, rowY + 5);
    
    // Highlight mach number by speed category
    if (s.mach >= 5.0) {
      pdf.setTextColor(248, 113, 113); // Red for hypersonic
    } else if (s.mach >= 1.2) {
      pdf.setTextColor(251, 191, 36); // Amber for supersonic
    } else {
      pdf.setTextColor(240, 246, 252);
    }
    pdf.text(s.mach.toFixed(2), 100, rowY + 5);

    pdf.setTextColor(240, 246, 252);
    pdf.text(s.thrust.toFixed(0), 122, rowY + 5);
    pdf.text(s.drag.toFixed(0), 152, rowY + 5);
    pdf.text(s.mass.toFixed(0), 178, rowY + 5);

    rowY += 8;
  });

  // Dynamic analysis block at bottom
  const analysisY = rowY + 12;
  pdf.setFillColor(13, 17, 23); // #0D1117
  pdf.rect(10, analysisY, 190, 48, 'F');

  pdf.setFont('courier', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(56, 189, 248);
  pdf.text("FLIGHT ANALYSIS & REGIME VERIFICATION", 15, analysisY + 7);
  pdf.setDrawColor(33, 38, 45);
  pdf.line(15, analysisY + 11, 195, analysisY + 11);

  pdf.setFont('courier', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(139, 148, 158);

  const maxMach = Math.max(...trajectoryData.samples.map(s => s.mach));
  let regime = "SUBSONIC";
  let regimeDesc = "The vehicle remained entirely within the subsonic envelope (Mach < 0.8). Aerodynamic drag is low, and conventional control surfaces are sufficient.";
  if (maxMach >= 5.0) {
    regime = "HYPERSONIC";
    regimeDesc = "The vehicle breached the hypersonic boundary (Mach >= 5.0). Extreme thermal loads and shockwaves dominate. Advanced thermal protection and specialized aerodynamics are required.";
  } else if (maxMach >= 1.2) {
    regime = "SUPERSONIC";
    regimeDesc = "The vehicle reached supersonic speeds (Mach 1.2 - 5.0). Flight profile encountered wave drag and shock formation. High structural strength and aerodynamic stability were active.";
  } else if (maxMach >= 0.8) {
    regime = "TRANSONIC";
    regimeDesc = "The vehicle operated in the transonic regime (Mach 0.8 - 1.2). Airflow speed varies locally around the vehicle, causing shockwaves and significant drag fluctuations.";
  }

  // Find max thrust and drag forces
  const maxThrust = Math.max(...trajectoryData.samples.map(s => s.thrust));
  const maxDrag = Math.max(...trajectoryData.samples.map(s => s.drag));

  pdf.text(`MAX VELOCITY REGIME: `, 15, analysisY + 18);
  pdf.setFont('courier', 'bold');
  pdf.setTextColor(240, 246, 252);
  pdf.text(`${regime} (PEAK: Mach ${maxMach.toFixed(2)})`, 60, analysisY + 18);

  pdf.setFont('courier', 'normal');
  pdf.setTextColor(139, 148, 158);
  
  // Wrap text description manually
  pdf.text(regimeDesc.substring(0, 85), 15, analysisY + 24);
  if (regimeDesc.length > 85) {
    pdf.text(regimeDesc.substring(85), 15, analysisY + 29);
  }

  pdf.text("PROPULSION & AERODYNAMICS SUMMARY:", 15, analysisY + 38);
  pdf.setTextColor(240, 246, 252);
  pdf.text(`Peak Thrust: ${maxThrust.toFixed(0)} N | Peak Drag: ${maxDrag.toFixed(0)} N`, 15, analysisY + 43);

  pdf.save(`AeroSim_Flight_Log_${Date.now()}.pdf`);
}

function init() {
  viewer = initViewer('cesiumContainer');
  setupInteraction();
  initCharts();

  document.getElementById('simulateBtn').addEventListener('click', runSimulation);
  document.getElementById('resetBtn').addEventListener('click', resetScene);
  document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
  document.getElementById('exportPdfBtn').addEventListener('click', exportPdf);

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
