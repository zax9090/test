/**
 * The result tab.
 *
 * Three states, distinguished by icon and brightness only — no colour of our
 * own (the brief bans a highlight palette, and colour alone would not survive
 * the host's light/dark switch anyway).
 *
 *   set      the user chose it
 *   partial  a `default` stood in, folded away behind a count
 *   unset    left to the AI — shown on screen, absent from the copied text
 *
 * The prompt is read-only. Editing it directly would put the text and the axis
 * state out of step, and the axes are the thing that can be reasoned about.
 *
 * Only a character count is shown. No score, no percentage, no completeness
 * meter (P5).
 */

import { useState } from "react";

import type { ResolvedAxis, Selection } from "../lib/assemble.js";
import type { Fix } from "../lib/schema.js";
import { assembledLength } from "../lib/assemble.js";
import type { Strings } from "./i18n.js";
import { AxisRow } from "./AxisRow.js";
import { Icon } from "./icons.js";

interface ResultProps {
  text: string;
  resolved: ResolvedAxis[];
  fixes: Fix[];
  onChange: (axisId: string, value: Selection) => void;
  onApplyFix: (fix: Fix) => void;
  onCopy: () => void;
  onSend: () => void;
  copied: boolean;
  canSend: boolean;
  t: Strings;
}

/** A line that opens its own chips in place — never a jump to the list tab. */
function OpenableLine({
  item,
  icon,
  label,
  open,
  onToggle,
  onChange,
  t,
}: {
  item: ResolvedAxis;
  icon: "i-partial" | "i-unset";
  label: string;
  open: boolean;
  onToggle: () => void;
  onChange: (axisId: string, value: Selection) => void;
  t: Strings;
}) {
  return (
    <div className="uu-openable">
      <button type="button" className="uu-line-btn" onClick={onToggle} aria-expanded={open}>
        <Icon name={icon} />
        <span>{label}</span>
      </button>
      {open ? (
        <div className="uu-inline-edit">
          <AxisRow
            axis={item.axis}
            status={item.status}
            values={item.values}
            onChange={onChange}
            t={t}
          />
        </div>
      ) : null}
    </div>
  );
}

export function Result({
  text,
  resolved,
  fixes,
  onChange,
  onApplyFix,
  onCopy,
  onSend,
  copied,
  canSend,
  t,
}: ResultProps) {
  const [openAxis, setOpenAxis] = useState<string | null>(null);
  const [showPartials, setShowPartials] = useState(false);

  const set = resolved.filter((r) => r.status === "set");
  const partial = resolved.filter((r) => r.status === "partial");
  const unset = resolved.filter((r) => r.status === "unset");

  const toggle = (id: string) => setOpenAxis((cur) => (cur === id ? null : id));

  return (
    <div className="uu-result">
      <div className="uu-prompt">{text}</div>

      {set.length > 0 ? (
        <div className="uu-lines">
          {set.map((r) => (
            <div key={r.axis.id} className="uu-openable">
              <button
                type="button"
                className="uu-line-btn"
                onClick={() => toggle(r.axis.id)}
                aria-expanded={openAxis === r.axis.id}
              >
                <Icon name="i-set" />
                <span>{r.line}</span>
              </button>
              {openAxis === r.axis.id ? (
                <div className="uu-inline-edit">
                  <AxisRow
                    axis={r.axis}
                    status={r.status}
                    values={r.values}
                    onChange={onChange}
                    t={t}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Folded to a count until asked (P6). */}
      {partial.length > 0 ? (
        <div className="uu-lines uu-dim-mid">
          <button
            type="button"
            className="uu-fold"
            onClick={() => setShowPartials((v) => !v)}
            aria-expanded={showPartials}
          >
            <Icon name="i-partial" />
            <span>{t.onBehalf(partial.length)}</span>
            <Icon name={showPartials ? "i-less" : "i-more"} />
          </button>
          {showPartials
            ? partial.map((r) => (
                <OpenableLine
                  key={r.axis.id}
                  item={r}
                  icon="i-partial"
                  label={r.line}
                  open={openAxis === r.axis.id}
                  onToggle={() => toggle(r.axis.id)}
                  onChange={onChange}
                  t={t}
                />
              ))
            : null}
        </div>
      ) : null}

      {/* On screen so the user can see what is being left open — not copied. */}
      {unset.length > 0 ? (
        <div className="uu-lines uu-dim">
          {unset.map((r) => (
            <OpenableLine
              key={r.axis.id}
              item={r}
              icon="i-unset"
              label={`${r.axis.label} — ${t.delegated}`}
              open={openAxis === r.axis.id}
              onToggle={() => toggle(r.axis.id)}
              onChange={onChange}
              t={t}
            />
          ))}
        </div>
      ) : null}

      {fixes.length > 0 ? (
        <div className="uu-fixes">
          {fixes.slice(0, 4).map((fix) => (
            <button
              key={fix.label}
              type="button"
              className="uu-chip"
              onClick={() => onApplyFix(fix)}
            >
              {fix.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="uu-actions">
        <button type="button" className="uu-btn" onClick={onCopy}>
          <Icon name="i-copy" />
          <span>{copied ? t.copied : t.copy}</span>
        </button>
        {canSend ? (
          <button type="button" className="uu-btn" onClick={onSend}>
            <Icon name="i-link" />
            <span>{t.send}</span>
          </button>
        ) : null}
        <span className="uu-count">{t.chars(assembledLength(text))}</span>
      </div>
    </div>
  );
}
