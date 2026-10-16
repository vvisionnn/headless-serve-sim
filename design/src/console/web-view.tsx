import { useState } from "react";
import { cn } from "../lib/cn";
import { webTargets } from "../lib/mock";
import { Select } from "../ui/select";

type Line = { d: number; html: React.ReactNode; sel?: boolean };

const T = ({ children }: { children: React.ReactNode }) => <span className="text-label">{children}</span>;
const A = ({ n, v }: { n: string; v: string }) => (
  <>
    {" "}
    <span className="text-label-2">{n}</span>
    <span className="text-label-3">=</span>
    <span className="text-green">"{v}"</span>
  </>
);
const P = ({ children }: { children: React.ReactNode }) => <span className="text-label-3">{children}</span>;

const lines: Line[] = [
  { d: 0, html: <><P>&lt;!</P><T>DOCTYPE html</T><P>&gt;</P></> },
  { d: 0, html: <><P>&lt;</P><T>html</T><A n="lang" v="en" /><P>&gt;</P></> },
  { d: 1, html: <><P>▸ &lt;</P><T>head</T><P>&gt;…&lt;/</P><T>head</T><P>&gt;</P></> },
  { d: 1, html: <><P>▾ &lt;</P><T>body</T><A n="class" v="guide" /><P>&gt;</P></> },
  { d: 2, html: <><P>▾ &lt;</P><T>header</T><A n="class" v="hero" /><P>&gt;</P></> },
  { d: 3, html: <><P>&lt;</P><T>h1</T><P>&gt;</P><span className="text-label">Apple Park Loop</span><P>&lt;/</P><T>h1</T><P>&gt;</P></>, sel: true },
  { d: 3, html: <><P>&lt;</P><T>p</T><A n="class" v="meta" /><P>&gt;</P><span className="text-label">2.7 km · Easy</span><P>&lt;/</P><T>p</T><P>&gt;</P></> },
  { d: 2, html: <><P>&lt;/</P><T>header</T><P>&gt;</P></> },
  { d: 2, html: <><P>▸ &lt;</P><T>section</T><A n="id" v="map" /><P>&gt;…&lt;/</P><T>section</T><P>&gt;</P></> },
  { d: 2, html: <><P>▸ &lt;</P><T>ol</T><A n="class" v="waypoints" /><P>&gt;…&lt;/</P><T>ol</T><P>&gt;</P></> },
  { d: 2, html: <><P>&lt;</P><T>script</T><A n="src" v="/guide.js" /><P>&gt;&lt;/</P><T>script</T><P>&gt;</P></> },
  { d: 1, html: <><P>&lt;/</P><T>body</T><P>&gt;</P></> },
  { d: 0, html: <><P>&lt;/</P><T>html</T><P>&gt;</P></> },
];

const rules = [
  { sel: "element.style", props: [] as [string, string][] },
  { sel: ".hero h1", src: "guide.css:14", props: [["font", "700 28px/1.15 -apple-system"], ["letter-spacing", "-0.02em"], ["margin", "0 0 6px"]] as [string, string][] },
  { sel: "h1", src: "user agent", props: [["display", "block"], ["font-size", "2em"]] as [string, string][] },
];

export function WebView() {
  const [target, setTarget] = useState(webTargets[1]!.url);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b-[0.5px] border-separator px-2.5">
        <Select
          label="Inspect target"
          value={target}
          onChange={setTarget}
          options={webTargets.map((t) => ({ value: t.url, label: t.title, hint: `${t.app} · ${t.url}` }))}
          className="min-w-[220px]"
        />
        <div className="ml-2 flex items-center gap-0.5">
          {["Elements", "Console", "Network", "Sources"].map((t, i) => (
            <span key={t} className={cn("rounded-[6px] px-2 py-1 text-footnote font-medium", i === 0 ? "bg-fill-2 text-label" : "text-label-2 hover:bg-fill-3")}>
              {t}
            </span>
          ))}
        </div>
        <span className="ml-auto truncate font-mono text-caption text-label-3">{target}</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="thin-scrollbar min-w-0 flex-1 overflow-auto py-2 font-mono text-[11.5px]/[18px]">
          {lines.map((l, i) => (
            <div key={i} className={cn("pr-3 whitespace-nowrap", l.sel ? "bg-fill-2" : "hover:bg-fill-3")} style={{ paddingLeft: 12 + l.d * 14 }}>
              {l.html}
              {l.sel && <span className="text-label-3"> == $0</span>}
            </div>
          ))}
        </div>
        <aside className="thin-scrollbar w-[280px] shrink-0 overflow-y-auto border-l-[0.5px] border-separator py-2 font-mono text-[11.5px]/[18px]">
          {rules.map((r) => (
            <div key={r.sel} className="border-b-[0.5px] border-separator px-3 py-1.5 last:border-0">
              <div className="flex justify-between">
                <span className="text-label">{r.sel} {"{"}</span>
                {r.src && <span className="text-label-3">{r.src}</span>}
              </div>
              {r.props.map(([k, v]) => (
                <div key={k} className="pl-3">
                  <span className="text-label-2">{k}</span>
                  <span className="text-label-3">: </span>
                  <span className="text-label">{v}</span>
                  <span className="text-label-3">;</span>
                </div>
              ))}
              <span className="text-label">{"}"}</span>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
