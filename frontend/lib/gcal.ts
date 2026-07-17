// Google Calendar "add event" template links.
//
// The old integration OAuth-synced our events into the user's Google
// Calendar automatically — but Google requires app verification for the
// calendar.events scope, which blocks every user until approval. The
// template URL below needs NO OAuth, NO API key and NO verification: it
// opens Google Calendar's own "create event" screen pre-filled with the
// event details, and the user saves it into their account themselves.

interface GcalEventInput {
  title: string;
  date: string; // ISO datetime of the event start
  company_name?: string | null;
  role?: string | null;
  location_platform?: string | null;
  notes?: string | null;
}

/** Format a Date as Google Calendar's UTC stamp: YYYYMMDDTHHMMSSZ */
function gcalStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildGoogleCalendarUrl(ev: GcalEventInput): string {
  const start = new Date(ev.date);
  // Placement events rarely announce an end time — default 1 hour.
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const detailLines: string[] = [];
  if (ev.company_name) detailLines.push(`Company: ${ev.company_name}`);
  if (ev.role) detailLines.push(`Role: ${ev.role}`);
  if (ev.notes) detailLines.push(ev.notes);
  detailLines.push("Added from NextUp placement tracker.");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.company_name ? `${ev.company_name} — ${ev.title}` : ev.title,
    dates: `${gcalStamp(start)}/${gcalStamp(end)}`,
    details: detailLines.join("\n"),
  });
  if (ev.location_platform) params.set("location", ev.location_platform);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
