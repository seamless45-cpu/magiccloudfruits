import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

const MOTION_VERTEX = /* glsl */`
uniform mat4 uCurrentViewProjection;
uniform mat4 uPreviousViewProjection;
uniform mat4 uPreviousModelMatrix;
varying vec4 vCurrentClip;
varying vec4 vPreviousClip;
void main() {
  vec4 localPosition = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    localPosition = instanceMatrix * localPosition;
  #endif
  vCurrentClip = uCurrentViewProjection * modelMatrix * localPosition;
  vPreviousClip = uPreviousViewProjection * uPreviousModelMatrix * localPosition;
  gl_Position = projectionMatrix * modelViewMatrix * localPosition;
}`;

const MOTION_FRAGMENT = /* glsl */`
varying vec4 vCurrentClip;
varying vec4 vPreviousClip;
void main() {
  vec2 motion = vec2(0.0);
  if (vCurrentClip.w > 0.0001 && vPreviousClip.w > 0.0001) {
    motion = (vCurrentClip.xy / vCurrentClip.w - vPreviousClip.xy / vPreviousClip.w) * 0.5;
  }
  // Store signed current-minus-previous screen motion around 0.5. The half-float target
  // preserves subpixel velocities; 0.125 UV is a guard against camera cuts/teleports.
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

  // Reproject only along the current pixel's measured screen-space velocity, sampling
  // the preceding shutter interval. Depth disagreement suppresses trails across occluders.
  for (int tap = 1; tap <= 8; tap++) {
    float alongTrail = float(tap) / 8.0;
    vec2 sampleUv = vUv - motion * alongTrail;
    if (sampleUv.x <= 0.0 || sampleUv.x >= 1.0 || sampleUv.y <= 0.0 || sampleUv.y >= 1.0) continue;
    float sampleDepth = linearDepth(texture2D(tDepth, sampleUv).x);
    float depthTolerance = max(0.75, centerDepth * 0.025);
    float depthAgreement = 1.0 - smoothstep(depthTolerance, depthTolerance * 4.0, abs(sampleDepth - centerDepth));
    float weight = (1.0 - alongTrail * 0.22) * depthAgreement;
    accumulated += texture2D(tDiffuse, sampleUv).rgb * weight;
    totalWeight += weight;
  }

  gl_FragColor = vec4(accumulated / totalWeight, sharp.a);
}`,
};

/**
 * Renders per-pixel camera/object motion and a matching depth buffer. Previous object and
 * view-projection matrices are retained only between adjacent rendered frames; there is no
 * color-frame history or temporal ghosting.
 */
export class MotionVectorPass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  readonly velocityMaterial: THREE.ShaderMaterial;
  private previousViewProjection = new THREE.Matrix4();
  private currentViewProjection = new THREE.Matrix4();
  private previousModels = new WeakMap<THREE.Object3D, THREE.Matrix4>();
  private hasHistory = false;

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
      },
      vertexShader: MOTION_VERTEX,
      fragmentShader: MOTION_FRAGMENT,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    });
    this.velocityMaterial.onBeforeRender = (_renderer, _scene, _camera, _geometry, object) => {
      const previous = this.previousModels.get(object);
      (this.velocityMaterial.uniforms.uPreviousModelMatrix.value as THREE.Matrix4).copy(previous ?? object.matrixWorld);
    };
  }

  resetHistory() {
    this.previousModels = new WeakMap<THREE.Object3D, THREE.Matrix4>();
    this.hasHistory = false;
  }

  setSize(width: number, height: number) {
    this.target.setSize(Math.max(1, width), Math.max(1, height));
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
    let rendered = false;

    try {
      scene.updateMatrixWorld(true);
      this.camera.updateMatrixWorld(true);
      this.currentViewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
      if (!this.hasHistory) this.previousViewProjection.copy(this.currentViewProjection);
      this.velocityMaterial.uniforms.uCurrentViewProjection.value = this.currentViewProjection;
      this.velocityMaterial.uniforms.uPreviousViewProjection.value = this.previousViewProjection;

      // Points/lines (GPU particles, aim guides and lightning) don't have a stored previous
      // vertex buffer. Exclude them from this mesh-vector pass instead of inventing motion.
      scene.traverse(object => {
        const renderable = object as THREE.Object3D & { isPoints?: boolean; isLine?: boolean };
        if (renderable.isPoints || renderable.isLine) {
          hidden.push([object, object.visible]);
          object.visible = false;
        }
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

      scene.traverse(object => {
        const renderable = object as THREE.Object3D & { isMesh?: boolean };
        if (!renderable.isMesh) return;
        let previous = this.previousModels.get(object);
        if (!previous) {
          previous = new THREE.Matrix4();
          this.previousModels.set(object, previous);
        }
        previous.copy(object.matrixWorld);
      });
      this.previousViewProjection.copy(this.currentViewProjection);
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

  dispose() {
    this.target.dispose();
    this.velocityMaterial.dispose();
  }
}
