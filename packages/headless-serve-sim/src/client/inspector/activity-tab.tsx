import { StreamStats } from "../components/connection-stats-panel";
import { MetricsDashboard } from "../components/metrics-bar";
import { useAppMetrics } from "../hooks/use-app-metrics";
import type { InspectorProps } from "./types";

/** How the app and the stream are performing: app gauges first, then the stream. */
export function ActivityTab(props: InspectorProps) {
  const metrics = useAppMetrics(props.metricsEndpoint, props.streaming);
  return (
    <>
      <MetricsDashboard stream={metrics} />
      <StreamStats {...props.stream} />
    </>
  );
}
