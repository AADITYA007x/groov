import { $ } from "../utils";

const layoutEl = $("layout");
const bgBlurEl = $("bg-blur");

export function closeSidebar(): void {
  layoutEl.classList.remove("sidebar-open");
}

export function updateBackgroundArt(url: string | null | undefined): void {
  bgBlurEl.style.backgroundImage = url ? `url("${url}")` : "";
}

export function initLayout(): void {
  $("mobile-menu-toggle").addEventListener("click", () => layoutEl.classList.toggle("sidebar-open"));
  $("sidebar-backdrop").addEventListener("click", closeSidebar);
}
