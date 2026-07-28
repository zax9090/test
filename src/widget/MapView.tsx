/**
 * The radial map that sits folded above the tabs.
 *
 * This is a read-out, not a control surface. Clicking a node moves to that axis
 * in the list tab; nothing here changes a value. That restraint is the whole
 * point — the map answers "what is there and how much of it have I touched",
 * and deciding happens in the list where the values actually live.
 *
 * Core axes ride an inner ring and draw larger, extra axes an outer ring and
 * smaller. Angles are spread across the full circle per ring rather than packed
 * in sequence, so the silhouette stays balanced as the axis count grows — which
 * it will, since extraction is deliberately uncapped.
 *
 * Spoke style follows the icon grammar: solid for a decided axis, dashed for an
 * undecided one.
 */

import type { ResolvedAxis } from "../lib/assemble.js";

interface MapViewProps {
  resolved: ResolvedAxis[];
  /** The request, shown at the centre the axes radiate from. */
  intent: string;
  onPick: (axisId: string) => void;
  width: number;
}

const HEIGHT = 300;
const CORE_RADIUS = 72;
const EXTRA_RADIUS = 118;
const CORE_NODE = 5;
const EXTRA_NODE = 3.5;

/** Past this many nodes on a ring, labels are clipped hard to stay legible. */
const CROWDED = 8;

interface Placed {
  axis: ResolvedAxis;
  x: number;
  y: number;
  angle: number;
  radius: number;
  node: number;
}

function place(items: ResolvedAxis[], radius: number, node: number, offset: number): Placed[] {
  return items.map((axis, i) => {
    // Start at twelve o'clock and go clockwise. The half-step offset on the
    // outer ring keeps outer nodes from hiding directly behind inner spokes.
    const angle = (-90 + (360 * (i + offset)) / Math.max(items.length, 1)) * (Math.PI / 180);
    return {
      axis,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      angle,
      radius,
      node,
    };
  });
}

function clip(label: string, crowded: boolean): string {
  const max = crowded ? 4 : 9;
  return label.length > max ? `${label.slice(0, max)}…` : label;
}

/**
 * Break the request into the two short lines that fit inside the hub.
 *
 * Deliberately crude — the full request is already sitting in the header
 * directly above, so this only has to identify what the map is about.
 */
function hubLines(intent: string): string[] {
  const words = intent.trim().split(/\s+/);
  const lines: string[] = ["", ""];
  let at = 0;

  for (const word of words) {
    const line = lines[at] ?? "";
    if (line && line.length + word.length + 1 > 11) {
      if (at === 1) break;
      at = 1;
    }
    lines[at] = lines[at] ? `${lines[at]} ${word}` : word;
  }

  const out = lines.filter(Boolean);
  const last = out.length - 1;
  if (last >= 0 && out.join(" ").length < intent.trim().length) {
    out[last] = `${(out[last] ?? "").slice(0, 10)}…`;
  }
  return out;
}

export function MapView({ resolved, intent, onPick, width }: MapViewProps) {
  const core = resolved.filter((r) => r.axis.group === "core");
  const extra = resolved.filter((r) => r.axis.group !== "core");

  const placed = [
    ...place(core, CORE_RADIUS, CORE_NODE, 0),
    ...place(extra, EXTRA_RADIUS, EXTRA_NODE, 0.5),
  ];

  const cx = width / 2;
  const cy = HEIGHT / 2;

  return (
    <svg
      className="uu-map"
      width="100%"
      height={HEIGHT}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      role="group"
    >
      <g transform={`translate(${cx} ${cy})`}>
        {placed.map((p) => {
          const decided = p.axis.status !== "unset";
          const crowded = (p.radius === CORE_RADIUS ? core.length : extra.length) > CROWDED;
          // Anchor labels away from the centre so text runs outward, not across
          // the diagram.
          const outward = Math.cos(p.angle);
          const anchor = Math.abs(outward) < 0.25 ? "middle" : outward > 0 ? "start" : "end";
          const pad = anchor === "middle" ? 0 : outward > 0 ? 9 : -9;
          const labelY = Math.abs(outward) < 0.25 ? (p.y > 0 ? p.y + 18 : p.y - 12) : p.y + 4;

          return (
            <g
              key={p.axis.axis.id}
              data-node={p.axis.axis.id}
              className={`uu-node${decided ? " is-set" : ""}${
                p.radius === EXTRA_RADIUS ? " is-extra" : ""
              }`}
              onClick={() => onPick(p.axis.axis.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(p.axis.axis.id);
                }
              }}
            >
              <title>{p.axis.axis.label}</title>
              <line
                x1={0}
                y1={0}
                x2={p.x}
                y2={p.y}
                strokeDasharray={decided ? undefined : "3 3"}
              />
              {/* Square, because a node stands for a value (icon grammar). */}
              <rect
                x={p.x - p.node}
                y={p.y - p.node}
                width={p.node * 2}
                height={p.node * 2}
                strokeDasharray={decided ? undefined : "2 2"}
                fill={p.axis.status === "set" ? "currentColor" : "none"}
              />
              <text x={p.x + pad} y={labelY} textAnchor={anchor}>
                {clip(p.axis.axis.label, crowded)}
              </text>
              {/* The node marks are 7-10px across, too small to hit reliably.
                  This transparent disc is the actual target. */}
              <circle className="uu-node-hit" cx={p.x} cy={p.y} r={15} />
            </g>
          );
        })}

        {/* The request, at the centre everything radiates from. Drawn last so
            the spokes pass behind it. */}
        <circle className="uu-map-hub" r={CORE_RADIUS * 0.62} />
        <text className="uu-map-intent" textAnchor="middle">
          {hubLines(intent).map((line, i, all) => (
            <tspan key={line} x={0} y={(i - (all.length - 1) / 2) * 14 + 4}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    </svg>
  );
}
