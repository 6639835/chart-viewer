"use client";

import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

type Options = {
  enabled?: boolean;
  timeoutMs?: number;
};

export function useAutoHideScrollbar<T extends HTMLElement>(
  elementRef: RefObject<T | null>,
  options: Options = {}
) {
  const { enabled = true, timeoutMs = 1000 } = options;
  const [isScrolling, setIsScrolling] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearHideTimeout = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    if (!enabled) {
      clearHideTimeout();
      setIsScrolling(false);
      return;
    }

    const element = elementRef.current;
    if (!element) return;

    const onScroll = () => {
      setIsScrolling(true);

      clearHideTimeout();

      timeoutRef.current = setTimeout(
        () => {
          setIsScrolling(false);
          timeoutRef.current = null;
        },
        Math.max(timeoutMs, 0)
      );
    };

    element.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      element.removeEventListener("scroll", onScroll);
      clearHideTimeout();
    };
  }, [elementRef, enabled, timeoutMs]);

  return isScrolling;
}
