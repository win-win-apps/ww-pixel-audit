// Pure helpers shared between server and client code paths.
// Lives outside .server.ts on purpose so client components can import it.

export type TrackerStatus = "safe" | "broken_aug_26" | "unknown";
export type TrackerSource =
  | "script_tag"
  | "legacy_additional_scripts"
  | "theme_code"
  | "custom_pixel"
  | "sales_channel";

export function statusToBadgeTone(status: TrackerStatus): "success" | "warning" | "critical" | "info" {
  if (status === "safe") return "success";
  if (status === "broken_aug_26") return "critical";
  return "info";
}

export function statusToLabel(status: TrackerStatus): string {
  if (status === "safe") return "Safe";
  if (status === "broken_aug_26") return "Will break Aug 26";
  return "Unknown";
}

export function sourceToLabel(source: TrackerSource): string {
  switch (source) {
    case "script_tag": return "Script tag";
    case "legacy_additional_scripts": return "Legacy Additional Scripts";
    case "theme_code": return "Theme code";
    case "custom_pixel": return "Custom Pixel";
    case "sales_channel": return "Sales channel";
    default: return source;
  }
}
