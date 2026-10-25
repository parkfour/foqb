// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { updatePluginSettings } from "@/app/(dashboard)/settings/actions";
import type { PluginSettingDefinition, PluginSettingValue } from "@/lib/plugins/types";

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  settingsSchema: PluginSettingDefinition[];
  currentSettings: Record<string, PluginSettingValue>;
}

export interface PluginSettingsSectionProps {
  organizationId: string;
  isOwner: boolean;
  plugins: PluginInfo[];
}

export function PluginSettingsSection({
  organizationId,
  isOwner,
  plugins,
}: PluginSettingsSectionProps) {
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
          No plugins are enabled on this instance. The instance operator can turn them on via the
          FOQB_PLUGINS environment variable.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {plugins.map((plugin) => (
            <form
              key={plugin.id}
              action={updatePluginSettings}
              className="flex flex-col gap-4 rounded-lg border border-slate-200 p-5 bg-slate-50/50"
            >
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="pluginId" value={plugin.id} />

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
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
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={plugin.enabled}
                      disabled={!isOwner}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                    />
                    <span
                      className={`text-sm font-medium ${
                        plugin.enabled ? "text-emerald-700" : "text-slate-500"
                      }`}
                    >
                      {plugin.enabled ? "Active for this org" : "Disabled"}
                    </span>
                  </label>
                </div>
              </div>

              {plugin.settingsSchema.length > 0 && (
                <div className="flex flex-col gap-4 pt-1">
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

              {isOwner && (
                <div className="flex justify-end pt-2 border-t border-slate-200">
                  <button
                    type="submit"
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 transition-colors"
                  >
                    Save {plugin.name} Settings
                  </button>
                </div>
              )}
            </form>
          ))}
        </div>
      )}
    </section>
  );
}
