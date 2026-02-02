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
    if (!enabled) return;

    const element = elementRef.current;
    if (!element) return;

    const onScroll = () => {
      setIsScrolling(true);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, timeoutMs);
    };

    element.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      element.removeEventListener("scroll", onScroll);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [elementRef, enabled, timeoutMs]);

  return isScrolling;
}
