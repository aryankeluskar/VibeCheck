#!/usr/bin/env node
/**
 * Drive /xr on a USB-connected Quest from the laptop: the Quest Browser's
 * DevTools socket is forwarded over ADB and we talk CDP to the /xr page.
 *
 *   node scripts/quest-drive.mjs open [url]        # open /xr?beacon=1 on the headset, keep it awake
 *   node scripts/quest-drive.mjs state             # mirrorCoach.agent.status() from the headset page
 *   node scripts/quest-drive.mjs help              # the page's agent actions
 *   node scripts/quest-drive.mjs do <action> [json]  # e.g. do calibrate '{"distance":3}'  (see xr/src/agent.ts)
 *   node scripts/quest-drive.mjs log [n]           # the page's event timeline
 *   node scripts/quest-drive.mjs click <selector>  # click on the headset page (counts as a user tap)
 *   node scripts/quest-drive.mjs eval '<js>'       # evaluate in the headset page
 *   node scripts/quest-drive.mjs shot [file]       # screenshot of the 2D page (not the XR view)
 *   node scripts/quest-drive.mjs view [file]       # what the wearer sees, passthrough + XR (Meta's screenshot service)
 *   node scripts/quest-drive.mjs cast [serial]     # wireless cast: Wi-Fi ADB + MQDH's casting window; then unplug USB.
 *                                                  # Needs a network that lets the laptop reach the headset (venue Wi-Fi may not).
 *
 * Needs adb (developer mode on, USB debugging allowed in the headset). Works
 * over USB or Wi-Fi ADB; with both attached it uses USB (ANDROID_SERIAL overrides).
 */

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".tools/quest");
mkdirSync(out, { recursive: true });
// Use Meta Quest Developer Hub's adb when present: a second adb version on the
// same machine restarts the server and the headset asks to authorize again.
const MQDH_ADB = "/Applications/Meta Quest Developer Hub.app/Contents/Resources/bin/adb";
const ADB = process.env.ADB ?? (existsSync(MQDH_ADB) ? MQDH_ADB : "adb");
const adb = (...a) => execFileSync(ADB, a, { encoding: "utf8" });
const [cmd = "state", ...rest] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Attached headsets; Wi-Fi ones have an ip:port serial.
const devices = adb("devices")
  .split("\n")
  .slice(1)
  .map((l) => l.trim().split(/\s+/))
  .filter(([, state]) => state === "device")
  .map(([id]) => id);
// USB and Wi-Fi at once makes plain `adb` refuse to pick; prefer USB.
if (!process.env.ANDROID_SERIAL && devices.length > 1) {
  process.env.ANDROID_SERIAL = devices.find((d) => !d.includes(":")) ?? devices[0];
}
const PROD = "https://vercel-ff-five.vercel.app/xr?beacon=1";

if (cmd === "open") {
  // Keep the headset rendering while nobody is wearing it.
  adb("shell", "am", "broadcast", "-a", "com.oculus.vrpowermanager.prox_close");
  // adb shell joins arguments into one remote shell line, so quote the URL.
  adb("shell", `am start -a android.intent.action.VIEW -p com.oculus.browser -d '${rest[0] ?? PROD}'`);
  console.log(`opened ${rest[0] ?? PROD}`);
  process.exit(0);
}

if (cmd === "cast") {
  // Same casting window MQDH opens, pointed at a Wi-Fi ADB connection, so the
  // cable can come out. Wi-Fi ADB lasts until the headset reboots; after a
  // reboot plug in once and run this again.
  let serial = rest[0] ?? devices.find((d) => d.includes(":"));
  const usb = devices.find((d) => !d.includes(":"));
  if (!serial && usb) {
    const ip = execFileSync(ADB, ["-s", usb, "shell", "ip", "-f", "inet", "addr", "show", "wlan0"], { encoding: "utf8" })
      .match(/inet (\d+\.\d+\.\d+\.\d+)/)?.[1];
    if (!ip) throw new Error("Headset has no Wi-Fi address; join it to the same network as this laptop.");
    execFileSync(ADB, ["-s", usb, "tcpip", "5555"]);
    await sleep(2500);
    serial = `${ip}:5555`;
  }
  if (!serial) throw new Error("No headset: plug it in over USB once (developer mode on) to switch on Wi-Fi ADB.");
  console.log(adb("connect", serial).trim());
  execFileSync(ADB, ["-s", serial, "shell", "am", "broadcast", "-a", "com.oculus.vrpowermanager.prox_close"]);
  const casting = join(dirname(MQDH_ADB), "Casting.app/Contents/MacOS/Casting");
  if (!existsSync(casting)) throw new Error("Meta Quest Developer Hub isn't installed (it ships the casting app).");
  // Close a cast that's already running (e.g. MQDH's, over USB): one cast per headset.
  try {
    // -x: by process name; -f would also match any shell whose command mentions it.
    execFileSync("pkill", ["-x", "Casting"]);
    await sleep(1000);
  } catch {
    // none running
  }
  // A cast killed mid-stream leaves the headset side stuck; restart it.
  execFileSync(ADB, ["-s", serial, "shell", "am", "force-stop", "com.oculus.magicislandcastingservice"]);
  const features = ["input_forwarding", "image_stabilization", "update_device_fov_via_openxr_api", "panel_streaming"];
  spawn(
    casting,
    [
      // The casting app switches to USB whenever the headset is also plugged
      // in, so it gets an adb that only sees the Wi-Fi connection.
      "--adb", join(root, "scripts/adb-wifi.sh"),
      "--application-caches-dir", join(homedir(), "Library/Application Support/odh/casting"),
      "--exit-on-close",
      "--launch-surface", "MQDH",
      "--target-device", JSON.stringify({ id: serial }),
      "--features", ...features,
      "--launch-surface-session-uuid", randomUUID(),
    ],
    { detached: true, stdio: "ignore", env: { ...process.env, QUEST_WIFI: serial, QUEST_USB: usb ?? "", REAL_ADB: ADB } },
  ).unref();
  console.log(`casting ${serial} over Wi-Fi; the USB cable can come out`);
  process.exit(0);
}

