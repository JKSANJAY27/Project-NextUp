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

const BASE_URL = "https://project-next-up.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "NextUp VIT — Free Placement Tracker for VIT Vellore Students",
    template: "%s | NextUp VIT",
  },
  description:
    "NextUp is the free placement tracker for VIT Vellore students. Automatically reads CDC emails, detects shortlists, checks eligibility, and manages your entire campus placement journey — never miss a drive again.",
  keywords: [
    // Exact-match queries people type
    "nextup vit",
    "nextup vit vellore",
    "nextup ai vit",
    "project nextup vit",
    "placement tracker vit",
    "vit placement tracker",
    "vit placement tracker app",
    "placement tracker for vit students",
    // VIT-specific CDC terms
    "VIT CDC tracker",
    "VIT CDC placement automation",
    "VIT CDC email parser",
    "VIT Vellore placement",
    "VIT placements 2025",
    "VIT placements 2026",
    // Feature keywords
    "campus placement management",
    "placement drive tracker",
    "shortlist notification VIT",
    "placement eligibility checker VIT",
    "CDC shortlist detector",
    "job application tracker students India",
  ],
  authors: [
    { name: "Sanjay J K", url: "https://github.com/JKSANJAY27" },
    { name: "Hariprasad T", url: "https://github.com/HARIPRASAD-04" },
  ],
  creator: "Sanjay J K & Hariprasad T",
  publisher: "NextUp VIT",
  applicationName: "NextUp VIT",
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
    siteName: "NextUp VIT",
    title: "NextUp VIT — Free Placement Tracker for VIT Vellore",
    description:
      "The free placement tracker built for VIT Vellore students. Auto-detect CDC shortlists, track all your applications, check drive eligibility, and prepare smarter — in one place.",
    images: [
      {
        url: `${BASE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "NextUp VIT — Placement Tracker for VIT Vellore Students",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "NextUp VIT — Free Placement Tracker for VIT Vellore",
    description:
      "Auto-detect CDC shortlists, track applications, check eligibility. The free placement tracker built for VIT Vellore students.",
    images: [`${BASE_URL}/og-image.png`],
  },
  alternates: {
    canonical: BASE_URL,
  },
  category: "education",
};

// JSON-LD structured data
const jsonLdApp = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "NextUp VIT",
  alternateName: [
    "NextUp",
    "NEXTUP.AI",
    "NextUp placement tracker",
    "VIT placement tracker",
    "placement tracker VIT Vellore",
    "NextUp VIT Vellore",
  ],
  url: BASE_URL,
  description:
    "NextUp is a free, privacy-first placement tracking platform for VIT Vellore students. Automatically reads CDC emails to detect shortlists, checks your eligibility for drives, and manages your entire campus placement journey.",
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
    audienceType: "VIT Vellore engineering students appearing for campus placement drives",
  },
  featureList: [
    "Automatic shortlist detection from CDC Gmail",
    "Campus placement eligibility checker for VIT drives",
    "Application status tracker (Applied → OA → Interview → Offer)",
    "Placement drive calendar with auto-extracted deadlines",
    "AI-powered resume tailoring and keyword gap analysis",
    "Privacy-first AES-256 encrypted data storage",
    "Browser push notifications for shortlists",
  ],
  creator: [
    {
      "@type": "Person",
      name: "Sanjay J K",
      url: "https://github.com/JKSANJAY27",
      affiliation: { "@type": "CollegeOrUniversity", name: "VIT Vellore" },
    },
    {
      "@type": "Person",
      name: "Hariprasad T",
      url: "https://github.com/HARIPRASAD-04",
      affiliation: { "@type": "CollegeOrUniversity", name: "VIT Vellore" },
    },
  ],
};

const jsonLdOrg = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "NextUp VIT",
  alternateName: ["NEXTUP.AI", "NextUp placement tracker"],
  url: BASE_URL,
  description:
    "NextUp VIT is a student-built placement tracking platform for VIT Vellore. It helps students manage campus placement drives, detect CDC shortlists automatically, and tailor resumes using AI.",
  foundingLocation: { "@type": "Place", name: "VIT Vellore, Tamil Nadu, India" },
  areaServed: { "@type": "Place", name: "VIT Vellore" },
  member: [
    { "@type": "Person", name: "Sanjay J K" },
    { "@type": "Person", name: "Hariprasad T" },
  ],
};

const jsonLdFaq = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is NextUp VIT?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "NextUp VIT (also called NextUp or NEXTUP.AI) is a free placement tracker built for VIT Vellore students. It automatically reads CDC placement emails, detects when you are shortlisted, checks your eligibility for campus drives, and manages all your job applications in one dashboard.",
      },
    },
    {
      "@type": "Question",
      name: "Is there a placement tracker for VIT Vellore students?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. NextUp VIT (https://project-next-up.vercel.app) is a free, student-built placement tracker specifically for VIT Vellore. It connects to your college Gmail to auto-detect CDC shortlists and tracks all your placement applications.",
      },
    },
    {
      "@type": "Question",
      name: "How does NextUp VIT detect CDC shortlists?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "NextUp VIT connects to your college Gmail once using OAuth. It then monitors incoming CDC emails in the background. When a shortlist Excel sheet arrives, it checks whether your registration number appears and notifies you instantly.",
      },
    },
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
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdApp) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdOrg) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdFaq) }}
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
