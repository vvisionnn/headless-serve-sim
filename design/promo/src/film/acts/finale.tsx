import qrcode from "qrcode-generator";
import { wallpaperGlow } from "../../../../src/device/screens/parts";
import { clamp, curve, ease, mix, spring } from "../../lib/time";
import { cue } from "../cues";
import { INSTALL, INSTALL_KEYS } from "../beats";
import { Typed, Words } from "../type";

const QR = (() => {
  const q = qrcode(0, "M");
  q.addData("http://192.168.1.24:3200/p/7f3a9c2e");
  q.make();
  const n = q.getModuleCount();
  const finder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const cells: { r: number; c: number; d: number }[] = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (q.isDark(r, c) && !finder(r, c))
        cells.push({ r, c, d: Math.hypot(r - (n - 1) / 2, c - (n - 1) / 2) });
  return { n, cells, maxD: Math.hypot(n / 2, n / 2) };
})();

/**
 * Act VI: the phone link. The code condenses out of the centre, module by
 * module; later it gives its light back to the wordmark, outermost first.
 */
export function Pocket({ t }: { t: number }) {
  if (t < cue.qr - 0.1 || t > cue.mark + 1.2) return null;
  const size = 248;
  const m = size / QR.n;
  const card = clamp(spring(t, cue.qr, 0.9)) * (1 - ease(t, cue.qrOut + 0.25, 0.6, curve.in));
  const cx = 720;
  const cy = 360;
  const module = (d: number) => {
    const inP = clamp(spring(t, cue.qr + 0.25 + (d / QR.maxD) * 0.75, 0.55));
    const outP = clamp(spring(t, cue.qrOut + (1 - d / QR.maxD) * 0.4, 0.5));
    return inP * (1 - outP);
  };
  return (
    <>
      <div
        className="glass absolute rounded-[36px]"
        style={{
          left: cx - size / 2 - 28,
          top: cy - size / 2 - 28,
          width: size + 56,
          height: size + 56,
          opacity: card,
          transform: `scale(${mix(0.94, 1, card)})`,
          filter: `blur(${mix(8, 0, card)}px)`,
        }}
      />
      <svg
        className="absolute"
        style={{ left: cx - size / 2, top: cy - size / 2 }}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <g fill="var(--label)">
          {QR.cells.map(({ r, c, d }) => {
            const k = module(d);
            if (k <= 0.001) return null;
            const s = m * 0.84 * k;
            return (
              <rect
                key={`${r}-${c}`}
                x={c * m + (m - s) / 2}
                y={r * m + (m - s) / 2}
                width={s}
                height={s}
                rx={s * 0.4}
              />
            );
          })}
          {[
            [0, 0],
            [0, QR.n - 7],
            [QR.n - 7, 0],
          ].map(([r, c]) => {
            const k = module(QR.maxD * 0.9);
            if (k <= 0.001) return null;
            const x = c! * m + 3.5 * m;
            const y = r! * m + 3.5 * m;
            return (
              <g key={`${r}-${c}`} transform={`translate(${x} ${y}) scale(${k})`}>
                <rect
                  x={-3.5 * m + m * 0.5}
                  y={-3.5 * m + m * 0.5}
                  width={6 * m}
                  height={6 * m}
                  rx={2 * m}
                  fill="none"
                  stroke="var(--label)"
                  strokeWidth={m}
                />
                <rect x={-1.5 * m} y={-1.5 * m} width={3 * m} height={3 * m} rx={m} />
              </g>
            );
          })}
        </g>
      </svg>
      <div
        className="display absolute left-0 w-full text-center"
        style={{ top: 556, fontSize: 44 }}
      >
        <Words
          text="Hand it to any phone."
          t={t}
          at={cue.qr + 0.7}
          out={cue.qrOut}
          className="text-label"
        />
      </div>
      <div
        className="absolute left-0 w-full text-center text-title2 font-normal"
        style={{ top: 616 }}
      >
        <Words
          text="Scan, and the live simulator is in your hand."
          t={t}
          at={cue.qr + 1.1}
          out={cue.qrOut + 0.05}
          stagger={0.04}
          className="text-label-3"
        />
      </div>
    </>
  );
}

const MARK = "headless-serve-sim";

/**
 * Act VII: the wordmark becomes the lit object. Its letters resolve out of
 * the glow one by one; the install line types itself underneath.
 */
export function Finale({ t }: { t: number }) {
  if (t < cue.mark - 0.2) return null;
  const glow = ease(t, cue.mark - 0.3, 1.8, curve.fluid);
  const breathe = 1 + 0.035 * Math.sin(((t - cue.mark) / 5.5) * Math.PI * 2);
  const pill = clamp(spring(t, cue.install - 0.35, 0.8));
  return (
    <>
      <div
        aria-hidden
        className="absolute"
        style={{
          left: 720 - 420,
          top: 330 - 230,
          width: 840,
          height: 460,
          opacity: `calc(var(--glow-strength) * ${glow})`,
          mixBlendMode: "var(--glow-blend)" as never,
          filter: "blur(70px)",
          transform: `scale(${mix(0.6, 1, glow) * breathe})`,
          background: [
            `radial-gradient(36% 40% at 30% 40%, ${wallpaperGlow[0]} 0%, transparent 100%)`,
            `radial-gradient(36% 44% at 66% 34%, ${wallpaperGlow[1]} 0%, transparent 100%)`,
            `radial-gradient(40% 40% at 60% 74%, ${wallpaperGlow[2]} 0%, transparent 100%)`,
            `radial-gradient(34% 36% at 36% 70%, ${wallpaperGlow[3]} 0%, transparent 100%)`,
          ].join(","),
        }}
      />
      <div
        className="display absolute left-0 flex w-full justify-center text-label"
        style={{ top: 278, fontSize: 92, letterSpacing: "-0.045em" }}
      >
        {MARK.split("").map((ch, i) => {
          const p = spring(t, cue.mark + 0.12 + i * 0.035, 1.1, 0.14);
          const seen = clamp(p);
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity: seen,
                transform: `translateY(${mix(0.3, 0, p)}em) scale(${mix(1.25, 1, seen)})`,
                filter: `blur(${mix(18, 0, seen)}px)`,
              }}
            >
              {ch}
            </span>
          );
        })}
      </div>
      <div
        className="absolute left-0 w-full text-center text-label-2"
        style={{
          top: 398,
          fontSize: 22,
          letterSpacing: "-0.02em",
          fontFamily: "var(--font-display)",
        }}
      >
        <Words
          text="Apple simulators, streamed to your browser."
          t={t}
          at={cue.mark + 0.95}
          stagger={0.045}
        />
      </div>
      {pill > 0.002 && (
        <div
          className="absolute left-1/2 top-[470px]"
          style={{
            opacity: pill,
            transform: `translateX(-50%) translateY(${mix(10, 0, pill)}px)`,
            filter: `blur(${mix(6, 0, pill)}px)`,
          }}
        >
          <div className="glass-sm flex h-11 items-center gap-2.5 rounded-full px-5 font-mono text-body">
            <span className="text-label-3">$</span>
            <span className="text-label" style={{ minWidth: `${INSTALL.length * 0.602}em` }}>
              <Typed text={INSTALL} t={t} times={INSTALL_KEYS} />
            </span>
          </div>
        </div>
      )}
    </>
  );
}
