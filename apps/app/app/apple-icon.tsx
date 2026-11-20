import { ImageResponse } from "next/og";

// iOS reads this for the home-screen icon when a user does
// Share -> Add to Home Screen -- Next.js auto-injects the
// <link rel="apple-touch-icon"> tag for this file.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0496ff",
          color: "#ffffff",
          fontSize: 110,
          fontWeight: 700,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        M
      </div>
    ),
    size,
  );
}
