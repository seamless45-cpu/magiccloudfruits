import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { ParticleSystem, DebrisSystem, HailSystem } from './particles';
import { GameAudio } from './audio';
import { Bolt, boltStats, type BoltOpts } from './lightning';
import { Enemy } from './enemies';
import type { Effect, HitOpts, GraphicsSettings, ItemDef } from './types';
import { ITEMS } from './items';
import { V, rnd, slashMesh, Timed, Projectile, GEO } from './effects';

export const SKILL_KEYS = ['z', 'x', 'c', 'v', 'b', 'f', 'g', 'n', 'm', 'l', 'k', 'j'];
export const MAX_ZOOM = 900, MIN_ZOOM = 4;

export const PRESETS: Record<GraphicsSettings['preset'], Partial<GraphicsSettings>> = {
  low: { resolution: 0.6, shadows: false, shadowRes: 1024, bloom: false, particles: 0.35, debris: 0.35, maxBolts: 60, clouds: 0.5, antialiasFxaa: false, drawDistance: 12000 },
  medium: { resolution: 0.8, shadows: true, shadowRes: 1024, bloom: true, particles: 0.6, debris: 0.6, maxBolts: 120, clouds: 0.75, antialiasFxaa: false, drawDistance: 25000 },
  high: { resolution: 1, shadows: true, shadowRes: 2048, bloom: true, particles: 0.85, debris: 0.85, maxBolts: 200, clouds: 1, antialiasFxaa: true, drawDistance: 40000 },
  ultra: { resolution: 1.25, shadows: true, shadowRes: 4096, bloom: true, particles: 1, debris: 1, maxBolts: 320, clouds: 1.2, antialiasFxaa: true, drawDistance: 60000 },
};
export const defaultSettings = (): GraphicsSettings => ({ preset: 'high', sandbox: false, resolution: 1, shadows: true, shadowRes: 2048, bloom: true, bloomStrength: 0.9, particles: 0.85, debris: 0.85, maxBolts: 200, fog: true, exposure: 1.05, shake: 1, positionShake: true, rotationShake: true, showFps: true, antialiasFxaa: true, drawDistance: 40000, clouds: 1 });

interface CdState { rem: number; total: number; charges: number; interval: number; regenT: number; holding: boolean }

export class Game {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera; composer: EffectComposer; bloom: UnrealBloomPass; fxaa: ShaderPass;
  sun!: THREE.DirectionalLight; flashLight!: THREE.PointLight; flashI = 0;
  fx: ParticleSystem; smoke: ParticleSystem; debris: DebrisSystem;
  effects: Effect[] = []; timers: { t: number; fn: () => void }[] = [];
  enemies: Enemy[] = []; time = 0; pauseEnemies = 0;
  audio = new GameAudio(); hail!: HailSystem;
  settings: GraphicsSettings;
  player = { pos: V(0, 0, 0), vel: V(), facing: V(0, 0, 1), hp: 50000, maxHp: 50000, invincible: 0, mesh: new THREE.Group(), rArm: new THREE.Group(), lArm: new THREE.Group(), sword: new THREE.Group(), gun: new THREE.Group(), legs: [] as THREE.Group[], anim: { type: '', t: 0, d: 0 }, grounded: true, lockMove: 0 };
  cam = { yaw: Math.PI, pitch: 0.42, dist: 22, targetDist: 22 }; firstPerson = false;
  shakes: { pos: THREE.Vector3 | null; i: number; d: number; t: number }[] = [];
  aim = V(0, 0, 30); mouse = new THREE.Vector2(); ray = new THREE.Raycaster(); aimRing!: THREE.Mesh; aimLine!: THREE.Line;
  keys = new Set<string>(); joy = { x: 0, y: 0 }; isTouch = false; touchAim = false; touchSprint = false; joystickActive = false;
  items: ItemDef[] = ITEMS; equipped = -1; cds: Record<string, CdState[]> = {};
  m1 = { t: 0, combo: 0, last: 0, lag: 0 };
  buffs: Record<string, number> = {};
  lightningCharge = 50; chargeT = 0;
  stats = { kills: 0, dmg: 0, dmgWin: [] as { t: number; d: number }[] };
  fps = 60; fpsAcc = 0; fpsN = 0;
  overlay = { color: '#000', a: 0, fade: 0 };
  onToast: (m: string, c: string) => void = () => {};
  onFatal: (m: string) => void = () => {};
  sel: Record<string, any> = { supercell: 1 };
  gamepadIdx: number | null = null; prevPadButtons: boolean[] = [];
  raf = 0; last = performance.now(); container: HTMLElement; disposed = false; paused = true; cloudGroups: THREE.Object3D[] = [];
  halfFloat = true;
  pinch = { d: 0 }; drag = { active: false, x: 0, y: 0, id: -1, moved: 0 };

