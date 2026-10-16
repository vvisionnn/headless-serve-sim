import { Cpu, MemoryStick } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AppIcon, apps } from "../device/screens/parts";
import { currentApp } from "../lib/mock";
import { AreaChart, Sparkline } from "../ui/area-chart";
import { Badge, StatusDot } from "../ui/badge";
import { InfoRow, Section } from "../ui/group";
import { RollingNumber } from "../ui/rolling-number";
import { Segmented } from "../ui/segmented";

const N = 48;

function walk(prev: number, lo: number, hi: number, jitter: number, pull: number, center: number) {
  const next = prev + (Math.random() - 0.5) * jitter + (center - prev) * pull;
  return Math.min(hi, Math.max(lo, next));
}

function seed(center: number, jitter: number, lo: number, hi: number) {
  const out: number[] = [];
  let v = center;
  for (let i = 0; i < N; i++) {
    v = walk(v, lo, hi, jitter, 0.12, center);
    out.push(v);
  }
  return out;
}

/** One sample per second for every live series, plus a tick counter. */
function useMetrics() {
  const [m, setM] = useState(() => ({
    tick: 0,
    cpu: seed(14, 9, 2, 96),
    mem: seed(219, 6, 180, 320),
    fps: seed(59, 3, 40, 60),
    kbps: seed(14200, 2600, 6000, 24000),
    jitter: seed(2.4, 1.2, 0.4, 9),
    decode: seed(3.1, 0.8, 1, 8),
    threads: 31,
    wakeups: 212,
    time: new Date(),
  }));
  useEffect(() => {
    const id = setInterval(() => {
      setM((s) => {
        const push = (arr: number[], v: number) => [...arr.slice(1), v];
        // An occasional burst keeps the CPU trace honest-looking.
        const burst = Math.random() < 0.08 ? 35 + Math.random() * 30 : 0;
        return {
          tick: s.tick + 1,
          cpu: push(s.cpu, Math.min(96, walk(s.cpu.at(-1)!, 2, 80, 9, 0.18, 14) + burst)),
          mem: push(s.mem, walk(s.mem.at(-1)!, 180, 320, 6, 0.06, 222)),
          fps: push(s.fps, walk(s.fps.at(-1)!, 40, 60, 3, 0.4, 59)),
          kbps: push(s.kbps, walk(s.kbps.at(-1)!, 6000, 24000, 2600, 0.2, 14200)),
          jitter: push(s.jitter, walk(s.jitter.at(-1)!, 0.4, 9, 1.2, 0.3, 2.4)),
          decode: push(s.decode, walk(s.decode.at(-1)!, 1, 8, 0.8, 0.3, 3.1)),
          threads: Math.max(24, Math.min(40, s.threads + Math.round((Math.random() - 0.5) * 3))),
          wakeups: Math.max(120, Math.min(400, s.wakeups + Math.round((Math.random() - 0.5) * 40))),
          time: new Date(),
        };
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return m;
}

/** Two-column tile grid with hairlines between cells, none on the outer edge. */
const grid =
  "grid grid-cols-2 [&>*:nth-child(odd)]:shadow-[inset_-0.5px_0_0_var(--separator)] [&>*:nth-child(n+3)]:border-t-[0.5px] [&>*:nth-child(n+3)]:border-separator";

const hhmmss = (d: Date) => d.toTimeString().slice(0, 8);

export function ActivityTab() {
  const m = useMetrics();
  const cpu = m.cpu.at(-1)!;
  const mem = m.mem.at(-1)!;
  const memPeak = Math.max(...m.mem);
  const cpuTone = cpu >= 80 ? "red" : cpu >= 50 ? "orange" : "green";
  return (
    <>
      <div className="group-box flex items-center gap-2.5 px-3 py-2.5">
        <AppIcon app={apps.trails!} size={28} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-body font-semibold text-label">{currentApp.name}</span>
          <span className="font-mono text-caption text-label-3">PID {currentApp.pid}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <span className="flex items-center gap-1.5 text-footnote font-semibold text-green">
            <StatusDot tone="green" live /> Live
          </span>
          <span className="font-mono text-caption2 text-label-3">Updated {hhmmss(m.time)}</span>
        </span>
      </div>

      <Gauge icon={<Cpu />} label="CPU" tone={cpuTone} value={`${cpu.toFixed(1)}%`}>
        <AreaChart data={m.cpu} max={100} tick={m.tick} height={72} />
      </Gauge>
      <Gauge icon={<MemoryStick />} label="Memory" tone="green" value={`${Math.round(mem)} MB`}>
        <AreaChart data={m.mem} min={Math.max(0, Math.min(...m.mem) - 40)} max={memPeak + 30} tick={m.tick} height={72} />
      </Gauge>

      <Section title="Counters">
        <div className={grid}>
          {[
            ["User CPU", `${(cpu * 0.78).toFixed(1)}%`],
            ["System CPU", `${(cpu * 0.22).toFixed(1)}%`],
            ["Peak footprint", `${Math.round(memPeak)} MB`],
            ["Resident memory", `${Math.round(mem * 1.42)} MB`],
            ["Threads", `${m.threads}`],
            ["Running", `${Math.max(1, Math.round(cpu / 12))}`],
            ["Disk read", `${(cpu * 0.9).toFixed(0)} KB/s`],
            ["Disk write", `${(cpu * 0.35).toFixed(0)} KB/s`],
            ["Wakeups", `${m.wakeups}/s`],
            ["Page-ins", `${Math.round(cpu / 4)}/s`],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 px-3 py-2">
              <span className="text-caption text-label-3">{k}</span>
              <span className="font-mono text-footnote font-medium tabular text-label">{v}</span>
            </div>
          ))}
        </div>
      </Section>

      <StreamSection m={m} />
    </>
  );
}

function Gauge({ icon, label, tone, value, children }: { icon: ReactNode; label: string; tone: "green" | "orange" | "red"; value: string; children: ReactNode }) {
  return (
    <div className="group-box flex flex-col gap-2 p-3">
      <div className="flex items-center gap-1.5 text-label-2 [&_svg]:size-[14px] [&_svg]:stroke-[2]">
        {icon}
        <span className="text-headline text-label">{label}</span>
        <StatusDot tone={tone} className="ml-auto" />
      </div>
      <RollingNumber value={value} className="font-display text-numeral text-label" />
      {children}
    </div>
  );
}

function stats(a: number[], f: (n: number) => string) {
  const avg = a.reduce((x, y) => x + y, 0) / a.length;
  return `${f(Math.min(...a))} · ${f(avg)} · ${f(Math.max(...a))}`;
}

function StreamSection({ m }: { m: ReturnType<typeof useMetrics> }) {
  const [mode, setMode] = useState<"performance" | "quality">("performance");
  const tiles = [
    { k: "Painted", v: `${m.fps.at(-1)!.toFixed(0)} fps`, d: m.fps, s: stats(m.fps, (n) => n.toFixed(0)) },
    { k: "Bitrate", v: `${(m.kbps.at(-1)! / 1000).toFixed(1)} Mbps`, d: m.kbps, s: stats(m.kbps, (n) => (n / 1000).toFixed(1)) },
    { k: "Jitter", v: `${m.jitter.at(-1)!.toFixed(1)} ms`, d: m.jitter, s: stats(m.jitter, (n) => n.toFixed(1)) },
    { k: "Decode", v: `${m.decode.at(-1)!.toFixed(1)} ms`, d: m.decode, s: stats(m.decode, (n) => n.toFixed(1)) },
  ];
  return (
    <Section
      title="Stream"
      accessory={
        <span className="flex items-center gap-1.5">
          <Badge tone="green" dot>
            Live
          </Badge>
          <Badge>H.264</Badge>
        </span>
      }
    >
      <div className="row flex items-center justify-between gap-2 px-3 py-2">
        <span className="font-mono text-caption text-label-2">1206×2622</span>
        <Segmented
          aria-label="Stream mode"
          size="sm"
          className="w-[176px]"
          value={mode}
          onChange={setMode}
          items={[
            { value: "performance", label: "Perf" },
            { value: "quality", label: "Quality" },
          ]}
        />
      </div>
      <div className={`row ${grid}`}>
        {tiles.map((t) => (
          <div key={t.k} className="flex flex-col gap-1 px-3 pt-2 pb-2.5">
            <span className="text-caption text-label-3">{t.k}</span>
            <span className="font-mono text-body font-semibold tabular text-label">{t.v}</span>
            <Sparkline data={t.d.slice(-24)} />
            <span className="font-mono text-caption2 tabular text-label-3">{t.s}</span>
          </div>
        ))}
      </div>
      <InfoRow label="Link" value="Clear" />
      <InfoRow label="Target bitrate" value="18.0 Mbps" />
      <InfoRow label="Max QP" value="32" />
      <InfoRow label="Queue" value="4 ms" />
      <InfoRow label="Keyframes" value="every 2 s" />
    </Section>
  );
}
