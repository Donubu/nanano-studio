import type { NextConfig } from "next";
import packageJson from "./package.json";

const nextConfig: NextConfig = {
  output: "standalone",
  trailingSlash: false,
  skipTrailingSlashRedirect: false,
  experimental: {
    middlewareClientMaxBodySize: "50mb",
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "static.puer.to",
      },
    ],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
};

export default nextConfig;
