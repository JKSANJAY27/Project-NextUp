"use client";

import React, { useState, useEffect } from "react";
import { useAppStore } from "@/lib/store";
import api from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCompanies, useApplications } from "@/lib/queries";
import { Company, Application, CompanyEvent } from "./types";
import TrackingStats from "@/components/TrackingStats";
import TrackingSection from "@/components/TrackingSection";
import TrackingCard from "@/components/TrackingCard";
import { 
  X, Calendar, Edit2, Archive, StickyNote, FileText, MapPin, Award, 
  CheckCircle, XCircle, HelpCircle, ArrowRight, ExternalLink, Globe, 
  Link2, AlertTriangle, Activity
} from "lucide-react";

type FilterMode = "ALL" | "ACTIVE_ROUNDS" | "UPCOMING_7_DAYS" | "INTERVIEWS" | "OFFERS";

interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  message: string;
  body: string;
  sender: string;
  timestamp: Date;
  confidence_scores: Record<string, number>;
}

export default function TrackingPage() {
  const { user, encryptionKey } = useAppStore();
  const queryClient = useQueryClient();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [applications, setApplications] = useState<Record<string, Application>>({});
  const [loading, setLoading] = useState(true);
  
  const [filterMode, setFilterMode] = useState<FilterMode>("ALL");
  
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [companyEvents, setCompanyEvents] = useState<Record<string, CompanyEvent[]>>({});

  // Workspace modal states
  const [modalTab, setModalTab] = useState<"overview" | "details" | "toolkit">("overview");
  const [editingRoundNote, setEditingRoundNote] = useState<string | null>(null);
  const [tempNoteText, setTempNoteText] = useState("");
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);
  const [expandedEmailHeightId, setExpandedEmailHeightId] = useState<string | null>(null);
  const [jdTextExpanded, setJdTextExpanded] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [decryptedNotes, setDecryptedNotes] = useState<Record<string, string>>({});

  const { data: companiesData, isLoading: companiesLoading } = useCompanies(!!user);
  const { data: applicationsData, isLoading: applicationsLoading } = useApplications(!!user);

  useEffect(() => {
    setLoading(companiesLoading || applicationsLoading);
  }, [companiesLoading, applicationsLoading]);

  useEffect(() => {
    if (companiesData) {
      setCompanies(companiesData);
    }
  }, [companiesData]);

  useEffect(() => {
    if (applicationsData) {
      const appMap: Record<string, Application> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (applicationsData || []).forEach((record: any) => {
        if (record.record_type === "application") {
          appMap[record.company_id] = record;
        }
      });
      setApplications(appMap);
    }
  }, [applicationsData]);

  const fetchTrackingData = async () => {
    queryClient.invalidateQueries();
  };

  useEffect(() => {
    if (selectedCompanyId && !companyEvents[selectedCompanyId]) {
      api.get(`/companies/${selectedCompanyId}/events`).then(res => {
        setCompanyEvents(prev => ({ ...prev, [selectedCompanyId]: res.data || [] }));
      }).catch(err => console.error(err));
    }
  }, [selectedCompanyId, companyEvents]);

  // Derived state
  const trackingApps = Object.values(applications).filter(a => a.user_decision === "tracking");
  const trackingCompIds = new Set(trackingApps.map(a => a.company_id));
  let visibleCompanies = companies.filter(c => trackingCompIds.has(c.id));

  // Apply filter
  if (filterMode === "INTERVIEWS") {
    visibleCompanies = visibleCompanies.filter(c => {
      const status = applications[c.id]?.status || "";
      return status.includes("Interview") || status === "Technical" || status === "HR";
    });
  } else if (filterMode === "OFFERS") {
    visibleCompanies = visibleCompanies.filter(c => applications[c.id]?.status?.includes("Offer"));
  } else if (filterMode === "ACTIVE_ROUNDS") {
    visibleCompanies = visibleCompanies.filter(c => {
      const status = applications[c.id]?.status || "";
      return !status.includes("Offer") && !status.includes("Archived") && !status.includes("Rejected") && status !== "Applied";
    });
  } else if (filterMode === "UPCOMING_7_DAYS") {
    visibleCompanies = visibleCompanies.filter(c => (applications[c.id]?.priority_score || 0) > 3);
  }

  // Normalize stages
  const categorized = {
    REGISTRATION: [] as Company[],
    SHORTLISTED: [] as Company[],
    ONLINE_ASSESSMENT: [] as Company[],
    INTERVIEW: [] as Company[],
    OFFER: [] as Company[],
    REJECTED: [] as Company[],
  };

  visibleCompanies.forEach(c => {
    const status = applications[c.id]?.status || "Applied";
    if (status.includes("Offer")) categorized.OFFER.push(c);
    else if (status.includes("Interview") || status === "Technical" || status === "HR") categorized.INTERVIEW.push(c);
    else if (status === "OA" || status.includes("Assessment")) categorized.ONLINE_ASSESSMENT.push(c);
    else if (status === "Shortlisted") categorized.SHORTLISTED.push(c);
    else if (status.includes("Rejected") || status.includes("Archived")) categorized.REJECTED.push(c);
    else categorized.REGISTRATION.push(c); // Applied maps to REGISTRATION visually
  });

  const getNextEvent = (compId: string) => {
    const events = companyEvents[compId];
    if (!events || events.length === 0) return null;
    return events[events.length - 1];
  };

  const handleUpdateApplication = async (companyId: string, updates: any) => {
    const app = applications[companyId];
    if (!app) return;
    try {
      if (updates.status) {
        const recruitmentMap: Record<string, string> = {
          "Applied": "Registration",
          "Shortlisted": "Shortlisted",
          "OA": "OA",
          "Interview": "Interview",
          "Offer": "Offer",
          "Rejected": "Rejected"
        };
        updates.recruitment_state = recruitmentMap[updates.status] || updates.status;
      }
      const res = await api.patch(`/applications/${app.id}`, updates);
      setApplications(prev => ({
        ...prev,
        [companyId]: res.data
      }));
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      fetchTrackingData();
    } catch (err) {
      console.error("Failed to update application:", err);
    }
  };

  const selectedCompany = companies.find(c => c.id === selectedCompanyId) || null;
  const selectedApp = selectedCompanyId ? applications[selectedCompanyId] : null;

  // Decrypt notes whenever selectedCompany changes or encryption key is available
  useEffect(() => {
    const decryptNotesObj = async () => {
      if (!selectedCompany || !encryptionKey) {
        setDecryptedNotes({});
        return;
      }
      const app = applications[selectedCompany.id];
      if (!app || !app.notes_enc) {
        setDecryptedNotes({});
        return;
      }
      
      try {
        const { decryptData } = await import("@/lib/crypto");
        const plaintext = await decryptData(app.notes_enc, encryptionKey);
        const parsed = JSON.parse(plaintext);
        setDecryptedNotes(parsed || {});
      } catch (err) {
        console.error("Failed to decrypt notes:", err);
        setDecryptedNotes({
          [app.status || "Applied"]: app.notes_enc
        });
      }
    };
    decryptNotesObj();
  }, [selectedCompany, applications, encryptionKey]);

  // Timeline Notes GCM Encryption & Save
  const handleSaveRoundNote = async (roundKey: string, noteText: string) => {
    if (!selectedCompany || !encryptionKey) return;
    
    const updatedNotes = {
      ...decryptedNotes,
      [roundKey]: noteText
    };
    
    try {
      const { encryptData } = await import("@/lib/crypto");
      const plaintext = JSON.stringify(updatedNotes);
      const encrypted = await encryptData(plaintext, encryptionKey);
      
      await handleUpdateApplication(selectedCompany.id, {
        notes_enc: encrypted
      });
      setDecryptedNotes(updatedNotes);
    } catch (err) {
      console.error("Failed to save round note:", err);
      alert("Failed to save note. Please verify encryption key.");
    }
  };

  // Compile timeline events list for the selected company modal
  const getTimelineEvents = React.useCallback(() => {
    if (!selectedCompany) return [];
    
    const events: TimelineEvent[] = [];
    const evts = companyEvents[selectedCompany.id] || [];
    
    if (evts.length > 0) {
      evts.forEach(e => {
        events.push({
          id: e.id,
          type: e.event_type.toLowerCase(),
          title: e.event_type.toUpperCase(),
          message: e.user_notification_msg || e.subject || "Company Update",
          body: e.body || e.subject || "No details available.",
          sender: e.sender || "CDC Mail",
          timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
          confidence_scores: e.confidence_scores || {}
        });
      });
    } else {
      events.push({
        id: "baseline",
        type: "system",
        title: "WORKSPACE CREATED",
        message: `Application workspace for ${selectedCompany.name} is initialized.`,
        body: `Workspace tracking started for ${selectedCompany.role} position at ${selectedCompany.name}.`,
        sender: "System Event",
        timestamp: selectedCompany.registration_deadline ? new Date(selectedCompany.registration_deadline) : new Date(),
        confidence_scores: {}
      });
    }
    
    return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [selectedCompany, companyEvents]);

  const workspaceEvents = React.useMemo(() => getTimelineEvents(), [getTimelineEvents]);

  // Calculate Health Score
  const getHealthScore = (app: Application | null) => {
    if (!app) return 0;
    
    let score = 0;
    const stage = app.recruitment_state || app.status || 'Registration';
    const stageLower = stage.toLowerCase();
    
    if (stageLower.includes('registration') || stageLower.includes('interested')) {
      score += 15;
    } else if (stageLower.includes('applied') || stageLower.includes('awaiting shortlist')) {
      score += 40;
    } else if (stageLower.includes('shortlisted')) {
      score += 55;
    } else if (stageLower.includes('oa') || stageLower.includes('awaiting oa result')) {
      score += 70;
    } else if (stageLower.includes('interview') || stageLower.includes('awaiting interview result')) {
      score += 85;
    } else if (stageLower.includes('offer') || stageLower.includes('rejected') || stageLower.includes('likely rejected')) {
      score += 100;
    }
    
    if (app.match_score > 0) {
      score += 10;
    }
    
    if (app.notes_enc) {
      score += 5;
    }
    
    return Math.min(100, score);
  };

  const healthVal = React.useMemo(() => getHealthScore(selectedApp), [selectedApp]);

  // Calculate Prep Score
  const getPrepScore = (comp: any) => {
    let score = 0;
    score += 70; // Tracked is implicitly eligible
    
    if (user && user.neo_id_enc) {
      score += 20;
    }
    
    const userSkills = user?.skills || [];
    const compSkills = comp.jd_required_skills || [];
    const overlap = userSkills.filter((s: string) => compSkills.map((cs: string) => cs.toLowerCase()).includes(s.toLowerCase()));
    if (overlap.length > 0) {
      score += 10;
    }
    
    return Math.min(100, score);
  };

  const getEligibilityIcon = (status: string) => {
    switch (status) {
      case "ELIGIBLE": 
        return <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-500 border border-emerald-500 px-2 py-0.5"><CheckCircle size={10} /> ELIGIBLE</span>;
      case "NOT_ELIGIBLE": 
        return <span className="flex items-center gap-1.5 text-[10px] font-bold text-red-500 border border-red-500 px-2 py-0.5"><XCircle size={10} /> INELIGIBLE</span>;
      default: 
        return <span className="flex items-center gap-1.5 text-[10px] font-bold text-amber-500 border border-amber-500 px-2 py-0.5"><HelpCircle size={10} /> CHECK</span>;
    }
  };

  // PDF Rendering Hook
  const jdPdfAttachment = React.useMemo(() => {
    if (!selectedCompanyId) return null;
    const evts = companyEvents[selectedCompanyId] || [];
    for (const evt of evts) {
      if (evt.attachments) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdf = (evt as any).attachments.find((att: any) => att.file_type === 'JD_PDF');
        if (pdf) return pdf;
      }
    }
    return null;
  }, [selectedCompanyId, companyEvents]);

  useEffect(() => {
    let active = true;
    const loadPdf = async () => {
      if (!jdPdfAttachment) {
        setPdfUrl(null);
        return;
      }
      setPdfLoading(true);
      try {
        const response = await api.get(`/announcements/attachment/${jdPdfAttachment.id}`, {
          responseType: 'blob',
        });
        if (active) {
          const blob = new Blob([response.data], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          setPdfUrl(url);
        }
      } catch (err) {
        console.error("Failed to load JD PDF:", err);
      } finally {
        if (active) {
          setPdfLoading(false);
        }
      }
    };
    loadPdf();

    return () => {
      active = false;
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [jdPdfAttachment]);

  return (
    <>
      <div className="flex-1 bg-background p-8 md:p-12 space-y-12 max-w-[1600px] mx-auto w-full">
        
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between border-b-2 border-border pb-8 gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-accent uppercase">
              <Activity size={16} className="text-accent" />
              <span>ACTIVE TRACKING</span>
            </div>
            <h1 className="text-5xl font-extrabold tracking-tighter uppercase leading-none">
              WORKFLOW TRACKER
            </h1>
          </div>

          {/* Filter Chips */}
          <div className="flex flex-wrap gap-2">
            {(["ALL", "ACTIVE_ROUNDS", "UPCOMING_7_DAYS", "INTERVIEWS", "OFFERS"] as FilterMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`h-10 px-4 border-2 text-xs font-black tracking-wider uppercase transition-all ${
                  filterMode === mode
                    ? "border-accent bg-accent text-black"
                    : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                }`}
              >
                {mode.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Stats Row */}
        <TrackingStats
          total={visibleCompanies.length}
          registration={categorized.REGISTRATION.length}
          shortlisted={categorized.SHORTLISTED.length}
          onlineAssessment={categorized.ONLINE_ASSESSMENT.length}
          interview={categorized.INTERVIEW.length}
          offer={categorized.OFFER.length}
        />

        {/* Loading / Empty States */}
        {loading ? (
          <div className="text-center py-20 font-bold uppercase tracking-wider text-muted-foreground">
            Loading workflow tracker...
          </div>
        ) : visibleCompanies.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-border text-muted-foreground font-bold uppercase tracking-wider text-xs">
            No companies matching the current filter in active tracking.
          </div>
        ) : (
          <div className="space-y-6">
            <TrackingSection title="Registration" count={categorized.REGISTRATION.length} colorClass="bg-yellow-500">
              {categorized.REGISTRATION.map(c => (
                <TrackingCard key={c.id} company={c} application={applications[c.id]} nextEvent={getNextEvent(c.id)} stage="REGISTRATION" onClick={() => { setSelectedCompanyId(c.id); setModalTab("overview"); }} />
              ))}
            </TrackingSection>
            
            <TrackingSection title="Shortlisted" count={categorized.SHORTLISTED.length} colorClass="bg-blue-500">
              {categorized.SHORTLISTED.map(c => (
                <TrackingCard key={c.id} company={c} application={applications[c.id]} nextEvent={getNextEvent(c.id)} stage="SHORTLISTED" onClick={() => { setSelectedCompanyId(c.id); setModalTab("overview"); }} />
              ))}
            </TrackingSection>

            <TrackingSection title="Online Assessment" count={categorized.ONLINE_ASSESSMENT.length} colorClass="bg-orange-500">
              {categorized.ONLINE_ASSESSMENT.map(c => (
                <TrackingCard key={c.id} company={c} application={applications[c.id]} nextEvent={getNextEvent(c.id)} stage="ONLINE_ASSESSMENT" onClick={() => { setSelectedCompanyId(c.id); setModalTab("overview"); }} />
              ))}
            </TrackingSection>

            <TrackingSection title="Interview" count={categorized.INTERVIEW.length} colorClass="bg-purple-500">
              {categorized.INTERVIEW.map(c => (
                <TrackingCard key={c.id} company={c} application={applications[c.id]} nextEvent={getNextEvent(c.id)} stage="INTERVIEW" onClick={() => { setSelectedCompanyId(c.id); setModalTab("overview"); }} />
              ))}
            </TrackingSection>

            <TrackingSection title="Offer Received" count={categorized.OFFER.length} colorClass="bg-emerald-500">
              {categorized.OFFER.map(c => (
                <TrackingCard key={c.id} company={c} application={applications[c.id]} nextEvent={getNextEvent(c.id)} stage="OFFER" onClick={() => { setSelectedCompanyId(c.id); setModalTab("overview"); }} />
              ))}
            </TrackingSection>
            
            <TrackingSection title="Rejected" count={categorized.REJECTED.length} colorClass="bg-red-500">
              {categorized.REJECTED.map(c => (
                <TrackingCard key={c.id} company={c} application={applications[c.id]} nextEvent={getNextEvent(c.id)} stage="REJECTED" onClick={() => { setSelectedCompanyId(c.id); setModalTab("overview"); }} />
              ))}
            </TrackingSection>
          </div>
        )}

      </div>

      {/* Global modern Company Workspace Drawer / Modal */}
      {selectedCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="relative w-full max-w-5xl border-2 border-border bg-background flex flex-col md:flex-row h-[85vh] animate-in slide-in-from-bottom-4 duration-300 rounded-none overflow-hidden">
            
            {/* Left Nav Pane */}
            <div className="w-full md:w-56 border-r border-border bg-muted/15 flex flex-row md:flex-col shrink-0">
              <div className="hidden md:flex h-20 items-center justify-between border-b border-border px-6">
                <span className="text-xs font-black tracking-widest text-foreground uppercase truncate">
                  {selectedCompany.name}
                </span>
              </div>

              <div className="flex flex-row md:flex-col flex-1 py-2 overflow-x-auto md:overflow-x-visible">
                <button
                  onClick={() => setModalTab("overview")}
                  className={`flex-1 md:flex-none flex items-center gap-3 px-6 py-3.5 text-xs font-bold uppercase tracking-wider transition-all text-left ${
                    modalTab === "overview" ? "bg-accent text-black font-black" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Calendar size={14} />
                  <span>OVERVIEW</span>
                </button>
                <button
                  onClick={() => setModalTab("details")}
                  className={`flex-1 md:flex-none flex items-center gap-3 px-6 py-3.5 text-xs font-bold uppercase tracking-wider transition-all text-left ${
                    modalTab === "details" ? "bg-accent text-black font-black" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Link2 size={14} />
                  <span>JOB DETAILS</span>
                </button>
                <button
                  onClick={() => setModalTab("toolkit")}
                  className={`flex-1 md:flex-none flex items-center gap-3 px-6 py-3.5 text-xs font-bold uppercase tracking-wider transition-all text-left ${
                    modalTab === "toolkit" ? "bg-accent text-black font-black" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Award size={14} />
                  <span>AI TOOLKIT</span>
                </button>
              </div>
            </div>

            {/* Right Content Pane */}
            <div className="flex-1 flex flex-col min-h-0 bg-background relative">
              <button
                onClick={() => setSelectedCompanyId(null)}
                className="absolute top-4 right-4 z-10 border border-border p-2 bg-card hover:bg-red-500/10 hover:text-red-500 hover:border-red-500 transition-all active:scale-95"
                aria-label="Close modal"
              >
                <X size={16} />
              </button>

              <div className="flex-1 p-6 md:p-8 overflow-y-auto space-y-8 select-text">
                
                {/* 1. OVERVIEW & TIMELINE TAB */}
                {modalTab === "overview" && (
                  <div className="space-y-8">
                    {/* Warning notice if low confidence */}
                    {selectedCompany.requires_review && (
                      <div className="border-2 border-dashed border-amber-500 bg-amber-500/10 p-4 flex items-start gap-3">
                        <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-amber-500">
                            ⚠️ PARSER VERIFICATION NOTICE
                          </p>
                          <p className="text-[10px] text-muted-foreground uppercase leading-relaxed mt-0.5">
                            Some fields in this workspace were automatically parsed with low confidence. Please verify the timeline dates, CTC, and location parameters using the <strong className="text-accent">[View Source Email]</strong> button on the milestone items.
                          </p>
                        </div>
                      </div>
                    )}
                    {/* Header Summary */}
                    <div className="border-b border-border pb-4 pr-12 flex flex-col md:flex-row md:items-start justify-between gap-4">
                      <div>
                        <h2 className="text-2xl font-black uppercase tracking-tighter leading-none">{selectedCompany.name} Workspace</h2>
                        <div className="flex items-center flex-wrap gap-3 mt-2">
                          <span className="bg-accent px-2 py-0.5 border border-accent text-[9px] font-black text-black uppercase w-max">
                            {selectedCompany.category}
                          </span>
                          <p className="text-xs text-muted-foreground uppercase">{selectedCompany.role} ✦ {selectedCompany.job_location || "Unknown location"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {selectedApp && selectedApp.user_decision === 'tracking' && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-muted-foreground uppercase">STAGE:</span>
                            <select
                              value={selectedApp.status}
                              onChange={async (e) => {
                                await handleUpdateApplication(selectedCompany.id, {
                                  status: e.target.value,
                                  current_round: e.target.value
                                });
                              }}
                              className="bg-zinc-950 border-2 border-black px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-accent focus:outline-none cursor-pointer hover:bg-zinc-900 transition-colors"
                            >
                              {["Applied", "Shortlisted", "OA", "Technical", "HR", "Offer", "Rejected"].map((s) => (
                                <option key={s} value={s}>
                                  {s.toUpperCase()}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Specifications Grid */}
                    <div className="border-2 border-border p-5 bg-muted/5 space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h4 className="text-xs font-black tracking-widest text-accent uppercase">
                          📋 Placement Specifications
                        </h4>
                        {selectedCompany.requires_review ? (
                          <span className="inline-flex items-center gap-1.5 border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[9px] font-black text-amber-400 uppercase tracking-widest">
                            ⚠ Needs Review — Low confidence parse. Verify against source email.
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 border border-border/50 bg-muted/20 px-2 py-1 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                            🤖 AI-extracted — verify against the original CDC email
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        <div className="space-y-1">
                          <span className="text-[9px] font-black text-muted-foreground uppercase block">CTC / Package</span>
                          <span className="text-sm font-bold text-foreground block">{selectedCompany.ctc || "Will be announced later"}</span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[9px] font-black text-muted-foreground uppercase block">Stipend</span>
                          <span className="text-sm font-bold text-foreground block">{selectedCompany.stipend || "Will be announced later"}</span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[9px] font-black text-muted-foreground uppercase block">Registration Deadline</span>
                          <span className="text-sm font-bold text-foreground block">
                            {selectedCompany.registration_deadline 
                              ? new Date(selectedCompany.registration_deadline).toLocaleString("en-IN", { 
                                  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true 
                                }) 
                              : "Will be announced later"}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[9px] font-black text-muted-foreground uppercase block">Date of Visit</span>
                          <span className="text-sm font-bold text-foreground block">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(selectedCompany as any).eligibility_rules?.date_of_visit || "Will be announced later"}
                          </span>
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <span className="text-[9px] font-black text-muted-foreground uppercase block">Eligible Branches</span>
                          <span className="text-sm font-bold text-foreground block">
                            {selectedCompany.eligible_branches && selectedCompany.eligible_branches.length > 0 
                              ? selectedCompany.eligible_branches.join(", ") 
                              : "All Branches"}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[9px] font-black text-muted-foreground uppercase block">Min CGPA</span>
                          <span className="text-sm font-bold text-foreground block">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(selectedCompany as any).eligibility_rules?.min_cgpa ? `>= ${(selectedCompany as any).eligibility_rules.min_cgpa}` : "N/A"}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[9px] font-black text-muted-foreground uppercase block">History of Arrears</span>
                          <span className="text-sm font-bold text-foreground block">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(selectedCompany as any).eligibility_rules?.requires_no_arrears ? "No Active Backlogs" : "Backlogs Allowed"}
                          </span>
                        </div>
                      </div>

                      {/* Website and Application Links */}
                      <div className="flex flex-wrap gap-3 pt-3 border-t border-border/50">
                        {selectedCompany.registration_link && (
                          <a
                            href={selectedCompany.registration_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 h-9 px-4 border-2 border-accent bg-accent text-black font-black text-[10px] uppercase tracking-wider hover:bg-accent/80 transition-all"
                          >
                            <ExternalLink size={12} />
                            Apply via CDC Portal
                          </a>
                        )}
                        {selectedCompany.website && (
                          <a
                            href={selectedCompany.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 h-9 px-4 border border-border bg-transparent text-foreground font-black text-[10px] uppercase tracking-wider hover:bg-muted transition-all"
                          >
                            <Globe size={12} />
                            Visit Company Website
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Timeline & Notes list */}
                    <div className="space-y-4">
                      <h3 className="text-xs font-black tracking-widest uppercase text-muted-foreground">
                        📅 WORKSPACE TIMELINE MILESTONES
                      </h3>

                      <div className="relative border-l-2 border-border ml-3 pl-6 space-y-8">
                        {workspaceEvents.map((evt: TimelineEvent) => (
                          <div key={evt.id} className="relative space-y-3">
                            <div className="absolute -left-[31px] top-1.5 h-4 w-4 bg-accent border-2 border-black" />
                            
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="text-[10px] font-mono font-bold text-accent block">
                                  {evt.timestamp.toLocaleString("en-IN")}
                                </span>
                                <h5 className="text-sm font-black uppercase tracking-tight text-foreground mt-0.5">
                                  {evt.title}
                                </h5>
                                <span className="text-[9px] text-muted-foreground uppercase">
                                  Sender: {evt.sender}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => {
                                    if (expandedEmailId === evt.id) {
                                      setExpandedEmailId(null);
                                      setExpandedEmailHeightId(null);
                                    } else {
                                      setExpandedEmailId(evt.id);
                                    }
                                  }}
                                  className="text-[9px] font-bold text-accent hover:underline uppercase border border-border px-2.5 py-1 bg-background"
                                >
                                  {expandedEmailId === evt.id ? "Hide Source" : "View Source Email"}
                                </button>
                                {expandedEmailId === evt.id && (
                                  <button
                                    onClick={() => setExpandedEmailHeightId(expandedEmailHeightId === evt.id ? null : evt.id)}
                                    className="text-[9px] font-bold text-accent hover:underline uppercase border border-border px-2.5 py-1 bg-background"
                                  >
                                    {expandedEmailHeightId === evt.id ? "Standard Height" : "Expand Height"}
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Confidence indicators */}
                            {evt.confidence_scores && Object.keys(evt.confidence_scores).length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(evt.confidence_scores).map(([field, score]) => (
                                  <span 
                                    key={field} 
                                    className={`text-[8px] font-mono font-bold px-1.5 py-0.5 border ${
                                      score >= 0.85 ? 'bg-emerald-950/25 border-emerald-500/50 text-emerald-400' :
                                      score >= 0.70 ? 'bg-amber-950/25 border-amber-500/50 text-amber-400' :
                                      'bg-red-950/25 border-red-500/50 text-red-400'
                                    }`}
                                  >
                                    {field.toUpperCase()}: {Math.round(score * 100)}% CONFIDENCE
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Collapsible Source Email */}
                            {expandedEmailId === evt.id && (
                              <div className={`border border-border/80 p-4 bg-muted/20 font-mono leading-relaxed whitespace-pre-wrap overflow-y-auto border-dashed ${
                                expandedEmailHeightId === evt.id ? 'max-h-[75vh] text-xs' : 'max-h-48 text-[10px]'
                              }`}>
                                {evt.body}
                              </div>
                            )}

                            {/* Timeline Notes Integration */}
                            {encryptionKey && selectedApp ? (
                              editingRoundNote === evt.id ? (
                                <div className="space-y-2 max-w-xl">
                                  <textarea
                                    value={tempNoteText}
                                    onChange={(e) => setTempNoteText(e.target.value)}
                                    className="w-full border-2 border-border bg-background p-2 text-xs font-bold focus:border-accent focus:outline-none"
                                    rows={3}
                                    placeholder="Type preparation notes, dates, or questions here..."
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => {
                                        handleSaveRoundNote(evt.id, tempNoteText);
                                        setEditingRoundNote(null);
                                      }}
                                      className="h-8 px-3 border border-border bg-foreground text-background font-bold text-[10px] hover:bg-accent hover:text-black hover:border-accent uppercase tracking-wider transition-all"
                                    >
                                      Save Note
                                    </button>
                                    <button
                                      onClick={() => setEditingRoundNote(null)}
                                      className="h-8 px-3 border border-border bg-transparent text-foreground font-bold text-[10px] hover:bg-muted uppercase tracking-wider transition-all"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="max-w-xl">
                                  <div className="flex justify-between items-center bg-muted/15 border border-border px-3 py-1.5">
                                    <span className="text-[9px] text-muted-foreground uppercase font-bold">📝 Notes for this round</span>
                                    <button
                                      onClick={() => {
                                        setEditingRoundNote(evt.id);
                                        setTempNoteText(decryptedNotes[evt.id] || "");
                                      }}
                                      className="text-[9px] font-black text-accent hover:underline uppercase"
                                    >
                                      {decryptedNotes[evt.id] ? "Edit Note" : "+ Add Note"}
                                    </button>
                                  </div>
                                  {decryptedNotes[evt.id] && (
                                    <p className="text-[11px] text-foreground bg-muted/5 px-3 py-2.5 font-mono border-x border-b border-border leading-normal">
                                      {decryptedNotes[evt.id]}
                                    </p>
                                  )}
                                </div>
                              )
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. JOB DETAILS TAB */}
                {modalTab === "details" && (
                  <div className="space-y-6">
                    <div className="border-b border-border pb-4 flex items-start justify-between gap-3 flex-wrap">
                      <h2 className="text-2xl font-black uppercase tracking-tighter">Placement Specifications</h2>
                      {selectedCompany.requires_review ? (
                        <span className="inline-flex items-center gap-1.5 border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[9px] font-black text-amber-400 uppercase tracking-widest">
                          ⚠ Needs Review — verify all details against the original CDC email
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 border border-border/50 bg-muted/20 px-2 py-1 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                          🤖 AI-extracted — verify against the original CDC email
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div className="border border-border p-4 bg-muted/5 relative">
                          {selectedCompany.requires_review && (
                            <span className="absolute top-2 right-2 text-[8px] font-black text-amber-500 uppercase flex items-center gap-1">
                              <AlertTriangle size={10} /> VERIFY FROM SOURCE
                            </span>
                          )}
                          <span className="text-[10px] font-black tracking-widest text-muted-foreground uppercase block">CTC / SALARY</span>
                          <span className="text-lg font-black uppercase text-foreground">{selectedCompany.ctc || "—"}</span>
                        </div>
                        <div className="border border-border p-4 bg-muted/5 relative">
                          {selectedCompany.requires_review && (
                            <span className="absolute top-2 right-2 text-[8px] font-black text-amber-500 uppercase flex items-center gap-1">
                              <AlertTriangle size={10} /> VERIFY FROM SOURCE
                            </span>
                          )}
                          <span className="text-[10px] font-black tracking-widest text-muted-foreground uppercase block">STIPEND</span>
                          <span className="text-lg font-black uppercase text-foreground">{selectedCompany.stipend || "—"}</span>
                        </div>
                        <div className="border border-border p-4 bg-muted/5 relative">
                          {selectedCompany.requires_review && (
                            <span className="absolute top-2 right-2 text-[8px] font-black text-amber-500 uppercase flex items-center gap-1">
                              <AlertTriangle size={10} /> VERIFY FROM SOURCE
                            </span>
                          )}
                          <span className="text-[10px] font-black tracking-widest text-muted-foreground uppercase block">REGISTRATION DEADLINE</span>
                          <span className="text-xs font-mono font-bold text-foreground">
                            {selectedCompany.registration_deadline 
                              ? new Date(selectedCompany.registration_deadline).toLocaleString("en-IN")
                              : "—"}
                          </span>
                        </div>
                      </div>

                      <div className="border border-border p-4 bg-muted/5 space-y-3">
                        <h4 className="text-xs font-black tracking-wider uppercase text-muted-foreground">ELIGIBILITY DETAILS</h4>
                        <div className="flex items-center gap-2">
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          {getEligibilityIcon((selectedCompany as any).eligibility_status || "CHECK")}
                          <span className="text-xs font-bold uppercase">{selectedCompany.requires_review ? "NEEDS REVIEW" : "ELIGIBLE"}</span>
                        </div>
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(selectedCompany as any).eligibility_reason && (
                          <p className="text-[10px] text-muted-foreground uppercase leading-snug font-bold">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(selectedCompany as any).eligibility_reason}
                          </p>
                        )}

                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(selectedCompany as any).eligibility_explanation && (
                          <div className="space-y-3.5 pt-2 border-t border-border/60">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(selectedCompany as any).eligibility_explanation.failed && (selectedCompany as any).eligibility_explanation.failed.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[9px] font-black text-red-500 tracking-widest uppercase block">⚠️ FAILED CRITERIA</span>
                                <ul className="list-disc list-inside text-[10px] text-red-400 font-mono space-y-1 pl-1">
                                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                  {(selectedCompany as any).eligibility_explanation.failed.map((rule: string, idx: number) => (
                                    <li key={idx} className="leading-tight normal-case">{rule}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(selectedCompany as any).eligibility_explanation.matched && (selectedCompany as any).eligibility_explanation.matched.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[9px] font-black text-emerald-500 tracking-widest uppercase block">✓ MATCHED CRITERIA</span>
                                <ul className="list-disc list-inside text-[10px] text-emerald-400 font-mono space-y-1 pl-1">
                                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                  {(selectedCompany as any).eligibility_explanation.matched.map((rule: string, idx: number) => (
                                    <li key={idx} className="leading-tight normal-case">{rule}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(selectedCompany as any).eligibility_raw_text && (
                          <div className="space-y-1 pt-2 border-t border-border/60">
                            <span className="text-[9px] font-black text-muted-foreground tracking-widest uppercase block">RAW ELIGIBILITY TEXT (SOURCE)</span>
                            <pre className="text-[10px] font-mono text-zinc-350 bg-zinc-950 p-2.5 border border-border/80 whitespace-pre-wrap max-h-32 overflow-y-auto leading-normal normal-case font-normal">
                              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                              {(selectedCompany as any).eligibility_raw_text}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ATS Keywords */}
                    {selectedCompany.jd_ats_keywords && selectedCompany.jd_ats_keywords.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-black tracking-wider uppercase text-muted-foreground">ATS KEYWORDS</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedCompany.jd_ats_keywords.map((kw: string, i: number) => (
                            <span key={i} className="text-[9px] font-bold bg-muted border border-border px-2 py-0.5 text-foreground uppercase">
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Important links */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-black tracking-wider uppercase text-muted-foreground">IMPORTANT LINKS</h4>
                      <div className="space-y-2">
                        {selectedCompany.registration_link && (
                          <a
                            href={selectedCompany.registration_link}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 text-xs font-bold text-accent hover:underline uppercase"
                          >
                            <Link2 size={14} />
                            <span>Apply via CDC Portal</span>
                          </a>
                        )}
                        {selectedCompany.website && (
                          <a
                            href={selectedCompany.website}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 text-xs font-bold text-muted-foreground hover:underline uppercase"
                          >
                            <Link2 size={14} />
                            <span>Corporate Website</span>
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Full JD text or PDF */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <h4 className="text-xs font-black tracking-wider uppercase text-muted-foreground">JOB DESCRIPTION</h4>
                        <div className="flex gap-2">
                          {jdPdfAttachment && (
                            <span className="text-[10px] font-bold text-accent uppercase bg-accent/10 border border-accent/30 px-2 py-0.5 animate-pulse">
                              📄 PDF AVAILABLE
                            </span>
                          )}
                          {!pdfUrl && !pdfLoading && selectedCompany.jd_text && (
                            <button
                              onClick={() => setJdTextExpanded(!jdTextExpanded)}
                              className="text-[9px] font-bold text-accent hover:underline uppercase border border-border px-2 py-0.5 bg-background"
                            >
                              {jdTextExpanded ? "Standard View" : "Expand View"}
                            </button>
                          )}
                        </div>
                      </div>
                      
                      {pdfUrl ? (
                        <div className="border-2 border-border bg-muted/5 p-1">
                          <iframe
                            src={pdfUrl}
                            className="w-full h-[60vh] border-0"
                            title="Job Description PDF"
                          />
                        </div>
                      ) : pdfLoading ? (
                        <div className="border border-border p-8 bg-muted/10 text-center font-mono text-xs animate-pulse uppercase">
                          Loading Job Description PDF...
                        </div>
                      ) : (
                        <div className={`border border-border p-4 bg-muted/10 overflow-y-auto rounded-none font-mono leading-relaxed whitespace-pre-wrap text-foreground ${
                          jdTextExpanded ? 'max-h-[75vh] text-xs' : 'max-h-60 text-[10px]'
                        }`}>
                          {selectedCompany.jd_text || "No detailed job description text loaded."}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 3. AI TOOLKIT TAB */}
                {modalTab === "toolkit" && (
                  <div className="space-y-6">
                    <div className="border-b border-border pb-4">
                      <h2 className="text-2xl font-black uppercase tracking-tighter">AI Placement Toolkit</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="border border-border p-5 bg-card flex flex-col justify-between h-36">
                        <div>
                          <span className="text-[10px] font-black tracking-widest text-muted-foreground uppercase block">MATCH SCORE</span>
                          <span className="text-[9px] text-muted-foreground uppercase block mt-0.5">Resume vs JD overlap</span>
                        </div>
                        <span className="text-3xl font-extrabold tracking-tighter text-foreground">
                          {selectedApp?.match_score || 0}%
                        </span>
                      </div>
                      <div className="border border-border p-5 bg-card flex flex-col justify-between h-36">
                        <div>
                          <span className="text-[10px] font-black tracking-widest text-muted-foreground uppercase block">PREPARATION SCORE</span>
                          <span className="text-[9px] text-muted-foreground uppercase block mt-0.5">Pre-application readiness</span>
                        </div>
                        <span className="text-3xl font-extrabold tracking-tighter text-foreground">
                          {getPrepScore(selectedCompany)}%
                        </span>
                      </div>
                      <div className="border border-border p-5 bg-card flex flex-col justify-between h-36">
                        <div>
                          <span className="text-[10px] font-black tracking-widest text-muted-foreground uppercase block">APPLICATION HEALTH</span>
                          <span className="text-[9px] text-muted-foreground uppercase block mt-0.5">Completion checklists</span>
                        </div>
                        <span className="text-3xl font-extrabold tracking-tighter text-accent">
                          {healthVal}%
                        </span>
                      </div>
                    </div>

                    <div className="pt-6 space-y-4">
                      <h4 className="text-xs font-black tracking-widest uppercase text-muted-foreground">LAUNCH TOOLKIT ACTIONS</h4>
                      
                      <div className="flex flex-col gap-3">
                        <button
                          onClick={async () => {
                            if (window.confirm("Are you sure you want to stop tracking this company?")) {
                              await handleUpdateApplication(selectedCompany.id, { user_decision: 'archived' });
                              setSelectedCompanyId(null);
                            }
                          }}
                          className="flex items-center justify-between border-2 border-border p-4 bg-background hover:bg-red-950 hover:text-red-400 hover:border-red-500 transition-all uppercase w-full font-bold text-xs"
                        >
                          <span>Stop Tracking & Archive Workspace</span>
                          <Archive size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
