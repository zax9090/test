/**
 * Notice when a newer copy of this widget has taken over.
 *
 * Iframes are not reused: every `unfold` call mounts a fresh one and the old
 * ones stay live in the transcript. So a stale widget from three turns ago can
 * still speak — and `ui/message` speaks *as the user*, which is the one thing
 * that must not happen out of turn.
 *
 * Each instance announces itself on a shared channel. Anything that hears a
 * later sequence than its own stands down.
 *
 * Copying is left alone: reading an older widget and taking its text is a
 * perfectly reasonable thing to do, and it says nothing to anyone.
 */

import { useEffect, useState } from "react";

export function useSupersession(channelName: string): boolean {
  const [superseded, setSuperseded] = useState(false);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;

    // Time orders instances; the random tail breaks ties between two that mount
    // inside the same millisecond.
    const seq = Date.now() + Math.random();
    const channel = new BroadcastChannel(channelName);

    channel.onmessage = (event: MessageEvent<{ seq?: unknown }>) => {
      const other = event.data?.seq;
      if (typeof other === "number" && other > seq) setSuperseded(true);
    };

    // A sender does not receive its own message, so this only reaches instances
    // that were already mounted.
    channel.postMessage({ seq });

    return () => channel.close();
  }, [channelName]);

  return superseded;
}
