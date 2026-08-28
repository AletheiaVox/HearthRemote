import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const projectRoot = resolve(import.meta.dirname, "..");
const source = resolve(projectRoot, "assets", "icon.svg");
const outputDirectory = resolve(projectRoot, "build");
const output = resolve(outputDirectory, "icon.png");
const publicDirectory = resolve(projectRoot, "src", "renderer", "public");

await mkdir(outputDirectory, { recursive: true });
await mkdir(publicDirectory, { recursive: true });
await sharp(source, { density: 192 })
  .resize(512, 512)
  .png({ compressionLevel: 9 })
  .toFile(output);

await Promise.all([
  sharp(source, { density: 192 }).resize(192, 192).png({ compressionLevel: 9 }).toFile(resolve(publicDirectory, "icon-192.png")),
  sharp(source, { density: 192 }).resize(512, 512).png({ compressionLevel: 9 }).toFile(resolve(publicDirectory, "icon-512.png")),
  sharp(source, { density: 192 }).resize(180, 180).png({ compressionLevel: 9 }).toFile(resolve(publicDirectory, "apple-touch-icon.png")),
]);

console.log(`Generated ${output}`);
