import { fileURLToPath } from "node:url";

const frontendRoot = fileURLToPath(new URL(".", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: frontendRoot },
  outputFileTracingRoot: frontendRoot,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "cdn4.volusion.store",
        pathname: "/**",
      },
      // Product photos copied to Cloudflare Images (be-eominio/utils/cloudflareImages.js).
      {
        protocol: "https",
        hostname: "imagedelivery.net",
        pathname: "/**",
      },
      // Auth-page slideshow (see components/layout/AuthLayout.jsx).
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
