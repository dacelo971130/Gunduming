import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AETHER FRAME // TACTICAL COCKPIT",
  description: "A voice-controlled AI co-pilot that turns a browser into a living mecha cockpit.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistMono.variable} antialiased bg-hud-void text-hud-white`}>
        {children}
      </body>
    </html>
  );
}
