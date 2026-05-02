const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Compile backend TS files on import (workspaces). Backend uses ~ as its
  // own internal alias; webpack alias below makes it resolve to the
  // sibling package's src dir.
  transpilePackages: ['backend'],
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '~': path.resolve(__dirname, '../backend/src')
    }
    return config
  }
}

module.exports = nextConfig
