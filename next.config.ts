import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql", "exceljs", "pdfkit"],
  outputFileTracingIncludes: {
    "/api/rooms/*/export": ["./lib/export-assets/*.ttf"],
  },
};

export default nextConfig;
