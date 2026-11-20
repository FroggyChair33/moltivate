import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "./components/nav";

// Self-hosted brand font (app/fonts/, OFL license alongside): DM Sans for all text.
const dmSans = localFont({
  src: "./fonts/dm-sans.woff2",
  weight: "400 700",
  variable: "--font-dm-sans",
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
  themeColor: "#07121f",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} h-full antialiased`}
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
