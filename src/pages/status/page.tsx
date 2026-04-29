import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  ServerCrash,
  Wifi,
  XCircle,
} from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ServiceStatus = "up" | "degraded" | "down";

interface ServiceCheck {
  name: string;
  status: ServiceStatus;
  latencyMs: number | null;
  error?: string;
}

interface StatusResponse {
  status: ServiceStatus;
  timestamp: string;
  uptime: number;
  services: ServiceCheck[];
}

function overallColor(status: ServiceStatus) {
  if (status === "up") return "emerald";
  if (status === "degraded") return "amber";
  return "rose";
}

function StatusIcon({ status }: { status: ServiceStatus }) {
  if (status === "up") return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
  if (status === "degraded") return <AlertTriangle className="h-5 w-5 text-amber-400" />;
  return <XCircle className="h-5 w-5 text-rose-400" />;
}

function LatencyBar({ latencyMs }: { latencyMs: number | null }) {
  if (latencyMs === null) return <span className="text-xs text-slate-500">—</span>;
  const color = latencyMs < 300 ? "bg-emerald-400" : latencyMs < 1000 ? "bg-amber-400" : "bg-rose-400";
  const width = Math.min(100, (latencyMs / 2000) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${width}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-400">{latencyMs} ms</span>
    </div>
  );
}

function ServiceRow({ service }: { service: ServiceCheck }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4">
      <StatusIcon status={service.status} />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-white">{service.name}</p>
        {service.error && (
          <p className="mt-0.5 text-xs text-rose-300 truncate">{service.error}</p>
        )}
      </div>
      <LatencyBar latencyMs={service.latencyMs} />
      <Badge
        className={
          service.status === "up"
            ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
            : service.status === "degraded"
              ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
              : "border-rose-300/30 bg-rose-300/10 text-rose-100"
        }
      >
        {service.status}
      </Badge>
    </div>
  );
}

function UptimeStat({ seconds }: { seconds: number }) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return (
    <span className="tabular-nums">
      {h > 0 ? `${h}h ` : ""}
      {m > 0 ? `${m}m ` : ""}
      {s}s
    </span>
  );
}

export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const json = (await res.json()) as StatusResponse;
        setData(json);
      }
    } finally {
      setLoading(false);
      setLastChecked(new Date());
    }
  };

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), 30_000);
    return () => clearInterval(interval);
  }, []);

  const color = data ? overallColor(data.status) : "slate";

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_60%_40%_at_0%_0%,rgba(34,211,238,0.08),transparent),linear-gradient(180deg,#080b0f_0%,#0d1117_50%,#080b0f_100%)] text-white">
      <Navigation />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-200/10 text-cyan-100">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-white">Service Status</h1>
            <p className="text-xs text-slate-400">Live health of Stellar RPC, Horizon, and Unlock service.</p>
          </div>
        </div>

        {/* Overall banner */}
        {data && (
          <div
            className={`mt-6 flex items-center gap-4 rounded-2xl border px-6 py-5 ${
              color === "emerald"
                ? "border-emerald-300/25 bg-emerald-300/10"
                : color === "amber"
                  ? "border-amber-300/25 bg-amber-300/10"
                  : "border-rose-300/25 bg-rose-300/10"
            }`}
          >
            {data.status === "up" ? (
              <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-400" />
            ) : data.status === "degraded" ? (
              <AlertTriangle className="h-8 w-8 shrink-0 text-amber-400" />
            ) : (
              <ServerCrash className="h-8 w-8 shrink-0 text-rose-400" />
            )}
            <div>
              <p className={`text-lg font-semibold ${
                color === "emerald" ? "text-emerald-100" : color === "amber" ? "text-amber-100" : "text-rose-100"
              }`}>
                {data.status === "up"
                  ? "All systems operational"
                  : data.status === "degraded"
                    ? "Some systems are degraded"
                    : "Outage detected"}
              </p>
              <p className="text-sm text-slate-400">
                Last checked: {lastChecked?.toLocaleTimeString() ?? "—"}
              </p>
            </div>
            <Button
              variant="outline"
              className="ml-auto h-9 border-white/15 bg-white/[0.03] text-slate-300 hover:bg-white/10"
              onClick={() => void fetchStatus()}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        )}

        {/* Service list */}
        <section className="mt-6 space-y-3">
          <h2 className="text-xs uppercase tracking-[0.2em] text-slate-500">Services</h2>
          {loading && !data ? (
            <div className="flex items-center gap-3 py-10 text-slate-400">
              <RefreshCw className="h-5 w-5 animate-spin" />
              Checking service health…
            </div>
          ) : data ? (
            data.services.map((service) => (
              <ServiceRow key={service.name} service={service} />
            ))
          ) : (
            <p className="text-sm text-slate-400">Could not load status.</p>
          )}
        </section>

        {/* Meta */}
        {data && (
          <div className="mt-8 flex flex-wrap gap-6 rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4 text-sm text-slate-400">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-cyan-200" />
              Uptime: <span className="text-white"><UptimeStat seconds={data.uptime} /></span>
            </div>
            <div className="flex items-center gap-2">
              <Wifi className="h-4 w-4 text-cyan-200" />
              Auto-refreshes every 30 s
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
