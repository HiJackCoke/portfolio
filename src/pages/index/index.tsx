import { ScrollControls } from "@react-three/drei";

import Rig from "../../3D/components/Rig";
import Carousel from "../../3D/components/Carousel";
import Banner from "../../3D/components/Banner";

import cards from "../../constants/cards";

import { useLayoutEffect, useState } from "react";
import { useLocation } from "react-router-dom";

const Index = () => {
  const location = useLocation();
  const selectedId = new URLSearchParams(location.search).get("id");

  const [isSelected, setIsSelected] = useState(false);

  useLayoutEffect(() => {
    if (selectedId) {
      setIsSelected(true);
    } else {
      setIsSelected(false);
    }
  }, [selectedId]);

  return (
    <>
      <ScrollControls pages={5} infinite>
        <Rig
          animation={!selectedId}
          scrollHintVisible
          rotation={[0, 0, isSelected ? 0 : 0.15]}
        >
          <Carousel
            cards={cards}
            selectedId={selectedId ? Number(selectedId) : undefined}
            onCardClick={() => setIsSelected(true)}
            onCardClose={() => setIsSelected(false)}
          />
        </Rig>

        <Banner
          position={[0, -0.15, 0]}
          radius={isSelected ? 0 : cards.length / 5 + 0.2}
        />
      </ScrollControls>
    </>
  );
};

export default Index;
