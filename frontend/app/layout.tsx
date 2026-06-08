import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import Providers from "@/components/Providers";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["300", "400", "500", "600", "700"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "NEXTUP.AI | PLACEMENT MANAGEMENT OS",
  description: "Zero-knowledge placement drive tracker and intelligence engine.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${spaceGrotesk.variable} ${inter.variable} antialiased selection:bg-accent selection:text-accent-foreground`}>
        {/* SVG Noise filter overlay for Kinetic poster texture */}
        <svg className="pointer-events-none fixed inset-0 z-50 h-full w-full opacity-[0.02] mix-blend-overlay" xmlns="http://www.w3.org/2000/svg">
          <filter id="noiseFilter">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch" />
          </filter>
          <rect width="100%" height="100%" filter="url(#noiseFilter)" />
        </svg>

        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
