import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@matta/core'],
  serverExternalPackages: ['firebase-admin', 'google-auth-library'],
};

export default config;
