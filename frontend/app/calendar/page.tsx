"use client";

import React, { useState, useEffect } from "react";
import api from "@/lib/api";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Download, ShieldCheck } from "lucide-react";

interface PlacementEvent {
  id: string;
  title: string;
  type: "deadline" | "visit";
  companyName: string;
  date: Date;
  description: string;
}

export default function CalendarPage() {
  const [events, setEvents] = useState<PlacementEvent[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDayEvents, setSelectedDayEvents] = useState<PlacementEvent[]>([]);
  const [selectedDateStr, setSelectedDateStr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvents = async () => {
      setLoading(true);
      try {
        const res = await api.get("/companies");
        const extractedEvents: PlacementEvent[] = [];
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        res.data.forEach((company: any) => {
          if (company.registration_deadline) {
            extractedEvents.push({
              id: `${company.id}-deadline`,
              title: `DEADLINE: ${company.name.toUpperCase()} (${company.category.toUpperCase()})`,
              type: "deadline",
              companyName: company.name,
              date: new Date(company.registration_deadline),
              description: `Last date to register for ${company.name} (${company.role}). Category: ${company.category}. CTC: ${company.ctc || "N/A"}.`
            });
          }
          
          if (company.visit_date) {
            extractedEvents.push({
              id: `${company.id}-visit`,
              title: `VISIT: ${company.name.toUpperCase()}`,
              type: "visit",
              companyName: company.name,
              date: new Date(company.visit_date),
              description: `Company visit / Selection process for ${company.name} (${company.role}).`
            });
          }
        });
        
        setEvents(extractedEvents);
      } catch (err) {
        console.error("Failed to load calendar events", err);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, []);

  // Helper: Get days in month
  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  // Helper: Get first day index of month (0 = Sun, 1 = Mon...)
  const getFirstDayOfMonth = (year: number, month: number) => {
    const day = new Date(year, month, 1).getDay();
    // Adjust so 0 = Mon, 6 = Sun
    return day === 0 ? 6 : day - 1;
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayIndex = getFirstDayOfMonth(year, month);

  // Month navigation
  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedDayEvents([]);
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedDayEvents([]);
  };

  const monthNames = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"
  ];

  const daysOfWeek = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

  // Helper: Filter events for a specific day
  const getEventsForDay = (day: number) => {
    return events.filter(
      (e) =>
        e.date.getDate() === day &&
        e.date.getMonth() === month &&
        e.date.getFullYear() === year
    );
  };

  const handleDayClick = (day: number) => {
    const dayEvents = getEventsForDay(day);
    setSelectedDayEvents(dayEvents);
    setSelectedDateStr(`${day} ${monthNames[month]} ${year}`);
  };

  // Google Calendar .ics Download Helper
  const downloadIcs = (event: PlacementEvent) => {
    const formatICSDate = (date: Date) => {
      return date.toISOString().replace(/-|:|\.\d+/g, "");
    };

    // End date defaults to 1 hour after start date
    const endDate = new Date(event.date.getTime() + 60 * 60 * 1000);

    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//NextupAI//PlacementOS//EN",
      "BEGIN:VEVENT",
      `UID:${event.id}@nextupai.com`,
      `DTSTAMP:${formatICSDate(new Date())}`,
      `DTSTART:${formatICSDate(event.date)}`,
      `DTEND:${formatICSDate(endDate)}`,
      `SUMMARY:${event.title}`,
      `DESCRIPTION:${event.description.replace(/\n/g, "\\n")}`,
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${event.title.replace(/\s+/g, "_")}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Generate calendar grid array
  const calendarGrid = [];
  // Add empty spaces for padding before first day
  for (let i = 0; i < firstDayIndex; i++) {
    calendarGrid.push(null);
  }
  // Add actual days
  for (let i = 1; i <= daysInMonth; i++) {
    calendarGrid.push(i);
  }

  return (
    <div className="flex-1 bg-background p-8 md:p-12 space-y-12">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b-2 border-border pb-8">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-accent uppercase">
            <ShieldCheck size={16} />
            <span>🔒 Vault Connected</span>
          </div>
          <h1 className="text-5xl font-extrabold tracking-tighter uppercase leading-none">
            CALENDAR
          </h1>
        </div>

        {/* Month Navigation */}
        <div className="flex items-center gap-4 border-2 border-border p-1 bg-background">
          <button 
            onClick={prevMonth}
            className="p-2 bg-muted hover:bg-accent hover:text-black border border-transparent transition-all active:scale-95"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs font-black tracking-widest px-4 uppercase text-foreground min-w-[150px] text-center">
            {monthNames[month]} {year}
          </span>
          <button 
            onClick={nextMonth}
            className="p-2 bg-muted hover:bg-accent hover:text-black border border-transparent transition-all active:scale-95"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 font-bold uppercase tracking-wider text-muted-foreground">
          Fetching calendar event timetable...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          
          {/* Main Grid Calendar (3 cols) */}
          <div className="lg:col-span-3 border-2 border-border bg-background overflow-hidden">
            
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b-2 border-border bg-muted/40 text-center font-extrabold text-[10px] tracking-widest py-3 text-muted-foreground">
              {daysOfWeek.map((day) => (
                <div key={day}>{day}</div>
              ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 divide-x divide-y divide-border">
              {calendarGrid.map((day, idx) => {
                const dayEvents = day ? getEventsForDay(day) : [];
                const isToday = day && 
                  new Date().getDate() === day && 
                  new Date().getMonth() === month && 
                  new Date().getFullYear() === year;

                return (
                  <div
                    key={idx}
                    onClick={() => day && handleDayClick(day)}
                    className={`
                      min-h-[100px] p-2 flex flex-col justify-between transition-all duration-300 relative group
                      ${day ? "cursor-pointer hover:bg-muted/15" : "bg-muted/5 pointer-events-none"}
                      ${isToday ? "bg-accent/5" : ""}
                    `}
                  >
                    {/* Day Number */}
                    {day ? (
                      <span className={`
                        text-xs font-bold px-1.5 py-0.5 inline-block
                        ${isToday ? "bg-accent text-black font-black" : "text-foreground"}
                      `}>
                        {day}
                      </span>
                    ) : (
                      <span />
                    )}

                    {/* Events List inside Day */}
                    <div className="mt-2 space-y-1">
                      {dayEvents.slice(0, 3).map((e) => (
                        <div
                          key={e.id}
                          className={`
                            text-[8px] font-black uppercase px-1.5 py-0.5 truncate border
                            ${e.type === "deadline" ? "bg-red-600/10 border-red-600 text-red-600" : "bg-blue-600/10 border-blue-600 text-blue-600"}
                          `}
                          title={e.title}
                        >
                          {e.companyName}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <div className="text-[7px] font-bold text-muted-foreground text-center uppercase">
                          + {dayEvents.length - 3} MORE
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Event Sidebar Details (1 col) */}
          <div className="border-2 border-border p-6 bg-muted/10 space-y-6">
            <h3 className="text-lg font-black tracking-tighter uppercase border-b border-border pb-3 flex items-center gap-2">
              <CalendarIcon size={16} />
              <span>{selectedDateStr ? `EVENTS FOR ${selectedDateStr}` : "SELECT A DATE"}</span>
            </h3>

            {selectedDayEvents.length === 0 ? (
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest text-center py-12">
                No events scheduled for this date.
              </p>
            ) : (
              <div className="space-y-6">
                {selectedDayEvents.map((e) => (
                  <div key={e.id} className="border-2 border-border bg-background p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <span className={`
                        text-[8px] font-extrabold tracking-widest uppercase px-2 py-0.5 border
                        ${e.type === "deadline" ? "bg-red-600/10 border-red-600 text-red-600" : "bg-blue-600/10 border-blue-600 text-blue-600"}
                      `}>
                        {e.type.toUpperCase()}
                      </span>
                      <span className="text-[10px] font-bold text-muted-foreground">
                        {e.date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>

                    <h4 className="font-extrabold text-sm uppercase tracking-tight text-foreground leading-snug">
                      {e.title}
                    </h4>
                    
                    <p className="text-xs text-muted-foreground uppercase tracking-wide leading-relaxed">
                      {e.description}
                    </p>

                    <button
                      onClick={() => downloadIcs(e)}
                      className="flex items-center justify-center gap-2 w-full h-10 border-2 border-border bg-muted hover:bg-accent hover:text-black hover:border-accent text-[10px] font-bold tracking-widest uppercase transition-all"
                    >
                      <Download size={12} />
                      <span>ADD TO GOOGLE CALENDAR</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

    </div>
  );
}
