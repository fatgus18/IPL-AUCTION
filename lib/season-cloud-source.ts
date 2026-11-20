import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseSeasonSourceImport, SeasonSourceError, validateSeasonSourceUrl, type SeasonSourceSnapshot } from "./season-source.ts";

const SOURCE_PATH = "/tmp/season-source.ts", RUNNER_PATH = "/tmp/run.mjs", RESULT_PATH = "/tmp/result.json";
const MAX_RESULT_BYTES = 1_000_000;
const PROVIDER_HOSTS = ["www.cricinfo.com", "cricinfo.com", "www.espncricinfo.com", "espncricinfo.com"];

type CreateOptions = {
  persistent: false; resources: { vcpus: number }; timeout: number; region: "bom1";
  image: "vercel/sandbox/universal"; networkPolicy: { allow: string[] }; signal: AbortSignal;
};
type CommandOptions = { cmd: "node"; args: string[]; cwd: "/tmp"; timeoutMs: number; signal: AbortSignal };
export type SeasonCloudSandbox = {
  writeFiles(files: { path: string; content: Uint8Array }[], options: { signal: AbortSignal }): Promise<void>;
  runCommand(options: CommandOptions): Promise<{ exitCode: number }>;
  readFileToBuffer(file: { path: string; cwd: string }, options: { signal: AbortSignal }): Promise<Buffer | null>;
  stop(options: { signal: AbortSignal }): Promise<unknown>;
};
export type SeasonCloudRuntime = {
  create(options: CreateOptions): Promise<SeasonCloudSandbox>;
  readAsset(asset: "season-source.ts" | "season-cloud-runner.mjs"): Promise<Buffer>;
  /** Shorter deterministic deadlines for tests; production uses 32s work + 6s cleanup. */
  workTimeoutMs?: number; cleanupTimeoutMs?: number;
};

const unavailable = () => new SeasonSourceError("The cloud data source is temporarily unavailable. Your saved points are unchanged; try again later.", 503, "SEASON_CLOUD_UNAVAILABLE");
const timeoutError = () => new SeasonSourceError("The cloud data request took too long. Your saved points are unchanged; try again later.", 504, "SEASON_CLOUD_TIMEOUT");
const invalidResult = () => new SeasonSourceError("The cloud source returned an incomplete or invalid table. Your saved points are unchanged.", 502, "SEASON_SOURCE_RESPONSE");

