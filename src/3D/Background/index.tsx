import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { isMobileDevice } from "@/utils";

const vertexShader = `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vOpacity;
  uniform float uTime;
  uniform float uProgress;

  void main() {
    vColor = aColor;
    vOpacity = aSize / 5.0;

    vec3 pos = position;
    pos.x += sin(uTime * 0.11 + position.z * 0.009) * 1.8;
    pos.y += cos(uTime * 0.08 + position.x * 0.009) * 1.8;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (200.0 / -mvPosition.z) * uProgress;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float alpha = smoothstep(0.5, 0.05, dist) * vOpacity;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

const PALETTE = [
  new THREE.Color("#818cf8"),
  new THREE.Color("#a78bfa"),
  new THREE.Color("#38bdf8"),
  new THREE.Color("#c4b5fd"),
  new THREE.Color("#e0f2fe"),
  new THREE.Color("#f0abfc"),
];

const RAIN_COUNT = isMobileDevice ? 150 : 320;

function createLayer(
  count: number,
  rMin: number,
  rMax: number,
  sMin: number,
  sMax: number,
) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = rMin + Math.random() * (rMax - rMin);

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    sizes[i] = sMin + Math.random() * (sMax - sMin);

    const c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  return geo;
}

export default function Background() {
  const groupRef = useRef<THREE.Group>(null);
  const rainRef = useRef<THREE.LineSegments>(null);

  const { material, geometries } = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const mobile = isMobileDevice;
    return {
      material: mat,
      geometries: [
        createLayer(mobile ? 1500 : 3000, 80, 300, 0.8, 2.0),
        createLayer(mobile ? 300 : 600, 50, 250, 2.0, 4.5),
        createLayer(mobile ? 50 : 100, 30, 180, 5.0, 9.0),
      ],
    };
  }, []);

  // Rain streak system
  const { rainGeo, rainData } = useMemo(() => {
    const positions = new Float32Array(RAIN_COUNT * 6); // 2 vertices per streak

    const data = Array.from({ length: RAIN_COUNT }, () => ({
      x: (Math.random() - 0.5) * 14,
      y: Math.random() * 8 - 2,
      z: (Math.random() - 0.5) * 10,
      speed: 4 + Math.random() * 7,
      len: 0.2 + Math.random() * 0.4,
    }));

    data.forEach((d, i) => {
      positions[i * 6 + 0] = d.x;
      positions[i * 6 + 1] = d.y;
      positions[i * 6 + 2] = d.z;
      positions[i * 6 + 3] = d.x;
      positions[i * 6 + 4] = d.y - d.len;
      positions[i * 6 + 5] = d.z;
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return { rainGeo: geo, rainData: data };
  }, []);

  useFrame(({ clock, mouse }, delta) => {
    if (!groupRef.current) return;

    const t = clock.elapsedTime;
    material.uniforms.uTime.value = t;
    material.uniforms.uProgress.value = Math.min(1, t / 2.0);

    // Mouse parallax on star field
    groupRef.current.rotation.y +=
      (mouse.x * 0.08 - groupRef.current.rotation.y) * 0.04;
    groupRef.current.rotation.x +=
      (-mouse.y * 0.05 - groupRef.current.rotation.x) * 0.04;
    groupRef.current.rotation.z = t * 0.003;

    // Animate rain streaks
    if (rainRef.current) {
      const pos = rainRef.current.geometry.attributes.position
        .array as Float32Array;

      for (let i = 0; i < RAIN_COUNT; i++) {
        const d = rainData[i];
        d.y -= d.speed * delta;

        // Reset to top when below floor
        if (d.y < -3.5) {
          d.y = 4 + Math.random() * 4;
          d.x = (Math.random() - 0.5) * 14;
        }

        pos[i * 6 + 0] = d.x;
        pos[i * 6 + 1] = d.y;
        pos[i * 6 + 2] = d.z;
        pos[i * 6 + 3] = d.x;
        pos[i * 6 + 4] = d.y - d.len;
        pos[i * 6 + 5] = d.z;
      }

      rainRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <>
      <fogExp2 attach="fog" color="#06061a" density={0.012} />
      <group ref={groupRef}>
        {geometries.map((geo, i) => (
          <points key={i} geometry={geo} material={material} />
        ))}
      </group>

      {/* Rain streaks */}
      <lineSegments ref={rainRef} geometry={rainGeo}>
        <lineBasicMaterial color="#bae6fd" transparent opacity={0.55} />
      </lineSegments>
    </>
  );
}
