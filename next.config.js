/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Production optimizations
  compress: true,
  poweredByHeader: false,

  // Turbopack configuration (Next.js 16 default)
  // Note: canvas aliasing is handled differently in Turbopack
  turbopack: {},

  // Webpack fallback configuration (for --webpack flag)
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

module.exports = nextConfig;
