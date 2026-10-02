import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

const MOTION_VERTEX = /* glsl */`
uniform mat4 uCurrentViewProjection;
uniform mat4 uPreviousViewProjection;
uniform mat4 uPreviousModelMatrix;
uniform float uUsePreviousPosition;
uniform float uUsePointShape;
uniform float uPointScale;
uniform float uMaxPointSize;
uniform float uUseLightningRibbon;
uniform float uLightningWidth;
uniform float uLightningFlat;
uniform vec3 uPreviousCameraPosition;
#ifndef USE_INSTANCING
attribute vec3 aPreviousPosition;
attribute vec3 aDir;
attribute vec3 aPreviousDir;
attribute float aSide;
attribute float aTaper;
attribute float aSize;
attribute float aAlpha;
attribute float aPreviousAlpha;
#endif
#ifdef USE_INSTANCING
attribute mat4 aPreviousInstanceMatrix;
#endif
varying vec4 vCurrentClip;
varying vec4 vPreviousClip;
varying float vParticleAlpha;
varying float vPreviousParticleAlpha;
void main() {
  vec4 currentVertex = vec4(position, 1.0);
  vec4 priorVertex = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    currentVertex = instanceMatrix * currentVertex;
    priorVertex = aPreviousInstanceMatrix * priorVertex;
  #else
    priorVertex.xyz = mix(position, aPreviousPosition, uUsePreviousPosition);
  #endif
  vec4 currentWorld = modelMatrix * currentVertex;
  vec4 previousWorld = uPreviousModelMatrix * priorVertex;
  #ifndef USE_INSTANCING
  if (uUseLightningRibbon > 0.5) {
    vec3 toCurrentCamera = normalize(cameraPosition - currentWorld.xyz);
    vec3 currentNormal = mix(toCurrentCamera, vec3(0.0, 1.0, 0.0), uLightningFlat);
    vec3 currentSide = cross(aDir, currentNormal);
    float currentSideLength = length(currentSide);
    currentSide = currentSideLength > 0.0001 ? currentSide / currentSideLength : vec3(1.0, 0.0, 0.0);
    currentWorld.xyz += currentSide * aSide * uLightningWidth * aTaper;

    vec3 toPreviousCamera = normalize(uPreviousCameraPosition - previousWorld.xyz);
    vec3 previousNormal = mix(toPreviousCamera, vec3(0.0, 1.0, 0.0), uLightningFlat);
    vec3 previousSide = cross(aPreviousDir, previousNormal);
    float previousSideLength = length(previousSide);
    previousSide = previousSideLength > 0.0001 ? previousSide / previousSideLength : vec3(1.0, 0.0, 0.0);
    previousWorld.xyz += previousSide * aSide * uLightningWidth * aTaper;
  }
  #endif
  vCurrentClip = uCurrentViewProjection * currentWorld;
  vPreviousClip = uPreviousViewProjection * previousWorld;
  vec4 viewPosition = viewMatrix * currentWorld;
  gl_Position = projectionMatrix * viewPosition;
  #ifndef USE_INSTANCING
    // Match the game's GPU particle sizing; particle velocity is measured at its center.
    gl_PointSize = clamp(aSize * uPointScale / max(0.5, -viewPosition.z), 0.0, uMaxPointSize);
    vParticleAlpha = aAlpha;
    vPreviousParticleAlpha = aPreviousAlpha;
  #else
    gl_PointSize = 1.0;
    vParticleAlpha = 0.0;
    vPreviousParticleAlpha = 0.0;
  #endif
}`;