  constructor(container: HTMLElement, settings: GraphicsSettings) {
    this.container = container; this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    // EffectComposer (three r152+) renders into half-float targets. Without the matching
    // extension the framebuffer is incomplete and the 3D view comes out black, so detect it
    // up front and fall back to direct rendering.
    const gl2 = this.renderer.getContext() as WebGL2RenderingContext;
    try { this.halfFloat = !!(gl2.getExtension('EXT_color_buffer_half_float') || gl2.getExtension('EXT_color_buffer_float')); }
    catch { this.halfFloat = false; }
    this.renderer.shadowMap.type = THREE.PCFShadowMap; this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, settings.drawDistance);
    this.scene.background = new THREE.Color(0xb9c9cf);
    this.scene.fog = new THREE.FogExp2(0xb7b09a, 0.00055);
    this.buildWorld();
    this.fx = new ParticleSystem(30000, true); this.smoke = new ParticleSystem(26000, false); this.smoke.windSampler = (x, y, z) => this.windAt(V(x, y, z)); this.debris = new DebrisSystem(2500);
    this.hail = new HailSystem(this.scene, pos => this.windAt(pos));
    this.scene.add(this.fx.points, this.smoke.points, this.debris.mesh);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.9, 0.5, 0.82); this.composer.addPass(this.bloom);
    this.fxaa = new ShaderPass(FXAAShader); this.composer.addPass(this.fxaa);
    this.composer.addPass(new OutputPass());
    for (const it of this.items) this.cds[it.id] = it.skills.map(s => ({ rem: 0, total: s.cd, charges: s.charges?.max ?? 0, interval: 0, regenT: 0, holding: false }));
    for (let i = 0; i < 48; i++) this.enemies.push(new Enemy(this, 'normal'));
    for (let i = 0; i < 7; i++) this.enemies.push(new Enemy(this, 'elite'));
    for (let i = 0; i < 2; i++) this.enemies.push(new Enemy(this, 'boss'));
    for (let i = 0; i < 6; i++) this.enemies.push(new Enemy(this, 'runner'));
    for (let i = 0; i < 4; i++) this.enemies.push(new Enemy(this, 'ranged'));
    for (let i = 0; i < 2; i++) this.enemies.push(new Enemy(this, 'brute'));
    this.applySettings(settings);
    this.bindInput();
    window.addEventListener('resize', this.resize); this.resize();
    this.loop();
  }

  // ---------------------------------------------------------------- world
  buildWorld() {
    const hemi = new THREE.HemisphereLight(0xd7e9fa, 0x8b7751, 1.15); this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff3d8, 2.45); this.sun.position.set(80, 140, 60); this.sun.castShadow = true;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera; sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120; sc.far = 600; this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);
    this.flashLight = new THREE.PointLight(0xffffff, 0, 400, 1.2); this.scene.add(this.flashLight);
    // sky dome
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vp; void main(){ vp=position; vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position=p.xyww; }',
      fragmentShader: 'varying vec3 vp; void main(){ vec3 d=normalize(vp); float h=max(d.y,0.); vec3 zenith=vec3(0.24,0.43,0.57), upper=vec3(0.48,0.66,0.76), horizon=vec3(0.87,0.82,0.72), warm=vec3(1.0,0.88,0.71); float haze=pow(1.0-h,3.2); vec3 col=mix(horizon,upper,smoothstep(0.0,0.32,h)); col=mix(col,zenith,smoothstep(0.28,0.92,h)); col=mix(col,warm,clamp(haze*0.16,0.0,0.2)); vec3 sunDir=normalize(vec3(0.43,0.75,0.50)); float mu=dot(d,sunDir); float halo=pow(max(mu,0.0),22.0)*0.16+pow(max(mu,0.0),110.0)*0.45; float disc=1.0-smoothstep(0.99988,0.99995,mu); col+=vec3(1.0,0.88,0.68)*(halo+disc*1.4); float under=clamp(-d.y,0.0,1.0); col=mix(col,horizon*0.72,under*0.55); gl_FragColor=vec4(col,1.); }' }));
    sky.scale.setScalar(1000); sky.frustumCulled = false; sky.renderOrder = -10; sky.onBeforeRender = () => sky.position.copy(this.camera.position); this.scene.add(sky);
    // Sun-baked grassland floor with broad irregular sand regions and fine dry-earth grain.
    const gmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    gmat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTerrain;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTerrain=(modelMatrix*vec4(transformed,1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vTerrain;
float terrainHash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float terrainNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(terrainHash(i),terrainHash(i+vec2(1.,0.)),f.x),mix(terrainHash(i+vec2(0.,1.)),terrainHash(i+vec2(1.,1.)),f.x),f.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
vec2 p=vTerrain.xz;
float broad=terrainNoise(p*0.006);
float grain=terrainNoise(p*0.095);
float patchA=length((p-vec2(420.,-240.))/vec2(560.,390.));
float patchB=length((p-vec2(-500.,390.))/vec2(500.,360.));
float patchC=length((p-vec2(90.,730.))/vec2(420.,310.));
float desert=max(max(1.-smoothstep(.82,1.16,patchA+(broad-.5)*.22),1.-smoothstep(.8,1.15,patchB+(broad-.5)*.2)),1.-smoothstep(.78,1.12,patchC+(broad-.5)*.18));
float dryVariation=0.82+0.34*broad+0.13*grain;
vec3 grass=vec3(.18,.18,.085)*dryVariation;
vec3 sand=vec3(.39,.30,.18)*(0.88+0.25*grain);
diffuseColor.rgb*=mix(grass,sand,desert);`);
    };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2), gmat); ground.receiveShadow = true; this.scene.add(ground);
    // Sparse dry-grass tufts are instanced into one draw call; rocky clusters mark the sandy regions.
    const tuftPositions: number[] = [];
    for (let blade = 0; blade < 3; blade++) {
      const a = blade * Math.PI / 3, tx = Math.cos(a), tz = Math.sin(a), dx = -tz, dz = tx;
      const h = 0.55 + (blade % 2) * 0.12, w = 0.055;
      const lx = -dx * w, lz = -dz * w, rx = dx * w, rz = dz * w;
      tuftPositions.push(lx,0,lz, rx,0,rz, tx*0.13,h,tz*0.13, rx,0,rz, tx*0.13,h,tz*0.13, -dx*w*0.3,0,-dz*w*0.3);
    }
    const tuftGeo = new THREE.BufferGeometry(); tuftGeo.setAttribute('position', new THREE.Float32BufferAttribute(tuftPositions, 3)); tuftGeo.computeVertexNormals();
    const tuftMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide, vertexColors: false });
    const tuftMesh = new THREE.InstancedMesh(tuftGeo, tuftMat, 2400); tuftMesh.frustumCulled = false; tuftMesh.castShadow = false;
    const deserts: [number, number, number, number][] = [[420,-240,560,390],[-500,390,500,360],[90,730,420,310]];
    const inDesert = (x: number, z: number) => deserts.some(([cx,cz,rx,rz]) => ((x-cx)/rx)**2 + ((z-cz)/rz)**2 < 0.92);
    const grassM = new THREE.Matrix4(), grassQ = new THREE.Quaternion(), grassS = new THREE.Vector3(), grassP = new THREE.Vector3();
    const grassColor = new THREE.Color(); let grassCount = 0, attempts = 0;
    while (grassCount < 2400 && attempts++ < 12000) {
      const a = Math.random()*Math.PI*2, r = Math.sqrt(Math.random())*1290, x=Math.cos(a)*r, z=Math.sin(a)*r;
      if (inDesert(x,z)) continue;
      grassP.set(x,0,z); grassQ.setFromAxisAngle(V(0,1,0),Math.random()*Math.PI*2);
      grassS.setScalar(0.7+Math.random()*0.9); grassS.y=0.7+Math.random()*0.8;
      grassM.compose(grassP,grassQ,grassS); tuftMesh.setMatrixAt(grassCount,grassM);
      grassColor.setHSL(0.13+Math.random()*0.055,0.25+Math.random()*0.18,0.27+Math.random()*0.13); tuftMesh.setColorAt(grassCount,grassColor); grassCount++;
    }
    tuftMesh.count=grassCount; tuftMesh.instanceMatrix.needsUpdate=true; if(tuftMesh.instanceColor)tuftMesh.instanceColor.needsUpdate=true; this.scene.add(tuftMesh);
    const rockGeo = new THREE.DodecahedronGeometry(1,0), rockMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:1, flatShading:true });
    const rocks = new THREE.InstancedMesh(rockGeo,rockMat,42); rocks.frustumCulled=false;
    for(let i=0;i<42;i++){ const zone=deserts[i%deserts.length], a=Math.random()*Math.PI*2, r=Math.sqrt(Math.random())*.8;
      const x=zone[0]+Math.cos(a)*zone[2]*r,z=zone[1]+Math.sin(a)*zone[3]*r, h=1.2+Math.random()*4.5;
      grassP.set(x,h*.38,z); grassQ.setFromEuler(new THREE.Euler(Math.random()*.5,Math.random()*6.28,Math.random()*.35)); grassS.set(2+Math.random()*5,h,2+Math.random()*4);
      grassM.compose(grassP,grassQ,grassS); rocks.setMatrixAt(i,grassM); grassColor.setHSL(.09+Math.random()*.035,.2+Math.random()*.12,.35+Math.random()*.16); rocks.setColorAt(i,grassColor);
    }
    rocks.instanceMatrix.needsUpdate=true; if(rocks.instanceColor)rocks.instanceColor.needsUpdate=true; this.scene.add(rocks);
    // Vast perimeter and elevated, soft-edged cloud banks give the arena a true open-sky scale.
    const cloudPalette = [0xf1f5ff, 0xdce6f4, 0xc7d4e8, 0xffffff];
    const cloudPuffGeo = new THREE.SphereGeometry(1, 16, 12);
    const cloudPuffMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:1, metalness:0, transparent:true, opacity:0.66, depthWrite:false });
    const cloudM = new THREE.Matrix4(), cloudP = new THREE.Vector3(), cloudS = new THREE.Vector3(), cloudQ = new THREE.Quaternion(), cloudColor = new THREE.Color();
    for (let i = 0; i < 13; i++) {
      const a = i * Math.PI * 2 / 13 + rnd(-0.2, 0.2), radius = rnd(700, 1550), count = 9 + Math.floor(Math.random() * 7);
      const cloud = new THREE.InstancedMesh(cloudPuffGeo,cloudPuffMat,count); cloud.frustumCulled=false;
      cloud.position.set(Math.cos(a) * radius, rnd(190, 330), Math.sin(a) * radius); cloud.rotation.y = rnd(0, Math.PI * 2);
      for (let j = 0; j < count; j++) {
        const size = rnd(40, 105); cloudP.set(rnd(-150,150),rnd(-18,24),rnd(-120,120));
        cloudS.set(size*rnd(1.05,1.7),size*rnd(.25,.52),size*rnd(.8,1.4)); cloudM.compose(cloudP,cloudQ,cloudS); cloud.setMatrixAt(j,cloudM);
        cloudColor.setHex(cloudPalette[Math.floor(Math.random()*cloudPalette.length)]); cloud.setColorAt(j,cloudColor);
      }
      cloud.instanceMatrix.needsUpdate=true; if(cloud.instanceColor)cloud.instanceColor.needsUpdate=true;
      cloud.userData.drift = rnd(0.35, 1.1); cloud.userData.phase = rnd(0, Math.PI * 2);
      this.cloudGroups.push(cloud); this.scene.add(cloud);
    }
    // A few pale field markers sit at the far edge; the fighting ground itself stays open.
    const markerGeo = new THREE.CylinderGeometry(1.8, 2.8, 12, 5);
    const markerMat = new THREE.MeshStandardMaterial({ color: 0xf0ede3, metalness: 0.38, roughness: 0.42, emissive: 0x252116, emissiveIntensity: 0.08 });
    const markers = new THREE.InstancedMesh(markerGeo, markerMat, 20); markers.frustumCulled = false;
    const markerM = new THREE.Matrix4(), markerS = new THREE.Vector3(), markerP = new THREE.Vector3();
    for (let i=0;i<20;i++){ const a=i*Math.PI*2/20, r=1350, h=8+(i%4)*2.5;
      markerP.set(Math.cos(a)*r,h/2,Math.sin(a)*r); markerS.set(1,h/12,1); markerM.compose(markerP,new THREE.Quaternion().setFromAxisAngle(V(0,1,0),a),markerS); markers.setMatrixAt(i,markerM);
    }
    markers.instanceMatrix.needsUpdate=true; this.scene.add(markers);
    // Low, distant ochre mesas frame the field without cluttering the playable grassland.
    const mesaGeo = new THREE.DodecahedronGeometry(1,1), mesaMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:1, flatShading:true });
    const mesas = new THREE.InstancedMesh(mesaGeo,mesaMat,34); mesas.frustumCulled=false;
    for(let i=0;i<34;i++){ const a=i*Math.PI*2/34+rnd(-.08,.08), r=rnd(1850,3150), h=rnd(70,220);
      markerP.set(Math.cos(a)*r,h*.72,Math.sin(a)*r); markerS.set(rnd(150,430),h,rnd(170,460));
      markerM.compose(markerP,new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(-.08,.08),a,rnd(-.06,.06))),markerS); mesas.setMatrixAt(i,markerM);
      grassColor.setHSL(.085+Math.random()*.025,.16+Math.random()*.1,.34+Math.random()*.12); mesas.setColorAt(i,grassColor);
    }
    mesas.instanceMatrix.needsUpdate=true; if(mesas.instanceColor)mesas.instanceColor.needsUpdate=true; this.scene.add(mesas);
    // player
    const P = this.player; const bm = new THREE.MeshStandardMaterial({ color: 0xdfe6f0, metalness: 0.4, roughness: 0.35 }); const am = new THREE.MeshStandardMaterial({ color: 0xe5e2d8, metalness: 0.68, roughness: 0.34, emissive: 0x9a8a62, emissiveIntensity: 0.12 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.78, 5, 12), am); body.position.y = 1.0; body.castShadow = true;
    const chestMat = new THREE.MeshStandardMaterial({ color: 0xf4f0e4, metalness: 0.62, roughness: 0.32, emissive: 0x6d603e, emissiveIntensity: 0.14 });
    const chest = new THREE.Mesh(new THREE.DodecahedronGeometry(0.52, 0), chestMat); chest.scale.set(0.82, 0.58, 0.52); chest.position.set(0, 1.18, 0.18); chest.castShadow = true;
    const shoulders = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.24, 0), chestMat, 2); const shoulderM = new THREE.Matrix4(), shoulderQ = new THREE.Quaternion(), shoulderS = new THREE.Vector3(1.35, 0.9, 1.05);
    for (let i = 0; i < 2; i++) { shoulderM.compose(V(i === 0 ? -0.5 : 0.5, 1.48, 0), shoulderQ, shoulderS); shoulders.setMatrixAt(i, shoulderM); } shoulders.instanceMatrix.needsUpdate = true; shoulders.castShadow = true;
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 1), new THREE.MeshBasicMaterial({ color: 0xffd16f })); core.position.set(0, 1.2, 0.3);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.68, 0.24), am); pack.position.set(0, 1.05, -0.27); P.mesh.add(pack);
    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32, 1), bm); head.position.y = 1.72; head.scale.set(0.9, 1, 0.86); head.castShadow = true;
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 5), am); crest.position.set(0, 2.01, -0.03); crest.rotation.x = -0.25;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.1, 0.13), new THREE.MeshBasicMaterial({ color: 0xe3c47e })); visor.position.set(0, 1.74, 0.24);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.16, 10), am); neck.position.y = 1.46;
    const armG = new THREE.CapsuleGeometry(0.1, 0.55, 3, 8);
    const ra = new THREE.Mesh(armG, bm); ra.position.y = -0.35; P.rArm.add(ra); P.rArm.position.set(-0.47, 1.42, 0);
    const la = new THREE.Mesh(armG, bm); la.position.y = -0.35; P.lArm.add(la); P.lArm.position.set(0.47, 1.42, 0);
    const legG = new THREE.CapsuleGeometry(0.13, 0.5, 3, 8); const legMat = am; const l1 = new THREE.Group(), l2 = new THREE.Group();
    for (const [leg, x] of [[l1, -0.18], [l2, 0.18]] as [THREE.Group, number][]) { const thigh = new THREE.Mesh(legG, legMat); thigh.position.y = 0.34; thigh.castShadow = true; const knee = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), bm); knee.position.set(0, 0.1, 0.05); const boot = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.18, 0.38), bm); boot.position.set(0, -0.03, 0.09); leg.add(thigh, knee, boot); leg.position.set(x, 0.03, 0); }
    P.sword.position.set(0, -0.72, 0.1); P.sword.rotation.x = Math.PI / 2; P.rArm.add(P.sword);
    P.gun.position.set(0, -0.7, 0.18); P.rArm.add(P.gun);
    P.mesh.add(body, chest, core, neck, head, crest, shoulders, visor, P.rArm, P.lArm, l1, l2); P.legs = [l1, l2]; this.scene.add(P.mesh);
    // aim reticle
    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe4d7b6, transparent: true, opacity: 0.75, depthWrite: false })); this.scene.add(this.aimRing);
    const lg = new THREE.BufferGeometry().setFromPoints([V(), V()]);
    this.aimLine = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: 0xe0d6bd, dashSize: 1, gapSize: 1, transparent: true, opacity: 0.36 })); this.aimLine.frustumCulled = false; this.scene.add(this.aimLine);
  }
  setHeld(item: ItemDef | null) {
    const P = this.player; P.sword.clear(); P.gun.clear();
    if (!item) return;
    const col = new THREE.Color(item.color);
    if (item.type === 'sword') {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, item.id === 'bisento' || item.id === 'pole' ? 2.6 : 1.5, 0.22), new THREE.MeshStandardMaterial({ color: 0xdde4ee, metalness: 1, roughness: 0.15, emissive: col, emissiveIntensity: 0.6 }));
      blade.position.y = item.id === 'bisento' || item.id === 'pole' ? 1.0 : 0.85;
      const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.1), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8 }));
      P.sword.add(blade, hilt);
      if (item.id === 'bisento') { const hd = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.5), blade.material); hd.position.y = 2.3; P.sword.add(hd); }
    } else if (item.m1?.gun) {
      const g1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.7), new THREE.MeshStandardMaterial({ color: 0x20252f, metalness: 0.9, roughness: 0.25 }));
      const g2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1 })); g2.position.z = 0.5;
      P.gun.add(g1, g2);
    }
  }

  // ---------------------------------------------------------------- settings
  applySettings(s: GraphicsSettings) {
    this.settings = s;
    for (const cloud of this.cloudGroups) cloud.scale.setScalar(s.clouds);
    this.renderer.setPixelRatio(Math.min(2.5, window.devicePixelRatio * s.resolution));
    this.renderer.shadowMap.enabled = s.shadows; this.sun.castShadow = s.shadows;
    if (this.sun.shadow.mapSize.x !== s.shadowRes) { this.sun.shadow.mapSize.set(s.shadowRes, s.shadowRes); this.sun.shadow.map?.dispose(); (this.sun.shadow as any).map = null; }
    this.scene.traverse((o: any) => { if (o.material) o.material.needsUpdate = true; });
    this.bloom.enabled = s.bloom && this.halfFloat; this.bloom.strength = s.bloomStrength; this.fxaa.enabled = s.antialiasFxaa && this.halfFloat;
    this.fx.density = s.particles; this.smoke.density = s.particles; this.debris.density = s.debris;
    (this.scene.fog as THREE.FogExp2).density = s.fog ? 0.0009 * (25000 / s.drawDistance) : 0;
    this.renderer.toneMappingExposure = s.exposure;
    this.camera.far = s.drawDistance; this.camera.updateProjectionMatrix();
    this.resize();
  }
  resize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h); this.composer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.fxaa.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
    const sc = (h * pr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    const gl = this.renderer.getContext(); const maxPt = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)[1] || 512;
    for (const p of [this.fx, this.smoke]) { p.mat.uniforms.uScale.value = sc; p.mat.uniforms.uMaxSize.value = maxPt; }
  };

  // ---------------------------------------------------------------- input (PC, mobile, console, laptop, TV)
  bindInput() {
    const el = this.renderer.domElement;
    this.isTouch = window.matchMedia?.('(pointer: coarse)').matches || (('ontouchstart' in window) && !window.matchMedia?.('(pointer: fine)').matches);
    window.addEventListener('keydown', this.onKeyDown); window.addEventListener('keyup', this.onKeyUp);
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => { e.preventDefault(); this.zoomBy(Math.sign(e.deltaY) * Math.max(1, this.cam.targetDist * 0.12) * Math.min(3, Math.abs(e.deltaY) / 60 + 0.5)); }, { passive: false });
    el.addEventListener('pointerdown', this.onPointerDown); window.addEventListener('pointermove', this.onPointerMove); window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('touchstart', this.onTouch, { passive: false }); el.addEventListener('touchmove', this.onTouch, { passive: false }); el.addEventListener('touchend', this.onTouchEnd);
    window.addEventListener('gamepadconnected', (e: any) => { this.gamepadIdx = e.gamepad.index; this.toast('CONTROLLER CONNECTED', '#7fffd4'); });
    window.addEventListener('gamepaddisconnected', () => { this.gamepadIdx = null; });
  }
  zoomBy(d: number) { this.cam.targetDist = THREE.MathUtils.clamp(this.cam.targetDist + d, MIN_ZOOM, MAX_ZOOM); }
  setZoom(m: number) { this.cam.targetDist = THREE.MathUtils.clamp(m, MIN_ZOOM, MAX_ZOOM); }
  onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    this.audio.unlock();
    const k = e.key.toLowerCase();
    if (this.keys.has(k)) return; this.keys.add(k);
    const si = SKILL_KEYS.indexOf(k); if (si >= 0) this.pressSkill(si);
    if (k >= '1' && k <= '9') this.toggleEquip(+k - 1); if (k === '0') this.toggleEquip(9); if (k === '-') this.toggleEquip(10);
    if (k === '=' || k === '+' || k === 'pageup') this.zoomBy(-8); if (k === 'pagedown') this.zoomBy(8);
    if (k === ' ') { this.jump(); e.preventDefault(); }
    if (k === 'e') this.doM1();
    if (k === 'p') this.toggleFirstPerson();
  };
  onKeyUp = (e: KeyboardEvent) => { const k = e.key.toLowerCase(); this.keys.delete(k); const si = SKILL_KEYS.indexOf(k); if (si >= 0) this.releaseSkill(si); };
  updateMouse(x: number, y: number) { const r = this.renderer.domElement.getBoundingClientRect(); this.mouse.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); }
  onPointerDown = (e: PointerEvent) => {
    this.audio.unlock();
    if (e.pointerType === 'touch') return;
    this.updateMouse(e.clientX, e.clientY);
    if (e.button === 2 || e.button === 1) { this.drag = { active: true, x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0 }; }
    else if (e.button === 0) { this.doM1(); }
  };
  onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    this.updateMouse(e.clientX, e.clientY);
    if (this.drag.active) { const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y; this.drag.x = e.clientX; this.drag.y = e.clientY; this.rotateCam(dx, dy); }
  };
  onPointerUp = (e: PointerEvent) => { if (e.pointerType !== 'touch') this.drag.active = false; };
  rotateCam(dx: number, dy: number) { this.cam.yaw -= dx * 0.005; this.cam.pitch = THREE.MathUtils.clamp(this.cam.pitch + dy * 0.004, -0.2, 1.45); }
  private cameraTouches(touches: TouchList): Touch[] {
    // HUD contacts (especially the left movement stick) are never camera pinch inputs.
    return Array.from(touches).filter(t => {
      const target = document.elementFromPoint(t.clientX, t.clientY);
      return !target?.closest('.mobile-joystick, .mobile-jump, [data-panel=\"inventory\"], [data-panel=\"skills\"], [data-panel=\"zoom\"]');
    });
  }
  onTouch = (e: TouchEvent) => {
    e.preventDefault();
    const ts = this.cameraTouches(e.touches);
    if (ts.length >= 2 && !this.joystickActive) {
      const d = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
      if (this.pinch.d > 0) this.zoomBy((this.pinch.d - d) * 0.25 * Math.max(0.5, this.cam.targetDist / 40));
      this.pinch.d = d; this.drag.active = false; return;
    }
    this.pinch.d = 0;
    const t = (this.joystickActive && this.drag.active ? ts.find(x => x.identifier === this.drag.id) : undefined) ?? ts[0]; if (!t) { this.drag.active = false; return; }
    if (e.type === 'touchstart' || !this.drag.active || this.drag.id !== t.identifier) {
      this.drag = { active: true, x: t.clientX, y: t.clientY, id: t.identifier, moved: 0 };
      this.updateMouse(t.clientX, t.clientY);
    } else {
      const dx = t.clientX - this.drag.x, dy = t.clientY - this.drag.y;
      this.drag.moved += Math.abs(dx) + Math.abs(dy); this.drag.x = t.clientX; this.drag.y = t.clientY;
      this.rotateCam(dx, dy);
    }
  };
  onTouchEnd = (e: TouchEvent) => {
    const remaining = this.cameraTouches(e.touches);
    if (remaining.length >= 2 && !this.joystickActive) {
      this.pinch.d = Math.hypot(remaining[0].clientX - remaining[1].clientX, remaining[0].clientY - remaining[1].clientY);
      this.drag.active = false; return;
    }
    if (remaining.length >= 1) {
      const t = (this.joystickActive && this.drag.active ? remaining.find(x => x.identifier === this.drag.id) : undefined) ?? remaining[0];
      this.pinch.d = 0; this.drag = { active: true, x: t.clientX, y: t.clientY, id: t.identifier, moved: 0 }; return;
    }
    const endedCameraTouch = Array.from(e.changedTouches).some(t => {
      const target = document.elementFromPoint(t.clientX, t.clientY);
      return !target?.closest('.mobile-joystick, .mobile-jump, [data-panel=\"inventory\"], [data-panel=\"skills\"], [data-panel=\"zoom\"]');
    });
    if (endedCameraTouch && this.drag.active && this.drag.moved < 8) { this.updateMouse(this.drag.x, this.drag.y); this.touchAim = true; this.doM1(); }
    this.drag.active = false; this.pinch.d = 0;
  };
  pollGamepad(dt: number) {
    const pads = navigator.getGamepads?.(); if (!pads) return; const gp = this.gamepadIdx !== null ? pads[this.gamepadIdx] : Array.from(pads).find(p => p);
    if (!gp) return;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    this.joy.x = dz(gp.axes[0]); this.joy.y = dz(gp.axes[1]);
    this.rotateCam(dz(gp.axes[2]) * 900 * dt, dz(gp.axes[3]) * 600 * dt);
    const b = gp.buttons.map(x => x.pressed); const was = (i: number) => this.prevPadButtons[i];
    const lt = gp.buttons[6]?.value ?? 0, rt = gp.buttons[7]?.value ?? 0;
    if (lt > 0.2) this.zoomBy(-lt * 120 * dt); if (b[4] && !b[2] && false) this.zoomBy(0);
    if (b[9] && !was(9)) this.toggleEquip((this.equipped + 1) % this.items.length); // start: cycle item
    if (b[8] && !was(8)) this.zoomBy(40); // select: zoom out step
    if (rt > 0.5 && !(this.prevPadButtons[7])) this.doM1();
    if (b[0] && !was(0)) this.jump();
    const map: [number, number][] = [[2, 0], [3, 1], [1, 2], [4, 3], [5, 4], [12, 5], [15, 6], [13, 7], [14, 8], [10, 9], [11, 10]];
    for (const [bi, si] of map) { if (b[bi] && !was(bi)) this.pressSkill(si); if (!b[bi] && was(bi)) this.releaseSkill(si); }
    if (gp.axes[3] !== undefined && b[10] && false) this.zoomBy(0);
    this.prevPadButtons = b;
  }

  // ---------------------------------------------------------------- items & skills
  get item(): ItemDef | null { return this.equipped >= 0 ? this.items[this.equipped] : null; }
  toggleEquip(i: number) {
    if (i < 0 || i >= this.items.length) return;
    for (let s = 0; s < 12; s++) this.releaseSkill(s);
    this.equipped = this.equipped === i ? -1 : i; this.m1.combo = 0;
    this.audio.uiSound('equip'); this.setHeld(this.item);
    if (this.item) this.toast(`EQUIPPED: ${this.item.name.toUpperCase()}`, this.item.color);
  }
  cdMul() { return this.settings.sandbox ? 0 : this.buff('alarm') ? 0.75 : 1; }
  dmgMul() { return this.buff('alarm') ? 3 : 1; }
  aoe(r: number) { return this.buff('alarm') ? r * 3 : r; }
  buff(n: string) { return (this.buffs[n] ?? 0) > this.time; }
  skillState(i: number) { const it = this.item; if (!it) return null; return this.cds[it.id][i] ?? null; }
  pressSkill(i: number) {
    const it = this.item; if (!it) return; const s = it.skills[i]; if (!s) return; const st = this.cds[it.id][i];
    if (st.holding) return;
    if (s.charges) {
      if (st.charges < 1 || st.interval > 0 || st.rem > 0) return;
      st.charges--; st.interval = 0.2; this.audio.uiSound('skill'); s.cast?.(this);
      if (st.charges <= 0) this.startCd(it, i);
      return;
    }
    if (st.rem > 0) return;
    if (s.holdStart) { st.holding = true; this.audio.uiSound('skill'); s.holdStart(this); return; }
    this.audio.uiSound('skill'); s.cast?.(this); this.startCd(it, i);
  }
  releaseSkill(i: number) {
    const it = this.item; if (!it) return; const s = it.skills[i]; if (!s) return; const st = this.cds[it.id][i];
    if (!st.holding) return; st.holding = false; s.holdEnd?.(this); this.startCd(it, i);
  }
  startCd(it: ItemDef, i: number) { const s = it.skills[i]; const st = this.cds[it.id][i]; st.total = s.cd * (s.cdMul ? s.cdMul(this) : 1) * this.cdMul(); st.rem = st.total; }
  tickCds(dt: number) {
    if (this.settings.sandbox) { for (const it of this.items) it.skills.forEach((s, i) => { const st = this.cds[it.id][i]; st.rem = 0; st.total = 0; st.interval = 0; if (s.charges) { st.charges = s.charges.max; st.regenT = 0; } }); }
    for (const it of this.items) it.skills.forEach((s, i) => {
      const st = this.cds[it.id][i];
      if (st.rem > 0) st.rem = Math.max(0, st.rem - dt);
      if (st.interval > 0) st.interval -= dt;
      if (s.charges && st.charges < s.charges.max) { st.regenT += dt; if (st.regenT >= s.charges.regen) { st.regenT = 0; st.charges++; } }
      if (st.holding && s.holdTick && this.item === it) { if (s.holdTick(this, dt) === false) this.releaseSkill(i); }
    });
  }
  doM1() {
    const it = this.item; if (!it?.m1) return; const m = it.m1;
    if (this.m1.t > 0 || this.m1.lag > 0) return;
    if (this.time - this.m1.last > 1.2) this.m1.combo = 0;
    this.m1.combo++; this.m1.last = this.time;
    const gunMul = m.gun ? (this.buff('iceBombard') ? 0.23 : this.buff('hellFury') ? 0.22 : 1) : 1;
    this.m1.t = m.interval * gunMul;
    m.onHit(this, this.m1.combo);
    if (m.combo && this.m1.combo >= m.combo) { this.m1.combo = 0; if (m.endLag) this.m1.lag = m.endLag; }
    this.anim(m.gun ? 'shoot' : 'slash', m.gun ? 0.08 : 0.18);
  }
  anim(type: string, d: number) { this.player.anim = { type, t: 0, d }; }

  // ---------------------------------------------------------------- combat API
  add(e: Effect) { this.effects.push(e); return e; }
  after(d: number, fn: () => void) { this.timers.push({ t: this.time + d, fn }); }
  every(iv: number, n: number, fn: (i: number) => void) { for (let i = 0; i < n; i++) this.after(iv * i, () => fn(i)); }
  toast(m: string, c = '#7fdcff') { this.onToast(m, c); }
  flash(p: THREE.Vector3, c: number, i: number) { if (i >= this.flashI * 0.6) { this.flashLight.position.set(p.x, p.y + 6, p.z); this.flashLight.color.setHex(c); this.flashI = Math.max(this.flashI, i); } }
  screen(color: string, a: number, fade: number) { this.overlay = { color, a, fade }; }
  shake(pos: THREE.Vector3, intensity: number, dur: number) { this.shakes.push({ pos: pos.clone(), i: intensity, d: dur, t: 0 }); }
  shakeRaw(intensity: number, dur: number) { this.shakes.push({ pos: null, i: intensity, d: dur, t: 0 }); }
  toggleFirstPerson() {
    this.firstPerson = !this.firstPerson;
    this.cam.pitch = this.firstPerson ? 0.06 : 0.42;
    this.player.mesh.visible = !this.firstPerson;
    this.toast(this.firstPerson ? 'FIRST-PERSON VIEW' : 'THIRD-PERSON VIEW', '#f4e8c9');
  }
  windAt(pos: THREE.Vector3) {
    const wind = V(1.3 + Math.sin(this.time * 0.08) * 0.7, 0, 0.7 + Math.cos(this.time * 0.065) * 0.8);
    for (const effect of this.effects) {
      const sample = (effect as Effect & { windAt?: (at: THREE.Vector3) => THREE.Vector3 | null }).windAt;
      if (sample) { const local = sample.call(effect, pos); if (local) wind.add(local); }
    }
    return wind.clampLength(0, 78);
  }
  bolt(a: THREE.Vector3, b: THREE.Vector3, o: BoltOpts = {}) { if (boltStats.active >= this.settings.maxBolts) return null; return this.add(new Bolt(this.scene, a, b, { ...o, width: (o.width ?? 0.6) * 1.2 })) as Bolt; }
  /** tall vertical jagged bolt from sky to ground point; `n` overlapped bolts */
  strike(x: number, z: number, o: BoltOpts & { h?: number; n?: number; spread?: number } = {}) {
    const h = (o.h ?? rnd(175, 245)) * 3; const n = o.n ?? 1;
    for (let i = 0; i < n; i++) { const s = o.spread ?? 0.6; this.bolt(V(x + rnd(-8, 8), h, z + rnd(-8, 8)), V(x + rnd(-s, s), 0.1, z + rnd(-s, s)), { segs: 18, jag: 0.035, branches: 2, width: 0.38, life: 0.32, ...o }); }
    const c = new THREE.Color(o.color ?? 0x88aaff);
    for (let i = 0; i < 14; i++) this.fx.spawn(x, 0.4, z, rnd(-12, 12), rnd(4, 16), rnd(-12, 12), c, 0.5, rnd(0.2, 0.5), { grav: 20 });
    this.flash(V(x, 0, z), o.color ?? 0x88aaff, 12);
  }
  handPos(right = true) { const v = V(); (right ? this.player.rArm : this.player.lArm).localToWorld(v.set(0, -0.75, 0)); return v; }
  forward() { return this.player.facing.clone(); }
  alive() { return this.enemies.filter(e => !e.dead); }
  nearest(p: THREE.Vector3, maxR = Infinity, exclude?: Set<any>) {
    let best: Enemy | null = null, bd = maxR * maxR;
    for (const e of this.enemies) { if (e.dead || exclude?.has(e)) continue; const d = e.pos.distanceToSquared(p); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  /** pick distinct random targets; if fewer alive than n, reuse survivors (only when not killed) */
  pickTargets(n: number, center: THREE.Vector3, r: number) {
    const pool = this.enemies.filter(e => !e.dead && e.pos.distanceTo(center) < r);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, n);
  }
  autoAim(maxR = 200) { const e = this.nearest(this.aim, 40) ?? this.nearest(this.player.pos, maxR); return e; }
  damageRadius(c: THREE.Vector3, r: number, dmg: number, o: HitOpts = {}) {
    const hit: Enemy[] = []; const r2 = r * r;
    for (const e of this.enemies) { if (e.dead) continue; const dx = e.pos.x - c.x, dz = e.pos.z - c.z, dy = e.pos.y - c.y; if (dx * dx + dz * dz + Math.min(dy * dy, (dy * 0.3) ** 2) <= r2 + e.radius * e.radius) { hit.push(e); this.damage(e, dmg, { from: c, ...o }); } }
    return hit;
  }
  damage(e: Enemy, amt: number, o: HitOpts = {}) {
    if (e.dead) return 0;
    let d = amt * this.dmgMul();
    if (o.crit) d *= 2;
    if (o.percentMax) d += e.maxHp * o.percentMax;
    if (o.lowHpBonus && e.hp < e.maxHp * 0.5) d *= 11;
    if (o.stun) e.stun = Math.max(e.stun, o.stun);
    if (o.freeze) e.freeze = Math.max(e.freeze, o.freeze);
    if (o.imprison) e.imprison = Math.max(e.imprison, o.imprison);
    if (o.blind) e.blind = Math.max(e.blind, o.blind);
    if (o.flee) e.flee = Math.max(e.flee, o.flee);
    if (o.lift) { e.lift = Math.max(e.lift, o.lift); }
    if (o.burn) { e.burn = Math.max(e.burn, o.burn); e.burnDps = Math.max(o.burnDps ?? d * 0.1, e.burn > 0 ? e.burnDps : 0); }
    if (o.bleed) e.bleeds.push({ t: o.bleed, dps: o.bleedDps ?? d * 0.01 });
    if (o.source !== 'dot' && o.source !== 'rain') {
      if (this.buff('iceBombard')) e.freeze = Math.max(e.freeze, 3);
      if (this.buff('hellFury')) { e.burn = Math.max(e.burn, 3); e.burnDps = Math.max(e.burnDps, d * 0.05); }
    }
    if (o.knock && o.from) {
      const dir = V(e.pos.x - o.from.x, 0, e.pos.z - o.from.z); if (dir.lengthSq() < 1e-4) dir.set(rnd(-1, 1), 0, rnd(-1, 1)); dir.normalize();
      const kb = e.kind === 'boss' ? 0.35 : e.kind === 'brute' ? 0.22 : e.kind === 'elite' ? 0.7 : 1;
      e.vel.x = dir.x * o.knock * 2.2 * kb; e.vel.z = dir.z * o.knock * 2.2 * kb; e.vel.y = (o.knockUp ?? o.knock * 0.9) * kb; e.airborne = true;
    }
    if (o.pull) { const dir = o.pull.clone().sub(e.pos).setY(0); const l = dir.length(); if (l > 0.5) e.pos.addScaledVector(dir.normalize(), Math.min(l, 6)); }
    e.hp -= d; e.lastHit = this.time; this.stats.dmg += d; this.stats.dmgWin.push({ t: this.time, d });
    if (!o.noCharge && this.time - this.chargeT > 0.25) { this.chargeT = this.time; this.lightningCharge = Math.min(100, this.lightningCharge + 10); }
    if (e.hp <= 0) this.kill(e);
    return d;
  }
  kill(e: Enemy) {
    if (e.dead) return; e.dead = true; e.deadT = 0; e.hp = 0; this.stats.kills++;
    this.lightningCharge = Math.min(100, this.lightningCharge + 10);
    for (let i = 0; i < 16; i++) this.fx.spawn(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z, rnd(-6, 6), rnd(2, 10), rnd(-6, 6), 0x66ffe0, 0.5 * e.scale, rnd(0.4, 0.9), { grav: 10 });
  }
  onEnemyLand(e: any) { if (e.onLand) { const f = e.onLand; e.onLand = null; f(e); } }
  enemyAttack(e: Enemy) {
    if (e.blind > 0) return;
    const P = this.player;
    if (e.hacked > 0) { P.hp = Math.min(P.maxHp, P.hp + (e.kind === 'boss' ? 1500 : 400)); this.fx.spawn(P.pos.x, 1.5, P.pos.z, 0, 3, 0, 0x33ff88, 1.2, 0.6, {}); return; }
    if (this.settings.sandbox || P.invincible > 0) { if (this.settings.sandbox) P.hp = P.maxHp; return; }
    const applyHit = (amount: number) => {
      if (this.settings.sandbox || P.invincible > 0) return;
      P.hp -= amount; this.screen('#ff2030', 0.18, 3);
      if (this.buff('alarm')) { this.strike(e.pos.x, e.pos.z, { color: 0xff2a2a, core: 0xffd0d0, width: 0.7, n: 2, h: 40 }); this.damage(e, 0, { percentMax: 0.2, noCharge: true }); }
      if (P.hp <= 0) { P.hp = P.maxHp; P.pos.set(0, 0, 0); this.toast('YOU WERE DEFEATED — RESPAWNED', '#ff5566'); }
    };
    if (e.kind === 'ranged') {
      const start = e.pos.clone().add(V(0, e.height * 0.68, 0));
      const target = P.pos.clone().add(V(0, 1.15, 0));
      const velocity = target.sub(start).normalize().multiplyScalar(34);
      const orb = new THREE.Mesh(GEO.sphereLo, new THREE.MeshBasicMaterial({ color: 0x79eaff, toneMapped: false }));
      orb.scale.setScalar(0.62); this.audio.enemyShot(e.pos.distanceTo(P.pos));
      let resolved = false;
      const impact = (at: THREE.Vector3) => {
        if (resolved) return; resolved = true;
        this.fx.spawn(at.x, at.y, at.z, rnd(-1, 1), rnd(-1, 2), rnd(-1, 1), 0x8df3ff, 1.15, 0.22, {});
        if (Math.hypot(at.x - P.pos.x, at.z - P.pos.z) < 4.2 && at.y < 6) applyHit(340);
      };
      this.add(new Projectile(this, { pos: start, vel: velocity, mesh: orb, life: 2.8, hitR: 1.05, hitEnemies: false, hitGround: false,
        onHit: impact,
        trail: (at, _dt, self) => {
          if (Math.hypot(at.x - P.pos.x, at.z - P.pos.z) < 2.4 && at.y < 6) { impact(at); self.dead = true; }
          if (Math.random() < 0.38) this.fx.spawn(at.x, at.y, at.z, 0, 0, 0, 0x54dfff, 0.42, 0.12, {});
        },
      }));
      return;
    }
    applyHit(e.kind === 'boss' ? 1500 : e.kind === 'brute' ? 950 : e.kind === 'elite' ? 600 : e.kind === 'runner' ? 240 : 180);
  }
  jump() { if (this.player.grounded) { this.player.vel.y = 13; this.player.grounded = false; } }
  slashFx(color: number, size: number, dist = 1.6, tilt = 0) {
    const P = this.player; const m = slashMesh(color, size); const f = this.forward();
    m.position.copy(P.pos).addScaledVector(f, dist).setY(1.2);
    m.lookAt(m.position.clone().add(V(0, 1, 0))); m.rotation.z = Math.atan2(f.x, f.z) - Math.PI / 2 + Math.PI; m.rotateX(tilt);
    const grp = new THREE.Group(); grp.add(m);
    this.add(new Timed(this, grp, 0.22, (k) => { m.scale.setScalar(size * (0.7 + k * 0.5)); (m.material as any).opacity = 0.95 * (1 - k); m.rotateZ(0.12); }));
  }

  // ---------------------------------------------------------------- loop
  loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now(); const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    this.fpsAcc += dt; this.fpsN++; if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    try {
      this.update(dt);
      if ((this.settings.bloom || this.settings.antialiasFxaa) && this.halfFloat) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    } catch (e) {
      // A failure in the render loop would otherwise leave a silently frozen/black scene.
      this.disposed = true; cancelAnimationFrame(this.raf);
      console.error('[MagicCloud] render loop stopped', e);
      this.onFatal(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  };
  update(dt: number) {
    this.time += dt;
    for (const cloud of this.cloudGroups) { cloud.position.x += dt * cloud.userData.drift; cloud.position.z += Math.sin(this.time * 0.08 + cloud.userData.phase) * dt * 0.7; cloud.rotation.y += dt * 0.002; }
    if (this.paused) { const P = this.player, tgt = V(P.pos.x, P.pos.y + 1.6, P.pos.z), cp = Math.cos(this.cam.pitch), sp = Math.sin(this.cam.pitch);
      if (this.firstPerson) { this.camera.position.set(P.pos.x, P.pos.y + 1.62, P.pos.z); this.camera.lookAt(this.camera.position.clone().add(V(-Math.sin(this.cam.yaw) * cp, -sp, -Math.cos(this.cam.yaw) * cp))); }
      else { this.camera.position.set(tgt.x + Math.sin(this.cam.yaw) * cp * this.cam.dist, tgt.y + sp * this.cam.dist, tgt.z + Math.cos(this.cam.yaw) * cp * this.cam.dist); this.camera.lookAt(tgt); }
      this.sun.position.set(P.pos.x + 80, 140, P.pos.z + 60); this.sun.target.position.copy(P.pos); return; }
    if (this.pauseEnemies > 0) this.pauseEnemies -= dt;
    this.pollGamepad(dt);
    const P = this.player;
    if (P.invincible > 0) P.invincible -= dt;
    P.hp = this.settings.sandbox ? P.maxHp : Math.min(P.maxHp, P.hp + P.maxHp * 0.01 * dt);
    // movement
    let mx = 0, mz = 0; const K = this.keys;
    if (K.has('w') || K.has('arrowup')) mz += 1; if (K.has('s') || K.has('arrowdown')) mz -= 1; if (K.has('a') || K.has('arrowleft')) mx -= 1; if (K.has('d') || K.has('arrowright')) mx += 1;
    mx += this.joy.x; mz -= this.joy.y;
    const fwd = V(-Math.sin(this.cam.yaw), 0, -Math.cos(this.cam.yaw)); const right = V(-fwd.z, 0, fwd.x);
    const mv = fwd.multiplyScalar(mz).addScaledVector(right, mx); const ml = mv.length();
    if (P.lockMove > 0) P.lockMove -= dt;
    else if (ml > 0.05) { mv.divideScalar(Math.max(1, ml)); const sp = K.has('shift') || this.touchSprint ? 36 : 20; P.pos.addScaledVector(mv, sp * dt); P.facing.copy(mv).normalize(); }
    P.vel.y -= 32 * dt; P.pos.y += P.vel.y * dt; if (P.pos.y <= 0) { P.pos.y = 0; P.vel.y = 0; P.grounded = true; }
    if (P.vel.x || P.vel.z) { P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt; }
    const playerRadius = Math.hypot(P.pos.x, P.pos.z); if (playerRadius > 1320) { P.pos.x *= 1320 / playerRadius; P.pos.z *= 1320 / playerRadius; }
    P.mesh.position.copy(P.pos); P.mesh.rotation.y = Math.atan2(P.facing.x, P.facing.z);
    // anim
    const A = P.anim; A.t += dt; const ak = A.d ? Math.min(1, A.t / A.d) : 1;
    P.rArm.rotation.set(0, 0, 0); P.lArm.rotation.set(0, 0, 0);
    const moving = ml > 0.05 && P.grounded; const gait = Math.sin(this.time * (K.has('shift') || this.touchSprint ? 15 : 9));
    if (P.legs) { P.legs[0].rotation.x = moving ? gait * 0.42 : 0; P.legs[1].rotation.x = moving ? -gait * 0.42 : 0; }
    if (ak < 1) {
      if (A.type === 'slash') { P.rArm.rotation.x = -2.6 + ak * 3.2; P.rArm.rotation.z = 0.6 - ak; }
      else if (A.type === 'shoot') P.rArm.rotation.x = -1.57;
      else if (A.type === 'punch') { P.rArm.rotation.x = -1.57 * (ak < 0.5 ? ak * 0.5 : 1); }
      else if (A.type === 'raise') { P.rArm.rotation.x = -2.9 * Math.min(1, ak * 3); P.lArm.rotation.x = -2.9 * Math.min(1, ak * 3); }
      else if (A.type === 'charge') { P.rArm.rotation.x = -1.2; P.lArm.rotation.x = -1.2; P.rArm.rotation.z = 0.5; P.lArm.rotation.z = -0.5; }
    } else if (this.item?.m1?.gun) P.rArm.rotation.x = -1.2;
    // m1
    if (this.m1.t > 0) this.m1.t -= dt; if (this.m1.lag > 0) this.m1.lag -= dt;
    this.tickCds(dt);
    // aim
    if (!this.isTouch || this.touchAim || this.drag.active) {
      this.ray.setFromCamera(this.mouse, this.camera); const r = this.ray.ray;
      if (r.direction.y < -0.0005) { const t = -r.origin.y / r.direction.y; this.aim.copy(r.origin).addScaledVector(r.direction, Math.min(t, 5000)); }
      else this.aim.copy(r.origin).addScaledVector(V(r.direction.x, 0, r.direction.z).normalize(), 5000).setY(0);
    }
    if (this.isTouch && !this.touchAim) { const e = this.nearest(P.pos, 150); if (e) this.aim.copy(e.pos).setY(0); else this.aim.copy(P.pos).addScaledVector(P.facing, 30).setY(0); }
    this.aimRing.position.set(this.aim.x, 0.25, this.aim.z); this.aimRing.scale.setScalar(Math.max(1, this.cam.dist * 0.04)); (this.aimRing.material as THREE.MeshBasicMaterial).color.setHex(this.item ? parseInt(this.item.color.slice(1), 16) : 0x33e0ff);
    const lp = this.aimLine.geometry.attributes.position as THREE.BufferAttribute; lp.setXYZ(0, P.pos.x, 0.1, P.pos.z); lp.setXYZ(1, this.aim.x, 0.1, this.aim.z); lp.needsUpdate = true; this.aimLine.computeLineDistances();
    // timers
    if (this.timers.length) { const due = this.timers.filter(t => t.t <= this.time); if (due.length) { this.timers = this.timers.filter(t => t.t > this.time); for (const t of due) t.fn(); } }
    // enemies & effects
    for (const e of this.enemies) e.update(dt);
    for (let i = this.effects.length - 1; i >= 0; i--) { const ef = this.effects[i]; let alive = false; try { alive = ef.update(dt); } catch (err) { console.error(err); } if (!alive) { ef.dispose(); this.effects.splice(i, 1); } }
    let windMix=0, rainMix=0, hailMix=0;
    for (const effect of this.effects) {
      const profile=(effect as Effect & { audioMix?: () => { wind:number; rain:number; hail:number } }).audioMix?.();
      if(profile){windMix=Math.min(1,windMix+profile.wind*.32);rainMix=Math.min(1,rainMix+profile.rain*.3);hailMix=Math.min(1,hailMix+profile.hail*.35);}
    }
    this.audio.setWeatherMix({wind:windMix,rain:rainMix,hail:hailMix});
    this.fx.update(dt, this.time); this.smoke.update(dt, this.time); this.debris.update(dt); this.hail.update(dt);
    this.flashLight.intensity = this.flashI * 400; this.flashI *= Math.pow(0.001, dt);
    const cut = this.time - 3; while (this.stats.dmgWin.length && this.stats.dmgWin[0].t < cut) this.stats.dmgWin.shift();
    if (this.overlay.a > 0) this.overlay.a = Math.max(0, this.overlay.a - dt * this.overlay.fade);
    // camera: orbit + POSITION-ONLY shake (rotation untouched)
    this.cam.dist += (this.cam.targetDist - this.cam.dist) * Math.min(1, dt * 10);
    const tgt = V(P.pos.x, P.pos.y + 1.6, P.pos.z);
    const cp = Math.cos(this.cam.pitch), spp = Math.sin(this.cam.pitch);
    if (this.firstPerson) {
      this.camera.position.set(P.pos.x, P.pos.y + 1.62, P.pos.z);
      const look = V(-Math.sin(this.cam.yaw) * cp, -spp, -Math.cos(this.cam.yaw) * cp);
      this.camera.lookAt(this.camera.position.clone().add(look));
    } else {
      this.camera.position.set(tgt.x + Math.sin(this.cam.yaw) * cp * this.cam.dist, tgt.y + spp * this.cam.dist, tgt.z + Math.cos(this.cam.yaw) * cp * this.cam.dist);
      if (this.camera.position.y < 0.5) this.camera.position.y = 0.5;
      this.camera.lookAt(tgt);
    }
    let amp = 0;
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i]; s.t += dt; if (s.t >= s.d) { this.shakes.splice(i, 1); continue; }
      const fall = s.pos ? 1 / (1 + Math.pow(s.pos.distanceTo(P.pos) / 30, 1.6)) : 1; // closer = stronger
      amp += s.i * fall * (1 - s.t / s.d);
    }
    amp = Math.min(amp, 70) * this.settings.shake;
    if (this.settings.positionShake && amp > 0.001) this.camera.position.add(V((Math.random() * 2 - 1) * amp * 0.06, (Math.random() * 2 - 1) * amp * 0.06, (Math.random() * 2 - 1) * amp * 0.06));
    if (this.settings.rotationShake && amp > 0.001) { const r = Math.min(0.09, amp * 0.0013); this.camera.rotation.x += (Math.random() * 2 - 1) * r; this.camera.rotation.y += (Math.random() * 2 - 1) * r; this.camera.rotation.z += (Math.random() * 2 - 1) * r * 0.65; }
    this.sun.position.set(P.pos.x + 80, 140, P.pos.z + 60); this.sun.target.position.copy(P.pos);
  }
  snapshot() {
    const P = this.player; const dps = this.stats.dmgWin.reduce((a, b) => a + b.d, 0) / 3;
    const ne = this.nearest(P.pos);
    return {
      hp: P.hp, maxHp: P.maxHp, kills: this.stats.kills, dps, total: this.stats.dmg, fps: this.fps,
      aimDist: Math.hypot(this.aim.x - P.pos.x, this.aim.z - P.pos.z), aim3D: this.aim.distanceTo(P.pos), camDist: this.camera.position.distanceTo(V(P.pos.x, P.pos.y + 1.6, P.pos.z)), zoomTarget: this.cam.targetDist,
      nearest: ne ? ne.pos.distanceTo(P.pos) : 0, alive: this.enemies.filter(e => !e.dead).length, equipped: this.equipped,
      buffs: Object.entries(this.buffs).filter(([, v]) => v > this.time).map(([k, v]) => ({ k, rem: v - this.time })),
      charge: this.lightningCharge, bolts: boltStats.active, effects: this.effects.length, invincible: P.invincible > 0, pos: [P.pos.x, P.pos.z],
    };
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize); window.removeEventListener('keydown', this.onKeyDown); window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointermove', this.onPointerMove); window.removeEventListener('pointerup', this.onPointerUp);
    this.audio.dispose(); this.hail.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
