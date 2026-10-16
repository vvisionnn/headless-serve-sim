/** Mock data for the design preview. Shapes mirror the real client types. */

export type DeviceKind = "iphone" | "ipad" | "watch";
export type SimState = "live" | "booted" | "shutdown" | "booting";

export interface Sim {
  udid: string;
  name: string;
  kind: DeviceKind;
  runtime: string;
  state: SimState;
  port?: number;
}

export const sims: Sim[] = [
  { udid: "4C374F09-B922-4B07-9C0F-7E011736FD4D", name: "iPhone 17 Pro", kind: "iphone", runtime: "iOS 26.1", state: "live", port: 3101 },
  { udid: "1F725059-290B-4622-AC77-698FC660DA11", name: "iPad Pro 13-inch (M5)", kind: "ipad", runtime: "iOS 26.1", state: "live", port: 3102 },
  { udid: "9A0D7E12-35C1-4B8E-A2F0-1C55D0B3E7A4", name: "Apple Watch Ultra 3", kind: "watch", runtime: "watchOS 26.1", state: "live", port: 3103 },
  { udid: "D2B71C3A-0E55-4F7A-9B21-8C4A6E0F1D92", name: "iPhone Air", kind: "iphone", runtime: "iOS 26.1", state: "booted" },
  { udid: "7E3F2A90-61CB-4D18-8F4E-2B9A0C7D5E13", name: "iPhone 17", kind: "iphone", runtime: "iOS 26.1", state: "shutdown" },
  { udid: "B81E5C07-2A3D-4E96-A0F1-5D7C9B2E4F68", name: "iPhone 16e", kind: "iphone", runtime: "iOS 18.6", state: "shutdown" },
  { udid: "C4A92D1E-7B05-4F3C-8E62-0D1F9A3B7C25", name: "iPad mini (A17 Pro)", kind: "ipad", runtime: "iOS 18.6", state: "shutdown" },
];

export const currentApp = {
  name: "Trails",
  bundleId: "com.acme.trails",
  version: "2.4 (318)",
  minOS: "iOS 17.0",
  executable: "Trails",
  pid: 48213,
  reactNative: true,
  path: "~/Library/Developer/CoreSimulator/Devices/4C374F09-B922-4B07-9C0F-7E011736FD4D/data/Containers/Bundle/Application/2F1D7C3A-9E0B-4A6F-B5D8-31C7E2A0F94B/Trails.app",
};

export const permissions = [
  { key: "camera", label: "Camera", value: "allow" },
  { key: "microphone", label: "Microphone", value: "unset" },
  { key: "photos", label: "Photos", value: "allow" },
  { key: "photos-add", label: "Add to Photos", value: "unset" },
  { key: "contacts", label: "Contacts", value: "deny" },
  { key: "calendar", label: "Calendar", value: "unset" },
  { key: "reminders", label: "Reminders", value: "unset" },
  { key: "location", label: "Location", value: "allow" },
  { key: "location-always", label: "Location (Always)", value: "unset" },
  { key: "notifications", label: "Notifications", value: "allow" },
  { key: "motion", label: "Motion", value: "unset" },
  { key: "media-library", label: "Media Library", value: "unset" },
  { key: "siri", label: "Siri", value: "deny" },
] as const;

export const userDefaults = [
  { key: "hasOnboarded", type: "bool", value: true },
  { key: "units", type: "string", value: "metric" },
  { key: "lastSyncAt", type: "float", value: 1760668212.4 },
  { key: "launchCount", type: "int", value: 37 },
  { key: "featureFlags", type: "json", value: '{"offlineMaps":true,"heatmap":false}' },
] as const;

export type LogLevel = "default" | "info" | "debug" | "error" | "fault";
export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  process: string;
  subsystem?: string;
  message: string;
}

