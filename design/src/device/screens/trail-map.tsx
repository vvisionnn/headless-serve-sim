/** Topographic thumbnail with a route — deterministic per trail id. */
function rand(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

export function TrailMap({ id, dark, width, height, animate }: { id: string; dark: boolean; width: number; height: number; animate?: boolean }) {
  let seed = 7;
  for (const c of id) seed = (seed * 31 + c.charCodeAt(0)) % 2147483647;
  const r = rand(seed);
  const cx = width * (0.35 + r() * 0.3);
  const cy = height * (0.4 + r() * 0.2);
  const rings = Array.from({ length: 9 }, (_, i) => {
    const rx = 18 + i * (width / 16);
    const ry = 12 + i * (height / 11);
    const wob = Array.from({ length: 12 }, () => 0.86 + r() * 0.28);
    const pts = wob.map((k, j) => {
      const a = (j / wob.length) * Math.PI * 2;
      return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k] as const;
    });
    let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
    for (let j = 0; j < pts.length; j++) {
      const p1 = pts[j]!;
      const p2 = pts[(j + 1) % pts.length]!;
      d += ` Q ${p1[0]} ${p1[1]} ${(p1[0] + p2[0]) / 2} ${(p1[1] + p2[1]) / 2}`;
    }
    return d + " Z";
  });
  const route = Array.from({ length: 7 }, (_, i) => [width * (0.1 + (i / 6) * 0.8), height * (height > width ? 0.42 + r() * 0.16 : 0.25 + r() * 0.5)] as const);
  let rd = `M ${route[0]![0]} ${route[0]![1]}`;
  for (let i = 1; i < route.length; i++) {
    const p = route[i - 1]!;
    const q = route[i]!;
    rd += ` C ${(p[0] + q[0]) / 2} ${p[1]}, ${(p[0] + q[0]) / 2} ${q[1]}, ${q[0]} ${q[1]}`;
  }
  const start = route[0]!;
  const end = route[route.length - 1]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <rect width={width} height={height} fill={dark ? "#14211d" : "#eef4ef"} />
      {rings.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={dark ? "#2a4a3f" : "#cfe0d4"} strokeWidth={i % 3 === 0 ? 1.1 : 0.6} />
      ))}
      <path d={rd} fill="none" stroke={dark ? "#0b1512" : "#ffffff"} strokeWidth="6" strokeLinecap="round" />
      <path
        d={rd}
        fill="none"
        stroke="#13a37f"
        strokeWidth="3"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={animate ? "1 1" : undefined}
        style={animate ? { animation: "route-draw 1.6s cubic-bezier(0.22,1,0.36,1) both" } : undefined}
      />
      <circle cx={start[0]} cy={start[1]} r="4.5" fill="#fff" stroke="#13a37f" strokeWidth="2.5" />
      <circle cx={end[0]} cy={end[1]} r="4.5" fill="#13a37f" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}
