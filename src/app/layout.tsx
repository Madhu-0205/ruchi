import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import SafeArea from "@/components/SafeArea";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});

export const metadata: Metadata = {
  title: "RUCHI — రుచి · Let's cook",
  description:
    "Don't ask what to cook. Show RUCHI what you have. Healthy. Affordable. Simple. Let's cook.",
  applicationName: "RUCHI",
  icons: {
    icon: [
      { url: "/ruchi-logo-32.png", sizes: "32x32", type: "image/png" },
      { url: "/ruchi-logo-48.png", sizes: "48x48", type: "image/png" },
      { url: "/ruchi-logo.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/ruchi-logo-apple-touch.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#faf6ef",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        {/* Static loading splash: replaced the moment React mounts. The
            official mark, subtle — no animation, no fake progress. A raw img
            is intentional: no lazy-load hop for a pre-hydration element. */}
        <div id="boot-splash" className="boot-splash">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ruchi-logo-192.png" alt="" width={72} height={72} />
        </div>
        <SafeArea>{children}</SafeArea>
      </body>
    </html>
  );
}
