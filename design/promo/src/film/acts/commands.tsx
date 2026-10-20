import { clamp, curve, ease, mix, spring } from "../../lib/time";
import { buttonLabels } from "../assets";
import { axProgress } from "../beats";
import { commands, cue, keyTimes, land } from "../cues";
import { COMMAND_PLACE } from "../layout";
import { settingsCenter, StillScreen } from "../screens";
import { Typed, Words } from "../type";

const LINE = 21;
const BOX = { left: 104, top: 214, width: 580, height: 400 };
const PAD = 18;
const VIEW = BOX.height - 40 - PAD * 2;
const THUMB = { w: 42, h: 42 * (2622 / 1206) };
const CHIP = THUMB.h + 14;

/** What the hero's screen shows during act V. */
export function commandScreen(t: number) {
  const tapAt = land(commands.tap);
  const shotAt = land(commands.shot);
  return {
    open: spring(t, tapAt + 0.06, 0.8, 0.06),
    ax: axProgress(t) * (1 - ease(t, shotAt - 0.35, 0.3)),
    touch:
      t > tapAt - 0.05 ? { ...settingsCenter, p: clamp((t - tapAt + 0.05) / 0.55) } : undefined,
    flash: t > shotAt ? 0.85 * (1 - ease(t, shotAt, 0.45)) : 0,
  };
}

type Row = { at: number; h: number; node: (t: number) => React.ReactNode };

function prompt(c: { text: string; at: number }): Row {
  const times = keyTimes(c.text, c.at);
  const split = c.text.indexOf(" ");
  return {
    at: c.at - 0.25,
    h: LINE,
    node: (t) => (
      <>
        <span className="text-label-3">$ </span>
        {t < c.at ? (
          <span className="inline-block h-[1.05em] w-[0.55em] translate-y-[0.18em] bg-current opacity-85" />
        ) : (
          <>
            <span className="text-label">
              <Typed
                text={c.text.slice(0, split)}
                t={t}
                times={times.slice(0, split)}
                caret={t < times[split]!}
              />
            </span>
            <span className="text-label-2">
              <Typed
                text={c.text.slice(split)}
                t={t}
                times={times.slice(split)}
                caret={t >= times[split]! && t < land(c)}
              />
            </span>
          </>
        )}
      </>
    ),
  };
}

const rows: Row[] = [
  prompt(commands.tap),
  prompt(commands.ax),
  ...buttonLabels.map((label, i) => ({
    at: land(commands.ax) + 0.08 + i * 0.045,
    h: LINE,
    node: () => <span className="text-label-2">{label}</span>,
  })),
  prompt(commands.shot),
  { at: land(commands.shot) + 0.15, h: CHIP + 8, node: () => null },
];

/** Where each row sits, and how far the terminal has scrolled, at time t. */
function layout(t: number) {
  let y = 0;
  let grown = 0;
  const placed = rows.map((r) => {
    const top = y;
    y += r.h;
    grown += r.h * clamp(spring(t, r.at, 0.4));
    return top;
  });
  return { placed, scroll: Math.max(0, grown - VIEW) };
}

/**
 * Act V: a terminal on the left drives the device on the right. Every line
 * lands on the screen — a tap grows Settings out of its icon, /ax lays the
 * app's real accessibility frames over it, and a screenshot lifts off the
 * glass and drops into the terminal.
 */
