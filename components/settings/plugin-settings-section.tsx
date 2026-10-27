// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { startTransition, useState, type ReactNode } from "react";
import { acknowledgePluginForBook, updatePluginSettings } from "@/app/(dashboard)/settings/actions";
import { AcknowledgeForm, AcknowledgementNotice } from "@/components/plugins/acknowledgement-notice";
import { PluginSlot } from "@/components/plugins/plugin-slot";
import type { PluginAcknowledgement, PluginSettingDefinition, PluginSettingValue } from "@/lib/plugins/types";

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  settingsSchema: PluginSettingDefinition[];
  currentSettings: Record<string, PluginSettingValue>;
  // A plugin that's off until the instance and this book acknowledge it.
  acknowledgement?: PluginAcknowledgement & { site: { at: string } | null; book: { at: string } | null };
}

export interface PluginSettingsSectionProps {
  organizationId: string;
  isOwner: boolean;
  plugins: PluginInfo[];
}

// On or off as a choice between the two: the one in force is marked
// "(now)" and set plain; the one you'd change to is bold.
function EnabledChoice({ enabled, disabled }: { enabled: boolean; disabled: boolean }) {
  const [value, setValue] = useState(String(enabled));
  const option = (on: boolean, label: string) => (
    <option value={String(on)} className={on === enabled ? "font-normal" : "font-semibold"}>
      {label}
      {on === enabled ? " (now)" : ""}
    </option>
  );
  return (
    <select
      name="enabled"
      aria-label="This plugin in this organization"
      defaultValue={String(enabled)}
      onChange={(e) => setValue(e.target.value)}
      disabled={disabled}
      className={`rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:bg-slate-100 ${
        value === "true" ? "text-emerald-700" : "text-slate-600"
      } ${value === String(enabled) ? "font-normal" : "font-semibold"}`}
    >
      {option(true, "Active for this org")}
      {option(false, "Off for this org")}
    </select>
  );
}

function SaveButton({ dirty, compact, children }: { dirty: boolean; compact?: boolean; children: ReactNode }) {
  const size = compact ? "px-3 py-1" : "px-4 py-2 shadow-sm";
  const look = dirty
    ? "bg-amber-500 text-white ring-2 ring-amber-300 ring-offset-1 hover:bg-amber-600"
    : compact
      ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      : "bg-slate-900 text-white hover:bg-slate-800";
  return (
    <button type="submit" className={`rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 ${size} ${look}`}>
      {children}
      {dirty && <span className="sr-only"> (unsaved changes)</span>}
    </button>
  );
}

