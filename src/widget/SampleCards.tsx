/**
 * A `sample` axis: each direction shown as a card of real text.
 *
 * Some axes cannot be judged from a label — voice, register, how an opening line
 * lands. Those get two or three lines written in the direction, from the user's
 * own material, so the difference is read rather than imagined.
 *
 * The refresh button is the only thing that regenerates. Sampling asks the user
 * for approval on hosts that implement it, so generating on render would put a
 * dialog in front of them every time a widget appeared.
 *
 * While new text is coming, the existing cards stay exactly where they are.
 * There is no skeleton and no spinner; the button simply goes quiet. If the
 * refresh fails, nothing is said and nothing is lost — the old cards remain.
 */

import type { Axis } from "../lib/schema.js";
import type { Strings } from "./i18n.js";
import { Icon } from "./icons.js";

interface SampleCardsProps {
  axis: Axis;
  selected: Set<string>;
  onPick: (value: string) => void;
  onRefresh?: () => void;
  refreshing: boolean;
  t: Strings;
}

export function SampleCards({
  axis,
  selected,
  onPick,
  onRefresh,
  refreshing,
  t,
}: SampleCardsProps) {
  const options = axis.options ?? [];

  return (
    <div className="uu-samples">
      <div className="uu-cards">
        {options.map((option) => {
          const on = selected.has(option.value);
          return (
            <button
              key={option.value}
              type="button"
              className={`uu-card${on ? " is-on" : ""}`}
              aria-pressed={on}
              onClick={() => onPick(option.value)}
            >
              <span className="uu-card-label">
                {option.label}
                {option.common ? <span className="uu-dot" aria-hidden="true" /> : null}
              </span>
              {/* A direction with no sample yet still shows as a choice — the
                  card is never empty, it just has less in it. */}
              {option.preview ? <span className="uu-card-body">{option.preview}</span> : null}
            </button>
          );
        })}
      </div>

      {onRefresh ? (
        <button
          type="button"
          className="uu-refresh uu-preview"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <Icon name="i-more" />
          <span>{refreshing ? t.previewing : t.preview}</span>
        </button>
      ) : null}
    </div>
  );
}
