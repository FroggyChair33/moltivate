import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "./components/nav";

// Same self-hosted fonts as the apps/web marketing site (see its
// assets/fonts/ -- license files copied alongside these), so the
// functional app reads as the same brand. DM Sans is body text, Fraunces
// is the serif used for headings, La Belle Aurore is a handwritten
// accent font for sparing use (not body or heading text).
const dmSans = localFont({
  src: "./fonts/dm-sans.woff2",
  weight: "400 700",
  variable: "--font-dm-sans",
  display: "swap",
});

const fraunces = localFont({
  src: [
    { path: "./fonts/fraunces.woff2", weight: "500 700", style: "normal" },
    { path: "./fonts/fraunces-italic.woff2", weight: "500 600", style: "italic" },
  ],
  variable: "--font-fraunces",
  display: "swap",
});

const laBelleAurore = localFont({
  src: "./fonts/la-belle-aurore.woff2",
  weight: "400",
  variable: "--font-hand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Moltivate",
  description: "Put your money where your muscles are.",
  // iOS reads this for "Add to Home Screen" -- without it, a home-screen
  // launch still opens inside Safari chrome instead of standalone.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Moltivate",
  },
};

export const viewport: Viewport = {
  themeColor: "#173e2c",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${fraunces.variable} ${laBelleAurore.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <Nav />
          <main id="main-content" className="flex flex-1 flex-col">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
