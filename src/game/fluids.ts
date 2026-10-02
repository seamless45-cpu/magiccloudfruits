import * as THREE from 'three';

const GRID_SIZE = 64;
const FLOW_STEP = 1 / 30;
const MAX_STEPS_PER_UPDATE = 3;
const MAX_SURFACE_WIND = 42; // bounded physical-layer speed before game presentation scaling
// Five times the former 10× gameplay outflow, as requested.
export const MICROBURST_OUTFLOW_MULTIPLIER = 50;
export const MICROBURST_OUTFLOW_MAX = MAX_SURFACE_WIND * MICROBURST_OUTFLOW_MULTIPLIER;

// Depth-averaged density-current parameters. Reduced gravity represents the buoyancy
// difference between the cold pool and ambient air, not full terrestrial gravity.
const REDUCED_GRAVITY = 0.78; // m/s², representative of a strong cold-air density anomaly
export const MICROBURST_DOWNDRAFT_SPEED = 65; // m/s, upper-bound vertical speed in the downdraft core
const DOWNDRAFT_LAYER_RATE = 24; // m/s equivalent layer-depth source during the impact pulse
const DOWNDRAFT_PRESSURE_COUPLING = 1; // stagnation head is the impact-pressure upper bound, dissipated by the solver
const ENTRAINMENT_RATE = 0.018; // s⁻¹, mixing of the cold layer into ambient air
const LINEAR_SURFACE_DRAG = 0.11; // s⁻¹, unresolved boundary-layer momentum loss
const QUADRATIC_SURFACE_DRAG = 0.045; // dimensionless shallow-layer drag coefficient
const EDDY_VISCOSITY = 55; // m²/s, sub-grid turbulent momentum mixing
const MAX_COLD_POOL_DEPTH = 160; // m, bounded gameplay-scale shallow layer
const DRY_DEPTH = 0.04; // m, wet/dry tolerance for finite-volume cells

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const smoothstep = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Normalized downdraft pulse shared by the source terms and cloud-to-ground shaft. */
export const microburstPulse = (elapsed: number) =>
  smoothstep(0.15, 0.9, elapsed) * (1 - smoothstep(2.5, 5.2, elapsed));

/**
 * Depth-averaged shallow-water model for a microburst density current.
 *
 * Cold-pool depth and horizontal momentum are advanced as conserved quantities with
 * Rusanov finite-volume fluxes. Hydrostatic reduced-gravity pressure drives the leading
 * outflow; a short-lived dynamic-pressure source represents the downdraft striking the
 * ground and spreading radially. Entrainment, roughness-dependent surface drag, and eddy
 * viscosity dissipate the current. A wet/dry edge lets the gust front run out of the domain
 * instead of reflecting from a hard circular wall.
 *
 * This is not a full 3-D weather model. The stable physical-layer solution is sampled by all
 * actors and particles, then receives the requested 50× presentation/gameplay scale (5× the
 * previous 10× level). The solver itself remains capped at 42 m/s before that scale is applied.
 */
export class MicroburstFlow {
  private depth: Float32Array;
  private momentumX: Float32Array;
  private momentumZ: Float32Array;
  private nextDepth: Float32Array;
  private nextMomentumX: Float32Array;
  private nextMomentumZ: Float32Array;
  private velocityX: Float32Array;
  private velocityZ: Float32Array;
  private nextVelocityX: Float32Array;
  private nextVelocityZ: Float32Array;
  private pressure: Float32Array;
  private waveSpeedX: Float32Array;
  private waveSpeedZ: Float32Array;
  private sourceShape: Float32Array;
  private roughness: Float32Array;
  private inside: Uint8Array;
  private fluxXDepth: Float32Array;
  private fluxXMomentumX: Float32Array;
  private fluxXMomentumZ: Float32Array;
  private fluxZDepth: Float32Array;
  private fluxZMomentumX: Float32Array;
  private fluxZMomentumZ: Float32Array;
  private readonly cellSize: number;
  private accumulator = 0;