export function PluginSettingsSection({
  organizationId,
  isOwner,
  plugins,
}: PluginSettingsSectionProps) {
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Plugins</h2>
        <p className="text-sm text-slate-500">
          Enable or disable plugins for this organization, and configure their custom settings.
          {!isOwner && " Only an organization administrator can change plugin settings."}
        </p>
      </div>

      {plugins.length === 0 ? (
        <p className="text-sm text-slate-500 italic py-2">
          No plugins are available here: the instance operator has turned them off (FOQB_PLUGINS), or
          a Site Admin has.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="flex flex-col gap-4 rounded-lg border border-slate-200 p-5 bg-slate-50/50"
            >
              {plugin.acknowledgement && (
                <AcknowledgementNotice
                  acknowledgement={plugin.acknowledgement}
                  site={plugin.acknowledgement.site}
                  book={plugin.acknowledgement.book}
                  action={
                    plugin.acknowledgement.site && !plugin.acknowledgement.book && isOwner ? (
                      <AcknowledgeForm
                        action={acknowledgePluginForBook}
                        hidden={{ organizationId, pluginId: plugin.id }}
                        label="I have read this. I'll check what this plugin produces with a tax professional before filing or paying anything."
                      />
                    ) : !plugin.acknowledgement.site ? (
                      <p className="text-sm font-medium">A Site Admin has to acknowledge it for this instance first.</p>
                    ) : null
                  }
                />
              )}
              <form
                // Remounted on what's saved, so each field shows it.
                key={JSON.stringify([plugin.enabled, plugin.currentSettings])}
                // Submitted by hand: a form action is followed by a reset,
                // which puts each select back on its first option.
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  setDirty((d) => new Set([...d].filter((id) => id !== plugin.id)));
                  startTransition(() => updatePluginSettings(form));
                }}
                // Any change lights up Save until it's pressed.
                onChange={() => setDirty((d) => new Set(d).add(plugin.id))}
                className="flex flex-col gap-4"
              >
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="pluginId" value={plugin.id} />

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-slate-900">{plugin.name}</h3>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-600">
                        v{plugin.version}
                      </span>
                    </div>
                    {plugin.description && (
                      <p className="text-xs text-slate-500 mt-1">{plugin.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <EnabledChoice enabled={plugin.enabled} disabled={!isOwner} />
                    {/* Nothing else to save, so it sits by the switch, apart
                        from any settings the plugin shows below. */}
                    {isOwner && plugin.settingsSchema.length === 0 && (
                      <SaveButton dirty={dirty.has(plugin.id)} compact>
                        Save
                      </SaveButton>
                    )}
                  </div>
                </div>

                {plugin.settingsSchema.length > 0 && (
                  <div className="flex flex-col gap-4 border-t border-slate-200 pt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Configuration Options
                    </h4>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {plugin.settingsSchema.map((def) => {
                        const val = plugin.currentSettings[def.key] ?? def.defaultValue;
                        const fieldId = `${plugin.id}_${def.key}`;

                        return (
                          <div
                            key={def.key}
                            className={`flex flex-col gap-1.5 ${
                              def.type === "multiselect" ? "md:col-span-2" : ""
                            }`}
                          >
                            <div className="flex items-baseline justify-between">
                              <label htmlFor={fieldId} className="text-sm font-medium text-slate-700">
                                {def.label}
                                {def.required && <span className="text-red-500 ml-1">*</span>}
                              </label>
                              <span className="text-xs text-slate-400 font-mono">{def.type}</span>
                            </div>

                            {def.description && (
                              <p className="text-xs text-slate-500">{def.description}</p>
                            )}

                            {def.type === "text" && (
                              <input
                                type="text"
                                id={fieldId}
                                name={`setting_${def.key}`}
                                defaultValue={String(val ?? "")}
                                placeholder={def.placeholder}
                                disabled={!isOwner}
                                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:bg-slate-100"
                              />
                            )}

                            {def.type === "select" && (
                              <select
                                id={fieldId}
                                name={`setting_${def.key}`}
                                defaultValue={String(val ?? def.options?.[0]?.value ?? "")}
                                disabled={!isOwner}
                                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:bg-slate-100"
                              >
                                {def.options?.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            )}

                            {def.type === "multiselect" && (
                              <div className="flex flex-wrap gap-3 rounded-md border border-slate-200 bg-white p-3">
                                {def.options?.map((opt) => {
                                  const selectedArray = Array.isArray(val) ? val : [];
                                  const checked = selectedArray.includes(opt.value);
                                  return (
                                    <label
                                      key={opt.value}
                                      className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none"
                                    >
                                      <input
                                        type="checkbox"
                                        name={`setting_${def.key}`}
                                        value={opt.value}
                                        defaultChecked={checked}
                                        disabled={!isOwner}
                                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                                      />
                                      <span>{opt.label}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}

                            {def.type === "boolean" && (
                              <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
                                <input
                                  type="checkbox"
                                  id={fieldId}
                                  name={`setting_${def.key}`}
                                  defaultChecked={Boolean(val)}
                                  disabled={!isOwner}
                                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                                />
                                <span className="text-sm text-slate-700">Enabled</span>
                              </label>
                            )}

                            {def.type === "number" && (
                              <input
                                type="number"
                                id={fieldId}
                                name={`setting_${def.key}`}
                                defaultValue={Number(val ?? 0)}
                                disabled={!isOwner}
                                className="w-32 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:bg-slate-100"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isOwner && plugin.settingsSchema.length > 0 && (
                  <div className="flex justify-end pt-2 border-t border-slate-200">
                    <SaveButton dirty={dirty.has(plugin.id)}>Save {plugin.name} Settings</SaveButton>
                  </div>
                )}
              </form>
              {/* The plugin's own settings (keys, accounts), once it's on. */}
              <PluginSlot
                name="settings.sections"
                context={{ organizationId }}
                pluginId={plugin.id}
                className="flex flex-col gap-4 border-t border-slate-200 pt-4"
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
