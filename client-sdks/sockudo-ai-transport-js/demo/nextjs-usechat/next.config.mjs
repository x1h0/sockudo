import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@sockudo/ai-transport"],
  turbopack: { root },
};

export default nextConfig;
