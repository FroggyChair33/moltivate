import type { MetadataRoute } from "next";

// Next.js auto-serves this at /manifest.webmanifest and injects the
// matching <link rel="manifest"> tag. display: "standalone" is what makes
// an iOS/Android home-screen install open without browser chrome.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Moltivate",
    short_name: "Moltivate",
    description: "Put your money where your muscles are.",
    start_url: "/",
    display: "standalone",
    background_color: "#f9f8f2",
    theme_color: "#173e2c",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
