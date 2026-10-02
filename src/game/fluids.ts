import * as THREE from 'three';

const GRID_SIZE = 64;
const FLOW_STEP = 1 / 30;
const MAX_STEPS_PER_UPDATE = 3;
const MAX_SURFACE_WIND = 42; // gameplay ceiling: severe but survivable surface outflow
const AIR_DENSITY = 1.2; // kg/m³
const DOWNDRAFT_SPEED = 65; // m/s in the strongest source; sets the cold-pool pressure scale
const SCALAR_DIFFUSIVITY = 650; // m²/s, sub-grid turbulent mixing
const KINEMATIC_VISCOSITY = 180; // m²/s

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const smoothstep = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * A small 2-D, depth-averaged boundary-layer model for a microburst cold pool.
 *
 * The downdraft deposits a finite patch of negatively buoyant/cold air at the surface.
 * That scalar is carried by the solved wind with an upwind flux, mixed by turbulent
 * diffusivity, and converted to pressure. The pressure gradient drives the outflow;
 * semi-Lagrangian advection, viscosity, surface drag, and an absorbing domain edge shape
 * the resulting velocity field. There is deliberately no prescribed expanding ring or
 * radial-force front: its arrival and direction emerge from the pressure-driven flow.
 *
 * This is a bounded gameplay-scale solver, not a full 3-D atmospheric model. All actors,
 * loose particles, and weather effects sample the same horizontal velocity field.
 */
export class MicroburstFlow {
  private u: Float32Array;
  private v: Float32Array;
  private coldPool: Float32Array;
  private nextU: Float32Array;
  private nextV: Float32Array;
  private nextColdPool: Float32Array;
  private readonly cellSize: number;
  private readonly pressureScale = (0.5 * AIR_DENSITY * DOWNDRAFT_SPEED * DOWNDRAFT_SPEED) / AIR_DENSITY;
  private accumulator = 0;

