/**
 * The prompt as it stands, on the same screen as the choices.
 *
 * The result used to live behind a tab, so the effect of a choice was one
 * navigation away from the choice itself. That is the wrong distance for the one
 * thing this widget is actually building. It sits under the list and the board
 * now, updating as values change.
 *
 * Clamped rather than complete: this is a readout, not the result tab. The full
 * text, the character count and the corrections stay where they were.
 *
 * `Go with this` is the other half. Nothing here has ever required the user to
 * fill everything in, but nothing said so either, and an unfinished-looking form
 * reads as one that is not ready to send.
 */

import type { Strings } from "./i18n.js";

interface LivePreviewProps {
  text: string;
  /** How many axes are still blank — not a score, and never a target (P5). */
  openCount: number;
  onProceed: () => void;
  canProceed: boolean;
  t: Strings;
}

export function LivePreview({ text, openCount, onProceed, canProceed, t }: LivePreviewProps) {
  return (
    <div className="uu-live">
      <div className="uu-live-head">
        <span className="uu-live-label">{t.livePreview}</span>
        {/*
          Said plainly, because the alternative is the user guessing. It is a
          statement of what will happen on send, not a count of work outstanding
          — there is no bar, no percentage and no target.
        */}
        {openCount > 0 ? <span className="uu-live-note">{t.openLeft(openCount)}</span> : null}
      </div>

      <p className="uu-live-text">{text}</p>

      <div className="uu-live-actions">
        <button
          type="button"
          className="uu-btn is-primary"
          disabled={!canProceed}
          onClick={onProceed}
        >
          {t.proceed}
        </button>
      </div>
    </div>
  );
}
