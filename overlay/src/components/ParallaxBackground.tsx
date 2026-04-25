import { useEffect, useState } from 'react';

const backgroundUrl = `${import.meta.env.BASE_URL}background.png`;

export function ParallaxBackground({ tick }: { tick: number }) {
  const [pngOk, setPngOk] = useState<boolean>(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setPngOk(true);
    img.onerror = () => setPngOk(false);
    img.src = backgroundUrl;
  }, []);

  return (
    <div className="parallax-bg">
      <div
        className="parallax-layer sky"
        style={{ transform: `translateX(${-(tick / 10) % 800}px)` }}
      />
      <div
        className="parallax-layer city"
        style={{ transform: `translateX(${-(tick / 5) % 600}px)` }}
      />
      {pngOk && (
        <div
          className="parallax-layer city-png"
          style={{
            backgroundImage: `url(${backgroundUrl})`,
            backgroundRepeat: 'repeat-x',
            backgroundSize: 'auto 60%',
            backgroundPosition: `${-(tick / 5) % 1536}px center`,
            opacity: 0.85,
            mixBlendMode: 'multiply',
          }}
        />
      )}
      <div className="parallax-layer ground" />
    </div>
  );
}
