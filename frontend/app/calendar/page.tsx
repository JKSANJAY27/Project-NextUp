"use client";

import React, { useState, useEffect } from "react";
import api from "@/lib/api";

import { useCalendarEvents, useApplications } from "@/lib/queries";
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Trash2, 
  Edit2, 
  Check, 
  X, 
  Calendar as CalendarIcon, 
  ShieldCheck, 
  MapPin,
  FileText
} from "lucide-react";

interface CalendarEvent {
  id: string;
  user_id: string;
  company_id: string | null;
  company_event_id: string | null;
  title: string;
  company_name: string | null;
  role: string | null;
  event_type: 'registration_deadline' | 'online_assessment' | 'interview' | 'offer_result' | 'manual';
  date: string;
  location_platform: string | null;
  notes: string | null;
  completed: boolean;
  is_manual: boolean;
  is_deleted: boolean;
  source: 'application_timeline' | 'manual';
  source_key: string | null;
  created_at: string;
  updated_at: string;
}

interface Application {
  id: string;
  company_id: string;
  status: string;
  workspace_priority_override: string | null;
  company: {
    id: string;
    name: string;
    role: string;
  };
}

export default function CalendarPage() {


  // State
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterType, setFilterType] = useState<'ALL' | 'FOCUS' | 'COMPANY'>('ALL');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  // Form Fields
  const [formTitle, setFormTitle] = useState('');
  const [formEventType, setFormEventType] = useState<CalendarEvent['event_type']>('manual');
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('10:00');
  const [formLocation, setFormLocation] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formCompanyId, setFormCompanyId] = useState('');
  const [formError, setFormError] = useState('');

  // Query Hooks
  const { data: eventsData, isLoading: eventsLoading } = useCalendarEvents();
  const { data: applicationsData, isLoading: applicationsLoading } = useApplications();

  useEffect(() => {
    setLoading(eventsLoading || applicationsLoading);
  }, [eventsLoading, applicationsLoading]);

  useEffect(() => {
    if (eventsData) {
      setEvents(eventsData);
    }
  }, [eventsData]);

  useEffect(() => {
    if (applicationsData) {
      setApplications(applicationsData);
    }
  }, [applicationsData]);


  // Set today's date selected by default on load
  useEffect(() => {
    if (!selectedDay && !loading) {
      setSelectedDay(new Date().getDate());
    }
  }, [loading, selectedDay]);

  // Date Nav Helpers
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const getDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const getFirstDayIndex = (y: number, m: number) => {
    const day = new Date(y, m, 1).getDay();
    return day === 0 ? 6 : day - 1; // Mon-Sun index mapping
  };

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedDay(null);
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedDay(null);
  };

  const monthNames = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"
  ];
  const daysOfWeek = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

  // Filter application dictionary
  const appMap = React.useMemo(() => {
    const map: Record<string, Application> = {};
    applications.forEach(app => {
      map[app.company_id] = app;
    });
    return map;
  }, [applications]);

  // Filter archived company IDs
  const archivedCompanyIds = React.useMemo(() => {
    const set = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applications.forEach((record: any) => {
      if (
        record.record_type === "opportunity_state" &&
        (record.state === "archived" || record.state === "auto_archived")
      ) {
        set.add(record.company_id);
      }
      if (record.record_type === "application" && record.user_decision === "archived") {
        set.add(record.company_id);
      }
    });
    return set;
  }, [applications]);

  // Filtered Events
  const filteredEvents = React.useMemo(() => {
    return events.filter(e => {
      if (e.company_id && archivedCompanyIds.has(e.company_id)) {
        return false;
      }
      if (filterType === 'FOCUS') {
        if (!e.company_id) return false;
        const app = appMap[e.company_id];
        return app && app.workspace_priority_override === 'pinned';
      }
      if (filterType === 'COMPANY') {
        return e.company_id === selectedCompanyId;
      }
      return true;
    });
  }, [events, filterType, selectedCompanyId, appMap, archivedCompanyIds]);

  // Helpers to get events for specific day
  const getEventsForDay = (day: number) => {
    return filteredEvents.filter(e => {
      const eDate = new Date(e.date);
      return (
        eDate.getDate() === day &&
        eDate.getMonth() === month &&
        eDate.getFullYear() === year
      );
    });
  };

  // Color mappings
  const getEventColors = (type: CalendarEvent['event_type']) => {
    switch (type) {
      case 'registration_deadline':
        return { dot: "bg-blue-500", text: "text-blue-500", border: "border-blue-500/30", bg: "bg-blue-500/10" };
      case 'online_assessment':
        return { dot: "bg-orange-500", text: "text-orange-500", border: "border-orange-500/30", bg: "bg-orange-500/10" };
      case 'interview':
        return { dot: "bg-purple-500", text: "text-purple-500", border: "border-purple-500/30", bg: "bg-purple-500/10" };
      case 'offer_result':
        return { dot: "bg-green-500", text: "text-green-500", border: "border-green-500/30", bg: "bg-green-500/10" };
      case 'manual':
      default:
        return { dot: "bg-zinc-400", text: "text-zinc-400", border: "border-zinc-500/30", bg: "bg-zinc-500/10" };
    }
  };

  // Toggle Event Completion
  const handleToggleComplete = async (event: CalendarEvent) => {
    try {
      const res = await api.put(`/calendar/${event.id}`, {
        completed: !event.completed
      });
      setEvents(prev => prev.map(e => e.id === event.id ? res.data : e));
    } catch (err) {
      console.error("Failed to toggle completion status:", err);
    }
  };

  // CRUD Actions
  const handleOpenAddModal = () => {
    setFormError('');
    setFormTitle('');
    setFormEventType('manual');
    
    // Default to currently selected date
    const d = new Date(year, month, selectedDay || 1);
    const dateStr = d.toISOString().split('T')[0];
    setFormDate(dateStr);
    setFormTime('10:00');
    setFormLocation('');
    setFormNotes('');
    setFormCompanyId('');
    setShowAddModal(true);
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      setFormError('TITLE IS REQUIRED');
      return;
    }
    try {
      const combinedDate = new Date(`${formDate}T${formTime || '00:00'}:00`);
      const payload = {
        title: formTitle.trim(),
        event_type: formEventType,
        date: combinedDate.toISOString(),
        location_platform: formLocation.trim() || null,
        notes: formNotes.trim() || null,
        company_id: formCompanyId || null
      };

      const res = await api.post("/calendar", payload);
      setEvents(prev => [...prev, res.data]);
      setShowAddModal(false);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apiError = err as any;
      setFormError(apiError.response?.data?.detail || "FAILED TO CREATE EVENT");
    }
  };

  const handleOpenEditModal = (event: CalendarEvent) => {
    setEditingEvent(event);
    setFormError('');
    setFormTitle(event.title);
    setFormEventType(event.event_type);
    
    const d = new Date(event.date);
    setFormDate(d.toISOString().split('T')[0]);
    
    const pad = (num: number) => String(num).padStart(2, '0');
    setFormTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setFormLocation(event.location_platform || '');
    setFormNotes(event.notes || '');
    setFormCompanyId(event.company_id || '');
    setShowEditModal(true);
  };

  const handleUpdateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEvent) return;
    if (!formTitle.trim()) {
      setFormError('TITLE IS REQUIRED');
      return;
    }
    try {
      const combinedDate = new Date(`${formDate}T${formTime || '00:00'}:00`);
      const payload = {
        title: formTitle.trim(),
        event_type: formEventType,
        date: combinedDate.toISOString(),
        location_platform: formLocation.trim() || null,
        notes: formNotes.trim() || null,
        company_id: formCompanyId || null
      };

      const res = await api.put(`/calendar/${editingEvent.id}`, payload);
      setEvents(prev => prev.map(item => item.id === editingEvent.id ? res.data : item));
      setShowEditModal(false);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apiError = err as any;
      setFormError(apiError.response?.data?.detail || "FAILED TO UPDATE EVENT");
    }
  };

  const handleDeleteEvent = async (event: CalendarEvent) => {
    if (!confirm(`ARE YOU SURE YOU WANT TO DELETE THIS EVENT?\n"${event.title}"`)) {
      return;
    }
    try {
      await api.delete(`/calendar/${event.id}`);
      setEvents(prev => prev.filter(e => e.id !== event.id));
    } catch (err) {
      console.error("Failed to delete event:", err);
    }
  };

  // Grid Builder
  const daysInMonth = getDaysInMonth(year, month);
  const firstDayIndex = getFirstDayIndex(year, month);
  
  const gridCells = [];
  for (let i = 0; i < firstDayIndex; i++) {
    gridCells.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    gridCells.push(i);
  }

  // Selected Day Details
  const selectedDayEvents = selectedDay ? getEventsForDay(selectedDay) : [];

  return (
    <div className="flex-1 bg-background p-8 md:p-12 flex flex-col min-h-screen">
      
      {/* Header */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-end gap-6 border-b-2 border-border pb-8">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-black tracking-widest text-accent uppercase">
            <ShieldCheck size={16} />
            <span>🔒 Secure Calendar Local Plane</span>
          </div>
          <h1 className="text-5xl font-extrabold tracking-tighter uppercase leading-none">
            PLACEMENT CALENDAR
          </h1>
        </div>

        {/* Date Month Selector */}
        <div className="flex items-center gap-4 border-2 border-border p-1 bg-card">
          <button 
            onClick={prevMonth}
            className="p-2 bg-muted hover:bg-accent hover:text-black border border-transparent transition-all active:scale-95"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs font-black tracking-widest px-4 uppercase min-w-[150px] text-center">
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

      {/* Filter and Top Controls Bar */}
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 mt-8 pb-4 border-b border-border/50">
        
        {/* Filters Group */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setFilterType('ALL'); setSelectedCompanyId(''); }}
            className={`px-4 py-2 text-xs font-black uppercase border-2 tracking-wider transition-all active:scale-95 ${
              filterType === 'ALL' 
                ? "bg-accent border-accent text-black" 
                : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-foreground"
            }`}
          >
            ALL EVENTS
          </button>
          <button
            onClick={() => { setFilterType('FOCUS'); setSelectedCompanyId(''); }}
            className={`px-4 py-2 text-xs font-black uppercase border-2 tracking-wider transition-all active:scale-95 ${
              filterType === 'FOCUS' 
                ? "bg-accent border-accent text-black" 
                : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-foreground"
            }`}
          >
            FOCUS COMPANIES
          </button>

          {/* Company Overlay Dropdown */}
          <div className="flex items-center gap-2">
            <select
              value={filterType === 'COMPANY' ? selectedCompanyId : ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val) {
                  setFilterType('COMPANY');
                  setSelectedCompanyId(val);
                } else {
                  setFilterType('ALL');
                  setSelectedCompanyId('');
                }
              }}
              className="bg-card border-2 border-border text-xs font-bold uppercase tracking-wider px-3 h-9 text-foreground focus:outline-none focus:border-accent"
            >
              <option value="">COMPANY OVERLAY</option>
              {applications.map(app => (
                <option key={app.company_id} value={app.company_id}>
                  {app.company.name.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Add Event Button */}
        <button
          onClick={handleOpenAddModal}
          className="flex items-center justify-center gap-2 h-10 px-5 border-2 border-accent bg-accent text-black hover:bg-transparent hover:text-accent font-extrabold text-xs tracking-wider transition-all active:scale-95 uppercase"
        >
          <Plus size={16} />
          <span>ADD MANUAL EVENT</span>
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center py-32">
          <div className="text-center font-bold tracking-widest text-muted-foreground uppercase animate-pulse">
            LOADING SECURE CALENDAR GRID...
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 mt-8 flex-1 items-start">
          
          {/* Calendar Month Grid */}
          <div className="lg:col-span-3 border-2 border-border bg-card shadow-2xl">
            
            {/* Days of Week Header */}
            <div className="grid grid-cols-7 border-b-2 border-border bg-muted/20 text-center font-black text-[10px] tracking-widest py-3 text-muted-foreground">
              {daysOfWeek.map(day => (
                <div key={day}>{day}</div>
              ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 divide-x divide-y divide-border border-l-0 border-t-0">
              {gridCells.map((day, idx) => {
                const dayEvents = day ? getEventsForDay(day) : [];
                
                const isSelected = day === selectedDay;
                const isToday = day &&
                  new Date().getDate() === day &&
                  new Date().getMonth() === month &&
                  new Date().getFullYear() === year;



                return (
                  <div
                    key={idx}
                    onClick={() => day && setSelectedDay(day)}
                    className={`
                      min-h-[90px] p-2 flex flex-col justify-between transition-all duration-200 relative group select-none
                      ${day ? "cursor-pointer hover:bg-muted/15" : "bg-muted/5 pointer-events-none"}
                      ${isSelected ? "bg-muted/20 border-accent" : ""}
                      ${isToday ? "bg-accent/5" : ""}
                    `}
                  >
                    {/* Top Row: Day number */}
                    <div className="flex justify-between items-start w-full">
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
                    </div>

                    {/* Bottom Row: Event lists with titles */}
                    <div className="flex flex-col gap-1 mt-2 w-full overflow-hidden">
                      {dayEvents.slice(0, 3).map(e => {
                        const clr = getEventColors(e.event_type);
                        return (
                          <div
                            key={e.id}
                            className={`text-[9px] font-bold truncate flex items-center gap-1 text-foreground/80 ${
                              e.completed ? "line-through opacity-45" : ""
                            }`}
                            title={`${e.title} (${e.event_type.toUpperCase()})`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${clr.dot}`} />
                            <span className="truncate uppercase">{e.title}</span>
                          </div>
                        );
                      })}
                      {dayEvents.length > 3 && (
                        <div className="text-[8px] font-black text-muted-foreground uppercase leading-none pl-2.5 mt-0.5">
                          +{dayEvents.length - 3} MORE
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sidebar Panel for Selected Date */}
          <div className="border-2 border-border bg-card p-6 flex flex-col gap-6 min-h-[400px]">
            
            {/* Header displaying selected date */}
            <div className="border-b-2 border-border pb-4">
              <span className="text-[10px] font-black tracking-widest text-accent uppercase block mb-1 leading-none">
                {selectedDay ? `${selectedDay} ${monthNames[month]} ${year}` : "SELECT A DATE"}
              </span>
              <h3 className="text-lg font-black uppercase tracking-tighter flex items-center gap-2 text-foreground">
                <CalendarIcon size={18} />
                <span>DAY SCHEDULE</span>
              </h3>
            </div>

            {/* Event list */}
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
              {selectedDayEvents.length === 0 ? (
                <div className="py-16 text-center text-xs font-bold text-muted-foreground uppercase tracking-widest leading-relaxed">
                  No events scheduled.
                </div>
              ) : (
                selectedDayEvents.map(e => {
                  const clr = getEventColors(e.event_type);
                  
                  // Format time
                  const timeStr = new Date(e.date).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit"
                  });

                  return (
                    <div 
                      key={e.id} 
                      className={`border-2 border-border bg-background p-4 flex flex-col gap-3 transition-all relative ${
                        e.completed ? "opacity-40" : ""
                      }`}
                    >
                      {/* Event Meta Line */}
                      <div className="flex justify-between items-center w-full">
                        <span className={`text-[8px] font-extrabold tracking-widest uppercase px-2 py-0.5 border ${clr.border} ${clr.bg} ${clr.text}`}>
                          {e.event_type.replace('_', ' ').toUpperCase()}
                        </span>
                        <span className="text-[10px] font-bold text-muted-foreground">
                          {timeStr}
                        </span>
                      </div>

                      {/* Title */}
                      <h4 className={`font-extrabold text-sm uppercase tracking-tight text-foreground leading-snug ${e.completed ? "line-through" : ""}`}>
                        {e.title}
                      </h4>

                      {/* Display Info (Company & Role) if available */}
                      {(e.company_name || e.role) && (
                        <div className="text-[10px] font-bold text-muted-foreground uppercase flex flex-col gap-0.5 bg-muted/20 p-2 border border-border/50">
                          {e.company_name && (
                            <div>COMPANY: <span className="text-foreground">{e.company_name}</span></div>
                          )}
                          {e.role && (
                            <div>ROLE: <span className="text-foreground">{e.role}</span></div>
                          )}
                        </div>
                      )}

                      {/* Location or Notes */}
                      {e.location_platform && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase">
                          <MapPin size={12} className={clr.text} />
                          <span className="truncate">{e.location_platform}</span>
                        </div>
                      )}

                      {e.notes && (
                        <div className="flex items-start gap-1.5 text-xs text-muted-foreground uppercase">
                          <FileText size={12} className="shrink-0 mt-0.5" />
                          <p className="line-clamp-3 leading-tight">{e.notes}</p>
                        </div>
                      )}

                      {/* Source Info */}
                      <div className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1.5 border-t border-border/20 pt-2">
                        <span>SOURCE:</span>
                        {e.source === 'application_timeline' ? (
                          <span className="text-emerald-500 font-extrabold flex items-center gap-1">
                            ✓ AUTO (CDC MAIL)
                          </span>
                        ) : (
                          <span className="text-amber-500 font-extrabold flex items-center gap-1">
                            ✏ MANUAL
                          </span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between border-t border-border/50 pt-3 mt-1">
                        {/* Complete Checkbox */}
                        <button
                          onClick={() => handleToggleComplete(e)}
                          className={`flex items-center gap-1.5 text-[9px] font-black uppercase px-2 py-1 border transition-all active:scale-95 ${
                            e.completed 
                              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500" 
                              : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {e.completed ? (
                            <>
                              <Check size={10} />
                              <span>COMPLETED</span>
                            </>
                          ) : (
                            <span>MARK COMPLETE</span>
                          )}
                        </button>

                        {/* Edit & Delete (CRUD for Manual, or Soft Delete for Synced) */}
                        <div className="flex items-center gap-1.5">
                          {e.is_manual && (
                            <button
                              onClick={() => handleOpenEditModal(e)}
                              className="p-1 border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-all active:scale-95"
                              title="Edit Event"
                            >
                              <Edit2 size={12} />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteEvent(e)}
                            className="p-1 border border-border/50 text-red-500 hover:bg-red-500/10 hover:border-red-500 transition-all active:scale-95"
                            title="Delete Event"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      )}

      {/* ================= ADD EVENT MODAL ================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-background border-2 border-border w-full max-w-lg shadow-2xl p-6 relative">
            <button 
              onClick={() => setShowAddModal(false)}
              className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={20} />
            </button>

            <h3 className="text-xl font-black uppercase tracking-tighter mb-6">
              ADD MANUAL EVENT
            </h3>

            {formError && (
              <div className="border-2 border-red-600 bg-red-600/10 p-3 text-xs font-bold text-red-600 uppercase tracking-wider mb-4">
                ERROR: {formError}
              </div>
            )}

            <form onSubmit={handleCreateEvent} className="space-y-4">
              {/* Title */}
              <div className="space-y-1">
                <label className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                  EVENT TITLE *
                </label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="E.G. GOOGLE PREPARATION SESSION"
                  className="w-full h-11 border-b-2 border-border bg-transparent text-sm font-bold uppercase tracking-tight focus:border-accent focus:outline-none px-1 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Event Type */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                    EVENT TYPE
                  </label>
                  <select
                    value={formEventType}
                    onChange={(e) => setFormEventType(e.target.value as CalendarEvent['event_type'])}
                    className="w-full h-11 border-b-2 border-border bg-card text-xs font-bold uppercase tracking-wider px-1 text-foreground focus:outline-none focus:border-accent"
                  >
                    <option value="manual">MANUAL EVENT (GREY)</option>
                    <option value="registration_deadline">REGISTRATION DEADLINE (BLUE)</option>
                    <option value="online_assessment">ONLINE ASSESSMENT (ORANGE)</option>
                    <option value="interview">INTERVIEW (PURPLE)</option>
                    <option value="offer_result">OFFER / RESULT (GREEN)</option>
                  </select>
                </div>

                {/* Company Link */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                    LINK TO COMPANY
                  </label>
                  <select
                    value={formCompanyId}
                    onChange={(e) => setFormCompanyId(e.target.value)}
                    className="w-full h-11 border-b-2 border-border bg-card text-xs font-bold uppercase tracking-wider px-1 text-foreground focus:outline-none focus:border-accent"
                  >
                    <option value="">NO LINK</option>
                    {applications.map(app => (
                      <option key={app.company_id} value={app.company_id}>
                        {app.company.name.toUpperCase()} ({app.company.role.toUpperCase()})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Date */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                    DATE
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full h-11 border-b-2 border-border bg-transparent text-xs font-bold uppercase tracking-widest px-1 text-foreground focus:outline-none focus:border-accent"
                  />
                </div>

                {/* Time */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                    TIME
                  </label>
                  <input
                    type="time"
                    required
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                    className="w-full h-11 border-b-2 border-border bg-transparent text-xs font-bold uppercase tracking-widest px-1 text-foreground focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* Location */}
              <div className="space-y-1">
                <label className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                  LOCATION / PLATFORM
                </label>
                <input
                  type="text"
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="E.G. GOOGLE MEET / HACKERRANK"
                  className="w-full h-11 border-b-2 border-border bg-transparent text-sm font-bold uppercase tracking-tight focus:border-accent focus:outline-none px-1 transition-colors"
                />
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                  NOTES / DESCRIPTION
                </label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="ADD ANY RELEVANT INFORMATION..."
                  rows={3}
                  className="w-full border-2 border-border bg-card text-xs font-bold p-3 focus:border-accent focus:outline-none uppercase"
                />
              </div>

              <div className="pt-4 flex gap-4">
                <button
                  type="submit"
                  className="flex-1 h-12 border-2 border-accent bg-accent text-black font-extrabold text-xs tracking-widest hover:bg-transparent hover:text-accent transition-all active:scale-95 uppercase"
                >
                  CREATE EVENT
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 h-12 border-2 border-border bg-transparent text-muted-foreground font-extrabold text-xs tracking-widest hover:text-foreground hover:border-foreground transition-all active:scale-95 uppercase"
                >
                  CANCEL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= EDIT EVENT MODAL ================= */}
      {showEditModal && editingEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-background border-2 border-border w-full max-w-lg shadow-2xl p-6 relative">
            <button 
              onClick={() => setShowEditModal(false)}
              className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={20} />
            </button>

            <h3 className="text-xl font-black uppercase tracking-tighter mb-6">
              EDIT EVENT
            </h3>

            {formError && (
              <div className="border-2 border-red-600 bg-red-600/10 p-3 text-xs font-bold text-red-600 uppercase tracking-wider mb-4">
                ERROR: {formError}
              </div>
            )}

            <form onSubmit={handleUpdateEvent} className="space-y-4">
              {/* Title */}
              <div className="space-y-1">
                <label className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                  EVENT TITLE *
                </label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="E.G. GOOGLE PREPARATION SESSION"
                  className="w-full h-11 border-b-2 border-border bg-transparent text-sm font-bold uppercase tracking-tight focus:border-accent focus:outline-none px-1 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Event Type */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                    EVENT TYPE
                  </label>
                  <select
                    value={formEventType}
                    onChange={(e) => setFormEventType(e.target.value as CalendarEvent['event_type'])}
                    className="w-full h-11 border-b-2 border-border bg-card text-xs font-bold uppercase tracking-wider px-1 text-foreground focus:outline-none focus:border-accent"
                  >
                    <option value="manual">MANUAL EVENT (GREY)</option>
                    <option value="registration_deadline">REGISTRATION DEADLINE (BLUE)</option>
                    <option value="online_assessment">ONLINE ASSESSMENT (ORANGE)</option>
                    <option value="interview">INTERVIEW (PURPLE)</option>
                    <option value="offer_result">OFFER / RESULT (GREEN)</option>
                  </select>
                </div>

                {/* Company Link */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                    LINK TO COMPANY
                  </label>
                  <select
                    value={formCompanyId}
                    onChange={(e) => setFormCompanyId(e.target.value)}
                    className="w-full h-11 border-b-2 border-border bg-card text-xs font-bold uppercase tracking-wider px-1 text-foreground focus:outline-none focus:border-accent"
                  >
                    <option value="">NO LINK</option>
                    {applications.map(app => (
                      <option key={app.company_id} value={app.company_id}>
                        {app.company.name.toUpperCase()} ({app.company.role.toUpperCase()})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Date */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                    DATE
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full h-11 border-b-2 border-border bg-transparent text-xs font-bold uppercase tracking-widest px-1 text-foreground focus:outline-none focus:border-accent"
                  />
                </div>

                {/* Time */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                    TIME
                  </label>
                  <input
                    type="time"
                    required
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                    className="w-full h-11 border-b-2 border-border bg-transparent text-xs font-bold uppercase tracking-widest px-1 text-foreground focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* Location */}
              <div className="space-y-1">
                <label className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                  LOCATION / PLATFORM
                </label>
                <input
                  type="text"
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="E.G. GOOGLE MEET / HACKERRANK"
                  className="w-full h-11 border-b-2 border-border bg-transparent text-sm font-bold uppercase tracking-tight focus:border-accent focus:outline-none px-1 transition-colors"
                />
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                  NOTES / DESCRIPTION
                </label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="ADD ANY RELEVANT INFORMATION..."
                  rows={3}
                  className="w-full border-2 border-border bg-card text-xs font-bold p-3 focus:border-accent focus:outline-none uppercase"
                />
              </div>

              <div className="pt-4 flex gap-4">
                <button
                  type="submit"
                  className="flex-1 h-12 border-2 border-accent bg-accent text-black font-extrabold text-xs tracking-widest hover:bg-transparent hover:text-accent transition-all active:scale-95 uppercase"
                >
                  SAVE CHANGES
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 h-12 border-2 border-border bg-transparent text-muted-foreground font-extrabold text-xs tracking-widest hover:text-foreground hover:border-foreground transition-all active:scale-95 uppercase"
                >
                  CANCEL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
