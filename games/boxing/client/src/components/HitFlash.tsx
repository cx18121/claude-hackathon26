interface HitFlashProps {
  hit: { region: string; damage: number } | null;
}

export function HitFlash({ hit }: HitFlashProps) {
  return (
    <div className={`hit-flash${hit ? ' active' : ''}`}>
      {hit ? (
        <div className="hit-flash-text">
          <span className="hit-flash-region">{formatRegion(hit.region)}</span>
          <span className="hit-flash-damage">-{hit.damage}</span>
        </div>
      ) : null}
    </div>
  );
}

function formatRegion(region: string): string {
  return region
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}
