import * as THREE from "three";

import { useCallback, useEffect, useRef, useState } from "react";
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

  const scrollRef = useRef(0);
  const meshesRef = useRef<(THREE.Mesh | null)[]>([]);
  const selectedMeshRef = useRef<CardMeshRef | null>(null);

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
        (meshRef) => meshRef?.uuid === mesh.uuid
      );

      scroll.el.style.pointerEvents = "none";

      animateToCenter(index);
      onCardClick?.(card);
    };

  const animateScale = (
    card: CardMeshRef,
    zoom: boolean,
    smoothTime: number,
    delta: number
  ) => {
    meshesRef.current.forEach((mesh) => {
      if (!mesh) return;

      if (mesh.uuid === card.mesh.uuid) {
        easing.damp3(
          mesh.scale,
          zoom ? SELECTED_MESH_SCALE : 1,
          smoothTime,
          delta
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
        SELECTED_MESH_SCALE
      )
    );

    if (isCompleted) {
      scroll.el.style.pointerEvents = "";

      navigate(`/card/${selectedMeshRef.current.id}`);
    }
  };

  const createAnimate = () => {
    let positionEquals = false; // 클로저 내부 변수

    const animate = (
      card: CardMeshRef,
      reverse: boolean,
      [state, delta]: Parameters<RenderCallback>
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
            card.mesh.rotation.z
          )
        );
        // const isOriginRotationEquals = card.mesh.rotation.equals(
        //   card.originRotation
        // );

        if (isPositionEquals && isRotationEquals) {
          if (isScaleEquals && isOriginPositionEquals) {
            selectedMeshRef.current = null;

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
    behavior: ScrollBehavior = "smooth"
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
    originRotation: THREE.Euler
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
      vertical ? -circlePosition : 0,
      Math.cos((index / count) * Math.PI * 2) * baseRadius,
    ];

    return position;
  }, []);

  useFrame((state, delta) => {
    const card = selectedMeshRef.current;

    if (!card) return;

    animate(card, !!selectedId, [state, delta]);
  });

  useEffect(() => {
    if (selectedId) {
      const index = cards.findIndex((card) => card.id === selectedId);
      const mesh = meshesRef.current[index];
      if (!mesh) return;

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

  return cards.map((card, index) => {
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
  });
};

export default Carousel;