function parseCloudResult(buffer: Buffer | null, input: string, startedAt: number, now: number, exitCode: number): SeasonSourceSnapshot {
  if (!buffer || buffer.byteLength > MAX_RESULT_BYTES) throw invalidResult();
  let value: unknown;
  try { value = JSON.parse(buffer.toString("utf8")); } catch { throw invalidResult(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidResult();
  const envelope = value as Record<string, unknown>;
  if (envelope.ok === false) {
    const error = envelope.error && typeof envelope.error === "object" ? envelope.error as Record<string, unknown> : {};
    if (error.code === "SEASON_SOURCE_RATE_LIMIT") throw new SeasonSourceError("ESPNcricinfo is limiting requests. Your saved points are unchanged; try again later.", 429, "SEASON_SOURCE_RATE_LIMIT");
    if (error.code === "SEASON_SOURCE_RESPONSE") throw invalidResult();
    throw new SeasonSourceError("ESPNcricinfo could not supply that MVP table. Your saved points are unchanged; try again later.", 502, "SEASON_SOURCE_UNAVAILABLE");
  }
  if (envelope.ok !== true || exitCode !== 0 || !envelope.snapshot || typeof envelope.snapshot !== "object" || Array.isArray(envelope.snapshot)) throw invalidResult();
  const candidate = envelope.snapshot as Record<string, unknown>;
  const source = validateSeasonSourceUrl(input);
  const capturedAt = typeof candidate.fetchedAt === "string" ? Date.parse(candidate.fetchedAt) : NaN;
  if (candidate.sourceUrl !== source.url.href || candidate.provider !== "espncricinfo" || candidate.seriesId !== source.seriesId
    || typeof candidate.seriesName !== "string" || !candidate.seriesName.trim() || candidate.seriesName.length > 120 || /[<>\u0000-\u001f]/.test(candidate.seriesName)
    || !Number.isFinite(capturedAt) || capturedAt < startedAt - 5000 || capturedAt > now + 5000
    || !Array.isArray(candidate.rows) || !Number.isSafeInteger(envelope.totalRows) || envelope.totalRows !== candidate.rows.length
    || candidate.rows.length < 1 || candidate.rows.length > 1000
    || candidate.rows.some(row => !row || typeof row !== "object" || !/^[1-9]\d{0,9}$/.test(String((row as Record<string, unknown>).providerPlayerId)))) throw invalidResult();
  try {
    const checked = parseSeasonSourceImport(JSON.stringify(candidate.rows), source.url.href, new Date(capturedAt).toISOString());
    return { ...checked, seriesName: candidate.seriesName.trim() };
  } catch { throw invalidResult(); }
}

/** One fixed, non-persistent cloud task; never forwards application environment or credentials. */
export function createSeasonCloudSource(runtime: SeasonCloudRuntime) {
  return async function fetchInCloud(input: string): Promise<SeasonSourceSnapshot> {
    const source = validateSeasonSourceUrl(input);
    const startedAt = Date.now();
    const workMs = runtime.workTimeoutMs ?? 32_000, cleanupMs = runtime.cleanupTimeoutMs ?? 6_000;
    const workController = new AbortController();
    let sandbox: SeasonCloudSandbox | null = null;
    let stopPromise: Promise<void> | null = null;
    let expired = false;
    const stop = (): Promise<void> => {
      if (!sandbox) return Promise.resolve();
      if (!stopPromise) {
        const instance = sandbox;
        const cleanupController = new AbortController();
        stopPromise = (async () => {
          let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
          const cutoff = new Promise<void>(resolve => { cleanupTimer = setTimeout(() => { cleanupController.abort(); resolve(); }, cleanupMs); });
          try { await Promise.race([Promise.resolve().then(() => instance.stop({ signal: cleanupController.signal })).then(() => undefined).catch(() => undefined), cutoff]); }
          finally { if (cleanupTimer) clearTimeout(cleanupTimer); }
        })();
      }
      return stopPromise;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cutoff = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { expired = true; workController.abort(); reject(timeoutError()); }, workMs); });
    const work = async () => {
      const [parser, runner] = await Promise.all([runtime.readAsset("season-source.ts"), runtime.readAsset("season-cloud-runner.mjs")]);
      if (expired) throw timeoutError();
      if (parser.byteLength > 128_000 || runner.byteLength > 16_000) throw unavailable();
      sandbox = await runtime.create({ persistent: false, resources: { vcpus: 1 }, timeout: 45_000, region: "bom1", image: "vercel/sandbox/universal", networkPolicy: { allow: [...PROVIDER_HOSTS] }, signal: workController.signal });
      if (expired) { await stop(); throw timeoutError(); }
      await sandbox.writeFiles([{ path: SOURCE_PATH, content: parser }, { path: RUNNER_PATH, content: runner }], { signal: workController.signal });
      if (expired) throw timeoutError();
      const command = await sandbox.runCommand({ cmd: "node", args: ["--experimental-strip-types", RUNNER_PATH, source.url.href], cwd: "/tmp", timeoutMs: Math.min(20_000, Math.max(1, startedAt + workMs - Date.now())), signal: workController.signal });
      if (expired) throw timeoutError();
      const buffer = await sandbox.readFileToBuffer({ path: RESULT_PATH, cwd: "/tmp" }, { signal: workController.signal });
      if (expired) throw timeoutError();
      return parseCloudResult(buffer, source.url.href, startedAt, Date.now(), command.exitCode);
    };
    try { return await Promise.race([work(), cutoff]); }
    catch (error) {
      if (expired) throw timeoutError();
      if (error instanceof SeasonSourceError) throw error;
      throw unavailable(); // Never return raw SDK messages, control-plane URLs, or credentials.
    } finally {
      if (timer) clearTimeout(timer);
      workController.abort();
      await stop();
    }
  };
}

const fetchInCloud = createSeasonCloudSource({
  create: async options => (await import("@vercel/sandbox")).Sandbox.create(options),
  readAsset: asset => readFile(path.join(process.cwd(), "lib", asset)),
});
export async function fetchSeasonSourceInCloud(input: string): Promise<SeasonSourceSnapshot> { return fetchInCloud(input); }
