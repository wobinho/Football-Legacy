import type { Metadata, Viewport } from "next";
import { Saira_Condensed, Instrument_Sans } from "next/font/google";
import "./globals.css";

const saira = Saira_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-saira",
});

const instrument = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-instrument",
});

export const metadata: Metadata = {
  title: "Football Legacy",
  description: "Build a dynasty. Write the history books.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Football Legacy" },
};

// Mobile-friendly viewport: fit the device width, allow zoom, and respect the
// safe-area on notched phones (used by the fixed mobile top bar in the Shell).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0c0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${saira.variable} ${instrument.variable}`}>
      <body>{children}</body>
    </html>
  );
}
