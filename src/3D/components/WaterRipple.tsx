/**
 * WaterRipple — faithful React port of CodePen shubniggurath/OEeMOd
 *
 * Architecture:
 *  - Standalone Three.js renderer (NOT R3F) — avoids coordinate-system mismatch
 *  - Single ShaderMaterial with u_renderpass bool to switch sim ↔ display
 *  - Ping-pong render targets for the finite-difference wave PDE
 *  - CDN textures (noise, environment, pool tile) match the original exactly
 *  - Mouse: same screen-space coordinate transform as the original
 *  - WaterDrop animation is managed internally (no external event needed)
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";

// ─── Drop animation constants ─────────────────────────────────────────────────
const DROP_DURATION = 0.9; // seconds — matches Carousel intro timing
const DROP_START_Y = 2.5;
const easeInQuad = (t: number) => t * t;

// ─── Drop vertex shader ───────────────────────────────────────────────────────
const DROP_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;

  void main() {
    vUv      = uv;
    vNormal  = normalize(normalMatrix * normal);
    vec4 mv  = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

// ─── Drop fragment shader ─────────────────────────────────────────────────────
const DROP_FRAG = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewDir);

    float NdotV   = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = pow(1.0 - NdotV, 2.8);

    vec3  L1    = normalize(vec3(-0.3, 0.6, 1.0));
    float spec1 = pow(max(dot(reflect(-L1, N), V), 0.0), 140.0);

    vec3  L2    = normalize(vec3(0.55, 0.25, 0.8));
    float spec2 = pow(max(dot(reflect(-L2, N), V), 0.0), 18.0) * 0.28;

    vec3 centerCol = vec3(0.52, 0.72, 0.90);
    vec3 rimCol    = vec3(0.10, 0.22, 0.45);
    vec3 col       = mix(centerCol, rimCol, fresnel);

    float dx      = (vUv.x - 0.50);
    float dy      = (vUv.y - 0.22);
    float innerHL = smoothstep(0.20, 0.0, sqrt(dx * dx + dy * dy * 2.2));

    float dx2      = (vUv.x - 0.50);
    float dy2      = (vUv.y - 0.32);
    float innerHL2 = smoothstep(0.07, 0.0, sqrt(dx2 * dx2 + dy2 * dy2));

    col  = mix(col, vec3(1.0),               spec1);
    col += vec3(0.72, 0.88, 1.0)           * spec2;
    col  = mix(col, vec3(0.88, 0.94, 1.0),  innerHL  * 0.60);
    col  = mix(col, vec3(1.0),               innerHL2 * 0.80);

    float alpha = mix(0.06, 0.78, fresnel)
                + spec1   * 0.92
                + spec2   * 0.45
                + innerHL  * 0.40
                + innerHL2 * 0.50;
    alpha = clamp(alpha, 0.0, 0.94);

    gl_FragColor = vec4(col, alpha);
  }
`;

// ─── Teardrop geometry ────────────────────────────────────────────────────────
function createTeardropGeometry(): THREE.BufferGeometry {
  const raw: [number, number][] = [
    [0.0, 1.0],
    [0.06, 0.88],
    [0.15, 0.7],
    [0.27, 0.45],
    [0.38, 0.16],
    [0.44, -0.09],
    [0.445, -0.3],
    [0.41, -0.49],
    [0.34, -0.64],
    [0.22, -0.76],
    [0.08, -0.83],
    [0.0, -0.86],
  ];

  const pts2D = raw.map(([r, y]) => new THREE.Vector2(r, y));
  const curve = new THREE.SplineCurve(pts2D);
  const smooth = curve
    .getPoints(48)
    .map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  return new THREE.LatheGeometry(smooth, 40);
}

// ─── Water vertex shader — full-screen quad, no camera transform ──────────────
const VERT = /* glsl */ `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// ─── Water fragment shader ────────────────────────────────────────────────────
const FRAG = /* glsl */ `
  precision highp float;

  uniform vec2      u_resolution;
  uniform vec3      u_mouse;
  uniform float     u_time;
  uniform float     u_reveal;
  uniform sampler2D u_noise;
  uniform sampler2D u_buffer;
  uniform sampler2D u_environment;
  uniform bool      u_renderpass;
  uniform int       u_frame;

  #define PI  3.141592653589793
  #define pow2(x) (x * x)

  const float bias  = .2;
  const float scale = 10.;
  const float power = 10.1;

  const float blurStrength = 2.98;
  const int   samples      = 8;
  const float sigma        = float(samples) * 0.25;

  const float FOCAL       = 3.796;
  const float TILT        = 0.25;
  const float CAM_HEIGHT  = 1.0;
  const float FLOOR_SCALE = 3.0;

  vec2 hash2(vec2 p) {
    return texture2D(u_noise, fract((p + 0.5) / 256.0)).xy;
  }

  float gaussian(vec2 i) {
    return 1.0 / (2.0 * PI * pow2(sigma))
           * exp(-((pow2(i.x) + pow2(i.y)) / (2.0 * pow2(sigma))));
  }

  vec3 blur(sampler2D sp, vec2 uv, vec2 sc) {
    vec3  col   = vec3(0.0);
    float accum = 0.0;
    float weight;
    vec2  offset;
    for (int x = -samples / 2; x < samples / 2; ++x) {
      for (int y = -samples / 2; y < samples / 2; ++y) {
        offset  = vec2(x, y);
        weight  = gaussian(offset);
        col    += texture2D(sp, uv + sc * offset).rgb * weight;
        accum  += weight;
      }
    }
    return col / accum;
  }

  vec3 envMap(vec3 rd, vec3 sn, float s) {
    vec3 col = texture2D(u_environment, rd.xy - .5).rgb * 2.;
    col *= normalize(col);
    return col;
  }

  float bumpMap(vec2 baseUV, vec2 offset, float height, inout vec3 colourmap) {
    vec2 ps    = vec2(1.0) / u_resolution.xy;
    vec3 shade = vec3(blur(u_buffer, baseUV + offset, ps * blurStrength));
    colourmap  = shade;
    return 1. - shade.x * height;
  }
  float bumpMap(vec2 baseUV, vec2 offset, float height) {
    vec3 c;
    return bumpMap(baseUV, offset, height, c);
  }

  vec4 renderRipples() {
    vec2 uv    = (gl_FragCoord.xy - 0.5 * u_resolution.xy)
                 / min(u_resolution.y, u_resolution.x);
    vec3 e     = vec3(vec2(3.6) / u_resolution.xy, 0.);
    vec2 s     = gl_FragCoord.xy / u_resolution.xy;
    vec2 mouse = u_mouse.xy - uv;

    vec4  fragcolour = texture2D(u_buffer, s);
    float shade      = 0.;

    if (u_mouse.z == 1.) {
      shade = smoothstep(.02 + abs(sin(u_time * 10.) * .006), .0, length(mouse));
    }
    if (mod(u_time, .1) >= .095) {
      vec2 hash  = hash2(vec2(u_time * 2., sin(u_time * 10.))) * 3. - 1.;
      shade     += smoothstep(.012, .0, length(uv - hash + .5));
    }

    vec4  texcol = fragcolour;
    float d      = shade * 2.;

    float t = texture2D(u_buffer, s - e.zy).x;
    float r = texture2D(u_buffer, s - e.xz).x;
    float b = texture2D(u_buffer, s + e.xz).x;
    float l = texture2D(u_buffer, s + e.zy).x;

    d += -(texcol.y - .5) * 2. + (t + r + b + l - 2.);
    d *= .99;
    d *= (u_frame > 5) ? 1.0 : 0.0;
    d  = d * .5 + .5;

    return vec4(d, texcol.x, 0., 0.);
  }

  void main() {
    if (u_renderpass) {
      gl_FragColor = renderRipples();
      return;
    }

    float aspect = u_resolution.x / u_resolution.y;
    vec2  ndc    = (gl_FragCoord.xy / u_resolution.xy - 0.5)
                   * vec2(aspect, 1.0);

    float ca = cos(TILT), sa = sin(TILT);
    vec3  ray = vec3(ndc.x,
                     ndc.y * ca - FOCAL * sa,
                     ndc.y * sa + FOCAL * ca);

    float tFloor  = CAM_HEIGHT / max(-ray.y, 1e-6);
    vec2  floorXZ = vec2(ray.x, ray.z) * tFloor;

    vec2 s  = fract(floorXZ / FLOOR_SCALE + 0.5);
    vec2 uv = floorXZ / FLOOR_SCALE;

    vec2 sD = vec2(.005, 0.);
    vec3 colourmap;
    float fx = bumpMap(s, sD.xy, .2);
    float fy = bumpMap(s, sD.yx, .2);
    float f  = bumpMap(s, vec2(0.), .2, colourmap);

    float distortion = f;
    fx = (fx - f) / sD.x;
    fy = (fy - f) / sD.x;
    vec3 normal = normalize(vec3(0., 0., -1.) + vec3(fx, fy, 0.) * 0.2);

    vec3 surfacePos = vec3(uv, 0.0);
    vec3 viewRay    = normalize(vec3(uv, 1.));
    vec3 lightPos   = vec3(cos(u_time * .5 + 2.) * 2.,
                           1. + sin(u_time * .5 + 2.) * 2., -3.);

    float shade = bias + (scale * pow(
                    1.0 + dot(normalize(surfacePos - vec3(uv, -3.0)), normal),
                    power));

    vec3  lightV    = lightPos - surfacePos;
    float lightDist = max(length(lightV), 0.001);
    lightV /= lightDist;

    vec3  lightColour = vec3(.8, .8, 1.);
    float attenuation = 1. / (1.0 + lightDist * lightDist * 0.1);
    float diffuse     = max(dot(normal, lightV), 0.);
    float specular    = pow(max(dot(reflect(-lightV, normal), -viewRay), 0.), 52.) * .8;

    vec3 reflectRay = reflect(vec3(uv, 1.), normal);
    vec3 tex        = envMap(reflectRay, normal, 1.5) * (shade + .5);
    vec3 texCol     = (vec3(.04, .18, .46) + tex) * .5;

    float metalness = (1. - colourmap.x);
    metalness      *= metalness;

    vec3 colour = (texCol * (diffuse * vec3(1., .97, .92) * 2. + 0.5)
                  + lightColour * specular * f * 2. * metalness)
                  * attenuation * 1.5;

    // Procedural ocean surface — deep dark blue, lighter at wave crests
    vec3 deepSea   = vec3(0.005, 0.04, 0.10);
    vec3 crestCol  = vec3(0.02,  0.14, 0.32);
    float crest    = clamp((f - 0.47) * 5.0, 0.0, 1.0);
    vec3 oceanBase = mix(deepSea, crestCol, crest);

    vec4 fragcolour = vec4(oceanBase, 1.0);
    fragcolour.rgb += (texture2D(u_buffer, s + .03).x - 0.5) * 0.06;
    fragcolour += vec4(colour, 0.0) * 0.9;

    // Distance fog — hides UV tiling seams in perspective; fades to deep sea near horizon
    float fog = 1.0 - clamp((tFloor - 0.7) / 1.4, 0.0, 1.0);
    fragcolour.rgb = mix(deepSea, fragcolour.rgb, fog);

    gl_FragColor = fragcolour * u_reveal;
  }