  constructor(readonly radius: number, stormScale: number) {
    this.cellSize = (radius * 2) / (GRID_SIZE - 1);
    const cells = GRID_SIZE * GRID_SIZE;
    this.depth = new Float32Array(cells);
    this.momentumX = new Float32Array(cells);
    this.momentumZ = new Float32Array(cells);
    this.nextDepth = new Float32Array(cells);
    this.nextMomentumX = new Float32Array(cells);
    this.nextMomentumZ = new Float32Array(cells);
    this.velocityX = new Float32Array(cells);
    this.velocityZ = new Float32Array(cells);
    this.nextVelocityX = new Float32Array(cells);
    this.nextVelocityZ = new Float32Array(cells);
    this.pressure = new Float32Array(cells);
    this.waveSpeedX = new Float32Array(cells);
    this.waveSpeedZ = new Float32Array(cells);
    this.sourceShape = new Float32Array(cells);
    this.roughness = new Float32Array(cells);
    this.inside = new Uint8Array(cells);
    this.fluxXDepth = new Float32Array(cells);
    this.fluxXMomentumX = new Float32Array(cells);
    this.fluxXMomentumZ = new Float32Array(cells);
    this.fluxZDepth = new Float32Array(cells);
    this.fluxZMomentumX = new Float32Array(cells);
    this.fluxZMomentumZ = new Float32Array(cells);

    const sigma = Math.max(this.cellSize * 1.5, stormScale * 0.62);
    const sigmaSq2 = 2 * sigma * sigma;
    for (let z = 0; z < GRID_SIZE; z++) {
      const localZ = z * this.cellSize - radius;
      const row = z * GRID_SIZE;
      for (let x = 0; x < GRID_SIZE; x++) {
        const index = row + x;
        const localX = x * this.cellSize - radius;
        const radiusSq = localX * localX + localZ * localZ;
        const radial = Math.sqrt(radiusSq);
        const inDomain = radiusSq < radius * radius && x > 0 && z > 0 && x < GRID_SIZE - 1 && z < GRID_SIZE - 1;
        this.inside[index] = inDomain ? 1 : 0;
        if (!inDomain) continue;

        const gaussian = Math.exp(-radiusSq / sigmaSq2);
        // A gentle fixed surface-roughness field breaks perfect circular symmetry and
        // modulates drag without injecting hand-drawn gust rings into the velocity field.
        const lowFreq = Math.sin(localX * 0.018 + 1.1) * Math.cos(localZ * 0.015 - 0.7);
        const fine = Math.sin((localX + localZ) * 0.043 + 2.4);
        const terrainNoise = lowFreq * 0.7 + fine * 0.3;
        this.sourceShape[index] = gaussian * (1 + terrainNoise * 0.12);
        const edgeFactor = smoothstep(radius * 0.78, radius * 0.99, radial);
        this.roughness[index] = (0.92 + terrainNoise * 0.15) * (1 + edgeFactor * 0.8);
      }
    }
  }

