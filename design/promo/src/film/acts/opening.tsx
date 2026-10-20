import { clamp, curve, ease, mix, spring } from "../../lib/time";
import { cue } from "../cues";
import { hero } from "../layout";
import { Words } from "../type";

const WIN = { w: 392, h: 676 };

/** The window's glass, cut into jittered triangles: deterministic, so every render breaks it the same way. */
const SHARDS = (() => {
  const cols = 5;
  const rows = 8;
  let seed = 41;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pt = (c: number, r: number) => {
    const edge = c === 0 || r === 0 || c === cols || r === rows;
    const j = edge ? 0 : 0.36;
    return {
      x: ((c + (rand() - 0.5) * j) / cols) * WIN.w,
      y: ((r + (rand() - 0.5) * j) / rows) * WIN.h,
    };
  };
  const grid = Array.from({ length: rows + 1 }, (_, r) =>
    Array.from({ length: cols + 1 }, (_, c) => pt(c, r)),
  );
  const out: {
    pts: { x: number; y: number }[];
    box: { x: number; y: number; w: number; h: number };
    cx: number;
    cy: number;
    spin: number[];
    v: number;
  }[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const [a, b2, cc, d] = [grid[r]![c]!, grid[r]![c + 1]!, grid[r + 1]![c + 1]!, grid[r + 1]![c]!];
      const tris = (r + c) % 2 ? [[a, b2, cc], [a, cc, d]] : [[a, b2, d], [b2, cc, d]];
      for (const pts of tris) {
        const cx = (pts[0]!.x + pts[1]!.x + pts[2]!.x) / 3;
        const cy = (pts[0]!.y + pts[1]!.y + pts[2]!.y) / 3;
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const box = { x: Math.min(...xs), y: Math.min(...ys), w: 0, h: 0 };
        box.w = Math.max(...xs) - box.x;
        box.h = Math.max(...ys) - box.y;
        out.push({ pts, box, cx, cy, spin: [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1], v: 0.6 + rand() * 0.8 });
      }
    }
  return out;
})();

function Chrome({ t }: { t: number }) {
  return (
    <div className="flex h-[30px] items-center gap-[7px] px-[12px]">
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <span key={c} className="size-[11px] rounded-full" style={{ background: c }} />
      ))}
      <span
        className="flex-1 pr-[38px] text-center text-caption font-semibold text-label-2"
        style={{ opacity: 1 - ease(t, cue.shatter - 0.3, 0.2) }}
      >
        Simulator — iPhone 17 Pro
      </span>
    </div>
  );
}

/**
 * Act II: the Simulator.app window the tool does without. It closes in around
 * the device, holds for a beat, and breaks: the glass goes out in shards that
 * fly and fall like glass, and the device is left standing on its own.
 */
export function GhostWindow({ t }: { t: number }) {
  if (t < cue.window || t > cue.shatter + 1.4) return null;
  const h = hero(t);
  const left = h.x - WIN.w / 2;
  const top = h.y - WIN.h / 2 - 14;
  const inP = spring(t, cue.window, 0.5, 0.1);
  // Tension before the break: the glass flexes a hair toward the viewer.
  const strain = ease(t, cue.shatter - 0.45, 0.45, curve.in);
  if (t < cue.shatter) {
    return (
      <div
        className="glass absolute overflow-hidden rounded-[18px]"
        style={{
          left,
          top,
          width: WIN.w,
          height: WIN.h,
          opacity: clamp(inP * 2),
          transform: `scale(${mix(1.12, 1, inP) + strain * 0.012})`,
          filter: `blur(${mix(10, 0, clamp(inP))}px)`,
        }}
      >
        <Chrome t={t} />
      </div>
    );
  }
  const e = t - cue.shatter;
  const ox = WIN.w / 2;
  const oy = WIN.h * 0.46;
  return (
    <div className="absolute" style={{ left, top, width: WIN.w, height: WIN.h, perspective: 900 }}>
      {SHARDS.map((s, i) => {
        // Ballistic: thrown outward from the break, then gravity takes it.
        const dx = s.cx - ox;
        const dy = s.cy - oy;
        const d = Math.hypot(dx, dy) || 1;
        const speed = 520 * s.v * (0.6 + d / 500);
        const x = (dx / d) * speed * e;
        const y = (dy / d) * speed * e + 0.5 * 1500 * e * e;
        const z = 260 * s.v * e;
        const o = 1 - ease(t, cue.shatter + 0.05 + s.v * 0.2, 0.55, curve.in);
        if (o <= 0.002) return null;
        const [rx, ry, rz] = s.spin.map((k) => k * 540 * e);
        const blur = Math.min(10, speed * 0.006 * Math.exp(-e * 2));
        return (
          // Each shard is only as big as its triangle: a window-sized glass
          // layer per shard costs the backdrop blur eighty whole windows.
          <div
            key={i}
            className="glass absolute overflow-hidden"
            style={{
              left: s.box.x,
              top: s.box.y,
              width: s.box.w,
              height: s.box.h,
              // Only the window's own corners are round.
              borderTopLeftRadius: s.box.x === 0 && s.box.y === 0 ? 18 : 0,
              borderTopRightRadius: s.box.x + s.box.w === WIN.w && s.box.y === 0 ? 18 : 0,
              borderBottomRightRadius: s.box.x + s.box.w === WIN.w && s.box.y + s.box.h === WIN.h ? 18 : 0,
              borderBottomLeftRadius: s.box.x === 0 && s.box.y + s.box.h === WIN.h ? 18 : 0,
              clipPath: `polygon(${s.pts.map((p) => `${p.x - s.box.x}px ${p.y - s.box.y}px`).join(",")})`,
              transformOrigin: `${s.cx - s.box.x}px ${s.cy - s.box.y}px`,
              transform: `translate3d(${x}px, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`,
              opacity: o,
              filter: `blur(${blur}px) brightness(${1 + 0.8 * Math.exp(-e * 10)})`,
              boxShadow: "none",
            }}
          >
            <div
              className="absolute rounded-[18px]"
              style={{
                left: -s.box.x,
                top: -s.box.y,
                width: WIN.w,
                height: WIN.h,
                boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.6)",
              }}
            >
              <Chrome t={t} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function NoWindow({ t }: { t: number }) {
  return (
    <div className="display absolute" style={{ left: 742, top: 292, width: 660, fontSize: 64 }}>
      <Words text="No Simulator window." t={t} at={cue.noWindow} out={cue.noWindowOut} className="text-label" />
      <Words
        text="Just the device,"
        t={t}
        at={cue.noWindow + 0.5}
        out={cue.noWindowOut + 0.04}
        className="text-label-3"
      />
      <Words
        text="live in your browser."
        t={t}
        at={cue.noWindow + 0.75}
        out={cue.noWindowOut + 0.08}
        className="text-label-3"
      />
    </div>
  );
}
