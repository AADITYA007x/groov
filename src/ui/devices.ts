// Sidebar → Account: which devices are signed in to my account (and sign
// the others out), and for the admin, how many devices every account uses.
import { supabase } from "../cloud/client";
import { getAccount } from "../cloud/session";
import { bus } from "../state";
import { $, escapeHtml } from "../utils";
import { pushStep, removeStep } from "./back";

interface MyDevice {
  device: string | null;
  last_active: string;
  signed_in: string;
  this_device: boolean;
}

interface AccountDevices {
  name: string;
  email: string;
  devices: number;
  last_active: string | null;
  device_list: string[];
}

const myBtn = $("devices-btn");
const allBtn = $("all-devices-btn");

/** "Android 14 · I2302", "Chrome on Windows"… from a browser's user agent. */
export function describeDevice(ua: string | null): string {
  if (!ua) return "Unknown device";
  const android = ua.match(/Android ([\d.]+)(?:;\s*([^;)]+))?/);
  if (android) {
    const model = android[2]?.replace(/\s*Build\/.*$/, "").trim();
    const app = /; wv\)/.test(ua) ? "Groov app" : "browser";
    return `Android ${android[1]}${model && model !== "K" ? ` · ${model}` : ""} (${app})`;
  }
  if (/iPhone|iPad/.test(ua)) return "iPhone / iPad (browser)";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "computer";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${browser} on ${os}`;
}

function ago(iso: string | null): string {
  if (!iso) return "not in the last 30 days";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

let sheet: HTMLElement | null = null;

function close(): void {
  sheet?.remove();
  sheet = null;
  removeStep("devices");
}

function show(title: string, note: string, body: string, actions = ""): HTMLElement {
  close();
  sheet = document.createElement("div");
  sheet.className = "queue-sheet";
  sheet.innerHTML = `
    <div class="queue-panel" role="dialog" aria-label="${escapeHtml(title)}">
      <div class="queue-header"><h2>${escapeHtml(title)}</h2>
        <button class="dialog-close queue-close" data-close aria-label="Close">✕</button></div>
      ${note ? `<div class="queue-now">${note}</div>` : ""}
      <div class="devices-list">${body}</div>
      ${actions ? `<div class="devices-actions">${actions}</div>` : ""}
    </div>`;
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet || (e.target as Element).closest("[data-close]")) close();
  });
  document.body.appendChild(sheet);
  pushStep("devices", close);
  return sheet;
}

async function loadMine(): Promise<MyDevice[] | null> {
  const { data, error } = await supabase.rpc("my_devices");
  return error ? null : (data as MyDevice[]);
}

function renderMyCount(devices: MyDevice[] | null): void {
  myBtn.textContent = devices ? `Your devices: ${devices.length}` : "Your devices";
}

async function openMine(): Promise<void> {
  const devices = await loadMine();
  renderMyCount(devices);
  if (!devices) {
    bus.emit("toast", "Couldn't load devices (offline, or the database needs its update)");
    return;
  }
  const root = show(
    "Your devices",
    `Signed in to your account in the last 30 days. Don't recognise one? Sign the others out and change your password.`,
    devices
      .map(
        (d) => `
      <div class="device-row">
        <b>${escapeHtml(describeDevice(d.device))}${d.this_device ? `<span class="device-tag">This device</span>` : ""}</b>
        <span>Active ${ago(d.last_active)} · signed in ${ago(d.signed_in)}</span>
      </div>`,
      )
      .join(""),
    devices.length > 1 ? `<button class="dialog-primary" data-signout-others>Sign out all other devices</button>` : "",
  );
  root.querySelector("[data-signout-others]")?.addEventListener("click", async () => {
    if (!confirm("Sign out every other device? They'll need your password to get back in.")) return;
    const { error } = await supabase.auth.signOut({ scope: "others" });
    close();
    bus.emit("toast", error ? "Couldn't sign them out. Check your internet." : "Other devices signed out (within the hour)");
    renderMyCount(await loadMine());
  });
}

async function openAll(): Promise<void> {
  const { data, error } = await supabase.rpc("all_devices");
  if (error) {
    bus.emit("toast", "Couldn't load everyone's devices");
    return;
  }
  const accounts = data as AccountDevices[];
  show(
    "Everyone's devices",
    `Devices each account used in the last 30 days. Lots of devices on one account may mean its password was shared.`,
    accounts
      .map((a) => {
        const kinds = [...new Set(a.device_list.map(describeDevice))];
        return `
      <div class="device-row">
        <b>${escapeHtml(a.name)}</b>
        <span>${escapeHtml(a.email)}</span>
        <span class="${a.devices > 3 ? "device-many" : ""}">${a.devices} device${a.devices === 1 ? "" : "s"} · last active ${ago(a.last_active)}</span>
        ${kinds.length ? `<span>${kinds.map(escapeHtml).join(" · ")}</span>` : ""}
      </div>`;
      })
      .join(""),
  );
}

async function onAuth(): Promise<void> {
  const signedIn = !!getAccount();
  myBtn.style.display = signedIn ? "block" : "none";
  allBtn.style.display = "none";
  if (!signedIn) return;
  const [mine, admin] = await Promise.all([loadMine(), supabase.rpc("is_groov_admin")]);
  renderMyCount(mine);
  allBtn.style.display = !admin.error && admin.data === true && getAccount() ? "block" : "none";
}

export function initDevices(): void {
  myBtn.addEventListener("click", () => void openMine());
  allBtn.addEventListener("click", () => void openAll());
  bus.on("authchange", () => void onAuth());
}
