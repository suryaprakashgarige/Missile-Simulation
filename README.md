# Pre-Launch Missile Simulation Platform

[![CI/CD Pipeline](https://github.com/suryaprakashgarige/Missile-Simulation/actions/workflows/ci.yml/badge.svg)](https://github.com/suryaprakashgarige/Missile-Simulation/actions/workflows/ci.yml)

A high-fidelity, physics-based 3D aerospace and trajectory simulation platform. This system calculates gravity-compensated and controlled 3D trajectories for various flight vehicles (heavy rockets, hypersonic cruise missiles, artillery projectiles) under various planetary conditions (Earth, Moon, Mars).

The platform features a fully-interactive 3D globe using CesiumJS, telemetry analytics panels, dynamic parameter inputs, and real-time physical simulation.

---

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES6), CesiumJS, Tailwind CSS (CDN-loaded), Chart.js (CDN-loaded)
- **Backend**: Node.js, Express (with CORS support)
- **Physics Engine**: Numerical Integration (Euler / Runge-Kutta 4th Order), Gravitational & Aerodynamic Drag Models, and PID-controlled Altitude Hold
- **DevOps & Containers**: Docker (production-optimized multi-stage build), GitHub Actions CI/CD

---

## Features

- **Multi-Vehicle Support**: Simulation dynamics for heavy orbital boosters, hypersonic cruise missiles, and artillery projectiles.
- **Planetary Physics Profiles**: Earth (normal gravity, dense atmospheric drag), Moon (low gravity, vacuum/no drag), and Mars (reduced gravity, thin atmosphere).
- **Advanced Physics Integrators**: Toggleable Euler or high-precision Runge-Kutta 4th Order (RK4) solvers.
- **Dynamic Charting**: Telemetry analytics plotting velocity, altitude, and trajectory changes.
- **Report Generation**: Export mission parameters and simulation data to PDF format.

---

## Local Development (No Docker)

### Prerequisites
- Node.js (version 18 or 20 recommended)
- npm (Node Package Manager)

### Step 1: Install Dependencies
Run the following command from the project root directory:
```bash
npm install --prefix server
```

### Step 2: Run the Server
Start the development server:
```bash
npm start --prefix server
```
The server will boot up and listen on port `3000` (or the port defined by the `PORT` environment variable).

### Step 3: Access the Application
Open your web browser and navigate to:
```
http://localhost:3000
```

### Running Tests
Execute the local integration and physics test suite:
```bash
npm test --prefix server
```

---

## Docker Setup

We provide a production-ready, security-hardened Docker configuration featuring a multi-stage build to keep the image footprint minimal.

### Prerequisites
- Docker installed on your host machine

### Build the Docker Image
To compile and build the production container image, run this from the project root:
```bash
docker build -t missile-simulation:latest .
```

### Run the Docker Container
Launch the containerized application and expose port 3000:
```bash
docker run -d -p 3000:3000 --name missile-sim missile-simulation:latest
```

Open `http://localhost:3000` in your web browser to access the application.

---

## Running with Docker Compose

For local development or orchestrating multi-container systems, you can also use Docker Compose.

To build and launch the platform:
```bash
docker-compose up --build
```

The app will be accessible at `http://localhost:3000`.

---

## GitHub Actions CI/CD Pipeline

The project includes automated integration pipelines configured in `.github/workflows/ci.yml` that run on every push and pull request. The pipeline performs:
1. **Dependency Installation**: Caching and restoring dependencies using `npm ci`.
2. **Syntax Verification**: Performs lint/syntax check of all JS source files.
3. **Automated Testing**: Executes the test suite to prevent logic regression.
4. **Docker Build Checks**: Runs a dry-run Docker build to guarantee container build health.
