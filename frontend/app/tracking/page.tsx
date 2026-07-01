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
import { CompanyWorkspaceModal } from "@/components/CompanyWorkspaceModal";
import { 
  X, Calendar, Archive, Award, 
  CheckCircle, XCircle, HelpCircle, ExternalLink, Globe, 
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

  const handleUpdateApplication = async (companyId: string, updates: Partial<Application>) => {
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
  const getPrepScore = (comp: Company) => {
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
        const pdf = evt.attachments.find((att) => att.file_type === 'JD_PDF');
        if (pdf) return pdf;
      }
    }
    return null;
  }, [selectedCompanyId, companyEvents]);

  useEffect(() => {
    let active = true;
    let localPdfUrl: string | null = null;
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
          localPdfUrl = URL.createObjectURL(blob);
          setPdfUrl(localPdfUrl);
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
      if (localPdfUrl) {
        URL.revokeObjectURL(localPdfUrl);
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
        <CompanyWorkspaceModal
          companyId={selectedCompany.id}
          onClose={() => setSelectedCompanyId(null)}
        />
      )}
    </>
  );
}
