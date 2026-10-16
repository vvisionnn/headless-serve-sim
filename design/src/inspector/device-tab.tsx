import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  Bike,
  Camera,
  Car,
  Contrast,
  Eye,
  Footprints,
  ImagePlus,
  Keyboard,
  MapPin,
  Moon,
  Pause,
  Play,
  Signal,
  Smartphone,
  Snail,
  Square,
  SquareDashed,
  Sun,
  Volume2,
  Waves,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { TrailMap } from "../device/screens/trail-map";
import { trails } from "../lib/mock";
import { spring } from "../lib/motion";
import { useApp } from "../lib/store";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Stepper, TextField, ValueChip } from "../ui/field";
import { Disclosure, Row, Section } from "../ui/group";
import { RollingNumber } from "../ui/rolling-number";
import { Segmented } from "../ui/segmented";
import { Select } from "../ui/select";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";

const textSizes = ["Extra small", "Small", "Medium", "Large", "Extra large", "XX large", "XXX large"];

const colorFilters = [
  { value: "none", label: "None" },
  { value: "protanopia", label: "Red/Green (Protanopia)" },
  { value: "deuteranopia", label: "Green/Red (Deuteranopia)" },
  { value: "tritanopia", label: "Blue/Yellow (Tritanopia)" },
  { value: "grayscale", label: "Grayscale" },
];

const networks = [
  { value: "unset", label: "Unchanged" },
  { value: "hide", label: "Hidden" },
  { value: "wifi", label: "Wi‑Fi" },
  { value: "3g", label: "3G" },
  { value: "4g", label: "4G" },
  { value: "lte", label: "LTE" },
  { value: "lte-a", label: "LTE‑A" },
  { value: "lte+", label: "LTE+" },
  { value: "5g", label: "5G" },
  { value: "5g+", label: "5G+" },
  { value: "5g-uwb", label: "5G UW" },
  { value: "5g-uc", label: "5G UC" },
];

const batteryStates = [
  { value: "unset", label: "Unchanged" },
  { value: "charging", label: "Charging" },
  { value: "charged", label: "Charged" },
  { value: "discharging", label: "Discharging" },
];

export function DeviceTab() {
  return (
    <>
      <AppearanceSection />
      <AccessibilitySection />
      <ViewSection />
      <StatusBarDisclosure />
      <LocationDisclosure />
      <CameraDisclosure />
    </>
  );
}

function AppearanceSection() {
  const { simAppearance, set } = useApp();
  const [glass, setGlass] = useState<"clear" | "tinted">("clear");
  const [filter, setFilter] = useState("none");
  const [size, setSize] = useState(3);
  return (
    <Section title="Appearance">
      <Row label="Appearance">
        <Segmented
          aria-label="Appearance"
          className="w-[148px]"
          value={simAppearance}
          onChange={(v) => set({ simAppearance: v })}
          items={[
            { value: "light", label: "Light", icon: <Sun /> },
            { value: "dark", label: "Dark", icon: <Moon /> },
          ]}
        />
      </Row>
      <Row label="Liquid Glass">
        <Segmented
          aria-label="Liquid Glass"
          className="w-[148px]"
          value={glass}
          onChange={setGlass}
          items={[
            { value: "clear", label: "Clear" },
            { value: "tinted", label: "Tinted" },
          ]}
        />
      </Row>
      <Row label="Color filter">
        <Select label="Color filter" value={filter} onChange={setFilter} options={colorFilters} className="w-[148px] min-w-0" />
      </Row>
      <SliderRow label="Text size" value={textSizes[size]!}>
        <Slider
            label="Text size"
            value={size}
            min={0}
            max={6}
            step={1}
            ticks
            onChange={(v) => setSize(Math.round(v))}
            leading={<span className="w-3 text-center text-caption font-semibold">A</span>}
            trailing={<span className="w-3 text-center text-title3">A</span>}
          />
      </SliderRow>
    </Section>
  );
}

