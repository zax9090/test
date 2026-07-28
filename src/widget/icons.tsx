/**
 * The icon set.
 *
 * The supplied `icons.pdf` turned out to be a blank page, so these are drawn
 * from the grammar the brief states — see docs/stage0-conflicts.md (C3).
 *
 * Grammar:
 *   solid stroke = decided        dashed stroke = not decided
 *   square       = a value        circle        = a person confirming
 *
 * The three status marks read as one scale: a full core, a half core, then an
 * empty dashed box. Shape carries the meaning, so nothing depends on colour —
 * which is what lets the whole set inherit `currentColor` and sit correctly in
 * either host theme.
 *
 * 24 grid, stroke 2, `currentColor`. Only 14px and 20px are offered: the dash
 * pattern is tuned for those and goes ragged at other sizes.
 */

import type { JSX } from "react";

export type IconName =
  | "i-set"
  | "i-unset"
  | "i-partial"
  | "i-copy"
  | "i-link"
  | "i-more"
  | "i-less"
  | "i-clear";

/** The only two sizes the dash pattern stays even at. */
export type IconSize = 14 | 20;

interface IconProps {
  name: IconName;
  size?: IconSize;
  className?: string;
}

const BOX = { x: 4, y: 4, width: 16, height: 16, rx: 2 } as const;

const GLYPHS: Record<IconName, JSX.Element> = {
  // Decided by the user — solid box, full core.
  "i-set": (
    <>
      <rect {...BOX} />
      <rect x={9} y={9} width={6} height={6} rx={1} fill="currentColor" stroke="none" />
    </>
  ),

  // Decided on their behalf by a `default` — solid box, half core.
  "i-partial": (
    <>
      <rect {...BOX} />
      <rect x={9} y={9} width={3} height={6} fill="currentColor" stroke="none" />
    </>
  ),

  // Left to the AI — dashed box, nothing inside.
  "i-unset": <rect {...BOX} strokeDasharray="3 3" />,

  // Two stacked values.
  "i-copy": (
    <>
      <rect x={8} y={8} width={13} height={13} rx={2} />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),

  // Into the conversation, where a person takes it from here — hence the circle.
  "i-link": (
    <>
      <path d="M3 12h8" />
      <path d="M8 9l3 3-3 3" />
      <circle cx={17.5} cy={12} r={3.5} />
    </>
  ),

  "i-more": <path d="M6 9l6 6 6-6" />,
  "i-less": <path d="M6 15l6-6 6 6" />,
  "i-clear": <path d="M7 7l10 10M17 7L7 17" />,
};

/**
 * Every icon here carries information — none is decoration.
 *
 * Marked `aria-hidden` because each one sits beside its own text label; the
 * label is what a screen reader should read, not the shape.
 */
export function Icon({ name, size = 14, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}

/** The mark for an axis in each of the three result states. */
export const STATUS_ICON = {
  set: "i-set",
  partial: "i-partial",
  unset: "i-unset",
} as const satisfies Record<string, IconName>;
