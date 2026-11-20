import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql", "exceljs", "pdfkit", "sharp", "@vercel/sandbox"],
  outputFileTracingIncludes: {
    "/api/rooms/*/season": ["./lib/season-source.ts", "./lib/season-cloud-runner.mjs"],
    "/api/rooms/*/export": ["./lib/export-assets/*.ttf"],
    "/api/rooms/*/poster": ["./lib/export-assets/*.ttf", "./public/ipl/players/*", "./public/ipl/teams/*", "./public/cinematic/stadium-poster.webp", "./public/fonts/barlow-condensed-800.woff2"],
  },
};

export default nextConfig;
