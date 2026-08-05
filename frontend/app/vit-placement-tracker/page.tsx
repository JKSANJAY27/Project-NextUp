import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";

const SITE_URL = "https://project-next-up.vercel.app";
const PAGE_URL = `${SITE_URL}/vit-placement-tracker`;

export const metadata: Metadata = {
  title: "VIT Placement Tracker | Track CDC Drives, Shortlists & Eligibility",
  description:
    "NextUp is a free VIT Vellore placement tracker. Organise CDC placement drives, receive shortlist alerts, check eligibility, and manage applications in one place.",
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: "VIT Placement Tracker | NextUp",
    description:
      "A free placement tracker for VIT Vellore students: CDC drive updates, shortlist detection, eligibility checks, and application tracking.",
    url: PAGE_URL,
  },
};

const steps = [
  ["See relevant drives", "Keep placement-drive information, dates, and deadlines in one organised view."],
  ["Check eligibility", "Compare your academic profile with each drive's criteria before you apply."],
  ["Track every stage", "Follow applications from applied through online assessment, interview, offer, or rejection."],
  ["Catch shortlists", "Connect your college Gmail to receive an alert when a CDC shortlist includes your registration number."],
];

export default function VITPlacementTrackerPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "VIT Placement Tracker",
    description: metadata.description,
    url: PAGE_URL,
    isPartOf: { "@type": "WebSite", name: "NextUp VIT", url: SITE_URL },
    about: [
      { "@type": "Thing", name: "VIT Vellore campus placements" },
      { "@type": "Thing", name: "Career Development Centre placement drives" },
    ],
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <header className="flex min-h-20 items-center justify-between gap-4 border-b-2 border-border px-6 md:px-16">
        <Link href="/" className="flex items-center" aria-label="NextUp home"><Logo size="md" /></Link>
        <Link href="/register" className="border-2 border-border bg-accent px-4 py-2 text-xs font-extrabold uppercase tracking-wider text-black transition-colors hover:bg-foreground hover:text-background">Start free</Link>
      </header>

      <article className="mx-auto max-w-4xl px-6 py-16 md:py-24">
        <p className="mb-4 text-xs font-extrabold uppercase tracking-[0.2em] text-accent">For VIT Vellore students</p>
        <h1 className="max-w-3xl text-4xl font-extrabold tracking-tighter md:text-6xl">VIT Placement Tracker</h1>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground">NextUp is a free, student-built platform for managing the VIT Vellore campus-placement journey. It helps you follow CDC drives, understand eligibility, track applications, and spot shortlists without juggling spreadsheets and inbox searches.</p>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">NextUp is independent and is not affiliated with or endorsed by VIT Vellore or its Career Development Centre. Always confirm decisions and deadlines with official CDC communication.</p>

        <section className="mt-16 border-y-2 border-border py-10" aria-labelledby="how-nextup-helps">
          <h2 id="how-nextup-helps" className="text-2xl font-extrabold tracking-tight">How NextUp helps with VIT placements</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {steps.map(([title, detail], index) => <div key={title} className="border-l-2 border-accent pl-5"><p className="text-xs font-bold text-accent">0{index + 1}</p><h3 className="mt-1 font-bold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail}</p></div>)}
          </div>
        </section>

        <section className="mt-16" aria-labelledby="who-is-it-for">
          <h2 id="who-is-it-for" className="text-2xl font-extrabold tracking-tight">Who is this placement tracker for?</h2>
          <p className="mt-4 leading-relaxed text-muted-foreground">NextUp is designed for VIT Vellore students navigating campus recruitment. Eligibility checking works from the profile you provide; drive coverage depends on the CDC emails available to the connected inbox. It is useful whether you are preparing for your first applications or keeping track of multiple assessments and interviews.</p>
        </section>

        <section className="mt-16 border-2 border-border bg-muted/20 p-8" aria-labelledby="get-started">
          <h2 id="get-started" className="text-2xl font-extrabold tracking-tight">Ready to organise your placement journey?</h2>
          <p className="mt-3 text-muted-foreground">Create a free account, add your profile, and begin tracking your VIT placement applications.</p>
          <Link href="/register" className="mt-6 inline-block bg-accent px-5 py-3 text-sm font-extrabold uppercase tracking-wider text-black hover:bg-foreground hover:text-background">Create a free account</Link>
        </section>
      </article>
    </main>
  );
}