  constructor(readonly radius: number, private readonly stormScale: number) {
    this.cellSize = (radius * 2) / (GRID_SIZE - 1);
    const cells = GRID_SIZE * GRID_SIZE;
    this.u = new Float32Array(cells);
    this.v = new Float32Array(cells);
    this.coldPool = new Float32Array(cells);
    this.nextU = new Float32Array(cells);
    this.nextV = new Float32Array(cells);
    this.nextColdPool = new Float32Array(cells);
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

  /** Sample the simulated horizontal wind. `out` is reused to avoid hot-loop allocations. */
  sample(x: number, z: number, height: number, out: THREE.Vector3): boolean {
    if (Math.abs(x) >= this.radius || Math.abs(z) >= this.radius) return false;
    const gx = (x + this.radius) / this.cellSize;
    const gz = (z + this.radius) / this.cellSize;
    const u = this.bilinear(this.u, gx, gz);
    const v = this.bilinear(this.v, gx, gz);
    // A surface cold pool has a shallower horizontal jet than its source downdraft.
    const altitudeScale = Math.max(90, this.stormScale * 1.1);
    const altitudeAttenuation = Math.exp(-Math.max(0, height) / altitudeScale);
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
    const row0 = a + (b - a) * tx;
    return row0 + ((c + (d - c) * tx) - row0) * tz;
  }

  private integrate(dt: number, elapsed: number) {
    const oldU = this.u, oldV = this.v, oldCold = this.coldPool;
    const newU = this.nextU, newV = this.nextV, newCold = this.nextColdPool;
    const cell = this.cellSize;
    const cellAreaScale = 1 / (2 * cell);
    const scalarCourant = dt / cell;
    const scalarDiffusion = SCALAR_DIFFUSIVITY * dt / (cell * cell);
    const velocityDiffusion = KINEMATIC_VISCOSITY * dt / (cell * cell);
    const sourceFade = 1 - smoothstep(1.4, 2.8, elapsed);
    const sourceSigma = Math.max(cell * 1.5, this.stormScale * 0.62);
    const sourceRate = 0.72 * sourceFade;
    const coldAirDecay = Math.exp(-0.025 * dt);
    const pressureAt = (sample: number, sx: number, sz: number) => {
      const roughness = 1 + 0.035 * Math.sin(sx * 0.021 + elapsed * 1.1) * Math.cos(sz * 0.018 - elapsed * 0.73);
      return this.pressureScale * oldCold[sample] * roughness;
    };

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
          newCold[index] = 0;
          continue;
        }

        const left = index - 1, right = index + 1;
        const up = index - GRID_SIZE, down = index + GRID_SIZE;

        // Conservative first-order upwind transport of the cold-pool density anomaly.
        // Face velocities and upwind scalar values preserve the sign of the mass flux.
        const uLeft = 0.5 * (oldU[left] + oldU[index]);
        const uRight = 0.5 * (oldU[index] + oldU[right]);
        const vUp = 0.5 * (oldV[up] + oldV[index]);
        const vDown = 0.5 * (oldV[index] + oldV[down]);
        const fluxLeft = uLeft * (uLeft >= 0 ? oldCold[left] : oldCold[index]);
        const fluxRight = uRight * (uRight >= 0 ? oldCold[index] : oldCold[right]);
        const fluxUp = vUp * (vUp >= 0 ? oldCold[up] : oldCold[index]);
        const fluxDown = vDown * (vDown >= 0 ? oldCold[index] : oldCold[down]);
        const scalarDivergence = (fluxRight - fluxLeft + fluxDown - fluxUp) * scalarCourant;
        const scalarLaplacian = oldCold[left] + oldCold[right] + oldCold[up] + oldCold[down] - 4 * oldCold[index];
        const sourceShape = Math.exp(-0.5 * radialDistance * radialDistance / (sourceSigma * sourceSigma));
        const mixedColdAir = (oldCold[index] - scalarDivergence + scalarLaplacian * scalarDiffusion) * coldAirDecay;
        newCold[index] = clamp(mixedColdAir + sourceRate * sourceShape * dt, 0, 1.15);

        // Semi-Lagrangian momentum advection is stable at this deliberately coarse resolution.
        const backX = x - oldU[index] * dt / cell;
        const backZ = z - oldV[index] * dt / cell;
        const advectedU = this.bilinear(oldU, backX, backZ);
        const advectedV = this.bilinear(oldV, backX, backZ);

        // Pressure is proportional to the local cold-air anomaly. Mild spatial roughness
        // seeds asymmetry so a perfectly circular source does not remain a perfect radial jet.
        const accelerationX = -(pressureAt(right, localX + cell, localZ) - pressureAt(left, localX - cell, localZ)) * cellAreaScale;
        const accelerationZ = -(pressureAt(down, localX, localZ + cell) - pressureAt(up, localX, localZ - cell)) * cellAreaScale;

        const lapU = oldU[left] + oldU[right] + oldU[up] + oldU[down] - 4 * oldU[index];
        const lapV = oldV[left] + oldV[right] + oldV[up] + oldV[down] - 4 * oldV[index];
        let nextX = advectedU + accelerationX * dt + lapU * velocityDiffusion;
        let nextZ = advectedV + accelerationZ * dt + lapV * velocityDiffusion;

        // Quadratic aerodynamic loading and ground-layer drag limit terminal outflow without
        // prescribing its direction. The domain edge absorbs the cold pool rather than reflecting it.
        const speed = Math.hypot(nextX, nextZ);
        const surfaceDrag = 0.12 + 0.0032 * speed;
        const edgeDrag = smoothstep(this.radius * 0.76, this.radius * 0.98, radialDistance) * 1.8;
        const damping = Math.exp(-(surfaceDrag + edgeDrag) * dt);
        nextX *= damping;
        nextZ *= damping;

        const dampedSpeed = Math.hypot(nextX, nextZ);
        if (dampedSpeed > MAX_SURFACE_WIND) {
          const scale = MAX_SURFACE_WIND / dampedSpeed;
          nextX *= scale;
          nextZ *= scale;
        }
        newU[index] = nextX;
        newV[index] = nextZ;
      }
    }

    this.nextU = oldU;
    this.nextV = oldV;
    this.nextColdPool = oldCold;
    this.u = newU;
    this.v = newV;
    this.coldPool = newCold;
  }
}
