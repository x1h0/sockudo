/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@sockudo/ai-transport"],
};

export default nextConfig;