export function Commands({ t }: { t: number }) {
  if (t < cue.terminal - 0.2 || t > cue.terminalOut + 1) return null;
  const inP = spring(t, cue.terminal, 0.9, 0.08);
  const outP = ease(t, cue.terminalOut, 0.6, curve.in);
  const { placed, scroll } = layout(t);
  const chipIndex = rows.length - 1;
  const chipTop = BOX.top + 40 + PAD + placed[chipIndex]! - scroll;
  return (
    <>
      <div className="display absolute" style={{ left: BOX.left, top: 94, fontSize: 46 }}>
        <Words
          text="Every control is a command."
          t={t}
          at={cue.terminal + 0.15}
          out={cue.terminalOut - 0.1}
          className="text-label"
        />
        <Words
          text="For people, scripts and agents."
          t={t}
          at={cue.terminal + 0.5}
          out={cue.terminalOut - 0.05}
          className="text-label-3"
        />
      </div>
      <div
        className="glass-pop absolute overflow-hidden rounded-[20px]"
        style={{
          ...BOX,
          opacity: clamp(inP) * (1 - outP),
          transform: `translateY(${mix(24, 0, inP)}px) scale(${mix(0.96, 1, inP) - outP * 0.03})`,
          filter: `blur(${mix(8, 0, clamp(inP)) + outP * 10}px)`,
        }}
      >
        <div className="flex h-10 items-center justify-center border-b-[0.5px] border-separator text-caption font-medium text-label-3">
          ~ — zsh
        </div>
        <div
          className="relative font-mono text-footnote"
          style={{ height: BOX.height - 40, padding: PAD }}
        >
          <div className="scroll-fade relative h-full overflow-hidden">
            {rows.map((r, i) => {
              if (t < r.at || i === chipIndex) return null;
              const p = clamp(spring(t, r.at, 0.35));
              return (
                <div
                  key={i}
                  className="absolute right-0 left-0 truncate whitespace-pre"
                  style={{
                    top: placed[i]! - scroll + mix(6, 0, p),
                    lineHeight: `${LINE}px`,
                    opacity: p,
                  }}
                >
                  {r.node(t)}
                </div>
              );
            })}
            {t >= rows[chipIndex]!.at && (
              <div
                className="absolute left-0 flex items-center gap-3"
                style={{
                  top: placed[chipIndex]! - scroll + 4,
                  opacity: clamp(spring(t, rows[chipIndex]!.at + 0.75, 0.5)),
                }}
              >
                <span style={{ width: THUMB.w, height: THUMB.h }} />
                <span className="flex flex-col gap-0.5">
                  <span className="text-label">settings.png</span>
                  <span className="text-label-3">1206 × 2622 · PNG</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      <Flight t={t} to={{ x: BOX.left + PAD, y: chipTop + 4 }} fade={outP} />
    </>
  );
}

/** The screenshot: lifts off the glass, arcs over, and lands in the terminal. */
function Flight({ t, to, fade }: { t: number; to: { x: number; y: number }; fade: number }) {
  const at = land(commands.shot) + 0.12;
  if (t < at || fade >= 1) return null;
  const s = COMMAND_PLACE.s;
  const from = { w: 1206 * s, h: 2622 * s };
  const lift = clamp(spring(t, at, 0.35));
  const p = spring(t, at + 0.2, 1.05, 0.1);
  const q = clamp(p);
  const w = mix(from.w, THUMB.w, p) * (1 + 0.04 * lift * (1 - q));
  const h = mix(from.h, THUMB.h, p) * (1 + 0.04 * lift * (1 - q));
  // An arc, not a line: it rises before it falls into place.
  const x = mix(COMMAND_PLACE.x, to.x + THUMB.w / 2, p);
  const y = mix(COMMAND_PLACE.y, to.y + THUMB.h / 2, p) - Math.sin(Math.PI * q) * 90;
  return (
    <div
      className="absolute overflow-hidden bg-black"
      style={{
        left: x - w / 2,
        top: y - h / 2,
        width: w,
        height: h,
        borderRadius: mix(46, 7, q),
        opacity: 1 - fade,
        transform: `rotate(${Math.sin(Math.PI * q) * -6}deg)`,
        boxShadow: `0 0 0 ${mix(0, 2.5, lift)}px rgba(255,255,255,0.9), 0 ${14 * lift}px ${36 * lift}px rgba(0,0,0,${0.45 * lift})`,
      }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ width: 1206, height: 2622, transform: `scale(${w / 1206})` }}
      >
        <StillScreen src="settings" />
      </div>
    </div>
  );
}
