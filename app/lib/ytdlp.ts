import { execFile, spawn } from "child_process";
import { mkdir, readFile, rm } from "fs/promises";
import path from "path";
import os from "os";

export type YtMetadata = { title: string; description: string };
export type Progress = (percent: number, phase?: string) => void;

const FORMAT = "best[ext=mp4][height<=720]/bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4]/best";
const MAX_FILESIZE = "150M";

function parsePercent(line: string): number | null {
  const match = line.match(/\[download\]\s+([\d.]+)%/);
  return match ? parseFloat(match[1]) : null;
}

/** True when a yt-dlp binary is on PATH (local dev on a residential IP). */
export function hasLocalYtDlp(): Promise<boolean> {
  if (process.env.VERCEL) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile("yt-dlp", ["--version"], (err) => resolve(!err));
  });
}

/** Download with the local yt-dlp binary. Returns the mp4 bytes + metadata. */
export async function downloadLocal(
  videoId: string,
  onProgress: Progress,
): Promise<{ data: Buffer; meta: YtMetadata }> {
  const dir = path.join(os.tmpdir(), "movement-coach");
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, `${videoId}.mp4`);
  const infoPath = path.join(dir, `${videoId}.info.json`);
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("yt-dlp", [
      "-f", FORMAT,
      "--merge-output-format", "mp4",
      "--max-filesize", MAX_FILESIZE,
      "--no-playlist",
      "--write-info-json",
      "-o", out,
      "--newline",
      url,
    ]);
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      const pct = parsePercent(d.toString());
      if (pct !== null) onProgress(pct * 0.9, "downloading");
    });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.slice(-500) || `yt-dlp exited ${code}`)),
    );
  });

  const data = await readFile(out);
  let meta: YtMetadata = { title: "", description: "" };
  try {
    const info = JSON.parse(await readFile(infoPath, "utf8"));
    meta = { title: info.title ?? "", description: info.description ?? "" };
  } catch {
    // metadata is best-effort
  }
  await rm(out, { force: true });
  await rm(infoPath, { force: true });
  return { data, meta };
}

/**
 * Download inside a Vercel Sandbox microVM. YouTube bot-checks datacenter
 * IPs, so this generally needs YTDLP_PROXY (a residential proxy URL) or
 * YTDLP_COOKIES (Netscape cookies.txt contents) to succeed.
 */
export async function downloadInSandbox(
  videoId: string,
  onProgress: Progress,
): Promise<{ data: Buffer; meta: YtMetadata }> {
  const { Sandbox } = await import("@vercel/sandbox");
  onProgress(2, "starting sandbox");
  const sandbox = await Sandbox.create({ runtime: "python3.13", timeout: 4 * 60_000 });
  try {
    const run = async (script: string) => {
      const r = await sandbox.runCommand({ cmd: "bash", args: ["-lc", script] });
      return { code: r.exitCode, out: await r.stdout(), err: await r.stderr() };
    };

    onProgress(5, "installing yt-dlp");
    const setup = await run(
      "curl -sSL -o /tmp/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux && chmod +x /tmp/yt-dlp " +
        "&& (curl -fsSL https://deno.land/install.sh | sh -s -- -y >/dev/null 2>&1 || true)",
    );
    if (setup.code !== 0) throw new Error(`yt-dlp install failed: ${setup.err.slice(-300)}`);

    const extra: string[] = [];
    if (process.env.YTDLP_PROXY) extra.push(`--proxy '${process.env.YTDLP_PROXY.replace(/'/g, "")}'`);
    if (process.env.YTDLP_COOKIES) {
      await sandbox.writeFiles([{ path: "/tmp/cookies.txt", content: Buffer.from(process.env.YTDLP_COOKIES) }]);
      extra.push("--cookies /tmp/cookies.txt");
    }

    onProgress(10, "downloading");
    const dl = await run(
      `export PATH=$HOME/.deno/bin:$PATH; /tmp/yt-dlp -f "${FORMAT}" --merge-output-format mp4 --max-filesize ${MAX_FILESIZE} ` +
        `--no-playlist --write-info-json ${extra.join(" ")} -o /tmp/v.mp4 "https://www.youtube.com/watch?v=${videoId}" 2>&1 | tail -5`,
    );
    const data = await sandbox.readFileToBuffer({ path: "/tmp/v.mp4" });
    if (!data) {
      const reason = /not a bot|Sign in/i.test(dl.out)
        ? "YouTube blocked the cloud download (bot check on datacenter IPs)."
        : dl.out.slice(-300);
      throw new Error(reason);
    }
    onProgress(80, "saving");

    let meta: YtMetadata = { title: "", description: "" };
    const info = await sandbox.readFileToBuffer({ path: "/tmp/v.info.json" });
    if (info) {
      try {
        const parsed = JSON.parse(info.toString("utf8"));
        meta = { title: parsed.title ?? "", description: parsed.description ?? "" };
      } catch {
        // metadata is best-effort
      }
    }
    return { data, meta };
  } finally {
    await sandbox.stop().catch(() => {});
  }
}
