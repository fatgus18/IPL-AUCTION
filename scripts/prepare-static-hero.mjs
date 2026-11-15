/** Build small, deterministic local derivatives; originals and their credits are preserved. */
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public/hero-player");
const players = ["virat-kohli", "jasprit-bumrah", "shubman-gill", "rishabh-pant", "kl-rahul", "shreyas-iyer", "hardik-pandya", "rohit-sharma"];
await mkdir(output, { recursive: true });
let portraitBytes = 0;
for (const id of players) {
  const source = path.join(root, "public", "ipl/players", `${id}.webp`);
  const target = path.join(output, `${id}.webp`);
  // Remove transparent margins so the faces remain large without oversized files.
  await sharp(source).trim({ background: "#00000000", threshold: 8 }).resize({ height: 460, withoutEnlargement: true }).webp({ quality: 72, effort: 6 }).toFile(target);
  const bytes = (await stat(target)).size;
  portraitBytes += bytes;
  console.log(`${id}: ${bytes} bytes`);
}
const stadium = path.join(output, "stadium.webp");
await sharp(path.join(root, "public/cinematic/stadium-poster.webp")).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 48, effort: 5 }).toFile(stadium);
console.log(`Eight portraits: ${portraitBytes} bytes; background: ${(await stat(stadium)).size} bytes`);