/** A row whose control is a full-width slider, live value on the label line. */
function SliderRow({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="row flex flex-col gap-2 px-3 pt-2.5 pb-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body font-medium text-label">{label}</span>
        <ValueChip>{value}</ValueChip>
      </div>
      {children}
    </div>
  );
}

function AccessibilitySection() {
  const [s, setS] = useState({ motion: false, contrast: false, borders: false, transparency: false, voiceover: false });
  const rows = [
    { key: "motion", label: "Reduce motion", icon: <Waves /> },
    { key: "contrast", label: "Increase contrast", icon: <Contrast /> },
    { key: "borders", label: "Show borders", icon: <SquareDashed /> },
    { key: "transparency", label: "Reduce transparency", icon: <Eye /> },
    { key: "voiceover", label: "VoiceOver", icon: <Volume2 /> },
  ] as const;
  return (
    <Section title="Accessibility">
      {rows.map((r) => (
        <Row key={r.key} label={r.label} icon={r.icon}>
          <Switch label={r.label} checked={s[r.key]} onChange={(v) => setS({ ...s, [r.key]: v })} />
        </Row>
      ))}
    </Section>
  );
}

function ViewSection() {
  const [bezel, setBezel] = useState(true);
  const [scale, setScale] = useState(100);
  const [slow, setSlow] = useState(false);
  const [capture, setCapture] = useState(true);
  return (
    <Section
      title="View"
      accessory={
        <Button variant="plain" size="sm" onClick={() => setScale(100)}>
          Zoom to fit
        </Button>
      }
    >
      <Row label="Show bezel" icon={<Smartphone />}>
        <Switch label="Show bezel" checked={bezel} onChange={setBezel} />
      </Row>
      <SliderRow label="Scale" value={`${scale}%`}>
        <Slider label="Scale" value={scale} min={50} max={200} step={5} onChange={(v) => setScale(Math.round(v))} />
      </SliderRow>
      <Row label="Slow animations" icon={<Snail />}>
        <Switch label="Slow animations" checked={slow} onChange={setSlow} />
      </Row>
      <Row label="Capture keyboard" detail="Forward keys while this page is focused" icon={<Keyboard />}>
        <Switch label="Capture keyboard" checked={capture} onChange={setCapture} />
      </Row>
    </Section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <span className="text-body font-medium text-label">{label}</span>
      {children}
    </div>
  );
}

const keynote = { time: "9:41", network: "5g", cell: 4, wifi: 3, operator: "", battery: "charged", level: 100 };
const blank = { time: "", network: "unset", cell: 4, wifi: 3, operator: "", battery: "unset", level: 100 };

function StatusBarDisclosure() {
  const { toast } = useApp();
  const [v, setV] = useState(blank);
  const up = (p: Partial<typeof v>) => setV({ ...v, ...p });
  return (
    <Disclosure title="Status bar" icon={<Signal />}>
      <p className="text-caption text-label-3">Overrides apply to apps using the standard status bar and reset on reboot.</p>
      <Field label="Time">
        <TextField mono placeholder="9:41" value={v.time} onChange={(e) => up({ time: e.target.value })} className="w-[132px]" />
      </Field>
      <Field label="Network">
        <Select label="Network" value={v.network} onChange={(network) => up({ network })} options={networks} />
      </Field>
      <Field label="Cellular bars">
        <Stepper label="Cellular bars" value={v.cell} min={0} max={4} onChange={(cell) => up({ cell })} />
      </Field>
      <Field label="Wi‑Fi bars">
        <Stepper label="Wi‑Fi bars" value={v.wifi} min={0} max={3} onChange={(wifi) => up({ wifi })} />
      </Field>
      <Field label="Operator">
        <TextField placeholder="Carrier" maxLength={32} value={v.operator} onChange={(e) => up({ operator: e.target.value })} className="w-[132px]" />
      </Field>
      <Field label="Battery">
        <Select label="Battery state" value={v.battery} onChange={(battery) => up({ battery })} options={batteryStates} />
      </Field>
      <div className="flex flex-col gap-1.5">
        <Field label="Battery level">
          <ValueChip>{v.level}%</ValueChip>
        </Field>
        <Slider label="Battery level" value={v.level} min={0} max={100} step={1} onChange={(level) => up({ level: Math.round(level) })} />
      </div>
      <div className="flex items-center gap-1.5 pt-1">
        <Button variant="secondary" size="md" onClick={() => setV(keynote)}>
          9:41 Keynote
        </Button>
        <span className="flex-1" />
        <Button variant="plain" size="md" onClick={() => setV(blank)}>
          Reset
        </Button>
        <Button variant="primary" size="md" onClick={() => toast({ title: "Status bar updated", detail: "Applied to iPhone 17 Pro", tone: "success" })}>
          Apply
        </Button>
      </div>
    </Disclosure>
  );
}

