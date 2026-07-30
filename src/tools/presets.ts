/**
 * The preset tools.
 *
 * All four are app-only: no `resourceUri`, and `visibility: ["app"]` so they stay
 * out of Claude's tool list. The widget calls them through `callServerTool` and the
 * result comes back to the widget that asked, which is what lets a load replace the
 * axes in place with no second iframe and no model call — see
 * docs/stage0-conflicts.md (C9).
 *
 * They are registered only where there is somewhere to write. The remote Worker
 * has no filesystem, so it registers none of these and the widget draws no preset
 * UI there rather than offering buttons that would fail.
 *
 * Nothing here ever sees the source box. `save_preset` takes the axes and the
 * chosen values; the material stays in the widget, and `draftFrom` plus the store
 * both strip it in case a caller forgot.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { draftFrom, unfoldedFrom } from "../lib/preset.js";
import type { PresetStore } from "../lib/preset-store.js";
import { parseUnfolded } from "../lib/schema.js";
import { detectLocale } from "../lib/locale.js";

/** What the list needs to draw a row. Never the payload — that would be wasteful. */
interface PresetSummary {
  id: string;
  name: string;
  uses: number;
  lastUsedAt?: number;
}

const APP_ONLY = {
  _meta: { ui: { visibility: ["app"] as string[] } },
  annotations: { readOnlyHint: true, openWorldHint: false },
} as const;

function ok(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export function registerPresets(server: McpServer, store: PresetStore): void {
  registerAppTool(
    server,
    "list_presets",
    {
      ...APP_ONLY,
      title: "List presets",
      description:
        "The user's saved presets, most recently used first. Widget-only; no model work.",
      inputSchema: {},
    },
    async () => {
      const presets: PresetSummary[] = (await store.list()).map((p) => ({
        id: p.id,
        name: p.name,
        uses: p.uses,
        ...(p.lastUsedAt !== undefined ? { lastUsedAt: p.lastUsedAt } : {}),
      }));
      return ok({ presets });
    },
  );

  registerAppTool(
    server,
    "load_preset",
    {
      ...APP_ONLY,
      title: "Load a preset",
      description:
        "Read a saved preset and hand back its axes and values. No sampling and no " +
        "model call — the axes are already written down.",
      inputSchema: { id: z.string().min(1).describe("The preset id from list_presets.") },
    },
    async ({ id }) => {
      // Reading a preset is using it, so the counter moves here rather than in the
      // widget: the order of the list should reflect what was actually reached for.
      const preset = (await store.touch(id)) ?? (await store.get(id));
      if (!preset) return ok({ found: false });

      return ok({
        found: true,
        preset: { id: preset.id, name: preset.name },
        unfolded: unfoldedFrom(preset),
        // Loaded values are shown as decided-on-your-behalf, not as this-time
        // choices. The widget marks them; it does not silently adopt them (P7).
        selections: preset.selections,
        ...(preset.symptoms ? { symptoms: preset.symptoms } : {}),
        locale: detectLocale(preset.intent),
      });
    },
  );

  registerAppTool(
    server,
    "save_preset",
    {
      ...APP_ONLY,
      title: "Save a preset",
      description:
        "Save the current axes and values under a name. The source material is never " +
        "part of what is saved.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        name: z.string().min(1).describe("What the user called it. No description, no tags."),
        unfolded: z.string().min(1).describe("The current `Unfolded`, as JSON."),
        selections: z.string().optional().describe("Axis id to chosen value, as JSON."),
        symptoms: z.array(z.string()).optional().describe("Ids of the checked symptoms."),
        overwriteId: z
          .string()
          .optional()
          .describe("Set to replace an existing preset rather than add one."),
      },
    },
    async ({ name, unfolded, selections, symptoms, overwriteId }) => {
      // Reuse the same repair-oriented parser the tool result goes through, so a
      // half-written payload cannot put a broken preset on disk.
      const parsed = parseUnfolded(unfolded, name);
      if (!parsed) return ok({ saved: false, reason: "unreadable" });

      let values: Record<string, unknown> = {};
      if (selections) {
        try {
          const raw: unknown = JSON.parse(selections);
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            values = raw as Record<string, unknown>;
          }
        } catch {
          // Unreadable values are dropped; the axes are still worth keeping.
        }
      }

      const saved = await store.save(draftFrom(name, parsed, values, symptoms), overwriteId);
      return ok({ saved: true, id: saved.id, name: saved.name });
    },
  );

  registerAppTool(
    server,
    "delete_preset",
    {
      ...APP_ONLY,
      title: "Delete a preset",
      description: "Remove a saved preset.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => ok({ deleted: await store.remove(id) }),
  );
}
