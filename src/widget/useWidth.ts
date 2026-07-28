/**
 * Track the widget's own rendered width.
 *
 * The map is suppressed below a threshold, and the honest measure of "too
 * narrow" is how wide this element actually is. `hostContext.containerDimensions`
 * is advisory and may be absent or stale; the element cannot be.
 */

import { useEffect, useState, type RefObject } from "react";

export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    setWidth(element.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