const SPEEDS = [1, 2, 5, 20];
const MODES = { walk: 1.4, run: 3, cycle: 5.5, drive: 13.9 } as const;

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function LocationDisclosure() {
  const [trail, setTrail] = useState("apple-park");
  const [mode, setMode] = useState<keyof typeof MODES>("run");
  const [speed, setSpeed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const t = trails.find((x) => x.id === trail)!;
  const meters = Math.min(t.km * 1000, elapsed * MODES[mode]);
  const progress = meters / (t.km * 1000);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setElapsed((e) => e + 0.25 * SPEEDS[speed]!), 250);
    return () => clearInterval(id);
  }, [playing, speed]);
  useEffect(() => {
    if (progress >= 1) setPlaying(false);
  }, [progress]);

  const pace = MODES[mode] > 7 ? `${(MODES[mode] * 3.6).toFixed(0)} km/h` : `${fmtTime(1000 / MODES[mode])}/km`;
  const status = playing ? `${(meters / 1000).toFixed(2)} km · ${fmtTime(elapsed)}` : `${t.km.toFixed(1)} km`;

  return (
    <Disclosure
      title="Location"
      icon={<MapPin />}
      status={
        <span className="flex items-center gap-1.5">
          {playing && <span className="live-dot size-1.5 rounded-full bg-green text-green" />}
          <ValueChip>{status}</ValueChip>
        </span>
      }
    >
      <Select
        label="Trail"
        value={trail}
        onChange={(v) => {
          setTrail(v);
          setElapsed(0);
          setPlaying(false);
        }}
        options={trails.map((x) => ({ value: x.id, label: x.name, hint: x.place }))}
        className="w-full"
      />
      <div className="relative h-[150px] overflow-hidden rounded-[12px] shadow-[inset_0_0_0_0.5px_var(--separator)]">
        <TrailMap key={trail} id={trail} dark={false} width={272} height={150} animate />
        <motion.span
          className="absolute size-3 rounded-full bg-white shadow-[0_0_0_3px_rgba(19,163,127,0.9),0_2px_6px_rgba(0,0,0,0.3)]"
          initial={false}
          animate={{ left: `calc(${10 + progress * 80}% - 6px)`, top: `calc(${50 + Math.sin(progress * 9) * 18}% - 6px)`, opacity: elapsed > 0 ? 1 : 0 }}
          transition={spring.ui}
        />
        <span className="absolute top-2 left-2 rounded-full bg-white/85 px-2 py-0.5 font-mono text-caption2 font-semibold text-black/70 backdrop-blur">
          ↑ {t.gain} m
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {[
          { k: "Distance", v: meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`, roll: true },
          { k: "Pace", v: pace },
          { k: "Elapsed", v: fmtTime(elapsed) },
        ].map((s) => (
          <div key={s.k} className="flex flex-col gap-0.5 rounded-[10px] bg-fill-3 px-2.5 py-2">
            <span className="text-caption text-label-3">{s.k}</span>
            <span className="font-mono text-footnote font-semibold text-label">{s.roll && playing ? <RollingNumber value={s.v} /> : s.v}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Segmented
          aria-label="Transport"
          size="sm"
          className="flex-1"
          value={mode}
          onChange={setMode}
          items={[
            { value: "walk", icon: <Footprints />, title: "Walk" },
            { value: "run", icon: <Activity />, title: "Run" },
            { value: "cycle", icon: <Bike />, title: "Cycle" },
            { value: "drive", icon: <Car />, title: "Drive" },
          ]}
        />
        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
          transition={spring.snappy}
          onClick={() => setSpeed((s) => (s + 1) % SPEEDS.length)}
          aria-label="Playback speed"
          className="h-6 min-w-10 rounded-[7px] bg-fill-2 px-2 font-mono text-caption font-semibold tabular text-label hover:bg-fill"
        >
          {SPEEDS[speed]}×
        </motion.button>
      </div>
      <div className="flex gap-1.5">
        <Button
          variant="primary"
          size="md"
          className="flex-1"
          icon={playing ? <Pause /> : <Play />}
          onClick={() => {
            if (progress >= 1) setElapsed(0);
            setPlaying(!playing);
          }}
        >
          {playing ? "Pause" : elapsed > 0 && progress < 1 ? "Resume" : "Play route"}
        </Button>
        <Button
          variant="secondary"
          size="md"
          icon={<Square />}
          disabled={elapsed === 0}
          onClick={() => {
            setPlaying(false);
            setElapsed(0);
          }}
        >
          Stop
        </Button>
      </div>
    </Disclosure>
  );
}

const sources = [
  { value: "pattern", label: "Test pattern" },
  { value: "facetime", label: "FaceTime HD Camera" },
  { value: "continuity", label: "iPhone Continuity Camera" },
  { value: "file", label: "File…" },
];

function CameraDisclosure() {
  const [media, setMedia] = useState(false);
  const [source, setSource] = useState("pattern");
  const [mirror, setMirror] = useState<"auto" | "on" | "off">("auto");
  const [active, setActive] = useState(false);
  return (
    <Disclosure title="Camera" icon={<Camera />} status={active ? <Badge tone="green" dot>Active</Badge> : <Badge>Ready</Badge>}>
      <p className="text-caption text-label-3">Feeds an image, video or webcam into the app's camera. Injecting relaunches Trails.</p>
      <AnimatePresence mode="popLayout" initial={false}>
        {media ? (
          <motion.div
            key="media"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={spring.ui}
            className="flex items-center gap-2.5 rounded-[12px] bg-fill-3 p-2 shadow-[inset_0_0_0_0.5px_var(--separator)]"
          >
            <span className="h-10 w-14 shrink-0 rounded-[7px]" style={{ background: "linear-gradient(160deg,#7ec8ff,#ffd59a 60%,#f2a65a)" }} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body font-medium text-label">beach.mov</span>
              <span className="font-mono text-caption2 text-label-3">VIDEO · 0:12 · 1920×1080</span>
            </span>
            <button type="button" aria-label="Clear source" onClick={() => setMedia(false)} className="flex size-6 items-center justify-center rounded-full text-label-3 hover:bg-fill-2 hover:text-label">
              <X className="size-3.5" strokeWidth={2.25} />
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="drop"
            type="button"
            onClick={() => setMedia(true)}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            whileTap={{ scale: 0.98 }}
            transition={spring.ui}
            className="flex h-[72px] flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-label-4 text-label-2 transition-colors hover:border-label-3 hover:bg-fill-3"
          >
            <ImagePlus className="size-[18px]" strokeWidth={1.75} />
            <span className="text-footnote font-medium">Choose or drop media</span>
          </motion.button>
        )}
      </AnimatePresence>
      <Field label="Source">
        <Select label="Camera source" value={source} onChange={setSource} options={sources} className="w-[148px] min-w-0" />
      </Field>
      <Field label="Mirror">
        <Segmented
          aria-label="Mirror"
          size="sm"
          className="w-[148px]"
          value={mirror}
          onChange={setMirror}
          items={[
            { value: "auto", label: "Auto" },
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
      </Field>
      <Button variant={active ? "secondary" : "primary"} size="md" block icon={active ? <Square /> : <Play />} onClick={() => setActive(!active)}>
        {active ? "Stop" : "Inject into Trails"}
      </Button>
    </Disclosure>
  );
}
