import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NEXTUP.AI — Placement Tracker for VIT",
    short_name: "NEXTUP.AI",
    description:
      "Track campus placements, get automatic shortlist alerts, and manage your entire placement journey — built for VIT Vellore students.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090B",
    theme_color: "#DFE104",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
    categories: ["education", "productivity"],
    lang: "en",
    orientation: "portrait-primary",
  };
}
