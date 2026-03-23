import * as THREE from "three";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RenderCallback, useFrame } from "@react-three/fiber";
import { easing } from "maath";

import Card from "./Card";
import { Card as CardType } from "@/types/constants";
import { useNavigate } from "react-router-dom";
import { useScroll } from "@react-three/drei";
import { getResponseMesh } from "../utils";

type EventParams<T> = T;

type Props<T extends CardType> = {
  selectedId?: number;
  cards: T[];
  radius?: number;
  vertical?: boolean;

  onCardPointerOver?: (params: EventParams<T>) => void;
  onCardPointerOut?: (params: EventParams<T>) => void;
  onCardClick?: (params: EventParams<T>) => void;
  onCardClose?: (params: EventParams<T>) => void;
};

interface CardMeshRef {
  id: number;
  mesh: THREE.Mesh;
  originPosition: THREE.Vector3Tuple;
  originRotation: THREE.Euler;
  animation: boolean;
}

type ScrollControlsState = ReturnType<typeof useScroll> & {
  scroll: React.MutableRefObject<number>;
};

const SCALE = 1;
const SELECTED_MESH_SCALE = SCALE + 0.8;

const EPSILON = 0.001;

// Y height of the carousel ring — move up from 0 to sit closer to screen centre
const Y_OFFSET = 0;

// Glow halo colours matching the Background particle palette
const GLOW_PALETTE = [
  "#818cf8",
  "#a78bfa",
  "#38bdf8",
  "#c4b5fd",
  "#e0f2fe",
  "#f0abfc",
];

// Intro animation timing (seconds)
const START_Y = 2.5;
const DROP_DURATION = 0.9;
const IMPACT_DURATION = 0.3;
const SPREAD_DURATION = 1.4;
const TOTAL_INTRO = DROP_DURATION + IMPACT_DURATION + SPREAD_DURATION;

const easeInQuad = (t: number) => t * t;
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const CARD_INTRO_SCALE = 0.15;

