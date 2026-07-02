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

const BASE_URL = "https://nextup.ai";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "NEXTUP.AI — Placement Tracker for VIT Vellore Students",
    template: "%s | NEXTUP.AI",
  },
  description:
    "Never miss a campus placement shortlist again. NEXTUP.AI automatically tracks CDC emails, checks your eligibility for drives, and manages your entire placement journey — built for VIT Vellore students.",
  keywords: [
    "VIT placement tracker",
    "VIT Vellore placement",
    "CDC placement automation",
    "campus placement management",
    "shortlist notification",
    "placement drive tracker",
    "VIT CDC email parser",
    "job application tracker students",
    "VIT placements 2025",
    "placement eligibility checker",
  ],
  authors: [{ name: "NEXTUP.AI" }],
  creator: "NEXTUP.AI",
  publisher: "NEXTUP.AI",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: BASE_URL,
    siteName: "NEXTUP.AI",
    title: "NEXTUP.AI — Never Miss a Placement Shortlist",
    description:
      "The all-in-one placement tracker for VIT Vellore students. Auto-detect shortlists, track applications, check eligibility, and prepare smarter.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "NEXTUP.AI — Placement Tracker for VIT Vellore",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "NEXTUP.AI — Never Miss a Placement Shortlist",
    description:
      "Auto-detect placement shortlists from CDC emails, track applications, and prepare smarter. Built for VIT Vellore students.",
    images: ["/og-image.png"],
  },
  alternates: {
    canonical: BASE_URL,
  },
  category: "education",
};

// JSON-LD structured data for WebApplication schema
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "NEXTUP.AI",
  url: BASE_URL,
  description:
    "A privacy-first placement tracking platform for VIT Vellore students. Automatically parses CDC emails for shortlists, checks drive eligibility, and manages the full placement journey.",
  applicationCategory: "EducationApplication",
  operatingSystem: "Web Browser",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "INR",
  },
  audience: {
    "@type": "EducationalAudience",
    educationalRole: "student",
  },
  featureList: [
    "Automatic shortlist detection from Gmail",
    "Campus placement eligibility checker",
    "Application status tracker",
    "Placement drive calendar",
    "AI-powered resume keyword analysis",
    "Privacy-first encrypted data storage",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${spaceGrotesk.variable} ${inter.variable} antialiased selection:bg-accent selection:text-accent-foreground`}>

        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