const MOTION_FRAGMENT = /* glsl */`
uniform float uUsePointShape;
varying vec4 vCurrentClip;
varying vec4 vPreviousClip;
varying float vParticleAlpha;
varying float vPreviousParticleAlpha;
void main() {
  if (uUsePointShape > 0.5) {
    if (vParticleAlpha <= 0.001) discard;
    if (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;
  }
  vec2 motion = vec2(0.0);
  // A newly spawned/recycled particle has no previous trajectory. Keep its depth and
  // silhouette, but start its velocity at zero instead of streaking from the old slot.
  bool hasPreviousParticle = uUsePointShape < 0.5 || vPreviousParticleAlpha > 0.001;
  if (hasPreviousParticle && vCurrentClip.w > 0.0001 && vPreviousClip.w > 0.0001) {
    motion = (vCurrentClip.xy / vCurrentClip.w - vPreviousClip.xy / vPreviousClip.w) * 0.5;
  }
  // Store signed current-minus-previous screen motion around 0.5. Half-float preserves
  // subpixel velocities; long teleports/camera cuts are clamped and reset by the pass.
  gl_FragColor = vec4(clamp(motion, vec2(-0.125), vec2(0.125)) * 4.0 + 0.5, 0.0, 1.0);
}`;

export const MotionBlurShader = {
  name: 'DepthReprojectedMotionTrail',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tMotion: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.DepthTexture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.5 },
    uFar: { value: 40000 },
    uTrailStrength: { value: 0.72 },
  },
  vertexShader: /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tMotion;
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uTrailStrength;
varying vec2 vUv;
float linearDepth(float depth) {
  float ndc = depth * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
}
void main() {
  vec4 sharp = texture2D(tDiffuse, vUv);
  vec2 motion = (texture2D(tMotion, vUv).rg - vec2(0.5)) * 0.25;
  float pixelSpeed = length(motion * uResolution);
  if (pixelSpeed < 0.65) {
    gl_FragColor = sharp;
    return;
  }

  const float MAX_TRAIL_PIXELS = 40.0;
  if (pixelSpeed > MAX_TRAIL_PIXELS) motion *= MAX_TRAIL_PIXELS / pixelSpeed;
  motion *= uTrailStrength;
  float centerDepth = linearDepth(texture2D(tDepth, vUv).x);
  vec3 accumulated = sharp.rgb;
  float totalWeight = 1.0;

  // A one-frame shutter samples only the preceding surface trajectory. Linear-depth
  // rejection keeps the trail on its moving surface instead of smearing across silhouettes.
  for (int tap = 1; tap <= 10; tap++) {
    float alongTrail = float(tap) / 10.0;
    vec2 sampleUv = vUv - motion * alongTrail;
    if (sampleUv.x <= 0.0 || sampleUv.x >= 1.0 || sampleUv.y <= 0.0 || sampleUv.y >= 1.0) continue;
    float sampleDepth = linearDepth(texture2D(tDepth, sampleUv).x);
    float depthTolerance = max(0.75, centerDepth * 0.003);
    float depthAgreement = 1.0 - smoothstep(depthTolerance, depthTolerance * 3.0, abs(sampleDepth - centerDepth));
    float weight = (1.0 - alongTrail * 0.18) * depthAgreement;
    accumulated += texture2D(tDiffuse, sampleUv).rgb * weight;
    totalWeight += weight;
  }

  gl_FragColor = vec4(accumulated / totalWeight, sharp.a);
}`,
};

type PositionHistory = {
  position: THREE.BufferAttribute;
  previous: Float32Array;
  previousAttribute: THREE.BufferAttribute;
  alpha: THREE.BufferAttribute | null;
  previousAlpha: Float32Array | null;
  previousAlphaAttribute: THREE.BufferAttribute | null;
  direction: THREE.BufferAttribute | null;
  previousDirection: Float32Array | null;
  previousDirectionAttribute: THREE.BufferAttribute | null;
};

type InstanceHistory = {
  sourceGeometry: THREE.BufferGeometry;
  geometry: THREE.BufferGeometry;
  previous: Float32Array;
  attribute: THREE.InstancedBufferAttribute;
};

/**
 * Per-pixel camera, object, vertex, instance, and point-particle vectors. Each render stores
 * only the immediately previous transforms/positions; the blur is a depth-tested spatial
 * shutter over the current frame, not accumulated color or after-image ghosting.
 */
export class MotionVectorPass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  readonly velocityMaterial: THREE.ShaderMaterial;
  private previousViewProjection = new THREE.Matrix4();
  private currentViewProjection = new THREE.Matrix4();
  private previousCameraPosition = new THREE.Vector3();
  private currentCameraPosition = new THREE.Vector3();
  private previousModels = new WeakMap<THREE.Object3D, THREE.Matrix4>();
  private positionHistory = new Map<THREE.BufferGeometry, PositionHistory>();
  private instanceHistory = new Map<THREE.InstancedMesh, InstanceHistory>();
  private hasHistory = false;
  private pointScale = 500;
  private maxPointSize = 512;

  constructor(private readonly scene: THREE.Scene, private readonly camera: THREE.Camera) {
    super();
    this.needsSwap = false;
    this.clear = false;

    const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    depth.format = THREE.DepthFormat;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      colorSpace: THREE.NoColorSpace,
    });
    this.target.texture.generateMipmaps = false;
    this.target.depthTexture = depth;

    this.velocityMaterial = new THREE.ShaderMaterial({
      name: 'PerPixelMotionVectors',
      uniforms: {
        uCurrentViewProjection: { value: this.currentViewProjection },
        uPreviousViewProjection: { value: this.previousViewProjection },
        uPreviousModelMatrix: { value: new THREE.Matrix4() },
        uUsePreviousPosition: { value: 0 },
        uUsePointShape: { value: 0 },
        uPointScale: { value: this.pointScale },
        uMaxPointSize: { value: this.maxPointSize },
        uUseLightningRibbon: { value: 0 },
        uLightningWidth: { value: 0 },
        uLightningFlat: { value: 0 },
        uPreviousCameraPosition: { value: this.previousCameraPosition },
      },
      vertexShader: MOTION_VERTEX,
      fragmentShader: MOTION_FRAGMENT,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    });
    this.velocityMaterial.onBeforeRender = (_renderer, _scene, _camera, geometry, object) => {
      const renderable = object as THREE.Object3D & { isPoints?: boolean; geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
      const prior = this.previousModels.get(object);
      (this.velocityMaterial.uniforms.uPreviousModelMatrix.value as THREE.Matrix4).copy(prior ?? object.matrixWorld);
      const positions = renderable.geometry ? this.positionHistory.get(renderable.geometry) : undefined;
      this.velocityMaterial.uniforms.uUsePreviousPosition.value = positions ? 1 : 0;
      this.velocityMaterial.uniforms.uUsePointShape.value = renderable.isPoints ? 1 : 0;
      this.velocityMaterial.depthWrite = !renderable.isPoints;

      const sourceMaterial = Array.isArray(renderable.material) ? renderable.material[0] : renderable.material;
      const sourceUniforms = (sourceMaterial as THREE.ShaderMaterial | undefined)?.uniforms;
      const isRibbon = !!(geometry.getAttribute('aDir') && geometry.getAttribute('aSide') && geometry.getAttribute('aTaper'));
      this.velocityMaterial.uniforms.uUseLightningRibbon.value = isRibbon ? 1 : 0;
      this.velocityMaterial.uniforms.uLightningWidth.value = Number(sourceUniforms?.uWidth?.value ?? 0);
      this.velocityMaterial.uniforms.uLightningFlat.value = Number(sourceUniforms?.uFlat?.value ?? 0);
    };
  }

  resetHistory() {
    this.previousModels = new WeakMap<THREE.Object3D, THREE.Matrix4>();
    for (const [geometry, history] of this.positionHistory) {
      const values = history.position.array as Float32Array;
      if (values.length === history.previous.length) history.previous.set(values);
      history.previousAttribute.needsUpdate = true;
      if (history.alpha && history.previousAlpha && history.previousAlphaAttribute) {
        const alpha = history.alpha.array as Float32Array;
        if (alpha.length === history.previousAlpha.length) history.previousAlpha.set(alpha);
        history.previousAlphaAttribute.needsUpdate = true;
      }
      if (history.direction && history.previousDirection && history.previousDirectionAttribute) {
        const direction = history.direction.array as Float32Array;
        if (direction.length === history.previousDirection.length) history.previousDirection.set(direction);
        history.previousDirectionAttribute.needsUpdate = true;
      }
      void geometry;
    }
    for (const [mesh, history] of this.instanceHistory) {
      if (mesh.instanceMatrix.array.length === history.previous.length) history.previous.set(mesh.instanceMatrix.array as Float32Array);
      history.attribute.needsUpdate = true;
    }
    this.hasHistory = false;
  }

  setPointSizing(scale: number, maxSize: number) {
    this.pointScale = Math.max(0, scale);
    this.maxPointSize = Math.max(1, maxSize);
    this.velocityMaterial.uniforms.uPointScale.value = this.pointScale;
    this.velocityMaterial.uniforms.uMaxPointSize.value = this.maxPointSize;
  }

  setSize(width: number, height: number) {
    this.target.setSize(Math.max(1, width), Math.max(1, height));
  }

  private preparePositionHistory(geometry: THREE.BufferGeometry): PositionHistory | null {
    const position = geometry.getAttribute('position');
    if (!(position instanceof THREE.BufferAttribute)) return null;
    if (position.usage !== THREE.DynamicDrawUsage && position.usage !== THREE.StreamDrawUsage) return null;
    const existing = this.positionHistory.get(geometry);
    if (existing && existing.position === position && existing.previous.length === position.array.length) return existing;
    if (existing) {
      if (geometry.getAttribute('aPreviousPosition') === existing.previousAttribute) geometry.deleteAttribute('aPreviousPosition');
      if (existing.previousAlphaAttribute && geometry.getAttribute('aPreviousAlpha') === existing.previousAlphaAttribute) geometry.deleteAttribute('aPreviousAlpha');
      if (existing.previousDirectionAttribute && geometry.getAttribute('aPreviousDir') === existing.previousDirectionAttribute) geometry.deleteAttribute('aPreviousDir');
    }

    const source = position.array as Float32Array;
    const previous = new Float32Array(source.length);
    previous.set(source);
    const previousAttribute = new THREE.BufferAttribute(previous, position.itemSize).setUsage(THREE.DynamicDrawUsage);
    previousAttribute.needsUpdate = true;
    geometry.setAttribute('aPreviousPosition', previousAttribute);

    const alpha = geometry.getAttribute('aAlpha');
    let previousAlpha: Float32Array | null = null;
    let previousAlphaAttribute: THREE.BufferAttribute | null = null;
    if (alpha instanceof THREE.BufferAttribute && alpha.array.length > 0) {
      const alphaSource = alpha.array as Float32Array;
      previousAlpha = new Float32Array(alphaSource.length);
      previousAlpha.set(alphaSource);
      previousAlphaAttribute = new THREE.BufferAttribute(previousAlpha, alpha.itemSize).setUsage(THREE.DynamicDrawUsage);
      previousAlphaAttribute.needsUpdate = true;
      geometry.setAttribute('aPreviousAlpha', previousAlphaAttribute);
    }

    const directionAttribute = geometry.getAttribute('aDir');
    let direction: THREE.BufferAttribute | null = null;
    let previousDirection: Float32Array | null = null;
    let previousDirectionAttribute: THREE.BufferAttribute | null = null;
    if (directionAttribute instanceof THREE.BufferAttribute && directionAttribute.array.length > 0) {
      direction = directionAttribute;
      const directionSource = direction.array as Float32Array;
      previousDirection = new Float32Array(directionSource.length);
      previousDirection.set(directionSource);
      previousDirectionAttribute = new THREE.BufferAttribute(previousDirection, direction.itemSize).setUsage(THREE.DynamicDrawUsage);
      previousDirectionAttribute.needsUpdate = true;
      geometry.setAttribute('aPreviousDir', previousDirectionAttribute);
    }

    const history = { position, previous, previousAttribute, alpha: alpha instanceof THREE.BufferAttribute ? alpha : null, previousAlpha, previousAlphaAttribute, direction, previousDirection, previousDirectionAttribute };
    this.positionHistory.set(geometry, history);
    return history;
  }

  private prepareInstanceHistory(mesh: THREE.InstancedMesh): InstanceHistory {
    const currentGeometry = mesh.geometry;
    const existing = this.instanceHistory.get(mesh);
    if (existing && mesh.geometry === existing.geometry && existing.previous.length === mesh.instanceMatrix.array.length) return existing;
    if (existing) {
      if (mesh.geometry === existing.geometry) mesh.geometry = existing.sourceGeometry;
      existing.geometry.dispose();
      this.instanceHistory.delete(mesh);
    }

    const sourceGeometry = currentGeometry;
    const geometry = sourceGeometry.clone();
    const current = mesh.instanceMatrix.array as Float32Array;
    const previous = new Float32Array(current.length);
    previous.set(current);
    const attribute = new THREE.InstancedBufferAttribute(previous, 16).setUsage(THREE.DynamicDrawUsage);
    attribute.needsUpdate = true;
    geometry.setAttribute('aPreviousInstanceMatrix', attribute);
    mesh.geometry = geometry;
    const history = { sourceGeometry, geometry, previous, attribute };
    this.instanceHistory.set(mesh, history);
    return history;
  }

  render(renderer: THREE.WebGLRenderer) {
    const scene = this.scene;
    const previousTarget = renderer.getRenderTarget();
    const previousClearColor = renderer.getClearColor(new THREE.Color()).clone();
    const previousClearAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const previousShadowNeedsUpdate = renderer.shadowMap.needsUpdate;
    const previousBackground = scene.background;
    const previousOverride = scene.overrideMaterial;
    const hidden: Array<[THREE.Object3D, boolean]> = [];
    const seenModels = new Set<THREE.Object3D>();
    const seenPositions = new Set<THREE.BufferGeometry>();
    const seenInstances = new Set<THREE.InstancedMesh>();
    let rendered = false;

    try {
      scene.updateMatrixWorld(true);
      this.camera.updateMatrixWorld(true);
      this.currentViewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
      this.currentCameraPosition.setFromMatrixPosition(this.camera.matrixWorld);
      if (!this.hasHistory) {
        this.previousViewProjection.copy(this.currentViewProjection);
        this.previousCameraPosition.copy(this.currentCameraPosition);
      }
      this.velocityMaterial.uniforms.uCurrentViewProjection.value = this.currentViewProjection;
      this.velocityMaterial.uniforms.uPreviousViewProjection.value = this.previousViewProjection;
      (this.velocityMaterial.uniforms.uPreviousCameraPosition.value as THREE.Vector3).copy(this.previousCameraPosition);

      // Prepare vertex and instance histories before overriding materials. GPU particles and
      // dynamic lightning ribbons now contribute their actual previous positions rather than
      // being omitted from the scene-wide vector field.
      scene.traverse(object => {
        const renderable = object as THREE.Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isInstancedMesh?: boolean; geometry?: THREE.BufferGeometry };
        if (renderable.isLine) {
          hidden.push([object, object.visible]);
          object.visible = false;
          return;
        }
        if (renderable.isInstancedMesh) {
          const mesh = object as THREE.InstancedMesh;
          seenInstances.add(mesh);
          this.prepareInstanceHistory(mesh);
        } else if (renderable.geometry && (renderable.isMesh || renderable.isPoints)) {
          const geometry = renderable.geometry;
          if (this.preparePositionHistory(geometry)) seenPositions.add(geometry);
        }
        if (renderable.isMesh || renderable.isPoints) seenModels.add(object);
      });

      scene.background = null;
      scene.overrideMaterial = this.velocityMaterial;
      renderer.setClearColor(new THREE.Color(0.5, 0.5, 0), 1);
      renderer.autoClear = false;
      // The beauty pass has already refreshed shadows for this frame; don't draw a second
      // shadow map solely to generate the optional screen-space velocity buffer.
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.setRenderTarget(this.target);
      renderer.clear(true, true, true);
      renderer.render(scene, this.camera);
      rendered = true;

      for (const object of seenModels) {
        let previous = this.previousModels.get(object);
        if (!previous) { previous = new THREE.Matrix4(); this.previousModels.set(object, previous); }
        previous.copy(object.matrixWorld);
      }
      for (const geometry of seenPositions) {
        const history = this.positionHistory.get(geometry);
        if (!history) continue;
        const current = history.position.array as Float32Array;
        if (current.length === history.previous.length) history.previous.set(current);
        history.previousAttribute.needsUpdate = true;
        if (history.alpha && history.previousAlpha && history.previousAlphaAttribute) {
          const alpha = history.alpha.array as Float32Array;
          if (alpha.length === history.previousAlpha.length) history.previousAlpha.set(alpha);
          history.previousAlphaAttribute.needsUpdate = true;
        }
        if (history.direction && history.previousDirection && history.previousDirectionAttribute) {
          const direction = history.direction.array as Float32Array;
          if (direction.length === history.previousDirection.length) history.previousDirection.set(direction);
          history.previousDirectionAttribute.needsUpdate = true;
        }
      }
      for (const mesh of seenInstances) {
        const history = this.instanceHistory.get(mesh);
        if (!history) continue;
        const current = mesh.instanceMatrix.array as Float32Array;
        if (current.length === history.previous.length) history.previous.set(current);
        history.attribute.needsUpdate = true;
      }
      this.pruneHistory(seenPositions, seenInstances);
      this.previousViewProjection.copy(this.currentViewProjection);
      this.previousCameraPosition.copy(this.currentCameraPosition);
      this.hasHistory = true;
    } finally {
      for (const [object, visible] of hidden) object.visible = visible;
      scene.overrideMaterial = previousOverride;
      scene.background = previousBackground;
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      renderer.autoClear = previousAutoClear;
      renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
      renderer.shadowMap.needsUpdate = previousShadowNeedsUpdate;
      if (!rendered) this.resetHistory();
    }
  }

  private pruneHistory(seenPositions: Set<THREE.BufferGeometry>, seenInstances: Set<THREE.InstancedMesh>) {
    for (const [geometry, history] of this.positionHistory) {
      if (seenPositions.has(geometry)) continue;
      if (geometry.getAttribute('aPreviousPosition') === history.previousAttribute) geometry.deleteAttribute('aPreviousPosition');
      if (history.previousAlphaAttribute && geometry.getAttribute('aPreviousAlpha') === history.previousAlphaAttribute) geometry.deleteAttribute('aPreviousAlpha');
      if (history.previousDirectionAttribute && geometry.getAttribute('aPreviousDir') === history.previousDirectionAttribute) geometry.deleteAttribute('aPreviousDir');
      this.positionHistory.delete(geometry);
    }
    for (const [mesh, history] of this.instanceHistory) {
      if (seenInstances.has(mesh)) continue;
      if (mesh.geometry === history.geometry) mesh.geometry = history.sourceGeometry;
      history.geometry.dispose();
      this.instanceHistory.delete(mesh);
    }
  }

  dispose() {
    for (const [geometry, history] of this.positionHistory) {
      if (geometry.getAttribute('aPreviousPosition') === history.previousAttribute) geometry.deleteAttribute('aPreviousPosition');
      if (history.previousAlphaAttribute && geometry.getAttribute('aPreviousAlpha') === history.previousAlphaAttribute) geometry.deleteAttribute('aPreviousAlpha');
      if (history.previousDirectionAttribute && geometry.getAttribute('aPreviousDir') === history.previousDirectionAttribute) geometry.deleteAttribute('aPreviousDir');
    }
    for (const [mesh, history] of this.instanceHistory) {
      if (mesh.geometry === history.geometry) mesh.geometry = history.sourceGeometry;
      history.geometry.dispose();
    }
    this.positionHistory.clear();
    this.instanceHistory.clear();
    this.target.dispose();
    this.velocityMaterial.dispose();
  }
}
