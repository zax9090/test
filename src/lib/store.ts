/**
 * Short-lived request store backing `preview`.
 *
 * `preview` needs the original request and source material, but the tool call
 * arrives from the widget with only a `requestId`. A module-global Map cannot
 * hold that on Workers — isolates are evicted at will and successive requests
 * need not land on the same one, so the brief's "30-minute memory cache" would
 * expire unpredictably. A Durable Object gives the TTL an actual guarantee.
 *
 * This is the one place user material outlives a request, so it is kept narrow:
 * one object per request id, a hard 30-minute alarm that deletes the payload,
 * and no logging of the contents (P1).
 */

import { DurableObject } from "cloudflare:workers";

/** Retention window from the brief. */
export const TTL_MS = 30 * 60 * 1000;

const KEY = "payload";

export interface StoredRequest {
  request: string;
  source?: string;
  /** Axis metadata `preview` needs to generate samples for one axis. */
  axes?: unknown;
  expiresAt: number;
}

export class RequestStore extends DurableObject {
  /** Persist a request payload and arm the deletion alarm. */
  async put(payload: Omit<StoredRequest, "expiresAt">): Promise<void> {
    const expiresAt = Date.now() + TTL_MS;
    await this.ctx.storage.put<StoredRequest>(KEY, { ...payload, expiresAt });
    await this.ctx.storage.setAlarm(expiresAt);
  }

  /**
   * Read the payload, or `undefined` once it has expired.
   *
   * The expiry is re-checked on read rather than trusted to the alarm, so a
   * delayed alarm can never serve material past its window.
   */
  async get(): Promise<StoredRequest | undefined> {
    const stored = await this.ctx.storage.get<StoredRequest>(KEY);
    if (!stored) return undefined;
    if (Date.now() >= stored.expiresAt) {
      await this.ctx.storage.deleteAll();
      return undefined;
    }
    return stored;
  }

  /** TTL reached — drop everything. */
  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

export interface StoreEnv {
  REQUEST_STORE: DurableObjectNamespace<RequestStore>;
}

export function requestStore(env: StoreEnv, requestId: string): DurableObjectStub<RequestStore> {
  return env.REQUEST_STORE.get(env.REQUEST_STORE.idFromName(requestId));
}

/** Opaque id for one unfold result. Not derived from the content. */
export function newRequestId(): string {
  return crypto.randomUUID();
}
