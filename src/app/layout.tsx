import type { Metadata, Viewport } from "next";
import "./globals.css";
import SafeArea from "@/components/SafeArea";

export const metadata: Metadata = {
  title: "RUCHI — రుచి · Let's cook",
  description:
    "Don't ask what to cook. Show RUCHI what you have. Healthy. Affordable. Simple. Let's cook.",
  applicationName: "RUCHI",
};

export const viewport: Viewport = {
  themeColor: "#fbf7f1",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SafeArea>{children}</SafeArea>
      </body>
    </html>
  );
}