if (cmd === "view") {
  // adb screencap is black in XR; the system screenshot service captures the
  // composited view (passthrough included) into /sdcard/Oculus/Screenshots.
  const dir = "/sdcard/Oculus/Screenshots";
  const newest = () => adb("shell", "ls", "-t", dir).split("\n")[0].trim();
  const before = newest();
  adb("shell", "am", "startservice", "-n", "com.oculus.metacam/.capture.CaptureService", "-a", "TAKE_SCREENSHOT");
  let name = before;
  for (let i = 0; i < 20 && name === before; i++) {
    await new Promise((r) => setTimeout(r, 250));
    name = newest();
  }
  await new Promise((r) => setTimeout(r, 500)); // let the JPEG finish writing
  const file = rest[0] ?? join(out, `view-${Date.now()}.jpg`);
  adb("pull", `${dir}/${name}`, file);
  console.log(file);
  process.exit(0);
}

// Forward the browser's DevTools socket and attach to the /xr page target.
// (Quest Browser drops browser-level CDP connections, so talk to the page.)
const socket = adb("shell", "cat", "/proc/net/unix")
  .split("\n")
  .map((l) => l.trim().split(/\s+/).pop())
  .find((n) => n?.startsWith("@") && n.includes("devtools_remote"));
if (!socket) {
  console.error("No DevTools socket: is Quest Browser open?");
  process.exit(1);
}
adb("forward", "tcp:9222", `localabstract:${socket.slice(1)}`);
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
// TARGET=<id> picks a tab (ids from http://127.0.0.1:9222/json); default: first /xr tab.
const target =
  targets.find((t) => t.id === process.env.TARGET) ??
  targets.find((t) => t.type === "page" && t.url.includes("/xr")) ??
  targets.find((t) => t.type === "page");
if (!target) {
  console.error("No page open in Quest Browser");
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
let nextId = 1;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const cdp = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, (msg) => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

const STATE = `(() => {
  const s = window.mirrorCoach;
  const e = s?.engine?.state;
  return {
    url: location.href,
    visible: document.visibilityState,
    setup: document.getElementById("status")?.textContent,
    enterDisabled: document.getElementById("enter")?.disabled,
    cameras: [...(document.getElementById("camera")?.options ?? [])].map((o) => o.textContent),
    started: !!s?.started,
    camera: s?.camera ? s.camera.videoWidth + "x" + s.camera.videoHeight + " ready=" + s.camera.readyState : null,
    sees: s?.engine?.cameraSeesMirror ? "mirror" : "direct",
    ref: s?.reference ? { t: +s.reference.currentTime.toFixed(1), paused: s.reference.paused } : null,
    status: e?.status,
    fps: e?.trackingFps,
    score: e?.score,
    limbs: e?.limbScores,
    target: e?.targetPose,
    coach: e?.coachLine,
    calibration: s?.calibration,
    report: s?.reportStatus?.() ?? "none",
  };
})()`;

try {
  const hasAgent = await evaluate("!!window.mirrorCoach?.agent");
  if (cmd === "state") {
    console.log(JSON.stringify(await evaluate(hasAgent ? "mirrorCoach.agent.status()" : STATE), null, 2));
  } else if (cmd === "help" || cmd === "do" || cmd === "log") {
    if (!hasAgent) throw new Error("This page has no mirrorCoach.agent (old build?). Reload the tab.");
    const expr =
      cmd === "help"
        ? "mirrorCoach.agent.help()"
        : cmd === "log"
          ? `mirrorCoach.agent.log(${Number(rest[0]) || 40})`
          : `mirrorCoach.agent.do(${JSON.stringify(rest[0])}, ${rest[1] ?? "undefined"})`;
    console.log(JSON.stringify(await evaluate(expr), null, 2));
  } else if (cmd === "click") {
    // A real tap (trusted input), so the page gets user activation for XR and audio.
    const rect = await evaluate(
      `(() => { const r = document.querySelector(${JSON.stringify(rest[0])})?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    );
    if (!rect) throw new Error(`no element ${rest[0]}`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await cdp("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    }
    console.log(`tapped ${rest[0]} at ${Math.round(rect.x)},${Math.round(rect.y)}`);
  } else if (cmd === "eval") console.log(JSON.stringify(await evaluate(rest[0]), null, 2));
  else if (cmd === "shot") {
    const file = rest[0] ?? join(out, `page-${Date.now()}.png`);
    const { data } = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(file);
  } else console.error(`unknown command ${cmd}`);
} finally {
  ws.close();
  process.exit(0);
}