`;

// ─── Component ───────────────────────────────────────────────────────────────
export default function WaterRipple() {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = divRef.current;
    if (!container) return;

    // ── Three.js objects ────────────────────────────────────────────────────
    let camera: THREE.Camera;
    let scene: THREE.Scene;
    let renderer: THREE.WebGLRenderer;
    let mat: THREE.ShaderMaterial;
    let uniforms: Record<string, THREE.IUniform>;
    let rtA: THREE.WebGLRenderTarget;
    let rtB: THREE.WebGLRenderTarget;
    let animId: number;
    let initialized = false;

    // ── Drop objects ─────────────────────────────────────────────────────────
    let dropScene: THREE.Scene | null = null;
    let dropCamera: THREE.PerspectiveCamera | null = null;
    let dropMesh: THREE.Mesh | null = null;
    let dropGeo: THREE.BufferGeometry | null = null;
    let dropMat: THREE.ShaderMaterial | null = null;
    let startTs = -1;
    let impactTriggered = false;

    // Reveal timing
    const hasSelectedId = new URLSearchParams(window.location.search).has("id");
    let impactTs: number = hasSelectedId ? -Infinity : -1;
    const REVEAL_DURATION = 1800;

    const newmouse = { x: 0, y: 0 };
    const DIVISOR = 1 / 8;
    const beta = Math.random() * -1000;

    function makeRT(w: number, h: number) {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
      });
      rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping;
      return rt;
    }

    function init(noise: THREE.Texture, env: THREE.Texture) {
      camera = new THREE.Camera();
      camera.position.z = 1;
      scene = new THREE.Scene();

      const geo = new THREE.PlaneGeometry(2, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      rtA = makeRT(w, h);
      rtB = makeRT(w, h);

      uniforms = {
        u_time: { value: 1.0 },
        u_reveal: { value: hasSelectedId ? 1.0 : 0.0 },
        u_resolution: { value: new THREE.Vector2(w, h) },
        u_noise: { value: noise },
        u_buffer: { value: rtA.texture },
        u_environment: { value: env },
        u_mouse: { value: new THREE.Vector3() },
        u_frame: { value: -1 },
        u_renderpass: { value: false },
      };

      mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        glslVersion: THREE.GLSL1,
      });
      scene.add(new THREE.Mesh(geo, mat));

      // ── Drop scene (perspective matches R3F: fov=15, z=100) ──────────────
      if (!hasSelectedId) {
        dropScene = new THREE.Scene();
        dropCamera = new THREE.PerspectiveCamera(15, w / h, 0.1, 1000);
        dropCamera.position.set(0, 0, 100);
        dropCamera.lookAt(0, 0, 0);

        dropGeo = createTeardropGeometry();
        dropMat = new THREE.ShaderMaterial({
          vertexShader: DROP_VERT,
          fragmentShader: DROP_FRAG,
          transparent: true,
          side: THREE.FrontSide,
          depthWrite: false,
        });
        dropMesh = new THREE.Mesh(dropGeo, dropMat);
        dropMesh.scale.setScalar(0.22);
        dropMesh.position.set(0, DROP_START_Y, 0);
        dropScene.add(dropMesh);
      }

      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
      renderer.setPixelRatio(1);
      Object.assign(renderer.domElement.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        display: "block",
      });
      container?.appendChild(renderer.domElement);

      initialized = true;
      onResize();
    }

    function onResize() {
      if (!initialized) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      uniforms.u_resolution.value.set(w, h);

      if (dropCamera) {
        dropCamera.aspect = w / h;
        dropCamera.updateProjectionMatrix();
      }

      rtA.dispose();
      rtB.dispose();
      rtA = makeRT(w, h);
      rtB = makeRT(w, h);
      uniforms.u_frame.value = -1;
    }

    function onMove(e: PointerEvent) {
      const ratio = window.innerHeight / window.innerWidth;
      if (window.innerHeight > window.innerWidth) {
        newmouse.x = (e.pageX - window.innerWidth / 2) / window.innerWidth;
        newmouse.y =
          ((e.pageY - window.innerHeight / 2) / window.innerHeight) *
          -1 *
          ratio;
      } else {
        newmouse.x =
          (e.pageX - window.innerWidth / 2) / window.innerWidth / ratio;
        newmouse.y =
          ((e.pageY - window.innerHeight / 2) / window.innerHeight) * -1;
      }
    }
    const onDown = () => {
      if (uniforms) uniforms.u_mouse.value.z = 1;
    };
    const onUp = () => {
      if (uniforms) uniforms.u_mouse.value.z = 0;
    };

    function renderTexture() {
      const prevRes = (uniforms.u_resolution.value as THREE.Vector2).clone();
      uniforms.u_resolution.value.set(window.innerWidth, window.innerHeight);

      uniforms.u_buffer.value = rtB.texture;
      uniforms.u_renderpass.value = true;
      renderer.setRenderTarget(rtA);
      renderer.render(scene, camera);

      const tmp = rtA;
      rtA = rtB;
      rtB = tmp;

      uniforms.u_buffer.value = rtA.texture;
      uniforms.u_resolution.value.copy(prevRes);
      uniforms.u_renderpass.value = false;
    }

    let impactTimeout: ReturnType<typeof setTimeout>;

    function render(ts: number) {
      if (!initialized) return;

      // ── Drop animation ───────────────────────────────────────────────────
      if (!hasSelectedId && dropMesh && dropScene && dropCamera) {
        if (startTs < 0) startTs = ts;
        const elapsedSec = (ts - startTs) / 1000;

        if (!impactTriggered) {
          if (elapsedSec < DROP_DURATION) {
            const p = easeInQuad(elapsedSec / DROP_DURATION);
            dropMesh.position.y = DROP_START_Y - (DROP_START_Y + 0.15) * p;
            const stretchY = 1 + p * 0.25;
            const squishXZ = 1 - p * 0.1;
            dropMesh.scale.set(
              squishXZ * 0.22,
              stretchY * 0.22,
              squishXZ * 0.22,
            );
            dropMesh.visible = true;
          } else {
            impactTriggered = true;
            dropMesh.visible = false;
            impactTs = ts;
            newmouse.x = 0;
            newmouse.y = 0;
            const mu = uniforms.u_mouse.value as THREE.Vector3;
            mu.x = 0;
            mu.y = 0;
            mu.z = 1;
            clearTimeout(impactTimeout);
            impactTimeout = setTimeout(() => {
              if (uniforms) (uniforms.u_mouse.value as THREE.Vector3).z = 0;
            }, 300);
          }
        }
      }

      // ── Reveal ramp ──────────────────────────────────────────────────────
      if (impactTs >= 0 && uniforms.u_reveal.value < 1) {
        uniforms.u_reveal.value = Math.min(
          1,
          (ts - impactTs) / REVEAL_DURATION,
        );
      }

      uniforms.u_frame.value++;

      const mu = uniforms.u_mouse.value as THREE.Vector3;
      mu.x += (newmouse.x - mu.x) * DIVISOR;
      mu.y += (newmouse.y - mu.y) * DIVISOR;

      uniforms.u_time.value = beta + ts * 0.0005;

      // 1. Water display pass → screen
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);

      // 2. Drop overlay (composite on top, depth-clear first)
      if (!hasSelectedId && dropMesh?.visible && dropScene && dropCamera) {
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(dropScene, dropCamera);
        renderer.autoClear = true;
      }

      // 3. Simulation pass → render targets
      renderTexture();
    }

    function animate(ts: number) {
      animId = requestAnimationFrame(animate);
      render(ts);
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    window.addEventListener("resize", onResize);

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");

    loader.load(
      "/noise.png",
      (noise) => {
        noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
        noise.minFilter = THREE.LinearFilter;

        loader.load(
          "/env_lat-lon.png",
          (env) => {
            env.wrapS = env.wrapT = THREE.RepeatWrapping;
            env.minFilter = THREE.LinearFilter;

            init(noise, env);
            requestAnimationFrame(animate);
          },
        );
      },
    );

    return () => {
      cancelAnimationFrame(animId);
      clearTimeout(impactTimeout);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      window.removeEventListener("resize", onResize);
      dropGeo?.dispose();
      dropMat?.dispose();
      rtA?.dispose();
      rtB?.dispose();
      mat?.dispose();
      renderer?.dispose();
    };
  }, []);

  return (
    <div
      ref={divRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: -1,
        pointerEvents: "none",
      }}
    />
  );
}
