import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // Gotenberg loads the print route as http://client:3000 inside the compose network.
  allowedDevOrigins: ["client"],
  transpilePackages: ["@paypure/domain"],
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default config;
