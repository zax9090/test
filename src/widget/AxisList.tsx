/**
 * The list tab.
 *
 * Core axes are open; everything else sits behind one collapsed header that
 * shows a count and nothing else (P6). There is no "that's enough" line, no
 * divider, no progress bar, no completeness figure — the fold itself is what
 * says where the end is, and any wording on top of it would be a claim the tool
 * cannot back up.
 */

import type { ResolvedAxis, Selection } from "../lib/assemble.js";
import type { Strings } from "./i18n.js";
import { AxisRow } from "./AxisRow.js";
import { Icon } from "./icons.js";

interface AxisListProps {
  resolved: ResolvedAxis[];
  onChange: (axisId: string, value: Selection) => void;
  freeform: string;
  onFreeform: (value: string) => void;
  source: string;
  onSource: (value: string) => void;
  extrasOpen: boolean;
  onToggleExtras: () => void;
  t: Strings;
}

export function AxisList({
  resolved,
  onChange,
  freeform,
  onFreeform,
  source,
  onSource,
  extrasOpen,
  onToggleExtras,
  t,
}: AxisListProps) {
  const core = resolved.filter((r) => r.axis.group === "core");
  const extra = resolved.filter((r) => r.axis.group !== "core");

  const rows = (items: ResolvedAxis[]) =>
    items.map((r) => (
      <AxisRow
        key={r.axis.id}
        axis={r.axis}
        status={r.status}
        values={r.values}
        onChange={onChange}
        t={t}
      />
    ));

  return (
    <div className="uu-list">
      {rows(core)}

      {extra.length > 0 ? (
        <>
          <button type="button" className="uu-fold" onClick={onToggleExtras} aria-expanded={extrasOpen}>
            <Icon name={extrasOpen ? "i-less" : "i-more"} />
            <span>{extrasOpen ? t.less : t.more(extra.length)}</span>
          </button>
          {extrasOpen ? rows(extra) : null}
        </>
      ) : null}

      {/* Always present, so a value outside the offered set never has nowhere to go (P4). */}
      <div className="uu-row">
        <div className="uu-label">{t.freeform}</div>
        <div className="uu-values">
          <input
            type="text"
            className="uu-input"
            value={freeform}
            placeholder={t.freeformPlaceholder}
            onChange={(e) => onFreeform(e.target.value)}
          />
        </div>
        <div className="uu-status" />
      </div>

      <div className="uu-row">
        <div className="uu-label">{t.source}</div>
        <div className="uu-values">
          <textarea
            className="uu-input uu-textarea"
            value={source}
            placeholder={t.sourcePlaceholder}
            rows={2}
            onChange={(e) => onSource(e.target.value)}
          />
        </div>
        <div className="uu-status" />
      </div>
    </div>
  );
}