  update(dt: number, elapsed: number) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.accumulator = Math.min(this.accumulator + Math.min(dt, 0.1), FLOW_STEP * MAX_STEPS_PER_UPDATE);
    let steps = 0;
    while (this.accumulator >= FLOW_STEP && steps < MAX_STEPS_PER_UPDATE) {
      this.integrate(FLOW_STEP, clamp(elapsed, 0, 10));
      this.accumulator -= FLOW_STEP;
      steps++;
    }
  }

  /** Sample the surface-current velocity; `out` is reused in particle and actor hot loops. */
  sample(x: number, z: number, height: number, out: THREE.Vector3): boolean {
    if (x * x + z * z >= this.radius * this.radius) return false;
    const gx = (x + this.radius) / this.cellSize;
    const gz = (z + this.radius) / this.cellSize;
    const layerDepth = this.bilinear(this.depth, gx, gz);
    if (layerDepth < DRY_DEPTH) return false;

    // The gust decays through the top of the finite cold-pool layer instead of using one
    // storm-wide arbitrary altitude scale.
    const mixingDepth = Math.max(14, layerDepth * 1.45);
    const altitudeAttenuation = Math.exp(-Math.max(0, height) / mixingDepth);
    const gameplayScale = MICROBURST_OUTFLOW_MULTIPLIER;
    const windX = this.bilinear(this.velocityX, gx, gz) * altitudeAttenuation * gameplayScale;
    const windZ = this.bilinear(this.velocityZ, gx, gz) * altitudeAttenuation * gameplayScale;
    if (windX * windX + windZ * windZ < 0.01) return false;
    out.set(windX, 0, windZ);
    return true;
  }

  private bilinear(field: Float32Array, x: number, z: number) {
    const gx = clamp(x, 0, GRID_SIZE - 1);
    const gz = clamp(z, 0, GRID_SIZE - 1);
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const x1 = Math.min(GRID_SIZE - 1, x0 + 1), z1 = Math.min(GRID_SIZE - 1, z0 + 1);
    const tx = gx - x0, tz = gz - z0;
    const row0 = z0 * GRID_SIZE, row1 = z1 * GRID_SIZE;
    const a = field[row0 + x0], b = field[row0 + x1];
    const c = field[row1 + x0], d = field[row1 + x1];
    const top = a + (b - a) * tx;
    return top + ((c + (d - c) * tx) - top) * tz;
  }

  private integrate(dt: number, elapsed: number) {
    const oldDepth = this.depth, oldQx = this.momentumX, oldQz = this.momentumZ;
    const nextDepth = this.nextDepth, nextQx = this.nextMomentumX, nextQz = this.nextMomentumZ;
    const size = GRID_SIZE, cell = this.cellSize, invCell = 1 / cell;
    const dtOverCell = dt * invCell;
    const diffusion = EDDY_VISCOSITY * dt / (cell * cell);
    const pulse = microburstPulse(elapsed);
    const sourceRate = DOWNDRAFT_LAYER_RATE * pulse; // mass flux follows vertical airspeed
    const dynamicPressureHead = 0.5 * MICROBURST_DOWNDRAFT_SPEED * MICROBURST_DOWNDRAFT_SPEED * DOWNDRAFT_PRESSURE_COUPLING * pulse * pulse;
    const entrainment = Math.exp(-ENTRAINMENT_RATE * dt);

    this.fluxXDepth.fill(0); this.fluxXMomentumX.fill(0); this.fluxXMomentumZ.fill(0);
    this.fluxZDepth.fill(0); this.fluxZMomentumX.fill(0); this.fluxZMomentumZ.fill(0);

    // Reconstruct primitive velocity and hydrostatic pressure from conserved layer depth and
    // momentum. This is the only division/square-root pass; face fluxes reuse the result.
    for (let i = 0; i < size * size; i++) {
      const h = oldDepth[i];
      if (!this.inside[i] || h < DRY_DEPTH) {
        this.velocityX[i] = 0; this.velocityZ[i] = 0; this.pressure[i] = 0;
        this.waveSpeedX[i] = 0; this.waveSpeedZ[i] = 0;
        continue;
      }
      let u = oldQx[i] / h, v = oldQz[i] / h;
      const speed = Math.hypot(u, v);
      if (speed > MAX_SURFACE_WIND) { const scale = MAX_SURFACE_WIND / speed; u *= scale; v *= scale; }
      const gravityWave = Math.sqrt(REDUCED_GRAVITY * h);
      this.velocityX[i] = u; this.velocityZ[i] = v;
      this.pressure[i] = 0.5 * REDUCED_GRAVITY * h * h;
      this.waveSpeedX[i] = Math.abs(u) + gravityWave;
      this.waveSpeedZ[i] = Math.abs(v) + gravityWave;
    }

    // Local Lax-Friedrichs/Rusanov fluxes conserve layer mass and horizontal momentum while
    // resolving the moving cold-pool front without a prescribed radial expansion velocity.
    for (let z = 0; z < size; z++) {
      const row = z * size;
      for (let x = 0; x < size - 1; x++) {
        const i = row + x, j = i + 1;
        const hL = oldDepth[i], hR = oldDepth[j];
        const qxL = oldQx[i], qxR = oldQx[j], qzL = oldQz[i], qzR = oldQz[j];
        const uL = this.velocityX[i], uR = this.velocityX[j];
        const pL = this.pressure[i], pR = this.pressure[j];
        const alpha = Math.max(this.waveSpeedX[i], this.waveSpeedX[j]);
        this.fluxXDepth[i] = 0.5 * (qxL + qxR) - 0.5 * alpha * (hR - hL);
        this.fluxXMomentumX[i] = 0.5 * (qxL * uL + pL + qxR * uR + pR) - 0.5 * alpha * (qxR - qxL);
        this.fluxXMomentumZ[i] = 0.5 * (qzL * uL + qzR * uR) - 0.5 * alpha * (qzR - qzL);
      }
    }
    for (let z = 0; z < size - 1; z++) {
      const row = z * size;
      for (let x = 0; x < size; x++) {
        const i = row + x, j = i + size;
        const hL = oldDepth[i], hR = oldDepth[j];
        const qxL = oldQx[i], qxR = oldQx[j], qzL = oldQz[i], qzR = oldQz[j];
        const vL = this.velocityZ[i], vR = this.velocityZ[j];
        const pL = this.pressure[i], pR = this.pressure[j];
        const alpha = Math.max(this.waveSpeedZ[i], this.waveSpeedZ[j]);
        this.fluxZDepth[i] = 0.5 * (qzL + qzR) - 0.5 * alpha * (hR - hL);
        this.fluxZMomentumX[i] = 0.5 * (qxL * vL + qxR * vR) - 0.5 * alpha * (qxR - qxL);
        this.fluxZMomentumZ[i] = 0.5 * (qzL * vL + pL + qzR * vR + pR) - 0.5 * alpha * (qzR - qzL);
      }
    }

    for (let z = 1; z < size - 1; z++) {
      const row = z * size;
      for (let x = 1; x < size - 1; x++) {
        const i = row + x;
        if (!this.inside[i]) { nextDepth[i] = 0; nextQx[i] = 0; nextQz[i] = 0; this.nextVelocityX[i] = 0; this.nextVelocityZ[i] = 0; continue; }
        const left = i - 1, right = i + 1, up = i - size, down = i + size;
        let h = oldDepth[i] - dtOverCell * (this.fluxXDepth[i] - this.fluxXDepth[left] + this.fluxZDepth[i] - this.fluxZDepth[up]);
        let qx = oldQx[i] - dtOverCell * (this.fluxXMomentumX[i] - this.fluxXMomentumX[left] + this.fluxZMomentumX[i] - this.fluxZMomentumX[up]);
        let qz = oldQz[i] - dtOverCell * (this.fluxXMomentumZ[i] - this.fluxXMomentumZ[left] + this.fluxZMomentumZ[i] - this.fluxZMomentumZ[up]);

        // A compact source adds cold air at the impact point. Its dynamic head is a pressure
        // potential whose gradient transfers part of the downdraft momentum horizontally.
        const shape = this.sourceShape[i];
        const addedDepth = sourceRate * shape * dt;
        h += addedDepth;
        const accelScale = dynamicPressureHead / (2 * cell);
        const ax = -(this.sourceShape[right] - this.sourceShape[left]) * accelScale;
        const az = -(this.sourceShape[down] - this.sourceShape[up]) * accelScale;
        const forcedDepth = oldDepth[i] + addedDepth * 0.5;
        qx += forcedDepth * ax * dt;
        qz += forcedDepth * az * dt;

        // Sub-grid eddies diffuse momentum; ambient entrainment thins the cold layer and its
        // momentum together, while quadratic bottom drag depends on local layer depth.
        const lapU = this.velocityX[left] + this.velocityX[right] + this.velocityX[up] + this.velocityX[down] - 4 * this.velocityX[i];
        const lapV = this.velocityZ[left] + this.velocityZ[right] + this.velocityZ[up] + this.velocityZ[down] - 4 * this.velocityZ[i];
        qx += Math.max(DRY_DEPTH, h) * diffusion * lapU;
        qz += Math.max(DRY_DEPTH, h) * diffusion * lapV;
        h *= entrainment; qx *= entrainment; qz *= entrainment;
        h = clamp(h, 0, MAX_COLD_POOL_DEPTH);
        if (h < DRY_DEPTH) { h = 0; qx = 0; qz = 0; }

        if (h > 0) {
          const speed = Math.hypot(qx, qz) / h;
          const drag = Math.exp(-dt * (LINEAR_SURFACE_DRAG * this.roughness[i] + QUADRATIC_SURFACE_DRAG * speed / Math.max(8, h)));
          qx *= drag; qz *= drag;
          let u = qx / h, v = qz / h;
          const limitedSpeed = Math.hypot(u, v);
          if (limitedSpeed > MAX_SURFACE_WIND) { const scale = MAX_SURFACE_WIND / limitedSpeed; qx *= scale; qz *= scale; u *= scale; v *= scale; }
          this.nextVelocityX[i] = u;
          this.nextVelocityZ[i] = v;
        } else {
          this.nextVelocityX[i] = 0;
          this.nextVelocityZ[i] = 0;
        }
        nextDepth[i] = h; nextQx[i] = qx; nextQz[i] = qz;
      }
    }

    this.depth = this.nextDepth; this.nextDepth = oldDepth;
    this.momentumX = this.nextMomentumX; this.nextMomentumX = oldQx;
    this.momentumZ = this.nextMomentumZ; this.nextMomentumZ = oldQz;
    const oldVelocityX = this.velocityX, oldVelocityZ = this.velocityZ;
    this.velocityX = this.nextVelocityX; this.nextVelocityX = oldVelocityX;
    this.velocityZ = this.nextVelocityZ; this.nextVelocityZ = oldVelocityZ;
  }
}
