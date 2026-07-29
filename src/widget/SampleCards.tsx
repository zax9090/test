/**
 * A `sample` axis: each direction shown as a card of real text.
 *
 * Some axes cannot be judged from a label — voice, register, how an opening line
 * lands. Those get two or three lines written in the direction, from the user's
 * own material, so the difference is read rather than imagined.
 *
 * The text arrives with the axes and is not rewritten here. Rewriting only
 * matters when the material changed, and material changing is what refolding is
 * for — which regenerates these along with everything else.
 */

import type { Axis } from "../lib/schema.js";

interface SampleCardsProps {
  axis: Axis;
  selected: Set<string>;
  onPick: (value: string) => void;
}

export function SampleCards({ axis, selected, onPick }: SampleCardsProps) {
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
    </div>
  );
}
