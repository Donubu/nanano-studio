"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";

const POLL_INTERVAL = 15000;

export function DeploymentBanner() {
  const [deployment, setDeployment] = useState<{
    active: boolean;
    startedAt: number;
    estimatedSeconds: number;
  } | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const checkDeployment = useCallback(async () => {
    try {
      const res = await fetch("/api/health/deployment");
      if (res.ok) {
        const data = await res.json();
        if (data.active) {
          setDeployment(data);
        } else {
          setDeployment(null);
        }
      }
    } catch {
      // Silently ignore
    }
  }, []);

  useEffect(() => {
    checkDeployment();
    const interval = setInterval(checkDeployment, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [checkDeployment]);

  useEffect(() => {
    if (!deployment?.active) return;
    const updateElapsed = () => {
      const now = Math.floor(Date.now() / 1000);
      setElapsed(now - deployment.startedAt);
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [deployment]);

  if (!deployment?.active) return null;

  // If elapsed exceeds estimate, extend by 1 minute visually
  const effectiveEstimate = elapsed >= deployment.estimatedSeconds
    ? deployment.estimatedSeconds + 60 * (1 + Math.floor((elapsed - deployment.estimatedSeconds) / 60))
    : deployment.estimatedSeconds;

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}:${sec.toString().padStart(2, "0")}` : `${sec}s`;
  };

  return (
    <div className="fixed top-3 right-3 z-50 bg-amber-500/95 text-amber-950 pl-3 pr-4 py-2 rounded-lg shadow-lg backdrop-blur-sm">
      <div className="flex items-center gap-2 text-xs">
        <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
        <div className="leading-tight">
          <div className="font-semibold">Actualizando sistema</div>
          <div className="text-amber-900/80">
            Est. {fmt(elapsed)} / ~{fmt(effectiveEstimate)}
          </div>
        </div>
      </div>
    </div>
  );
}
