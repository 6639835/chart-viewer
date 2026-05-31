/** @type {import('next').NextConfig} */
const webpack = require("webpack");

const nextConfig = {
  reactStrictMode: true,
  output: "export",

  compress: true,
  poweredByHeader: false,

  // Turbopack (next dev) — define CESIUM_BASE_URL at compile time
  turbopack: {
    define: {
      CESIUM_BASE_URL: JSON.stringify("/cesium/"),
    },
  },

  // Webpack (next build / --webpack) — same define via DefinePlugin
  webpack: (config) => {
    config.resolve.alias.canvas = false;

    config.resolve.fallback = {
      ...config.resolve.fallback,
      https: false,
      zlib: false,
      http: false,
      url: false,
      fs: false,
    };

    config.plugins.push(
      new webpack.DefinePlugin({
        CESIUM_BASE_URL: JSON.stringify("/cesium/"),
      })
    );

    return config;
  },
};

module.exports = nextConfig;
