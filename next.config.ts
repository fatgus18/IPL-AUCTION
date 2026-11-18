import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql", "exceljs", "pdfkit", "sharp"],
  outputFileTracingIncludes: {
    "/api/rooms/*/export": ["./lib/export-assets/*.ttf"],
    "/api/rooms/*/poster": ["./lib/export-assets/*.ttf", "./public/ipl/players/*", "./public/ipl/teams/*"],
  },
};

export default nextConfig;
