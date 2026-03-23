import { Canvas } from "@react-three/fiber";

import { Outlet } from "react-router-dom";

import "../../3D";
import { isMobileDevice } from "@/utils";
import Background from "@/3D/Background";
import WaterRipple from "@/3D/components/WaterRipple";

const Index = () => {
  return (
    <>
      {/* Water ripple — standalone Three.js renderer, sits behind R3F canvas */}
      <WaterRipple />

      <div
        id="html"
        className="w-screen h-svh overflow-hidden absolute pointer-events-none"
      />

      <Canvas
        camera={{ position: [0, 0, 100], fov: 15 }}
        dpr={isMobileDevice ? [1, 1.5] : [1, 2]}
        performance={
          isMobileDevice ? { min: 0.5, max: 0.8 } : { min: 1, max: 1 }
        }
        gl={{ alpha: true }}
      >
        <Outlet />
        <Background />
      </Canvas>
    </>
  );
};

export default Index;