export const logs: LogEntry[] = [
  { id: 1, time: "10:41:02.118204", level: "info", process: "Trails", subsystem: "com.facebook.react.log:javascript", message: "Running \"main\" with {\"rootTag\":1,\"initialProps\":{},\"fabric\":true}" },
  { id: 2, time: "10:41:02.241557", level: "default", process: "Trails", subsystem: "com.acme.trails:sync", message: "Sync started · 14 trails, 3 pending uploads" },
  { id: 3, time: "10:41:02.390012", level: "debug", process: "Trails", subsystem: "com.acme.trails:maps", message: "Tile cache warm: 212 tiles (18.4 MB) in 41 ms" },
  { id: 4, time: "10:41:02.512870", level: "default", process: "locationd", subsystem: "com.apple.locationd.Core:Client", message: "{\"msg\":\"client authorization\", \"bundleId\":\"com.acme.trails\", \"status\":\"WhenInUse\"}" },
  { id: 5, time: "10:41:03.004311", level: "error", process: "Trails", subsystem: "com.acme.trails:network", message: "GET https://api.acme.dev/v2/trails/apple-park-loop/elevation failed: The request timed out. (NSURLErrorDomain -1001)" },
  { id: 6, time: "10:41:03.118940", level: "info", process: "Trails", subsystem: "com.acme.trails:network", message: "Retrying in 2.0 s (attempt 2 of 5)" },
  { id: 7, time: "10:41:03.774102", level: "default", process: "SpringBoard", subsystem: "com.apple.SpringBoard:Scene", message: "Scene update for com.acme.trails: foreground, active" },
  { id: 8, time: "10:41:04.201559", level: "debug", process: "Trails", subsystem: "com.acme.trails:render", message: "TrailList commit 8.2 ms · 24 rows · 0 dropped frames" },
  { id: 9, time: "10:41:05.118204", level: "info", process: "Trails", subsystem: "com.acme.trails:sync", message: "Sync finished in 2.87 s" },
  { id: 10, time: "10:41:05.660013", level: "fault", process: "Trails", subsystem: "com.acme.trails:db", message: "SQLite busy timeout exceeded on trails.sqlite (lock held 5012 ms)" },
  { id: 11, time: "10:41:06.004981", level: "default", process: "backboardd", subsystem: "com.apple.backboard:hid", message: "Touch began at (196.0, 512.3) · digitizer 0" },
  { id: 12, time: "10:41:06.088410", level: "info", process: "Trails", subsystem: "com.acme.trails:nav", message: "Navigate → TrailDetail {id: \"golden-gate-crossing\"}" },
];

export const inputEvents = [
  { time: "10:41:06.004", message: "Tap (196, 512)" },
  { time: "10:41:07.391", message: "Drag (201, 640) → (198, 288) · 412 ms" },
  { time: "10:41:09.120", message: "Pinch 1.00× → 1.84× at (196, 430)" },
  { time: "10:41:11.882", message: "Type \"golden gate\"" },
  { time: "10:41:12.540", message: "Key down ⏎" },
  { time: "10:41:14.002", message: "Button home" },
];

export interface AxNode {
  id: string;
  role: string;
  label?: string;
  frame: [number, number, number, number];
  children?: AxNode[];
}

export const axTree: AxNode = {
  id: "app",
  role: "Application",
  label: "Trails",
  frame: [0, 0, 402, 874],
  children: [
    {
      id: "nav",
      role: "NavigationBar",
      label: "Trails",
      frame: [0, 54, 402, 96],
      children: [
        { id: "title", role: "StaticText", label: "Trails", frame: [20, 98, 120, 41] },
        { id: "profile", role: "Button", label: "Profile", frame: [342, 60, 44, 44] },
      ],
    },
    { id: "search", role: "SearchField", label: "Search trails", frame: [16, 156, 370, 36] },
    {
      id: "list",
      role: "CollectionView",
      frame: [0, 204, 402, 586],
      children: [
        { id: "c1", role: "Cell", label: "Apple Park Loop, 2.7 km, Easy", frame: [16, 212, 370, 168] },
        { id: "c2", role: "Cell", label: "Golden Gate Crossing, 5.3 km, Moderate", frame: [16, 392, 370, 168] },
        { id: "c3", role: "Cell", label: "Mt. Tam Ridge, 11.8 km, Hard", frame: [16, 572, 370, 168] },
      ],
    },
    {
      id: "tabs",
      role: "TabBar",
      frame: [0, 790, 402, 84],
      children: [
        { id: "t1", role: "Button", label: "Explore", frame: [24, 798, 112, 54] },
        { id: "t2", role: "Button", label: "Saved", frame: [145, 798, 112, 54] },
        { id: "t3", role: "Button", label: "Profile", frame: [266, 798, 112, 54] },
      ],
    },
  ],
};

export const trails = [
  { id: "apple-park", name: "Apple Park Loop", place: "Cupertino · flat ring road", km: 2.7, gain: 12 },
  { id: "golden-gate", name: "Golden Gate Crossing", place: "San Francisco · bridge span", km: 5.3, gain: 68 },
  { id: "mt-tam", name: "Mt. Tam Ridge", place: "Mill Valley · ridge climb", km: 11.8, gain: 612 },
  { id: "reservoir", name: "Reservoir Loop", place: "Los Gatos · rolling", km: 7.4, gain: 140 },
  { id: "pch", name: "Pacific Coast Hwy", place: "Big Sur · coastal", km: 18.2, gain: 380 },
];

export const webTargets = [
  { app: "Safari", title: "WWDC26 — Apple Developer", url: "https://developer.apple.com/wwdc26/" },
  { app: "Trails", title: "Trail guide", url: "https://trails.acme.dev/guide/apple-park-loop" },
];
