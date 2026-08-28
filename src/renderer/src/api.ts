import type { HearthApi } from "../../shared/contracts";
import { createMockApi } from "./mock-api";
import { BrowserHearthApi } from "./browser-api";

declare const __HEARTH_WEB__: boolean;

let mock: HearthApi | undefined;

export function getApi(): HearthApi {
  if (window.hearth) return window.hearth;
  if (typeof __HEARTH_WEB__ !== "undefined" && __HEARTH_WEB__) {
    const localPreview = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
    mock ??= localPreview && new URLSearchParams(window.location.search).has("mock")
      ? createMockApi("web")
      : new BrowserHearthApi();
    return mock;
  }
  const localPreview = window.location.protocol === "http:" &&
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");
  if (localPreview) {
    mock ??= createMockApi();
    return mock;
  }
  throw new Error("Hearth Remote's secure desktop bridge did not load. Reinstall the desktop client.");
}
