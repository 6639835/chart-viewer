/** @type {import('next').NextConfig} */
const webpack = require("webpack");

const nextConfig = {
  reactStrictMode: true,
  output: "export",

  compress: true,
  poweredByHeader: false,

  // Explicitly opt into Turbopack defaults for `next dev`; Cesium's base URL is
  // set at runtime before dynamic import in GlobeViewer.
  turbopack: {},

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