const Carousel = <T extends CardType>({
  selectedId,
  cards,
  radius,
  vertical = false,

  onCardPointerOver,
  onCardPointerOut,
  onCardClick,
  onCardClose,
}: Props<T>) => {
  const count = cards.length;
  const baseRadius = radius ?? count / 5;

  const navigate = useNavigate();
  const scroll = useScroll() as ScrollControlsState;

  const meshesRef = useRef<(THREE.Mesh | null)[]>([]);
  const glowMeshesRef = useRef<(THREE.Mesh | null)[]>([]);
  const scrollRef = useRef(0);
  const selectedMeshRef = useRef<CardMeshRef | null>(null);
  const introRef = useRef({
    time: selectedId ? TOTAL_INTRO : 0,
    done: !!selectedId,
  });

  const clusterOffsets = useMemo(
    () =>
      cards.map(() => ({
        x: (Math.random() - 0.5) * 0.1,
        y: (Math.random() - 0.5) * 0.12,
        z: (Math.random() - 0.5) * 0.05,
      })),
    [count],
  );

  const glowTexture = useMemo(() => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grd = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    grd.addColorStop(0, "rgba(255,255,255,0.85)");
    grd.addColorStop(0.45, "rgba(255,255,255,0.2)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }, []);

  const [defaultSelectedID, setDefaultSelectedID] = useState(selectedId);

  const handleClose = (card: T) => () => {
    if (!selectedMeshRef.current) return;
    selectedMeshRef.current.animation = false;
    onCardClose?.(card);
  };

  const handleClick =
    (card: T, position: THREE.Vector3Tuple, originRotation: THREE.Euler) =>
    (_: unknown, mesh: THREE.Mesh | null) => {
      if (!mesh) return;

      selectMesh(mesh, card.id, position, originRotation);

      const index = meshesRef.current.findIndex(
        (meshRef) => meshRef?.uuid === mesh.uuid,
      );

      scroll.el.style.pointerEvents = "none";

      animateToCenter(index);
      onCardClick?.(card);
    };

  const animateScale = (
    card: CardMeshRef,
    zoom: boolean,
    smoothTime: number,
    delta: number,
  ) => {
    meshesRef.current.forEach((mesh) => {
      if (!mesh) return;

      if (mesh.uuid === card.mesh.uuid) {
        easing.damp3(
          mesh.scale,
          zoom ? SELECTED_MESH_SCALE : 1,
          smoothTime,
          delta,
        );
      } else {
        easing.damp3(mesh.scale, zoom ? 0 : 1, smoothTime, delta);
      }
    });
  };

  const navigateDetail = () => {
    if (!selectedMeshRef.current) return;

    window.history.replaceState("", "", `?id=${selectedMeshRef.current.id}`);

    const isCompleted = selectedMeshRef.current?.mesh.scale.equals(
      new THREE.Vector3(
        SELECTED_MESH_SCALE,
        SELECTED_MESH_SCALE,
        SELECTED_MESH_SCALE,
      ),
    );

    if (isCompleted) {
      document.body.style.pointerEvents = "none";
      navigate(`/card/${selectedMeshRef.current.id}`);
    }
  };

  const createAnimate = () => {
    let positionEquals = false; // 클로저 내부 변수

    const animate = (
      card: CardMeshRef,
      reverse: boolean,
      [state, delta]: Parameters<RenderCallback>,
    ) => {
      if (!card?.mesh.parent) return;

      if (!selectedMeshRef.current) return;

      const isCenter =
        Math.abs((scroll.offset % 1) - (scrollRef.current % 1)) < EPSILON;

      if (!isCenter) return;

      if (!reverse) {
        easing.damp3(card.mesh.position, [0, 0, 0], 0.1, delta);
        navigateDetail();
        animateScale(card, true, 0.1, delta);
        return;
      }

      const { position, scale } = getResponseMesh(state);
      const isOff = !selectedMeshRef.current?.animation;

      if (isOff) {
        const originPosition = new THREE.Vector3(...card.originPosition);
        const originScale = new THREE.Vector3(1, 1, 1);

        const isScaleEquals = card.mesh.scale.equals(originScale);
        const isOriginPositionEquals =
          card.mesh.position.equals(originPosition);

        const isPositionEquals =
          card.mesh.position.equals(new THREE.Vector3(0, 0, 0)) ||
          positionEquals;
        const isRotationEquals = card.mesh.rotation.equals(
          new THREE.Euler(
            card.mesh.rotation.x,
            card.mesh.rotation.y,
            card.mesh.rotation.z,
          ),
        );
        // const isOriginRotationEquals = card.mesh.rotation.equals(
        //   card.originRotation
        // );

        if (isPositionEquals && isRotationEquals) {
          if (isScaleEquals && isOriginPositionEquals) {
            selectedMeshRef.current = null;
            scroll.el.style.pointerEvents = "";
            navigate("/", { replace: true });
          }

          positionEquals = true; // 클로저 변수 업데이트

          animateScale(card, false, 0.1, delta);
          easing.damp3(card.mesh.position, originPosition, 0.1, delta);
          easing.dampE(card.mesh.rotation, card.originRotation, 0.2, delta);
          return;
        }

        easing.damp3(card.mesh.position, [0, 0, 0], 0.2, delta);
      } else {
        animateScale(card, true, 0, delta);
        easing.damp3(card.mesh.position, position, 0, delta);
        easing.dampE(card.mesh.rotation, [0, 0, 0], 0, delta);
        easing.damp3(card.mesh.scale, scale, 0, delta);

        selectedMeshRef.current.animation = false;
      }
    };

    return animate;
  };

  const animateToCenter = (
    index: number,
    behavior: ScrollBehavior = "smooth",
  ) => {
    const targetOffset = (index / cards.length) % 1;
    const realScrollPages = scroll.pages + 1;

    // 대부분 브라우저에서 scrollTo 하면 round 처리함
    const top =
      Math.round(scroll.el.scrollHeight / realScrollPages) *
      scroll.pages *
      targetOffset;

    if (scroll.offset !== targetOffset) {
      if (behavior !== "smooth") {
        scroll.offset = targetOffset;
        scroll.scroll.current = targetOffset;
      }

      scroll.el.scrollTo({
        top,
        behavior,
      });
    }

    scrollRef.current = targetOffset;
  };

  const selectMesh = (
    mesh: THREE.Mesh,
    cardID: number,
    originPosition: THREE.Vector3Tuple,
    originRotation: THREE.Euler,
  ) => {
    // selectedUUIDRef.current = mesh.uuid;
    selectedMeshRef.current = {
      id: cardID,
      mesh,
      originPosition,
      originRotation,
      animation: true,
    };
  };

  const animate = useCallback(createAnimate(), []);

  const getCardRotation = useCallback((index: number) => {
    const circleRotation = (index / count) * Math.PI * 2;
    const rotation = [
      vertical ? circleRotation : 0,
      vertical ? 0 : circleRotation,
      0,
    ];
    return new THREE.Euler(...rotation);
  }, []);

  const getCardPosition = useCallback((index: number) => {
    const circlePosition = Math.sin((index / count) * Math.PI * 2) * baseRadius;

    const position: THREE.Vector3Tuple = [
      vertical ? 0 : circlePosition,
      vertical ? -circlePosition : Y_OFFSET,
      Math.cos((index / count) * Math.PI * 2) * baseRadius,
    ];

    return position;
  }, []);

  useFrame((state, delta) => {
    if (!introRef.current.done) {
      introRef.current.time += delta;
      const t = introRef.current.time;

      // ── Card opacity: 0 until spread is wide enough to not overlap ──
      const spreadP =
        t < DROP_DURATION + IMPACT_DURATION
          ? 0
          : Math.min(
              1,
              (t - DROP_DURATION - IMPACT_DURATION) / SPREAD_DURATION,
            );
      // Cards start fading in at 25% spread, fully visible at 70%
      const cardOpacity = Math.min(1, Math.max(0, (spreadP - 0.25) / 0.45));

      // ── Phase 1: DROP ──
      if (t < DROP_DURATION) {
        const p = easeInQuad(t / DROP_DURATION);
        const y = START_Y * (1 - p);

        meshesRef.current.forEach((mesh, i) => {
          if (!mesh) return;
          const off = clusterOffsets[i];
          mesh.position.set(off.x, y + off.y, off.z);
          mesh.scale.setScalar(CARD_INTRO_SCALE);
          (mesh.material as THREE.MeshBasicMaterial).opacity = 0;
        });

        // ── Phase 2: IMPACT ──
      } else if (t < DROP_DURATION + IMPACT_DURATION) {
        const p = (t - DROP_DURATION) / IMPACT_DURATION;
        const bounceY = -0.12 * Math.sin(p * Math.PI);

        meshesRef.current.forEach((mesh, i) => {
          if (!mesh) return;
          const off = clusterOffsets[i];
          const squeeze = 1 - 0.4 * Math.sin(p * Math.PI);
          mesh.position.set(off.x, bounceY + off.y * squeeze, off.z);
          mesh.scale.setScalar(CARD_INTRO_SCALE);
          (mesh.material as THREE.MeshBasicMaterial).opacity = 0;
        });

        // ── Phase 3: SPREAD ──
      } else {
        const p = Math.min(
          1,
          (t - DROP_DURATION - IMPACT_DURATION) / SPREAD_DURATION,
        );
        const r = easeOutBack(p) * baseRadius;

        // Scale grows with the same easeOutBack curve as radius (slight overshoot → settle)
        const cardScale =
          CARD_INTRO_SCALE + (1 - CARD_INTRO_SCALE) * easeOutBack(p);

        meshesRef.current.forEach((mesh, index) => {
          if (!mesh) return;
          const angle = (index / count) * Math.PI * 2;
          const circlePos = Math.sin(angle) * r;
          mesh.position.set(
            vertical ? 0 : circlePos,
            vertical ? -circlePos : Y_OFFSET,
            Math.cos(angle) * r,
          );
          mesh.scale.setScalar(Math.max(CARD_INTRO_SCALE, cardScale));
          (mesh.material as THREE.MeshBasicMaterial).opacity = cardOpacity;
        });

        if (p >= 1) {
          // Restore opacity before handing control back
          meshesRef.current.forEach((mesh) => {
            if (!mesh) return;
            (mesh.material as THREE.MeshBasicMaterial).opacity = 1;
          });
          introRef.current.done = true;
        }
      }
    }

    const card = selectedMeshRef.current;
    if (card) animate(card, !!selectedId, [state, delta]);

    // Sync glow position/scale to their card mesh each frame
    glowMeshesRef.current.forEach((glow, i) => {
      const cardMesh = meshesRef.current[i];
      if (!glow || !cardMesh) return;
      glow.position.copy(cardMesh.position);
      glow.scale.copy(cardMesh.scale);
      const isSelectedCard =
        selectedMeshRef.current?.mesh === cardMesh &&
        selectedMeshRef.current.animation;
      (glow.material as THREE.MeshBasicMaterial).opacity = isSelectedCard
        ? 0
        : 0.5;
    });
  });

  useEffect(() => {
    if (selectedId) {
      const index = cards.findIndex((card) => card.id === selectedId);
      const mesh = meshesRef.current[index];
      if (!mesh) return;

      scroll.el.style.pointerEvents = "none";

      const originPosition = getCardPosition(index);
      const originRotation = getCardRotation(index);

      selectMesh(mesh, selectedId, originPosition, originRotation);
    }
  }, [selectedId]);

  useEffect(() => {
    const isFinishedReversAnimation =
      !selectedMeshRef.current?.animation &&
      !selectedId &&
      !selectedMeshRef.current;

    if (isFinishedReversAnimation) {
      setDefaultSelectedID(undefined);
    }
  }, [selectedMeshRef.current?.animation, selectedMeshRef.current]);

  return (
    <>
      {/* Soft glow halos — position synced to card meshes in useFrame */}
      {cards.map((card, index) => {
        const glowColor = GLOW_PALETTE[index % GLOW_PALETTE.length];
        const position = getCardPosition(index);
        const rotation = getCardRotation(index);
        return (
          <mesh
            key={`glow-${card.id}`}
            ref={(el) => (glowMeshesRef.current[index] = el)}
            position={position}
            rotation={rotation}
          >
            <planeGeometry args={[2.2, 3.0]} />
            <meshBasicMaterial
              map={glowTexture}
              color={glowColor}
              transparent
              opacity={0.5}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        );
      })}

      {cards.map((card, index) => {
        const { id, imageUrl } = card;

        const rotation = getCardRotation(index);
        const position = getCardPosition(index);

        const isDefaultSelectedCard = defaultSelectedID === card.id;

        const isSelected =
          selectedMeshRef.current?.animation &&
          selectedMeshRef.current.mesh.uuid === meshesRef.current[index]?.uuid;

        return (
          <Card
            key={id}
            ref={(el) => (meshesRef.current[index] = el)}
            url={imageUrl}
            bent={isSelected || isDefaultSelectedCard ? 0 : -0.1}
            zoom={isSelected || isDefaultSelectedCard ? 1 : 1.5}
            position={position}
            rotation={rotation}
            onPointerOver={() => onCardPointerOver?.(card)}
            onPointerOut={() => onCardPointerOut?.(card)}
            onClick={handleClick(card, position, rotation)}
            onClose={isSelected ? handleClose(card) : undefined}
          />
        );
      })}

    </>
  );
};

export default Carousel;
