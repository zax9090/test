/**
 * The reading the axes were built for.
 *
 * Sits above the sections because it governs them: switching it rebuilds the
 * axes, whereas switching an axis only changes a line. It is a readout first and
 * a control second — the widget arrives with a reading already taken, so nothing
 * here has to be touched for the prompt to be usable (P3).
 *
 * The field is only drawn when there are alternatives to switch to. A goal with
 * no alternatives is dropped in the parser rather than shown as dead text, since
 * `selected` goes into the prompt and an unswitchable line the user cannot see the
 * point of is just a hidden instruction.
 *
 * Typing is always available (P4). The listed readings are the model's; the box is
 * the way out of them, and a reading nobody offered is still a legitimate one.
 */

import { useState } from "preact/hooks";

import type { Goal } from "../lib/schema.js";
import type { Strings } from "./i18n.js";
import { Icon } from "./icons.js";

interface GoalFieldProps {
  goal: Goal;
  /** Fires with the reading to rebuild around. Never fires with the current one. */
  onSwitch: (reading: string) => void;
  /** A switch is in flight; the answer arrives as a new widget, so this stays set. */
  switching: boolean;
  disabled: boolean;
  t: Strings;
}

export function GoalField({ goal, onSwitch, switching, disabled, t }: GoalFieldProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const locked = disabled || switching;

  const pick = (reading: string) => {
    if (locked || reading === goal.selected) return;
    onSwitch(reading);
  };

  const submitTyped = () => {
    const reading = typed.trim();
    if (!reading || locked) return;
    onSwitch(reading);
  };

  return (
    <div className="uu-goal" data-switching={switching ? "yes" : "no"}>
      <div className="uu-goal-row">
        <div className="uu-label">{t.goal}</div>

        <button
          type="button"
          className="uu-goal-current"
          aria-expanded={open}
          disabled={locked}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="uu-goal-text">{goal.selected}</span>
          <Icon name={open ? "i-less" : "i-more"} />
        </button>
      </div>

      {open ? (
        <div className="uu-goal-open">
          {/* The alternatives, as plain readings. No ranking, no marking — the
              model already acted on its preference by choosing. */}
          {goal.alternatives.map((reading) => (
            <button
              key={reading}
              type="button"
              className="uu-goal-alt"
              disabled={locked}
              onClick={() => pick(reading)}
            >
              {reading}
            </button>
          ))}

          <div className="uu-goal-own">
            <input
              type="text"
              className="uu-input"
              value={typed}
              placeholder={t.goalOwnPlaceholder}
              disabled={locked}
              onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitTyped();
              }}
            />
            <button
              type="button"
              className="uu-goal-go"
              disabled={locked || !typed.trim()}
              onClick={submitTyped}
            >
              {t.goalSwitch}
            </button>
          </div>

          {/* Switching costs the current selections, because the axes themselves
              change. Said before the click, not after. */}
          <div className="uu-note">{t.goalCost}</div>
        </div>
      ) : null}

      {switching ? <div className="uu-note">{t.goalSwitching}</div> : null}
    </div>
  );
}
