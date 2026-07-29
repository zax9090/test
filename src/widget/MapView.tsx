/**
 * The radial map that sits folded above the tabs.
 *
 * This is a read-out, not a control surface. Clicking a node moves to that axis
 * in the list tab; nothing here changes a value. That restraint is the whole
 * point — the map answers "what is there and how much of it have I touched",
 * and deciding happens in the list where the values actually live.
 *
 * Two levels: sections branch from the centre, and each section's axes fan out
 * from it. That mirrors the list exactly — the same grouping, seen at once — and
 * it is what keeps the shape readable as the axis count grows, which it will,
 * since extraction is deliberately uncapped.
 *
 * A section node draws larger than an axis node. Nothing distinguishes a section
 * or axis the user added from one the model proposed; the origin is not
 * something the map has an opinion about.
 *
 * Spoke style follows the icon grammar: solid for a decided axis, dashed for an
 * undecided one.
 */

import type { ResolvedAxis } from "../lib/assemble.js";
import type { Section } from "../lib/schema.js";

interface MapViewProps {
  sections: Section[];
  resolved: ResolvedAxis[];
  /** The request, shown at the centre everything radiates from. */
  intent: string;
  onPick: (axisId: string) => void;
  width: number;
}

const HEIGHT = 320;
const SECTION_RADIUS = 66;
const AXIS_RADIUS = 122;
const SECTION_NODE = 5;
const AXIS_NODE = 3.5;

/** Half-angle each section's axes are allowed to occupy, as a fraction of its slice. */
const SPREAD = 0.38;

interface Placed {
  axis: ResolvedAxis;
  x: number;
  y: number;
  angle: number;
}

interface PlacedSection {
  section: Section;
  x: number;
  y: number;
  angle: number;
  axes: Placed[];
  /** True when any axis under it has been decided. */
  touched: boolean;
}

function polar(angle: number, radius: number) {
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function clip(label: string, max: number): string {
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

/**
 * Lay the sections around the circle, then fan each one's axes across its own
 * slice so an axis always sits visually under the section it belongs to.
 */
function place(sections: Section[], byId: Map<string, ResolvedAxis>): PlacedSection[] {
  const slice = (2 * Math.PI) / Math.max(sections.length, 1);

  return sections.map((section, i) => {
    const angle = -Math.PI / 2 + slice * i;
    const rows = section.axes.map((a) => byId.get(a.id)).filter(Boolean) as ResolvedAxis[];

    const span = slice * SPREAD * 2;
    const step = rows.length > 1 ? span / (rows.length - 1) : 0;
    const start = angle - (rows.length > 1 ? span / 2 : 0);

    return {
      section,
      ...polar(angle, SECTION_RADIUS),
      angle,
      touched: rows.some((r) => r.status !== "unset"),
      axes: rows.map((axis, j) => {
        const a = start + step * j;
        return { axis, ...polar(a, AXIS_RADIUS), angle: a };
      }),
    };
  });
}

export function MapView({ sections, resolved, intent, onPick, width }: MapViewProps) {
  const byId = new Map(resolved.map((r) => [r.axis.id, r]));
  const placed = place(sections, byId);

  const label = (x: number, y: number, angle: number, text: string, cls: string, key: string) => {
    const outward = Math.cos(angle);
    const anchor = Math.abs(outward) < 0.25 ? "middle" : outward > 0 ? "start" : "end";
    const pad = anchor === "middle" ? 0 : outward > 0 ? 9 : -9;
    const ly = Math.abs(outward) < 0.25 ? (y > 0 ? y + 17 : y - 11) : y + 4;
    return (
      <text key={key} className={cls} x={x + pad} y={ly} textAnchor={anchor}>
        {text}
      </text>
    );
  };

  return (
    <svg
      className="uu-map"
      width="100%"
      height={HEIGHT}
      viewBox={`0 ${-HEIGHT / 2} ${width} ${HEIGHT}`}
      role="group"
    >
      <g transform={`translate(${width / 2} 0)`}>
        {placed.map((p) => (
          <g key={p.section.id}>
            {/* Centre to section. Solid once anything under it is decided. */}
            <line
              className={`uu-branch${p.touched ? " is-set" : ""}`}
              x1={0}
              y1={0}
              x2={p.x}
              y2={p.y}
              strokeDasharray={p.touched ? undefined : "3 3"}
            />

            {p.axes.map(({ axis, x, y, angle }) => {
              const decided = axis.status !== "unset";
              return (
                <g
                  key={axis.axis.id}
                  data-node={axis.axis.id}
                  className={`uu-node${decided ? " is-set" : ""} is-axis`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPick(axis.axis.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPick(axis.axis.id);
                    }
                  }}
                >
                  <title>{axis.axis.label}</title>
                  {/* Section to axis, so the grouping is visible as structure. */}
                  <line
                    x1={p.x}
                    y1={p.y}
                    x2={x}
                    y2={y}
                    strokeDasharray={decided ? undefined : "3 3"}
                  />
                  {/* Square, because a node stands for a value (icon grammar). */}
                  <rect
                    x={x - AXIS_NODE}
                    y={y - AXIS_NODE}
                    width={AXIS_NODE * 2}
                    height={AXIS_NODE * 2}
                    strokeDasharray={decided ? undefined : "2 2"}
                    fill={axis.status === "set" ? "currentColor" : "none"}
                  />
                  {label(x, y, angle, clip(axis.axis.label, 7), "uu-axis-label", "l")}
                  {/* The marks are a few px across, too small to hit reliably. */}
                  <circle className="uu-node-hit" cx={x} cy={y} r={14} />
                </g>
              );
            })}

            <g className={`uu-node is-section${p.touched ? " is-set" : ""}`}>
              <rect
                x={p.x - SECTION_NODE}
                y={p.y - SECTION_NODE}
                width={SECTION_NODE * 2}
                height={SECTION_NODE * 2}
                strokeDasharray={p.touched ? undefined : "2 2"}
                fill={p.touched ? "currentColor" : "none"}
              />
              {p.section.label
                ? label(p.x, p.y, p.angle, clip(p.section.label, 6), "uu-section-node", "s")
                : null}
            </g>
          </g>
        ))}

        {/* The request, at the centre everything radiates from. Drawn last so
            the branches pass behind it. */}
        <circle className="uu-map-hub" r={SECTION_RADIUS * 0.6} />
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
