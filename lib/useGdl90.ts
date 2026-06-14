"use client";

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { OwnshipPosition } from "@/lib/gdl90";
import { startGdl90Listener, stopGdl90Listener } from "@/lib/tauriClient";

const STALE_TIMEOUT_MS = 10_000;

export function useGdl90(port: number | undefined) {
  const [position, setPosition] = useState<OwnshipPosition | null>(null);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const effectivePort = port ?? 0;

    if (effectivePort === 0) {
      setPosition(null);
      void stopGdl90Listener().catch(() => {});
      return;
    }

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const setup = async () => {
      try {
        await startGdl90Listener(effectivePort);
      } catch (err) {
        console.warn("[GDL90] Could not start listener:", err);
        return;
      }

      if (cancelled) return;

      const dispose = await listen<OwnshipPosition>("gdl90-position", (event) => {
        setPosition(event.payload);

        if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
        staleTimerRef.current = setTimeout(() => {
          setPosition(null);
          staleTimerRef.current = null;
        }, STALE_TIMEOUT_MS);
      });

      // The component may have unmounted while `listen` was pending; if so,
      // tear down immediately so we don't leak the event handler.
      if (cancelled) {
        dispose();
        return;
      }
      unlisten = dispose;
    };

    void setup();

    return () => {
      cancelled = true;
      if (staleTimerRef.current) {
        clearTimeout(staleTimerRef.current);
        staleTimerRef.current = null;
      }
      unlisten?.();
      void stopGdl90Listener().catch(() => {});
    };
  }, [port]);

  return position;
}
