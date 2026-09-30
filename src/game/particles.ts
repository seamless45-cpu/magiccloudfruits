import * as THREE from 'three';

const VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
uniform float uMaxSize;
void main(){
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_Position = projectionMatrix * mv;
  float s = aSize * uScale / max(0.5, -mv.z);
  gl_PointSize = clamp(s, 0.0, uMaxSize);
}`;
const FRAG_GLOW = `
varying float vAlpha; varying vec3 vColor;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if(d>0.5) discard;
  float a = pow(1.0 - d*2.0, 1.6);
  gl_FragColor = vec4(vColor * (1.0 + a), a * vAlpha);
}`;
const FRAG_SMOKE = `
varying float vAlpha; varying vec3 vColor;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float n = h(floor(gl_PointCoord*8.0));
  float edge = 0.44 + (n - 0.5) * 0.08;
  float a = 1.0 - smoothstep(edge - 0.18, edge, d);
  float mottling = 0.88 + 0.12 * h(floor(gl_PointCoord*13.0));
  gl_FragColor = vec4(vColor, a * mottling * vAlpha);
}`;

export interface SpawnOpts {
  grav?: number; drag?: number; grow?: number; alpha?: number; turb?: number;
  ox?: number; oz?: number; spread?: number; fade?: number; groundDrag?: number; windX?: number; windZ?: number; windResponse?: number; windDynamic?: boolean; densityManaged?: boolean;
}

/** Ring-buffer GPU point particle system with fluid-ish turbulence & ground outflow. */
export class ParticleSystem {
  cap: number; cursor = 0;
  pos: Float32Array; vel: Float32Array; col: Float32Array; size: Float32Array; alpha: Float32Array;
  life: Float32Array; maxLife: Float32Array; baseAlpha: Float32Array; grav: Float32Array; drag: Float32Array;
  grow: Float32Array; turb: Float32Array; ox: Float32Array; oz: Float32Array; spread: Float32Array; baseSize: Float32Array;
  windX: Float32Array; windZ: Float32Array; windResponse: Float32Array; windDynamic: Uint8Array; windClock: Float32Array; groundDrag: Float32Array; outflowStarted: Uint8Array; windSampler?: (x:number,y:number,z:number) => THREE.Vector3; active: number[] = []; activeAt: Int32Array;
  geo: THREE.BufferGeometry; points: THREE.Points; mat: THREE.ShaderMaterial;
  density = 1;
  constructor(cap: number, additive: boolean) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap); this.alpha = new Float32Array(cap); this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap); this.baseAlpha = new Float32Array(cap); this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap); this.grow = new Float32Array(cap); this.turb = new Float32Array(cap); this.groundDrag = new Float32Array(cap); this.outflowStarted = new Uint8Array(cap);
    this.ox = new Float32Array(cap); this.oz = new Float32Array(cap); this.spread = new Float32Array(cap); this.baseSize = new Float32Array(cap);
    this.windX = new Float32Array(cap); this.windZ = new Float32Array(cap); this.windResponse = new Float32Array(cap); this.windDynamic = new Uint8Array(cap); this.windClock = new Float32Array(cap); this.activeAt = new Int32Array(cap); this.activeAt.fill(-1);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: additive ? FRAG_GLOW : FRAG_SMOKE,
      uniforms: { uScale: { value: 500 }, uMaxSize: { value: 512 } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color | number, size: number, life: number, o: SpawnOpts = {}) {
    if (!o.densityManaged && this.density < 1 && Math.random() > this.density) return;
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.cap;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    const c = typeof color === 'number' ? _c.setHex(color) : color;
    this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;
    this.size[i] = size; this.baseSize[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.baseAlpha[i] = o.alpha ?? 1; this.alpha[i] = this.baseAlpha[i];
    this.grav[i] = o.grav ?? 0; this.drag[i] = o.drag ?? 0; this.grow[i] = o.grow ?? 0; this.turb[i] = o.turb ?? 0;
    this.ox[i] = o.ox ?? x; this.oz[i] = o.oz ?? z; this.spread[i] = o.spread ?? 0; this.groundDrag[i] = o.groundDrag ?? 0; this.outflowStarted[i] = 0;
    this.windX[i] = o.windX ?? 0; this.windZ[i] = o.windZ ?? 0; this.windResponse[i] = o.windResponse ?? 0; this.windDynamic[i] = o.windDynamic ? 1 : 0; this.windClock[i] = Math.random() * 0.3;
    if (this.activeAt[i] < 0) { this.activeAt[i] = this.active.length; this.active.push(i); }
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }
  update(dt: number, t: number) {
    const p = this.pos, v = this.vel; let dirty = false;
    for (let n = this.active.length - 1; n >= 0; n--) {
      const i = this.active[n]; dirty = true;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) {
        this.life[i] = 0; this.alpha[i] = 0; this.size[i] = 0;
        const last = this.active.pop()!;
        if (n < this.active.length) { this.active[n] = last; this.activeAt[last] = n; }
        this.activeAt[i] = -1;
        continue;
      }
      const tb = this.turb[i];
      if (tb > 0) {
        // Cheap divergence-free-ish curl field for fluid-like billowing.
        const x = p[i3] * 0.02, y = p[i3 + 1] * 0.02, z = p[i3 + 2] * 0.02;
        v[i3] += (Math.sin(y * 3.1 + t * 1.3) - Math.cos(z * 2.7 - t)) * tb * dt;
        v[i3 + 1] += (Math.sin(z * 2.3 + t * 0.9) - Math.cos(x * 3.3)) * tb * 0.4 * dt;
        v[i3 + 2] += (Math.sin(x * 2.9 - t * 1.1) - Math.cos(y * 2.1 + t)) * tb * dt;
      }
      const wind = this.windResponse[i];
      if (wind > 0) {
        // Weather particles periodically re-sample the live wind field as they travel,
        // instead of holding one fixed wind speed for their entire lifetime.
        if (this.windDynamic[i] && this.windSampler) {
          this.windClock[i] -= dt;
          if (this.windClock[i] <= 0) { this.windClock[i] = 0.25 + Math.random() * 0.15; const w = this.windSampler(p[i3], p[i3 + 1], p[i3 + 2]); this.windX[i] = w.x; this.windZ[i] = w.z; }
        }
        const blend = Math.min(1, wind * dt); v[i3] += (this.windX[i] - v[i3]) * blend; v[i3 + 2] += (this.windZ[i] - v[i3 + 2]) * blend;
      }
      v[i3 + 1] -= this.grav[i] * dt;
      const d = 1 - Math.min(1, this.drag[i] * dt);
      v[i3] *= d; v[i3 + 1] *= d; v[i3 + 2] *= d;
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      if (p[i3 + 1] < 0.3) {
        p[i3 + 1] = 0.3;
        const sp = this.spread[i];
        if (sp > 0) { // ground outflow (rainshaft / microburst spreading)
          let dx = p[i3] - this.ox[i], dz = p[i3 + 2] - this.oz[i];
          const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
          const vy = Math.abs(v[i3 + 1]);
          v[i3] += dx * vy * sp; v[i3 + 2] += dz * vy * sp;
          if (this.groundDrag[i] > 0) {
            if (!this.outflowStarted[i]) {
              this.outflowStarted[i] = 1; this.drag[i] = this.groundDrag[i];
              this.windResponse[i] = 0; this.windDynamic[i] = 0; this.turb[i] = 0;
            }
            v[i3 + 1] = 0;
          } else v[i3 + 1] = vy * 0.05;
        } else { v[i3 + 1] *= -0.3; v[i3] *= 0.7; v[i3 + 2] *= 0.7; }
      }
      const k = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.baseAlpha[i] * Math.min(1, k * 2.5) * Math.min(1, (1 - k) * 12 + 0.2);
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * (1 - k));
    }
    if (dirty) {
      (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Instanced physical debris chunks (rocks, ice shards, blocks). */
export class DebrisSystem {
  cap: number; cursor = 0; mesh: THREE.InstancedMesh; active: number[] = []; activeAt: Int32Array;
  p: Float32Array; v: Float32Array; r: Float32Array; rv: Float32Array; s: Float32Array; life: Float32Array; ml: Float32Array;
  density = 1;
  constructor(cap: number) {
    this.cap = cap;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    this.p = new Float32Array(cap * 3); this.v = new Float32Array(cap * 3); this.r = new Float32Array(cap * 3); this.rv = new Float32Array(cap * 3); this.activeAt = new Int32Array(cap); this.activeAt.fill(-1);
    this.s = new Float32Array(cap); this.life = new Float32Array(cap); this.ml = new Float32Array(cap);
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) { this.mesh.setMatrixAt(i, _m); this.mesh.setColorAt(i, _c.setHex(0x777777)); }
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, color: number, life = 4) {
    if (this.density < 1 && Math.random() > this.density) return;
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.cap; const i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z; this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.r[i3] = Math.random() * 6; this.r[i3 + 1] = Math.random() * 6; this.r[i3 + 2] = Math.random() * 6;
    this.rv[i3] = (Math.random() - 0.5) * 12; this.rv[i3 + 1] = (Math.random() - 0.5) * 12; this.rv[i3 + 2] = (Math.random() - 0.5) * 12;
    this.s[i] = size; this.life[i] = life; this.ml[i] = life;
    if (this.activeAt[i] < 0) { this.activeAt[i] = this.active.length; this.active.push(i); }
    this.mesh.setColorAt(i, _c.setHex(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt: number) {
    let dirty = false;
    for (let n = this.active.length - 1; n >= 0; n--) {
      const i = this.active[n], i3 = i * 3; dirty = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m);
        const last = this.active.pop()!;
        if (n < this.active.length) { this.active[n] = last; this.activeAt[last] = n; }
        this.activeAt[i] = -1; continue;
      }
      this.v[i3 + 1] -= 30 * dt;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      const sz = this.s[i];
      if (this.p[i3 + 1] < sz * 0.5) {
        this.p[i3 + 1] = sz * 0.5; this.v[i3 + 1] *= -0.35; this.v[i3] *= 0.6; this.v[i3 + 2] *= 0.6;
        this.rv[i3] *= 0.6; this.rv[i3 + 1] *= 0.6; this.rv[i3 + 2] *= 0.6;
      }
      this.r[i3] += this.rv[i3] * dt; this.r[i3 + 1] += this.rv[i3 + 1] * dt; this.r[i3 + 2] += this.rv[i3 + 2] * dt;
      const k = Math.min(1, this.life[i] / 0.6);
      _e.set(this.r[i3], this.r[i3 + 1], this.r[i3 + 2]); _q.setFromEuler(_e);
      _s.setScalar(sz * k); _p.set(this.p[i3], this.p[i3 + 1], this.p[i3 + 2]);
      _m.compose(_p, _q, _s); this.mesh.setMatrixAt(i, _m);
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** PBR ice spheres rendered in one instanced draw, with tumbling and live wind advection. */
export class HailSystem {
  readonly cap = 512;
  mesh: THREE.InstancedMesh;
  active: number[] = [];
  activeAt = new Int32Array(this.cap);
  pos = new Float32Array(this.cap * 3);
  vel = new Float32Array(this.cap * 3);
  rot = new Float32Array(this.cap * 3);
  spin = new Float32Array(this.cap * 3);
  size = new Float32Array(this.cap);
  life = new Float32Array(this.cap);
  windX = new Float32Array(this.cap);
  windZ = new Float32Array(this.cap);
  windClock = new Float32Array(this.cap);
  cursor = 0;
  private windPos = new THREE.Vector3();
  private color = new THREE.Color();

  constructor(scene: THREE.Scene, private sampleWind: (pos: THREE.Vector3) => THREE.Vector3) {
    this.activeAt.fill(-1);
    const geometry = new THREE.IcosahedronGeometry(0.5, 2);
    const vertices = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < vertices.count; i++) {
      const x=vertices.getX(i),y=vertices.getY(i),z=vertices.getZ(i);
      const radius=0.9+((Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453)%1+1)%1*0.2;
      vertices.setXYZ(i,x*radius,y*radius,z*radius);
    }
    vertices.needsUpdate = true; geometry.computeVertexNormals();
    const material = new THREE.MeshPhysicalMaterial({ color:0xeaf6fb, roughness:0.18, metalness:0.02, clearcoat:0.9, clearcoatRoughness:0.12, vertexColors:true });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    _m.makeScale(0,0,0);
    for (let i=0;i<this.cap;i++) { this.mesh.setMatrixAt(i,_m); this.mesh.setColorAt(i,this.color.setHex(0xdceef5)); }
    this.mesh.instanceMatrix.needsUpdate=true; if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true;
    scene.add(this.mesh);
  }

  spawn(x:number,y:number,z:number,vx:number,vy:number,vz:number,size:number,life:number) {
    const i=this.cursor; this.cursor=(this.cursor+1)%this.cap; const i3=i*3;
    this.pos[i3]=x; this.pos[i3+1]=y; this.pos[i3+2]=z;
    this.vel[i3]=vx; this.vel[i3+1]=vy; this.vel[i3+2]=vz;
    this.rot[i3]=Math.random()*6.28; this.rot[i3+1]=Math.random()*6.28; this.rot[i3+2]=Math.random()*6.28;
    this.spin[i3]=(Math.random()-.5)*5; this.spin[i3+1]=(Math.random()-.5)*7; this.spin[i3+2]=(Math.random()-.5)*5;
    this.size[i]=size; this.life[i]=life; this.windClock[i]=Math.random()*.3;
    if(this.activeAt[i]<0){this.activeAt[i]=this.active.length;this.active.push(i);}
    this.color.setRGB(0.82+Math.random()*.16,0.9+Math.random()*.09,0.94+Math.random()*.06);
    this.mesh.setColorAt(i,this.color); if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true;
  }

  update(dt:number) {
    let dirty=false;
    for(let n=this.active.length-1;n>=0;n--){
      const i=this.active[n],i3=i*3; this.life[i]-=dt;
      if(this.life[i]<=0||this.pos[i3+1]<=0.3){
        _m.makeScale(0,0,0); this.mesh.setMatrixAt(i,_m);
        const last=this.active.pop()!; if(n<this.active.length){this.active[n]=last;this.activeAt[last]=n;} this.activeAt[i]=-1; dirty=true; continue;
      }
      this.windClock[i]-=dt;
      if(this.windClock[i]<=0){this.windClock[i]=.3+Math.random()*.2;const w=this.sampleWind(this.windPos.set(this.pos[i3],this.pos[i3+1],this.pos[i3+2]));this.windX[i]=w.x;this.windZ[i]=w.z;}
      const blend=Math.min(1,1.5*dt); this.vel[i3]+=(this.windX[i]-this.vel[i3])*blend; this.vel[i3+2]+=(this.windZ[i]-this.vel[i3+2])*blend;
      this.pos[i3]+=this.vel[i3]*dt; this.pos[i3+1]+=this.vel[i3+1]*dt; this.pos[i3+2]+=this.vel[i3+2]*dt;
      this.rot[i3]+=this.spin[i3]*dt;this.rot[i3+1]+=this.spin[i3+1]*dt;this.rot[i3+2]+=this.spin[i3+2]*dt;
      const fade=Math.min(1,this.life[i]/.12); _e.set(this.rot[i3],this.rot[i3+1],this.rot[i3+2]); _q.setFromEuler(_e);
      _s.set(this.size[i]*fade,this.size[i]*fade*(.88+this.size[i]*.06),this.size[i]*fade); _p.set(this.pos[i3],this.pos[i3+1],this.pos[i3+2]);
      _m.compose(_p,_q,_s);this.mesh.setMatrixAt(i,_m);dirty=true;
    }
    if(dirty)this.mesh.instanceMatrix.needsUpdate=true;
  }

  dispose(){this.mesh.parent?.remove(this.mesh);this.mesh.geometry.dispose();(this.mesh.material as THREE.Material).dispose();}
}
