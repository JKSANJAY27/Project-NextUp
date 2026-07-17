"use client";

import React, { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import api from "@/lib/api";
import { useCompanies, useApplications } from "@/lib/queries";
import { Company, Application, CompanyEvent } from "./types";
import TrackingStats from "@/components/TrackingStats";
import TrackingSection from "@/components/TrackingSection";
import TrackingCard from "@/components/TrackingCard";
import CompanyWorkspaceModal from "@/components/CompanyWorkspaceModal";
import ConfirmArchiveModal from "@/components/ConfirmArchiveModal";
import { Activity } from "lucide-react";
type FilterMode = "ALL" | "ACTIVE_ROUNDS" | "UPCOMING_7_DAYS" | "INTERVIEWS" | "OFFERS";

export default function TrackingPage() {
  const { user, encryptionKey } = useAppStore();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [applications, setApplications] = useState<Record<string, Application>>({});
  const [loading, setLoading] = useState(true);
  
  const [filterMode, setFilterMode] = useState<FilterMode>("ALL");
  
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [companyEvents, setCompanyEvents] = useState<Record<string, CompanyEvent[]>>({});

  // Workspace modal states
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  const [decryptedNotes, setDecryptedNotes] = useState<Record<string, any>>({});
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [pdfLoading, setPdfLoading] = useState(false);
  const queryClient = useQueryClient();
  const { data: companiesData, isLoading: companiesLoading, isError: companiesError } = useCompanies(!!user);
  const { data: applicationsData, isLoading: applicationsLoading, isError: applicationsError } = useApplications(!!user);

  const [archiveConfirm, setArchiveConfirm] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {}
  });

  const handleArchive = (companyId: string) => {
    const compName = companies.find(c => c.id === companyId)?.name || "this company";
    setArchiveConfirm({
      isOpen: true,
      title: "Archive Workspace",
      message: `Are you sure you want to archive ${compName}? This will remove it from active tracking.`,
      onConfirm: async () => {
        setArchiveConfirm(prev => ({ ...prev, isOpen: false }));
        try {
          const app = applications[companyId];
          if (app) {
            // Optimistic UI update
            setApplications(prev => {
              const next = { ...prev };
              delete next[companyId];
              return next;
            });
            
            await api.patch(`/applications/${app.id}`, {
              user_decision: "archived"
            });
          } else {
            // If for some reason there is no application workspace, call opportunity state
            await api.post(`/applications/opportunity-state?company_id=${companyId}&action=archive&reason=MANUAL_NOT_INTERESTED`);
          }
          
          // Invalidate queries
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          queryClient.invalidateQueries({ queryKey: ["applications"] });
          queryClient.invalidateQueries({ queryKey: ["calendar"] });
        } catch (err) {
          console.error("Failed to archive application", err);
          alert("Failed to archive application.");
          // Refetch to restore state
          queryClient.invalidateQueries({ queryKey: ["applications"] });
        }
      }
    });
  };

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

  // Normalize stages. There is no separate 'Shortlisted' stage: a shortlist
  // always admits you into the next round (OA/Interview), so any legacy
  // 'Shortlisted' application shows under Online Assessment.
  const categorized = {
    REGISTRATION: [] as Company[],
    ONLINE_ASSESSMENT: [] as Company[],
    INTERVIEW: [] as Company[],
    OFFER: [] as Company[],
    REJECTED: [] as Company[],
  };

  visibleCompanies.forEach(c => {
    const status = applications[c.id]?.status || "Applied";
    if (status.includes("Offer")) categorized.OFFER.push(c);
    else if (status.includes("Interview") || status === "Technical" || status === "HR") categorized.INTERVIEW.push(c);
    else if (status === "OA" || status.includes("Assessment") || status === "Shortlisted") categorized.ONLINE_ASSESSMENT.push(c);
    else if (status.includes("Rejected") || status.includes("Archived")) categorized.REJECTED.push(c);
    else categorized.REGISTRATION.push(c); // Applied maps to REGISTRATION visually
  });

  const getNextEvent = (compId: string) => {
    const events = companyEvents[compId];
    if (!events || events.length === 0) return null;
    return events[events.length - 1];
  };



  const selectedCompany = companies.find(c => c.id === selectedCompanyId) || null;

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
          onlineAssessment={categorized.ONLINE_ASSESSMENT.length}
          interview={categorized.INTERVIEW.length}
          offer={categorized.OFFER.length}
        />

        {/* Loading / Error / Empty States */}
        {loading ? (
          <div className="text-center py-20 font-bold uppercase tracking-wider text-muted-foreground">
            Loading workflow tracker...
          </div>
        ) : (companiesError || applicationsError) ? (
          // Distinct from the real empty state: the free-tier backend can
          // take 30-50s to wake from a cold start, and a fetch failure used
          // to render as an indistinguishable 'no companies' message —
          // making the tracker look broken/empty when it was just waiting.
          <div className="text-center py-20 border-2 border-dashed border-destructive/40 text-muted-foreground font-bold uppercase tracking-wider text-xs space-y-3">
            <p>Could not reach the server. It may be waking up from idle — this can take up to a minute.</p>
            <button
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["companies"] });
                queryClient.invalidateQueries({ queryKey: ["applications"] });
              }}
              className="inline-block border border-border hover:border-foreground px-4 py-2 text-foreground normal-case tracking-normal"
            >
              Retry
            </button>
          </div>
        ) : visibleCompanies.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-border text-muted-foreground font-bold uppercase tracking-wider text-xs">
            No companies matching the current filter in active tracking.
          </div>
        ) : (
          <div className="space-y-6">
            <TrackingSection title="Registration" count={categorized.REGISTRATION.length} colorClass="bg-yellow-500">
              {categorized.REGISTRATION.map(c => (
                <TrackingCard key={c.id} company={c} application={applications[c.id]} nextEvent={getNextEvent(c.id)} stage="REGISTRATION" onClick={() => { setSelectedCompanyId(c.id); }} onArchive={() => handleArchive(c.id)} />
              ))}
            </TrackingSection>
            
            <TrackingSection title="Online Assessment" count={categorized.ONLINE_ASSESSMENT.length} colorClass="bg-orange-500">
              {categorized.ONLINE_ASSESSMENT.map(c => (
                <TrackingCard key={c.id} company={c} application={applications[c.id]} nextEvent={getNextEvent(c.id)} stage="ONLINE_ASSESSMENT" onClick={() => { setSelectedCompanyId(c.id); }} onArchive={() => handleArchive(c.id)} />
              ))}
            </TrackingSection>

            <TrackingSection title="Interview" count={categorized.INTERVIEW.length} colorClass="bg-purple-500">
              {categorized.INTERVIEW.map(c => (
                <TrackingCard key={c.id} company={c} application={applications[c.id]} nextEvent={getNextEvent(c.id)} stage="INTERVIEW" onClick={() => { setSelectedCompanyId(c.id); }} onArchive={() => handleArchive(c.id)} />
              ))}
            </TrackingSection>

            <TrackingSection title="Offer Received" count={categorized.OFFER.length} colorClass="bg-emerald-500">
              {categorized.OFFER.map(c => (
                <TrackingCard key={c.id} company={c} application={applications[c.id]} nextEvent={getNextEvent(c.id)} stage="OFFER" onClick={() => { setSelectedCompanyId(c.id); }} onArchive={() => handleArchive(c.id)} />
              ))}
            </TrackingSection>
            
            <TrackingSection title="Rejected" count={categorized.REJECTED.length} colorClass="bg-red-500">
              {categorized.REJECTED.map(c => (
                <TrackingCard key={c.id} company={c} application={applications[c.id]} nextEvent={getNextEvent(c.id)} stage="REJECTED" onClick={() => { setSelectedCompanyId(c.id); }} onArchive={() => handleArchive(c.id)} />
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

      <ConfirmArchiveModal
        isOpen={archiveConfirm.isOpen}
        title={archiveConfirm.title}
        message={archiveConfirm.message}
        onConfirm={archiveConfirm.onConfirm}
        onCancel={() => setArchiveConfirm(prev => ({ ...prev, isOpen: false }))}
      />
    </>
  );
}
