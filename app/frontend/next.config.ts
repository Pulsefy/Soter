import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    allowedDevOrigins: ['127.0.0.1', 'localhost'],
  turbopack: {
    root: path.join(__dirname, '../..'),
  },
};

export default nextConfig;
