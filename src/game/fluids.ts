import * as THREE from 'three';

const GRID_SIZE = 64;
const FLOW_STEP = 1 / 30;
const MAX_STEPS_PER_UPDATE = 3;
const MAX_GUST_SPEED = 60; // m/s, approximately 134 mph
const GUST_FRONT_PROPAGATION = 36; // m/s, expanding cold-pool edge
const GUST_FRONT_SURFACE_FORCE = 18; // effective grid forcing, tuned for severe downburst outflow

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const smoothstep = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Coarse 2D horizontal boundary-layer flow for a microburst. Velocity is advected on a
 * semi-Lagrangian grid, then accelerated by the cold-pool pressure gradient and moving
 * gust front, diffused by viscosity, and damped by surface friction. This is intentionally
 * a bounded, low-resolution gameplay solver rather than a visual after-image or radial
 * displacement formula; particles, enemies, and the player all sample the same field.
 */
export class MicroburstFlow {
  private u: Float32Array;
  private v: Float32Array;
  private nextU: Float32Array;
  private nextV: Float32Array;
  private readonly cellSize: number;
  private accumulator = 0;

  constructor(readonly radius: number, private readonly stormScale: number) {
    this.cellSize = (radius * 2) / (GRID_SIZE - 1);
    const cells = GRID_SIZE * GRID_SIZE;
    this.u = new Float32Array(cells);
    this.v = new Float32Array(cells);
    this.nextU = new Float32Array(cells);
    this.nextV = new Float32Array(cells);
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

  /** Sample the simulated surface wind. `out` is reused by Microburst to avoid hot-loop allocations. */
  sample(x: number, z: number, height: number, out: THREE.Vector3): boolean {
    if (Math.abs(x) >= this.radius || Math.abs(z) >= this.radius) return false;
    const gx = (x + this.radius) / this.cellSize;
    const gz = (z + this.radius) / this.cellSize;
    const u = this.bilinear(this.u, gx, gz);
    const v = this.bilinear(this.v, gx, gz);
    const altitudeAttenuation = Math.exp(-Math.max(0, height - 30) / Math.max(100, this.stormScale * 2.4));
    const windX = u * altitudeAttenuation;
    const windZ = v * altitudeAttenuation;
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
    const a = field[z0 * GRID_SIZE + x0], b = field[z0 * GRID_SIZE + x1];
    const c = field[z1 * GRID_SIZE + x0], d = field[z1 * GRID_SIZE + x1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
  }

  private integrate(dt: number, elapsed: number) {
    const oldU = this.u, oldV = this.v, newU = this.nextU, newV = this.nextV;
    const cell = this.cellSize;
    const onset = smoothstep(0, 1.1, elapsed);
    const frontRadius = Math.min(this.radius * 0.92, elapsed * GUST_FRONT_PROPAGATION);
    const frontWidth = Math.max(cell * 1.8, this.stormScale * 1.5);
    const pressureSigma = Math.max(cell * 1.6, this.stormScale * 1.55 + elapsed * 13);
    const diffusion = Math.min(0.02, 210 * dt / (cell * cell));

    for (let z = 0; z < GRID_SIZE; z++) {
      const row = z * GRID_SIZE;
      const localZ = z * cell - this.radius;
      for (let x = 0; x < GRID_SIZE; x++) {
        const index = row + x;
        const localX = x * cell - this.radius;
        const radialDistance = Math.hypot(localX, localZ);
        if (x === 0 || z === 0 || x === GRID_SIZE - 1 || z === GRID_SIZE - 1 || radialDistance >= this.radius) {
          newU[index] = 0;
          newV[index] = 0;
          continue;
        }

        // Semi-Lagrangian back-trace: follow the previous velocity field to the source
        // point for this cell, then bilinearly interpolate both velocity components.
        const backX = x - oldU[index] * dt / cell;
        const backZ = z - oldV[index] * dt / cell;
        const advectedU = this.bilinear(oldU, backX, backZ);
        const advectedV = this.bilinear(oldV, backX, backZ);

        const nx = localX / Math.max(1, radialDistance);
        const nz = localZ / Math.max(1, radialDistance);
        const coreQ = radialDistance / pressureSigma;
        // -grad(p) for a broad, decaying cold-pool pressure dome drives outward flow.
        const pressureAcceleration = 6.2 * coreQ * Math.exp(-0.5 * coreQ * coreQ) * onset;
        const frontQ = (radialDistance - frontRadius) / frontWidth;
        const gustFront = Math.exp(-0.5 * frontQ * frontQ) * onset;
        const directionalGust = 1 + 0.1 * Math.sin(localX * 0.003 + elapsed * 0.8) * Math.cos(localZ * 0.004 - elapsed * 0.55);
        const radialAcceleration = pressureAcceleration + GUST_FRONT_SURFACE_FORCE * gustFront * directionalGust;

        // A rolled gust-front edge forms a pair of weak, alternating horizontal eddies.
        const eddy = 2.1 * gustFront * Math.sin((localX - localZ) * 0.012 + elapsed * 1.7);
        const lapU = oldU[index - 1] + oldU[index + 1] + oldU[index - GRID_SIZE] + oldU[index + GRID_SIZE] - 4 * oldU[index];
        const lapV = oldV[index - 1] + oldV[index + 1] + oldV[index - GRID_SIZE] + oldV[index + GRID_SIZE] - 4 * oldV[index];

        let nextX = advectedU + (nx * radialAcceleration - nz * eddy) * dt + lapU * diffusion;
        let nextZ = advectedV + (nz * radialAcceleration + nx * eddy) * dt + lapV * diffusion;
        const speed = Math.hypot(nextX, nextZ);
        const surfaceDrag = 0.12 + 0.0032 * speed;
        const edgeDrag = smoothstep(this.radius * 0.78, this.radius * 0.98, radialDistance) * 1.7;
        const damping = Math.exp(-(surfaceDrag + edgeDrag) * dt);
        nextX *= damping;
        nextZ *= damping;

        const dampedSpeed = Math.hypot(nextX, nextZ);
        if (dampedSpeed > MAX_GUST_SPEED) {
          const scale = MAX_GUST_SPEED / dampedSpeed;
          nextX *= scale;
          nextZ *= scale;
        }
        newU[index] = nextX;
        newV[index] = nextZ;
      }
    }

    this.nextU = oldU;
    this.nextV = oldV;
    this.u = newU;
    this.v = newV;
  }
}
