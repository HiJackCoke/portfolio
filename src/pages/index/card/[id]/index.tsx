import { ScrollControls } from "@react-three/drei";

import * as THREE from "three";
import { easing } from "maath";

import { useEffect, useMemo, useRef } from "react";
import Rig from "@/3D/components/Rig";

import cards from "@/constants/cards";
import Card from "@/3D/components/Card";
import { useFrame, useThree } from "@react-three/fiber";
import { useNavigate, useParams } from "react-router-dom";
import CardDetailContent from "@/components/CardDetailContent";

import { createRoot } from "react-dom/client";
import { getResponseMesh } from "@/3D/utils";

const Index = () => {
  const ref = useRef<THREE.Mesh | null>(null);

  const params = useParams<{ id: string }>();
  const { viewport } = useThree();
  const navigate = useNavigate();

  const isVertical = useMemo(() => {
    if (viewport.aspect < 1) {
      return true;
    }
    return false;
  }, [viewport.aspect]);

  useFrame((state, delta) => {
    if (!ref.current) return;
    // const { width: w, height: h } = getMeshPixelSize(ref.current, camera, size);

    const { scale, position } = getResponseMesh(state);
    easing.damp3(ref.current.scale, scale, 0.2, delta);
    easing.damp3(ref.current.position, position, 0.2, delta);
  });

  const card = cards.find((card) => card.id === Number(params.id));
  useEffect(() => {
    document.body.style.pointerEvents = "";

    if (!card) {
      navigate("/", {
        flushSync: true,
        viewTransition: true,
      });
    }
  }, []);

  useEffect(() => {
    const html = document.getElementById("html");
    if (!html) return;

    const root = createRoot(html);
    root.render(
      <CardDetailContent data={card?.data} isVertical={isVertical} />,
    );

    return () => {
      root.unmount();
    };
  }, [isVertical]);

  if (!card) return null;

  return (
    <>
      <ScrollControls enabled={false} prepend={false}>
        <Rig rotation={[0, 0, 0]}>
          <Card
            ref={ref}
            url={card.imageUrl}
            bent={0}
            scale={1.8}
            radius={0.1}
            position={[0, 0, 0]}
            rotation={[0, 0, 0]}
            onClose={() => {
              document.body.style.pointerEvents = "none";
              navigate(`/?id=${card.id}`);
            }}
          />
        </Rig>
      </ScrollControls>
    </>
  );
};

export default Index;
