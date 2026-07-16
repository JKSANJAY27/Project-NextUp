"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { useDashboard, CACHE_KEYS } from "@/lib/queries";
import { SkeletonDashboard } from "@/components/SkeletonLoader";
import CompanyWorkspaceModal from "@/components/CompanyWorkspaceModal";
import ConfirmArchiveModal from "@/components/ConfirmArchiveModal";
import { 
  Plus, 
  Lock, 
  CheckCircle, 
  XCircle, 
  HelpCircle,
  ExternalLink,
  AlertCircle,
  X,
  Clock,
  TrendingUp,
  Award,
  AlertTriangle,
  Megaphone,
  Archive
} from "lucide-react";

interface ImportantLink {
  label: string;
  url: string;
}

interface AdditionalInfo {
  subject?: string;
  sender?: string;
  important_links?: ImportantLink[];
}

interface TodayEvent {
  time: Date;
  title: string;
  description: string;
  type: string;
  companyId: string;
}


interface Company {
  id: string;
  name: string;
  category: string;
  role: string;
  ctc: string;
  stipend: string;
  job_location: string;
  eligible_branches: string[] | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eligibility_rules: any | null;
  registration_deadline: string | null;
  website: string | null;
  registration_link: string | null;
  jd_text: string | null;
  jd_required_skills: string[] | null;
  jd_ats_keywords: string[] | null;
  source_email_body: string | null;
  additional_info: AdditionalInfo | null;
  requires_review?: boolean;
  latest_event?: {
    id: string;
    event_type: string;
    subject: string;
    timestamp: string | null;
  } | null;
}

interface EligibilityExplanation {
  eligible: boolean;
  matched: string[];
  failed: string[];
}

interface CompanyWithEligibility extends Company {
  eligibility_status: string;
  eligibility_reason: string | null;
  eligibility_explanation?: EligibilityExplanation | null;
  eligibility_raw_text?: string | null;
  deadline_label?: string | null;
}

interface Application {
  id: string;
  record_type: "application";
  company_id: string;
  status: string;
  current_round: string;
  notes_enc: string | null;
  match_score: number;
  user_decision: string;
  recruitment_state: string;
  last_user_activity_at: string;
  workspace_priority_override: string | null;
  snoozed_until: string | null;
  priority_score: number;
  is_stale: boolean;
}

interface OpportunityState {
  record_type: "opportunity_state";
  company_id: string;
  state: string; // unseen | tracking | decision_pending | archived | auto_archived
  archive_reason: string | null;
  archived_at: string | null;
  decision_pending_since: string | null;
  snoozed_until: string | null;
  previous_state: string | null;
  updated_at: string;
  company: Company | null;
}

interface NotificationDetail {
  id: string;
  message: string;
  is_read: boolean;
  notification_type: string;
  severity: number; // 1-5
  created_at: string;
  company_event_id: string | null;
  subject?: string;
  sender?: string;
  body?: string;
  timestamp?: string;
  confidence_scores: Record<string, number>;
}

interface NotificationBundle {
  company_id: string;
  company_name: string;
  role: string;
  category: string;
  unread_count: number;
  notifications: NotificationDetail[];
}

interface CompanyEvent {
  id: string;
  company_id: string;
  event_type: string;
  subject: string | null;
  sender: string | null;
  body: string | null;
  timestamp: string | null;
  confidence_scores: Record<string, number>;
  user_notification_msg: string | null;
  attachments?: AttachmentMetadata[];
}

interface AttachmentMetadata {
  id: string;
  file_name: string;
  file_type: string;
  storage_path?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsed_meta?: Record<string, any>;
  uploaded_at: string;
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  announcement_type: string;
  deadline: string | null;
  source_email_id: string | null;
  created_at: string;
  attachments: AttachmentMetadata[];
}



async function calculateHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}



function DashboardPageContent() {
  const { user, encryptionKey } = useAppStore();
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = searchParams.get("tab") || "action-center";

  useEffect(() => {
    if (activeTab === "tracking") {
      router.replace("/tracking");
    }
  }, [activeTab, router]);

  const [companies, setCompanies] = useState<CompanyWithEligibility[]>([]);
  const [applications, setApplications] = useState<Record<string, Application>>({});
  const [opportunityStates, setOpportunityStates] = useState<Record<string, OpportunityState>>({});
  const [notificationBundles, setNotificationBundles] = useState<NotificationBundle[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [filterCategory, setFilterCategory] = useState("ALL");
  const [filterEligibility, setFilterEligibility] = useState("ALL");
  const [selectedCompany, setSelectedCompany] = useState<CompanyWithEligibility | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Bulk Selection and Comparison states
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);
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

  // Company Workspace Drawer state
  const [companyEvents, setCompanyEvents] = useState<CompanyEvent[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  const [decryptedNotes, setDecryptedNotes] = useState<Record<string, any>>({});
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [pdfLoading, setPdfLoading] = useState(false);

  // Manual Company Form State
  const [compName, setCompName] = useState("");
  const [compCategory, setCompCategory] = useState("Dream");
  const [compRole, setCompRole] = useState("");
  const [compCtc, setCompCtc] = useState("");
  const [compStipend, setCompStipend] = useState("");
  const [compLocation, setCompLocation] = useState("");
  const [compBranches, setCompBranches] = useState("");
  const [compMinCgpa, setCompMinCgpa] = useState("");
  const [compRequiresNoArrears, setCompRequiresNoArrears] = useState(false);
  const [compDeadline, setCompDeadline] = useState("");
  const [compRegLink, setCompRegLink] = useState("");
  const [compJd, setCompJd] = useState("");
  
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  const queryClient = useQueryClient();

  // 1. TanStack Query hooks
  const { data: dashboardData, isLoading: dashboardLoading } = useDashboard(!!user);

  const companiesData = dashboardData?.companies;
  const applicationsData = dashboardData?.applications;
  const notificationsData = dashboardData?.notifications;
  const announcementsData = dashboardData?.announcements;

  // Sync loading state
  useEffect(() => {
    setLoading(dashboardLoading);
  }, [dashboardLoading]);

  // Sync companies state
  useEffect(() => {
    if (companiesData) {
      setCompanies(companiesData);
    }
  }, [companiesData]);

  // Sync applications state
  useEffect(() => {
    if (applicationsData) {
      const appMap: Record<string, Application> = {};
      const oppStateMap: Record<string, OpportunityState> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (applicationsData || []).forEach((record: any) => {
        if (record.record_type === "opportunity_state") {
          oppStateMap[record.company_id] = record as OpportunityState;
        } else {
          appMap[record.company_id] = {
            id: record.id,
            record_type: "application",
            company_id: record.company_id,
            status: record.status || "Applied",
            current_round: record.current_round || "Applied",
            notes_enc: record.notes_enc,
            match_score: record.match_score || 0,
            user_decision: record.user_decision || "tracking",
            recruitment_state: record.recruitment_state || "Registration",
            last_user_activity_at: record.last_user_activity_at,
            workspace_priority_override: record.workspace_priority_override,
            snoozed_until: record.snoozed_until,
            priority_score: record.priority_score || 0,
            is_stale: record.is_stale || false
          };
        }
      });
      setApplications(appMap);
      setOpportunityStates(oppStateMap);
    }
  }, [applicationsData]);

  // Sync notifications state
  useEffect(() => {
    if (notificationsData) {
      setNotificationBundles(notificationsData);
    }
  }, [notificationsData]);

  // Sync announcements state
  useEffect(() => {
    if (announcementsData) {
      setAnnouncements(announcementsData);
    }
  }, [announcementsData]);

  // Mock function for backwards compatibility with any remaining manual triggers
  const fetchDashboardData = async () => {
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["calendar"] });
    await queryClient.invalidateQueries({ queryKey: ["applications"] });
  };

  useEffect(() => {
    // Set up real-time subscription for realtime updates from Supabase
    const companiesChannel = supabase
      .channel("supabase-realtime-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "companies" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "applications" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(companiesChannel);
    };
  }, [user, encryptionKey, queryClient]);

  const prefetchCompanyDetails = (companyId: string) => {
    queryClient.prefetchQuery({
      queryKey: CACHE_KEYS.companyEvents(companyId),
      queryFn: async () => {
        const res = await api.get(`/companies/${companyId}/events`);
        return res.data || [];
      },
      staleTime: 5 * 60 * 1000,
    });
  };



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

  // Fetch company events whenever selectedCompany changes
  useEffect(() => {
    const fetchCompanyEvents = async () => {
      if (!selectedCompany) {
        setCompanyEvents([]);
        return;
      }
      try {
        const res = await api.get(`/companies/${selectedCompany.id}/events`);
        setCompanyEvents(res.data || []);
      } catch (err) {
        console.error("Failed to fetch company events:", err);
        setCompanyEvents([]);
      }
    };
    fetchCompanyEvents();
  }, [selectedCompany]);

  const jdPdfAttachment = React.useMemo(() => {
    for (const evt of companyEvents) {
      if (evt.attachments) {
        const pdf = evt.attachments.find((att) => att.file_type === 'JD_PDF');
        if (pdf) return pdf;
      }
    }
    return null;
  }, [companyEvents]);

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

  // Handle manual company creation
  const handleAddCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");

    if (!compName || !compRole) {
      setFormError("COMPANY NAME AND ROLE ARE REQUIRED.");
      return;
    }

    try {
      const branchesArray = compBranches
        ? compBranches.split(",").map((b) => b.trim().toUpperCase()).filter((b) => b)
        : [];

      const fingerprintInput = `${compName.trim().toUpperCase()}|${compRole.trim().toUpperCase()}|${compCategory.trim().toUpperCase()}|${new Date().getFullYear()}|DEFAULT`;
      const fingerprint = await calculateHash(fingerprintInput);

      const eligibilityRules = {
        min_cgpa: compMinCgpa ? parseFloat(compMinCgpa) : null,
        min_tenth_marks: null,
        min_twelfth_marks: null,
        requires_no_arrears: compRequiresNoArrears
      };

      const { error } = await supabase
        .from("companies")
        .insert({
          name: compName.trim(),
          category: compCategory,
          role: compRole.trim(),
          ctc: compCtc.trim() || null,
          stipend: compStipend.trim() || null,
          job_location: compLocation.trim() || null,
          eligible_branches: branchesArray.length > 0 ? branchesArray : [],
          eligibility_rules: eligibilityRules,
          registration_deadline: compDeadline ? new Date(compDeadline).toISOString() : null,
          registration_link: compRegLink.trim() || null,
          website: null,
          jd_text: compJd.trim() || null,
          jd_required_skills: [],
          jd_ats_keywords: [],
          recruitment_cycle: "Default",
          fingerprint: fingerprint
        });

      if (error) throw error;

      setFormSuccess("COMPANY DRIVE CREATED SUCCESSFULLY.");
      fetchDashboardData();
      
      // Reset form
      setCompName("");
      setCompRole("");
      setCompCtc("");
      setCompStipend("");
      setCompLocation("");
      setCompBranches("");
      setCompMinCgpa("");
      setCompRequiresNoArrears(false);
      setCompDeadline("");
      setCompRegLink("");
      setCompJd("");
      setTimeout(() => setShowAddCompany(false), 1500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setFormError(err.message || "FAILED TO CREATE DRIVE.");
    }
  };

  const handleUpdateApplication = async (companyId: string, updates: {
    status?: string;
    current_round?: string;
    notes_enc?: string | null;
    user_decision?: string;
    recruitment_state?: string;
    workspace_priority_override?: string | null;
    snoozed_until?: string | null;
  }) => {
    if (!user) {
      alert("PLEASE LOG IN TO TRACK APPLICATIONS.");
      return;
    }

    try {
      const app = applications[companyId];
      
      // OPTIMISTIC UI UPDATE
      const previousState = { ...applications };
      if (app) {
        setApplications(prev => ({
          ...prev,
          [companyId]: { ...app, ...updates }
        }));
      } else {
        setApplications(prev => ({
          ...prev,
          [companyId]: {
            id: "temp-id",
            record_type: "application",
            company_id: companyId,
            status: updates.status || "Applied",
            current_round: updates.current_round || "Applied",
            notes_enc: updates.notes_enc || null,
            user_decision: updates.user_decision || "tracking",
            recruitment_state: updates.recruitment_state || "Registration",
            last_user_activity_at: new Date().toISOString(),
            workspace_priority_override: updates.workspace_priority_override || null,
            snoozed_until: updates.snoozed_until || null,
            priority_score: 0,
            is_stale: false,
            match_score: 0
          }
        }));
      }

      try {
        if (app) {
          // Update existing application via FastAPI PATCH endpoint
          const res = await api.patch(`/applications/${app.id}`, updates);
          setApplications(prev => ({
            ...prev,
            [companyId]: res.data
          }));
        } else {
          // Create new application via FastAPI POST endpoint
          const res = await api.post(`/applications`, {
            company_id: companyId,
            status: updates.status || "Applied",
            current_round: updates.current_round || "Applied",
            notes_enc: updates.notes_enc || null,
            user_decision: updates.user_decision || "tracking",
            recruitment_state: updates.recruitment_state || "Registration",
            workspace_priority_override: updates.workspace_priority_override || null,
            snoozed_until: updates.snoozed_until || null
          });
          setApplications(prev => ({
            ...prev,
            [companyId]: res.data
          }));
        }
        fetchDashboardData();
      } catch (err) {
        // Rollback on error
        console.error("Failed to update application tracker, rolling back optimistic UI update:", err);
        setApplications(previousState);
        alert("FAILED TO UPDATE TRACKING STATUS.");
      }
    } catch (err) {
      console.error("Unknown error in tracking logic:", err);
    }
  };

  // Perform bulk actions across selected companies
  const handleBulkAction = async (action: "tracking" | "interested" | "archived") => {
    setLoading(true);
    try {
      await Promise.all(
        selectedCompanyIds.map(id => handleUpdateApplication(id, { user_decision: action }))
      );
      setSelectedCompanyIds([]);
      alert(`Bulk action completed: marked as ${action.toUpperCase()}`);
    } catch (err) {
      console.error("Bulk action failed:", err);
      alert("Failed to complete bulk action.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpportunityAction = async (companyId: string, action: "track" | "archive" | "snooze" | "restore", reason?: string) => {
    const prevOppStates = { ...opportunityStates };
    const prevApps = { ...applications };

    try {
      // Optimistic UI updates
      if (action === "track") {
        setOpportunityStates(prev => {
          const next = { ...prev };
          const existing = next[companyId] || {
            record_type: "opportunity_state",
            company_id: companyId,
            state: "unseen",
            archive_reason: null,
            archived_at: null,
            decision_pending_since: null,
            snoozed_until: null,
            previous_state: null,
            updated_at: new Date().toISOString(),
            company: null
          };
          next[companyId] = { ...existing, state: "tracking", previous_state: existing.state };
          return next;
        });
        setApplications(prev => {
          const next = { ...prev };
          const existing = next[companyId];
          next[companyId] = existing ? {
            ...existing,
            user_decision: "tracking"
          } : {
            id: "temp-id",
            record_type: "application",
            company_id: companyId,
            status: "Applied",
            current_round: "Applied",
            notes_enc: null,
            user_decision: "tracking",
            recruitment_state: "Registration",
            last_user_activity_at: new Date().toISOString(),
            workspace_priority_override: null,
            snoozed_until: null,
            priority_score: 0,
            is_stale: false,
            match_score: 0
          };
          return next;
        });
      } else if (action === "archive") {
        setOpportunityStates(prev => {
          const next = { ...prev };
          const existing = next[companyId] || {
            record_type: "opportunity_state",
            company_id: companyId,
            state: "unseen",
            archive_reason: null,
            archived_at: null,
            decision_pending_since: null,
            snoozed_until: null,
            previous_state: null,
            updated_at: new Date().toISOString(),
            company: null
          };
          next[companyId] = {
            ...existing,
            state: "archived",
            archive_reason: reason || "MANUAL_NOT_INTERESTED",
            archived_at: new Date().toISOString(),
            previous_state: existing.state
          };
          return next;
        });
        if (applications[companyId]) {
          setApplications(prev => {
            const next = { ...prev };
            next[companyId] = { ...next[companyId], user_decision: "archived" };
            return next;
          });
        }
      } else if (action === "snooze") {
        setOpportunityStates(prev => {
          const next = { ...prev };
          const existing = next[companyId] || {
            record_type: "opportunity_state",
            company_id: companyId,
            state: "unseen",
            archive_reason: null,
            archived_at: null,
            decision_pending_since: null,
            snoozed_until: null,
            previous_state: null,
            updated_at: new Date().toISOString(),
            company: null
          };
          const snoozeDate = new Date();
          snoozeDate.setDate(snoozeDate.getDate() + 7);
          next[companyId] = {
            ...existing,
            state: "decision_pending",
            snoozed_until: snoozeDate.toISOString(),
            previous_state: existing.state
          };
          return next;
        });
      } else if (action === "restore") {
        setOpportunityStates(prev => {
          const next = { ...prev };
          if (next[companyId]) {
            const restoreTarget = next[companyId].previous_state || "decision_pending";
            next[companyId] = {
              ...next[companyId],
              state: restoreTarget,
              archive_reason: null,
              archived_at: null,
              previous_state: null
            };
          }
          return next;
        });
        if (applications[companyId]) {
          setApplications(prev => {
            const next = { ...prev };
            next[companyId] = { ...next[companyId], user_decision: "tracking" };
            return next;
          });
        }
      }

      let url = `/applications/opportunity-state?company_id=${companyId}&action=${action}`;
      if (reason) {
        url += `&reason=${reason}`;
      }
      await api.post(url);
      await fetchDashboardData();
    } catch (err) {
      console.error(`Opportunity action '${action}' failed, rolling back:`, err);
      setOpportunityStates(prevOppStates);
      setApplications(prevApps);
      alert(`Failed to ${action} opportunity.`);
    }
  };


  
  // Manual trigger for email sync (calls FastAPI queue processing webhook)
  const handleTriggerSync = async () => {
    setSyncing(true);
    try {
      await api.post("/gmail/sync");
      fetchDashboardData();
    } catch (err) {
      console.error("Manual sync failed:", err);
      alert("Failed to sync emails. Check representative trigger logs.");
    } finally {
      setSyncing(false);
    }
  };

  // Native HTML5 Drag and Drop handlers
  // Check if application is currently snoozed
  const isSnoozed = (app: Application) => {
    if (!app || !app.snoozed_until) return false;
    return new Date(app.snoozed_until).getTime() > Date.now();
  };

  // Calculate Pre-application Preparation Readiness score
  const getPrepScore = (comp: CompanyWithEligibility) => {
    let score = 0;
    if (comp.eligibility_status === "ELIGIBLE") {
      score += 70;
    } else if (comp.eligibility_status === "CHECK" || comp.eligibility_status === "UNKNOWN") {
      score += 40;
    }
    
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

  // Helper: Get Today's schedule events
  const getTodayEvents = React.useCallback(() => {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
    
    const events: TodayEvent[] = [];
    
    // 1. Company registration deadlines today
    companies.forEach(comp => {
      if (comp.registration_deadline) {
        const dlTime = new Date(comp.registration_deadline).getTime();
        if (dlTime >= startOfDay && dlTime <= endOfDay) {
          events.push({
            time: new Date(comp.registration_deadline),
            title: `${comp.name} Deadline`,
            description: `Registration closes at ${new Date(comp.registration_deadline).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' })}.`,
            type: "deadline",
            companyId: comp.id
          });
        }
      }
    });

    // 2. Notification events today
    notificationBundles.forEach(bundle => {
      bundle.notifications.forEach((n) => {
        const eventTime = n.timestamp ? new Date(n.timestamp).getTime() : new Date(n.created_at).getTime();
        if (eventTime >= startOfDay && eventTime <= endOfDay) {
          events.push({
            time: new Date(eventTime),
            title: `${bundle.company_name} - ${n.notification_type.toUpperCase()}`,
            description: n.message,
            type: n.notification_type,
            companyId: bundle.company_id
          });
        }
      });
    });

    return events.sort((a, b) => a.time.getTime() - b.time.getTime());
  }, [companies, notificationBundles]);

  const getDailyDigest = () => {
    const userName = user?.full_name || "Sanjay";
    const todayEvents = getTodayEvents();
    
    let eventText = "You have no events scheduled for today.";
    if (todayEvents.length > 0) {
      const mainEvent = todayEvents[0];
      eventText = `You have ${mainEvent.title} at ${mainEvent.time.toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' })} today.`;
    }
    
    // Exclude terminated states so rejected/declined apps don't skew the digest
    // Check BOTH recruitment_state AND status — rejection can live in either field
    const TERMINAL_STATES = ['Rejected', 'Declined', 'Likely Rejected', 'Offer'];
    const trackedApps = Object.values(applications).filter(
      app =>
        app.user_decision === 'tracking' &&
        !TERMINAL_STATES.includes(app.recruitment_state) &&
        !TERMINAL_STATES.includes(app.status)
    );
    const interviewCount = trackedApps.filter(app => app.recruitment_state === 'Interview' || app.recruitment_state === 'Awaiting Interview Result').length;
    const oaCount = trackedApps.filter(app => app.recruitment_state === 'OA' || app.recruitment_state === 'Awaiting OA Result').length;
    
    let statsText = "";
    if (interviewCount > 0 && oaCount > 0) {
      statsText = `This week: ${interviewCount} interview${interviewCount > 1 ? 's' : ''} and ${oaCount} online assessment${oaCount > 1 ? 's' : ''}.`;
    } else if (interviewCount > 0) {
      statsText = `This week: ${interviewCount} interview${interviewCount > 1 ? 's' : ''}.`;
    } else if (oaCount > 0) {
      statsText = `This week: ${oaCount} online assessment${oaCount > 1 ? 's' : ''}.`;
    } else {
      statsText = `You are actively tracking ${trackedApps.length} application${trackedApps.length !== 1 ? 's' : ''}.`;
    }

    const focusApps = trackedApps.filter(app => app.workspace_priority_override === 'pinned');
    let focusText = "Select focus companies to prioritize your preparation.";
    if (focusApps.length > 0) {
      const compNames = focusApps.map(app => {
        const c = companies.find(comp => comp.id === app.company_id);
        return c ? c.name : "Company";
      });
      focusText = `Your focus: Prep for ${compNames.join(", ")}.`;
    } else if (trackedApps.length > 0) {
      const sortedTracked = [...trackedApps].sort((a, b) => b.priority_score - a.priority_score);
      const c = companies.find(comp => comp.id === sortedTracked[0].company_id);
      if (c) {
        focusText = `Suggested focus: Tailor resume and practice questions for ${c.name}.`;
      }
    }

    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    return `${greeting}, ${userName}. ${eventText} ${statsText} ${focusText}`;
  };



  // Compile timeline events list for the selected company drawer
  
  // Calculate Application Health Score checkmarks




  // Filter lists based on tab selection
  const filteredCompanies = React.useMemo(() => companies.filter((c) => {
    const oppState = opportunityStates[c.id];
    const effectiveState = oppState?.state;
    const app = applications[c.id];

    if (activeTab === "opportunities") {
      // Hide archived/auto_archived — the application's own user_decision
      // counts too: archiving from the tracking page sets it there, and a
      // drive must never show in Opportunities and Archived simultaneously.
      if (effectiveState === "archived" || effectiveState === "auto_archived"
          || app?.user_decision === "archived") return false;
      // Hide confirmed tracking workspaces (they live in Tracking tab)
      if (app && app.user_decision === "tracking") return false;
      // Hide decision_pending — deadline passed, card belongs in Action Center
      if (effectiveState === "decision_pending") return false;
      // Hide any company whose deadline has already passed, even before the scheduler runs
      if (c.registration_deadline && new Date(c.registration_deadline) < new Date()) return false;
    }

    if (activeTab === "applications") {
      if (!app) return false;
      const isArchived = app.user_decision === "archived" || effectiveState === "archived" || effectiveState === "auto_archived";
      const isRejected = app.status === "Rejected" || app.recruitment_state === "Rejected";
      const isOffer = app.status === "Offer" || app.recruitment_state === "Offer";
      if (!isArchived && !isRejected && !isOffer) return false;
    }

    if (filterCategory !== "ALL" && c.category !== filterCategory) return false;
    if (filterEligibility !== "ALL" && c.eligibility_status !== filterEligibility) return false;

    return true;
  }), [companies, opportunityStates, applications, activeTab, filterCategory, filterEligibility]);

  // Companies awaiting user decision (deadline expired, no app workspace yet)
  const decisionPendingCompanies = React.useMemo(() => companies.filter(c => {
    const oppState = opportunityStates[c.id];
    return oppState?.state === "decision_pending";
  }), [companies, opportunityStates]);

  // Active decision-pending (not snoozed) — shown in Action Center
  const activeDecisionPendingCompanies = React.useMemo(() => decisionPendingCompanies.filter(c => {
    const oppState = opportunityStates[c.id];
    if (!oppState?.snoozed_until) return true;
    return new Date(oppState.snoozed_until) <= new Date();
  }), [decisionPendingCompanies, opportunityStates]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Applied": return "bg-blue-600 text-white";
      case "Shortlisted": return "bg-amber-500 text-black";
      case "OA": return "bg-purple-600 text-white";
      case "Technical": return "bg-orange-500 text-black";
      case "HR": return "bg-teal-600 text-white";
      case "Offer": return "bg-emerald-600 text-white";
      case "Rejected": return "bg-red-600 text-white";
      case "Likely Rejected": return "bg-red-850 text-red-200 border border-red-500/50";
      default: return "bg-muted text-muted-foreground";
    }
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

  // Pre-calculate variables for Action Center and My Applications
  const todayEvents = React.useMemo(() => getTodayEvents(), [getTodayEvents]);
  const trackedApps = React.useMemo(() => Object.values(applications)
    .filter(app => app.user_decision === 'tracking' && !isSnoozed(app))
    .sort((a, b) => b.priority_score - a.priority_score), [applications]);

  // Batch selection state for Decision Required cards
  const [selectedDecisionIds, setSelectedDecisionIds] = useState<string[]>([]);

  const toggleDecisionSelect = (id: string) => {
    setSelectedDecisionIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Relative time helper for expired deadlines
  const getRelativeExpiry = (deadline: string | null): string => {
    if (!deadline) return 'Deadline unknown';
    const diff = Date.now() - new Date(deadline).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (hours < 1) return 'Registration just closed';
    if (hours < 24) return `Registration closed ${hours}h ago`;
    if (days === 1) return 'Registration closed yesterday';
    if (days < 7) return `Registration closed ${days} days ago`;
    const weeks = Math.floor(days / 7);
    return `Registration closed ${weeks} week${weeks > 1 ? 's' : ''} ago`;
  };

  // My Applications conversion stats
  const historyApps = React.useMemo(() => Object.values(applications), [applications]);
  const totalAppsCount = historyApps.length;
  const oaReachedCount = React.useMemo(() => historyApps.filter(app => ["OA", "Technical", "HR", "Offer"].includes(app.status) || app.recruitment_state.includes("OA") || app.recruitment_state.includes("Interview")).length, [historyApps]);
  const interviewReachedCount = React.useMemo(() => historyApps.filter(app => ["Technical", "HR", "Offer"].includes(app.status) || app.recruitment_state.includes("Interview")).length, [historyApps]);
  const offersCount = React.useMemo(() => historyApps.filter(app => app.status === "Offer" || app.recruitment_state === "Offer").length, [historyApps]);
  const conversionRate = React.useMemo(() => totalAppsCount > 0 ? ((offersCount / totalAppsCount) * 100).toFixed(1) : "0.0", [totalAppsCount, offersCount]);

  // Timeline and Workspace Drawer computed states

    
  return (
    <div className="flex-1 bg-background flex flex-col min-h-screen">
      
      {/* High-energy stats scrolling marquee */}
      <div className="border-b-2 border-border bg-accent py-3 overflow-hidden select-none">
        <div className="flex w-max animate-marquee">
          {Array(4).fill(0).map((_, i) => (
            <div key={i} className="flex items-center gap-16 text-black font-extrabold text-sm tracking-widest uppercase shrink-0 pr-16">
              <span>ACTIVE PLACEMENTS: {companies.length}</span>
              <span>✦</span>
              <span>TRACKED APPLICATIONS: {trackedApps.length}</span>
              <span>✦</span>
              <span>E2E DECRYPTION ACTIVE: {encryptionKey ? "YES" : "NO"}</span>
              <span>✦</span>
              <span>CDC SENDER SYNC: {user?.email || "CDC@VIT.AC.IN"}</span>
              <span>✦</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main Container */}
      <div className="p-8 md:p-12 space-y-12 flex-1">
        
        {/* Onboarding & Warning Banners */}
        {(!user?.neo_id_enc) && (
          <div className="border-2 border-accent bg-accent/10 p-6 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-accent text-black flex items-center justify-center border-2 border-black animate-pulse">
                <AlertCircle size={20} />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-wider text-accent">
                  ⚡ ONBOARDING: ACTION REQUIRED
                </p>
                <p className="text-xs text-muted-foreground uppercase tracking-tight leading-snug">
                  Please complete your Student Profile and set up your encryption vault to unlock eligibility calculations.
                </p>
              </div>
            </div>
            <Link 
              href="/profile" 
              className="border-2 border-accent bg-accent text-black text-xs font-bold tracking-widest px-6 py-3 hover:bg-transparent hover:text-accent transition-colors uppercase block"
            >
              GO TO PROFILE
            </Link>
          </div>
        )}

        {syncing && (
          <div className="border-2 border-accent bg-accent/10 p-6 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-accent text-black flex items-center justify-center border-2 border-black animate-pulse">
                <span className="h-2 w-2 rounded-full bg-black animate-ping" />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-wider text-accent">
                  ⚡ SYNCING WITH UNIVERSITY MAILBOX
                </p>
                <p className="text-xs text-muted-foreground uppercase tracking-tight leading-snug">
                  Polling placements emails securely. Updating your placement database on-the-fly...
                </p>
              </div>
            </div>
          </div>
        )}

        {!encryptionKey && (
          <div className="border-2 border-amber-500 bg-amber-500/10 p-6 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-amber-500 text-black flex items-center justify-center border-2 border-black">
                <Lock size={20} />
              </div>
              <div>
                <p className="text-sm font-bold uppercase tracking-wider text-amber-500">
                  VAULT IS CURRENTLY SEALED
                </p>
                <p className="text-xs text-muted-foreground uppercase tracking-tight leading-snug">
                  You can browse companies, but cannot view, edit, or check your student eligibility status.
                </p>
              </div>
            </div>
            <Link 
              href="/profile" 
              className="border-2 border-amber-500 bg-amber-500 text-black text-xs font-bold tracking-widest px-6 py-3 hover:bg-transparent hover:text-amber-500 transition-colors uppercase block"
            >
              UNLOCK VAULT
            </Link>
          </div>
        )}

        {/* ==================== 1. ACTION CENTER TAB ==================== */}
        {activeTab === "action-center" && loading && (
          <SkeletonDashboard />
        )}

        {/* ==================== 1. ACTION CENTER TAB ==================== */}
        {activeTab === "action-center" && !loading && (
          <div className="space-y-12">
            <div className="flex justify-between items-end border-b-2 border-border pb-6">
              <div className="space-y-1">
                <h1 className="text-[clamp(2rem,6vw,4rem)] font-extrabold tracking-tighter uppercase leading-none">
                  ACTION CENTER
                </h1>
                <p className="text-xs text-muted-foreground uppercase tracking-widest">
                  Your mission control hub: scannable task timelines and notification triage
                </p>
              </div>
              <button
                onClick={handleTriggerSync}
                disabled={syncing}
                className="flex items-center justify-center h-14 px-6 border-2 border-border bg-background font-extrabold tracking-wider hover:bg-muted transition-all active:scale-95 uppercase text-sm disabled:opacity-50"
              >
                <span>{syncing ? "SYNCING..." : "SYNC PLACEMENTS"}</span>
              </button>
            </div>

            {/* Smart Daily Digest Banner */}
            <div className="relative overflow-hidden border-2 border-border bg-gradient-to-r from-card to-card/50 p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
              <div className="absolute -right-24 -top-24 w-96 h-96 bg-accent/10 rounded-full blur-3xl pointer-events-none" />
              <div className="space-y-4 relative z-10 max-w-3xl">
                <div className="inline-block px-3 py-1 bg-accent/20 border border-accent text-accent text-[10px] font-black tracking-widest uppercase">
                  ⚡ SMART DAILY DIGEST
                </div>
                <h3 className="text-xl md:text-2xl font-bold tracking-tight text-foreground leading-snug">
                  {getDailyDigest()}
                </h3>
              </div>
            </div>

            {/* Urgent Announcement Deadline Alerts */}
            {announcements
              .filter(ann => {
                const deadline = ann.deadline;
                if (!deadline) return false;
                const dlTime = new Date(deadline).getTime();
                const now = Date.now();
                return dlTime > now && (dlTime - now) <= 24 * 60 * 60 * 1000;
              })
              .map(ann => {
                const deadline = ann.deadline;
                const dlTime = deadline ? new Date(deadline) : new Date();
                return (
                  <div key={ann.id} className="border-2 border-red-500 bg-red-500/10 p-6 flex flex-col md:flex-row items-center justify-between gap-6 animate-pulse">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 bg-red-500 text-black flex items-center justify-center border-2 border-black shrink-0">
                        <AlertTriangle size={20} />
                      </div>
                      <div>
                        <p className="text-sm font-black uppercase tracking-wider text-red-500">
                          🚨 URGENT ANNOUNCEMENT DEADLINE
                        </p>
                        <p className="text-xs text-muted-foreground uppercase tracking-tight leading-snug">
                          The deadline for &ldquo;{ann.title}&rdquo; is in less than 24 hours: {dlTime.toLocaleString("en-IN")}.
                        </p>
                      </div>
                    </div>
                    <Link 
                      href="/dashboard?tab=announcements"
                      className="border-2 border-red-500 bg-red-500 text-black text-xs font-bold tracking-widest px-6 py-3 hover:bg-transparent hover:text-red-500 transition-colors uppercase block whitespace-nowrap"
                    >
                      VIEW ANNOUNCEMENT
                    </Link>
                  </div>
                );
              })
            }

            {/* Today's Schedule Timeline — full width */}
            <div className="border-2 border-border p-6 bg-muted/10 space-y-4">
              <div className="border-b border-border pb-3 flex justify-between items-center">
                <h4 className="text-xs font-black tracking-widest uppercase text-muted-foreground">
                  📅 TODAY&apos;S SCHEDULE TIMELINE
                </h4>
                <span className="text-[10px] font-bold bg-muted px-2 py-0.5 border border-border">
                  {todayEvents.length} EVENT{todayEvents.length !== 1 ? 'S' : ''}
                </span>
              </div>
              <div className="overflow-y-auto max-h-[220px] space-y-4 pr-1">
                {todayEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-10 text-muted-foreground gap-1">
                    <span className="text-xs font-bold uppercase tracking-wider">NO EVENTS TODAY</span>
                    <span className="text-[10px] uppercase">All clear for the rest of the day.</span>
                  </div>
                ) : (
                  <div className="relative border-l-2 border-border ml-2 pl-4 space-y-6">
                    {todayEvents.map((evt, idx) => (
                      <div key={idx} className="relative">
                        <div className="absolute -left-[23px] top-1 h-3 w-3 bg-accent border-2 border-black" />
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold font-mono text-accent">
                            {evt.time.toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <h5 className="text-xs font-bold uppercase tracking-tight text-foreground">
                            {evt.title}
                          </h5>
                          <p className="text-[11px] text-muted-foreground leading-normal">
                            {evt.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ─── DECISION REQUIRED — Priority Section ─── */}
            {activeDecisionPendingCompanies.length > 0 && (
              <div className="border-2 border-amber-500/70 bg-amber-500/5 p-6 space-y-6">
                {/* Section header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-500/40 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 bg-amber-500 text-black flex items-center justify-center shrink-0 animate-pulse">
                      <AlertTriangle size={16} />
                    </div>
                    <div>
                      <h4 className="text-sm font-black tracking-widest uppercase text-amber-400">
                        DECISION REQUIRED
                        <span className="ml-2 bg-amber-500 text-black text-[10px] font-black px-1.5 py-0.5">
                          {activeDecisionPendingCompanies.length}
                        </span>
                      </h4>
                      <p className="text-[10px] text-amber-500/70 uppercase tracking-wide mt-0.5">
                        These registration windows have closed. Did you apply?
                      </p>
                    </div>
                  </div>
                  {/* Batch archive */}
                  {selectedDecisionIds.length > 0 && (
                    <button
                      onClick={() => {
                        setArchiveConfirm({
                          isOpen: true,
                          title: "Archive Selected",
                          message: `Are you sure you want to archive the ${selectedDecisionIds.length} selected opportunities?`,
                          onConfirm: async () => {
                            setArchiveConfirm(prev => ({ ...prev, isOpen: false }));
                            await Promise.all(selectedDecisionIds.map(id => handleOpportunityAction(id, 'archive', 'NOT_APPLIED')));
                            setSelectedDecisionIds([]);
                          }
                        });
                      }}
                      className="flex items-center gap-2 h-8 px-4 border border-red-500/50 bg-red-500/10 text-red-400 font-bold text-[10px] uppercase tracking-wider hover:bg-red-500 hover:text-white transition-all shrink-0"
                    >
                      <Archive size={12} />
                      Archive Selected ({selectedDecisionIds.length})
                    </button>
                  )}
                </div>

                {/* Cards grid — newest expired first */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {[...activeDecisionPendingCompanies]
                    .sort((a, b) => {
                      const dA = a.registration_deadline ? new Date(a.registration_deadline).getTime() : 0;
                      const dB = b.registration_deadline ? new Date(b.registration_deadline).getTime() : 0;
                      return dB - dA; // Most recently expired first
                    })
                    .map((comp) => {
                    const opp = opportunityStates[comp.id];
                    const isSelected = selectedDecisionIds.includes(comp.id);
                    return (
                      <div
                        key={comp.id}
                        className={`border-2 bg-background p-4 space-y-3 transition-all ${
                          isSelected ? 'border-amber-500 bg-amber-500/5' : 'border-amber-500/30 hover:border-amber-500/60'
                        }`}
                      >
                        {/* Card header: checkbox + company name */}
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleDecisionSelect(comp.id)}
                            className="mt-0.5 h-3.5 w-3.5 accent-amber-500 cursor-pointer shrink-0"
                            title="Select for batch archive"
                          />
                          <div className="flex-1 min-w-0">
                            <h5 className="font-extrabold text-sm uppercase tracking-tighter text-foreground truncate">{comp.name}</h5>
                            <p className="text-[10px] text-muted-foreground uppercase">{comp.role} ✦ {comp.category}</p>
                            <div className="mt-1.5 flex flex-col gap-0.5">
                              {getEligibilityIcon(comp.eligibility_status)}
                              {comp.eligibility_reason && (
                                <p className="text-[9px] text-muted-foreground uppercase leading-normal mt-0.5">{comp.eligibility_reason}</p>
                              )}
                            </div>
                          </div>
                          <span className="text-[8px] font-black bg-amber-950/60 border border-amber-500/50 text-amber-400 px-1.5 py-0.5 uppercase shrink-0">
                            PENDING
                          </span>
                        </div>

                        {/* Relative expiry time */}
                        <div className="text-[10px] text-amber-400/80 font-bold uppercase flex items-center gap-1.5">
                          <Clock size={10} />
                          {getRelativeExpiry(comp.registration_deadline)}
                        </div>

                        {/* Context clues: CTC/Stipend + link */}
                        <div className="grid grid-cols-2 gap-2 py-2 border-t border-b border-border/40">
                          <div>
                            <span className="text-[8px] text-muted-foreground uppercase block">Package</span>
                            <span className="text-[10px] font-bold text-foreground block">{comp.ctc || '—'}</span>
                            <span className="text-[8px] text-muted-foreground uppercase block mt-1">Stipend</span>
                            <span className="text-[10px] font-bold text-foreground">{comp.stipend || '—'}</span>
                          </div>
                          <div className="text-right">
                            {comp.registration_link ? (
                              <a
                                href={comp.registration_link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[9px] font-bold text-accent hover:underline flex items-center justify-end gap-1"
                              >
                                <ExternalLink size={9} /> Registration Portal
                              </a>
                            ) : (
                              <span className="text-[9px] text-muted-foreground">No link</span>
                            )}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleOpportunityAction(comp.id, 'track')}
                            className="flex-1 h-8 bg-accent text-black font-bold text-[9px] uppercase tracking-wider hover:bg-accent/80 transition-all border border-accent"
                          >
                            ✅ Yes, I Applied
                          </button>
                          <button
                            onClick={() => {
                              setArchiveConfirm({
                                isOpen: true,
                                title: "Archive Opportunity",
                                message: `Are you sure you want to archive ${comp.name}?`,
                                onConfirm: async () => {
                                  setArchiveConfirm(prev => ({ ...prev, isOpen: false }));
                                  await handleOpportunityAction(comp.id, 'archive', 'NOT_APPLIED');
                                }
                              });
                            }}
                            className="flex-1 h-8 bg-transparent text-muted-foreground font-bold text-[9px] uppercase tracking-wider hover:bg-muted border border-border transition-all"
                          >
                            ✗ No, Archive
                          </button>
                          <button
                            onClick={() => handleOpportunityAction(comp.id, 'snooze')}
                            className="h-8 px-3 bg-transparent text-muted-foreground font-bold text-[9px] uppercase tracking-wider hover:bg-muted border border-border transition-all"
                            title="Remind me again in 7 days"
                          >
                            ⏰
                          </button>
                        </div>

                        {/* Footer: Pending-since & Workspace Link */}
                        <div className="flex items-center justify-between mt-1 border-t border-border/40 pt-2">
                          <div>
                            {opp?.decision_pending_since ? (
                              <p className="text-[9px] text-muted-foreground/60 uppercase">
                                Pending since {new Date(opp.decision_pending_since).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                              </p>
                            ) : <span />}
                          </div>
                          <button onClick={() => { setSelectedCompany(comp); }} className="text-[9px] font-black tracking-widest text-accent uppercase hover:underline transition-all">
                            VIEW WORKSPACE &rarr;
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Overflow indicator when there are many pending */}
                {activeDecisionPendingCompanies.length > 6 && (
                  <p className="text-[10px] text-amber-500/60 font-bold uppercase text-center">
                    Showing all {activeDecisionPendingCompanies.length} pending decisions — resolve them to keep this section clear.
                  </p>
                )}
              </div>
            )}

            {/* Empty state: no decisions pending and no events */}
            {activeDecisionPendingCompanies.length === 0 && todayEvents.length === 0 && (
              <div className="text-center py-12 border-2 border-dashed border-border text-muted-foreground font-bold uppercase tracking-wider text-xs">
                No pending decisions. You are all caught up.
              </div>
            )}
          </div>
        )}

        {/* ==================== 1b. ANNOUNCEMENTS CENTER TAB (stub kept for URL compat) ==================== */}
        {activeTab === "announcements" && (
          <div className="flex flex-col items-center justify-center text-center py-32 border-2 border-dashed border-border bg-muted/10 gap-3">
            <Megaphone size={32} className="text-muted-foreground/40" />
            <p className="text-sm font-black uppercase tracking-wider text-muted-foreground">ANNOUNCEMENTS MOVED</p>
            <p className="text-[10px] text-muted-foreground/80 uppercase max-w-xs">
              General notices from CDC now appear as urgent banners in the Action Center when they require your attention.
            </p>
            <a href="/dashboard" className="mt-4 border-2 border-border bg-foreground text-background text-xs font-bold tracking-widest px-6 py-3 hover:bg-accent hover:text-black hover:border-accent transition-colors uppercase">
              Go to Action Center
            </a>
          </div>
        )}


        {/* ==================== 2. OPPORTUNITIES TAB ==================== */}
        {activeTab === "opportunities" && (
          <div className="space-y-12">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b-2 border-border pb-8">
              <div className="space-y-2">
                <h1 className="text-[clamp(2rem,6vw,4rem)] font-extrabold tracking-tighter uppercase leading-none">
                  OPPORTUNITIES
                </h1>
                <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
                  Explore university placement drives, check eligibility status, and begin tracking workspaces
                </p>
              </div>
              
              <div className="flex flex-wrap gap-4">
                <button
                  onClick={() => router.push('/dashboard?tab=archived')}
                  className="flex items-center justify-center gap-2 h-14 px-6 border-2 border-border bg-background hover:bg-muted font-extrabold tracking-wider transition-all active:scale-95 uppercase text-sm text-muted-foreground hover:text-foreground"
                >
                  <Archive size={16} />
                  <span>VIEW ARCHIVED DRIVES</span>
                </button>
                <button
                  onClick={handleTriggerSync}
                  disabled={syncing}
                  className="flex items-center justify-center gap-2 h-14 px-6 border-2 border-border bg-background font-extrabold tracking-wider hover:bg-muted transition-all active:scale-95 uppercase text-sm disabled:opacity-50"
                >
                  <span>{syncing ? "SYNCING..." : "SYNC PLACEMENTS"}</span>
                </button>
                <button 
                  onClick={() => setShowAddCompany(!showAddCompany)}
                  className="flex items-center justify-center gap-2 h-14 px-6 border-2 border-border bg-foreground text-background font-extrabold tracking-wider hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95 uppercase text-sm"
                >
                  <Plus size={16} />
                  <span>MANUAL DRIVE ANNOUNCEMENT</span>
                </button>
              </div>
            </div>

            {/* Manual Drive Creation Form block */}
            {showAddCompany && (
              <div className="border-2 border-border p-8 bg-muted/10 space-y-6">
                <h2 className="text-2xl font-bold tracking-tighter uppercase">
                  CREATE NEW DRIVE ANNOUNCEMENT
                </h2>

                {formError && (
                  <div className="border-2 border-red-650 bg-red-650/10 p-4 text-xs font-bold text-red-600 uppercase tracking-wider">
                    {formError}
                  </div>
                )}
                {formSuccess && (
                  <div className="border-2 border-green-600 bg-green-600/10 p-4 text-xs font-bold text-green-600 uppercase tracking-wider">
                    {formSuccess}
                  </div>
                )}

                <form onSubmit={handleAddCompany} className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground">COMPANY NAME</label>
                    <input
                      type="text"
                      required
                      value={compName}
                      onChange={(e) => setCompName(e.target.value)}
                      placeholder="NOKIA"
                      className="w-full h-12 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground">CATEGORY</label>
                    <select
                      value={compCategory}
                      onChange={(e) => setCompCategory(e.target.value)}
                      className="w-full h-12 border-2 border-border bg-background text-sm font-bold uppercase focus:border-accent focus:outline-none px-4 cursor-pointer"
                    >
                      <option value="Dream">DREAM OFFER</option>
                      <option value="Super Dream">SUPER DREAM OFFER</option>
                      <option value="Mass Recruiter">MASS RECRUITER</option>
                      <option value="Internship">INTERNSHIP</option>
                      <option value="Regular">REGULAR</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground">ROLE / PROFILE</label>
                    <input
                      type="text"
                      required
                      value={compRole}
                      onChange={(e) => setCompRole(e.target.value)}
                      placeholder="SOFTWARE ENGINEER"
                      className="w-full h-12 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground">CTC (LPA)</label>
                    <input
                      type="text"
                      value={compCtc}
                      onChange={(e) => setCompCtc(e.target.value)}
                      placeholder="12 LPA"
                      className="w-full h-12 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground">STIPEND (PER MONTH)</label>
                    <input
                      type="text"
                      value={compStipend}
                      onChange={(e) => setCompStipend(e.target.value)}
                      placeholder="40,000 PM"
                      className="w-full h-12 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground">LOCATION</label>
                    <input
                      type="text"
                      value={compLocation}
                      onChange={(e) => setCompLocation(e.target.value)}
                      placeholder="BENGALURU"
                      className="w-full h-12 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground">ELIGIBLE BRANCHES (COMMA SEPARATED)</label>
                    <input
                      type="text"
                      value={compBranches}
                      onChange={(e) => setCompBranches(e.target.value)}
                      placeholder="CSE, IT, ECE"
                      className="w-full h-12 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground">MINIMUM CGPA REQUIRED</label>
                    <input
                      type="number"
                      step="0.1"
                      value={compMinCgpa}
                      onChange={(e) => setCompMinCgpa(e.target.value)}
                      placeholder="7.0"
                      className="w-full h-12 border-2 border-border bg-transparent text-sm font-bold focus:border-accent focus:outline-none px-4"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground">DEADLINE</label>
                    <input
                      type="datetime-local"
                      value={compDeadline}
                      onChange={(e) => setCompDeadline(e.target.value)}
                      className="w-full h-12 border-2 border-border bg-background text-sm font-bold focus:border-accent focus:outline-none px-4 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground">REGISTRATION URL</label>
                    <input
                      type="url"
                      value={compRegLink}
                      onChange={(e) => setCompRegLink(e.target.value)}
                      placeholder="HTTPS://VTHOP.VIT.AC.IN/CDC"
                      className="w-full h-12 border-2 border-border bg-transparent text-sm font-bold focus:border-accent focus:outline-none px-4"
                    />
                  </div>

                  <div className="md:col-span-3 flex items-center gap-4 h-12 border-2 border-border px-4 bg-muted/20">
                    <input
                      type="checkbox"
                      id="compArrears"
                      checked={compRequiresNoArrears}
                      onChange={(e) => setCompRequiresNoArrears(e.target.checked)}
                      className="h-5 w-5 rounded-none border-2 border-border text-accent focus:ring-0 bg-transparent cursor-pointer"
                    />
                    <label htmlFor="compArrears" className="text-xs font-bold uppercase tracking-wider cursor-pointer">
                      Requires &apos;No Standing Arrears&apos;
                    </label>
                  </div>

                  <div className="md:col-span-3 space-y-2">
                    <label className="text-xs font-bold tracking-widest uppercase text-muted-foreground block">JOB DESCRIPTION (JD) TEXT</label>
                    <textarea
                      value={compJd}
                      onChange={(e) => setCompJd(e.target.value)}
                      placeholder="PASTE ANNOUNCEMENT JD TEXT HERE..."
                      rows={4}
                      className="w-full border-2 border-border bg-transparent text-sm font-bold p-4 focus:border-accent focus:outline-none"
                    />
                  </div>

                  <div className="md:col-span-3 flex gap-4">
                    <button
                      type="submit"
                      className="h-14 px-8 border-2 border-border bg-foreground text-background font-extrabold tracking-widest hover:bg-accent hover:text-black hover:border-accent transition-all uppercase"
                    >
                      SAVE DRIVE
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddCompany(false)}
                      className="h-14 px-8 border-2 border-border bg-transparent text-foreground font-extrabold tracking-widest hover:bg-muted transition-all uppercase"
                    >
                      CANCEL
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Filters panel */}
            <div className="flex flex-col lg:flex-row gap-6 border-b border-border pb-6 justify-between items-stretch">
              <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center">
                {/* Category Filter */}
                <div className="flex items-center border-2 border-border bg-background px-4 h-12">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase mr-3">CATEGORY</span>
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    className="bg-background text-xs font-bold uppercase outline-none cursor-pointer text-foreground"
                  >
                    <option value="ALL">ALL OFFERS</option>
                    <option value="Dream">DREAM</option>
                    <option value="Super Dream">SUPER DREAM</option>
                    <option value="Mass Recruiter">MASS RECRUITER</option>
                    <option value="Internship">INTERNSHIP</option>
                  </select>
                </div>

                {/* Eligibility Filter */}
                <div className="flex items-center border-2 border-border bg-background px-4 h-12">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase mr-3">ELIGIBILITY</span>
                  <select
                    value={filterEligibility}
                    onChange={(e) => setFilterEligibility(e.target.value)}
                    className="bg-background text-xs font-bold uppercase outline-none cursor-pointer text-foreground"
                  >
                    <option value="ALL">ALL STATUSES</option>
                    <option value="ELIGIBLE">ELIGIBLE</option>
                    <option value="NOT_ELIGIBLE">INELIGIBLE</option>
                    <option value="UNKNOWN">VERIFY MANUALLY</option>
                    <option value="CONDITIONALLY_ELIGIBLE">CONDITIONALLY</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Opportunities Table View */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 py-4">
                  {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="p-6 border border-border bg-card space-y-4">
                      <div className="flex justify-between items-start">
                        <div className="w-1/2 h-6 bg-muted animate-pulse rounded"></div>
                        <div className="w-16 h-6 bg-muted animate-pulse rounded-full"></div>
                      </div>
                      <div className="space-y-2">
                        <div className="h-4 bg-muted animate-pulse rounded w-full"></div>
                        <div className="h-4 bg-muted animate-pulse rounded w-5/6"></div>
                      </div>
                      <div className="flex space-x-2 pt-4">
                        <div className="w-20 h-8 bg-muted animate-pulse rounded"></div>
                        <div className="w-20 h-8 bg-muted animate-pulse rounded"></div>
                      </div>
                    </div>
                  ))}
                </div>
            ) : filteredCompanies.length === 0 ? (
              <div className="text-center py-20 border-2 border-dashed border-border font-bold uppercase tracking-wider text-muted-foreground">
                No active placement drives match the current filter criteria.
              </div>
            ) : (
              <div className="border-2 border-border overflow-hidden relative">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b-2 border-border bg-muted/30 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
                        <th className="py-4 px-6 w-12">
                          <input
                            type="checkbox"
                            checked={filteredCompanies.length > 0 && selectedCompanyIds.length === filteredCompanies.length}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedCompanyIds(filteredCompanies.map(c => c.id));
                              } else {
                                setSelectedCompanyIds([]);
                              }
                            }}
                            className="h-4.5 w-4.5 rounded-none border-2 border-border text-accent focus:ring-0 bg-transparent cursor-pointer"
                          />
                        </th>
                        <th className="py-4 px-6">COMPANY / ROLE</th>
                        <th className="py-4 px-6">CATEGORY</th>
                        <th className="py-4 px-6">CTC / STIPEND</th>
                        <th className="py-4 px-6">DEADLINE</th>
                        <th className="py-4 px-6">ELIGIBILITY</th>
                        <th className="py-4 px-6 text-right">ACTION</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredCompanies.map((c) => {
                        const oppState = opportunityStates[c.id];
                        const effectiveState = oppState?.state;
                        const deadlineDate = c.registration_deadline ? new Date(c.registration_deadline) : null;
                        const isRowChecked = selectedCompanyIds.includes(c.id);
                        const isArchived = effectiveState === 'archived' || effectiveState === 'auto_archived';
                        
                        return (
                          <tr key={c.id} className={`hover:bg-muted/15 transition-colors ${isRowChecked ? 'bg-accent/5' : ''} ${isArchived ? 'opacity-60' : ''}`} onMouseEnter={() => prefetchCompanyDetails(c.id)}>
                            <td className="py-5 px-6">
                              <input
                                type="checkbox"
                                checked={isRowChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedCompanyIds(prev => [...prev, c.id]);
                                  } else {
                                    setSelectedCompanyIds(prev => prev.filter(id => id !== c.id));
                                  }
                                }}
                                className="h-4.5 w-4.5 rounded-none border-2 border-border text-accent focus:ring-0 bg-transparent cursor-pointer"
                              />
                            </td>

                            <td 
                              className="py-5 px-6 cursor-pointer group"
                              onClick={() => { setSelectedCompany(c); }}
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-bold text-base uppercase tracking-tighter text-foreground group-hover:text-accent transition-colors">{c.name}</p>
                                {c.latest_event && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black bg-amber-500/20 text-amber-500 border border-amber-500/30 animate-pulse tracking-wider">
                                    {["REGISTRATION", "NEW_DRIVE"].includes(c.latest_event.event_type)
                                      ? "✨ NEW"
                                      : `⚡ ${c.latest_event.event_type.replace(/_/g, ' ')}`}
                                  </span>
                                )}
                                {c.jd_required_skills && c.jd_required_skills.length > 0 && (
                                  <div className="relative group/tooltip inline-block">
                                    <span className="text-[10px] text-accent cursor-help">💡</span>
                                    <div className="absolute left-0 bottom-full mb-1 hidden group-hover/tooltip:block bg-background border border-border p-2.5 shadow-xl z-20 text-[9px] uppercase min-w-[220px] leading-normal font-bold">
                                      Matches your skills: {c.jd_required_skills.slice(0, 3).join(", ")}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground uppercase">{c.role} {c.job_location ? `✦ ${c.job_location}` : ""}</p>
                            </td>

                            <td className="py-5 px-6">
                              <span className="text-[10px] font-extrabold tracking-widest uppercase px-2 py-1 bg-muted border border-border">
                                {c.category}
                              </span>
                            </td>

                            <td className="py-5 px-6">
                              <p className="text-sm font-bold uppercase tracking-tight">{c.ctc || "—"}</p>
                              <p className="text-[10px] text-muted-foreground uppercase">{c.stipend ? `Stipend: ${c.stipend}` : "No stipend listed"}</p>
                            </td>

                            <td className="py-5 px-6">
                              {deadlineDate ? (
                                <>
                                  <p className="text-[9px] text-muted-foreground uppercase mb-0.5 tracking-widest">{c.deadline_label || "REG. DEADLINE"}</p>
                                  <p className="text-xs font-bold uppercase">{deadlineDate.toLocaleDateString("en-IN", { day: '2-digit', month: 'short' })}</p>
                                  <p className="text-[10px] text-muted-foreground">{deadlineDate.toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' })}</p>
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>

                            <td className="py-5 px-6 relative group/elig">
                              <div className="flex flex-col gap-1 cursor-help">
                                {getEligibilityIcon(c.eligibility_status)}
                                {c.eligibility_reason && (
                                  <p className="text-[10px] text-muted-foreground max-w-xs mt-1 leading-normal uppercase">
                                    {c.eligibility_reason}
                                  </p>
                                )}
                              </div>
                              
                              <div className="absolute right-full top-0 mr-4 hidden group-hover/elig:block bg-zinc-950 border-2 border-black p-4 shadow-[4px_4px_0px_0px_#000] z-50 text-[10px] min-w-[300px] max-w-md uppercase leading-relaxed font-bold rounded-none">
                                {c.eligibility_explanation ? (
                                  <div className="space-y-3">
                                    {c.eligibility_explanation.failed && c.eligibility_explanation.failed.length > 0 && (
                                      <div className="space-y-1">
                                        <p className="text-red-500 font-extrabold tracking-wider border-b border-red-500/20 pb-0.5">⚠️ FAILED CRITERIA</p>
                                        <ul className="list-disc list-inside text-red-400/90 font-mono text-[9px] space-y-0.5 normal-case">
                                          {c.eligibility_explanation.failed.map((rule, idx) => (
                                            <li key={idx} className="whitespace-normal">{rule}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {c.eligibility_explanation.matched && c.eligibility_explanation.matched.length > 0 && (
                                      <div className="space-y-1">
                                        <p className="text-emerald-500 font-extrabold tracking-wider border-b border-emerald-500/20 pb-0.5">✓ MATCHED CRITERIA</p>
                                        <ul className="list-disc list-inside text-emerald-400/90 font-mono text-[9px] space-y-0.5 normal-case">
                                          {c.eligibility_explanation.matched.map((rule, idx) => (
                                            <li key={idx} className="whitespace-normal">{rule}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {c.eligibility_raw_text && (
                                      <div className="space-y-1">
                                        <p className="text-muted-foreground font-extrabold tracking-wider border-b border-zinc-850 pb-0.5">SOURCE TEXT</p>
                                        <pre className="text-[9px] font-mono text-zinc-300 normal-case bg-zinc-900 p-2 border border-zinc-800 max-h-32 overflow-y-auto whitespace-pre-wrap leading-normal font-normal">
                                          {c.eligibility_raw_text}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <p className="text-muted-foreground">No detailed rules parsed for this company.</p>
                                    {c.eligibility_raw_text && (
                                      <div className="space-y-1">
                                        <p className="text-muted-foreground font-extrabold tracking-wider border-b border-zinc-850 pb-0.5">SOURCE TEXT</p>
                                        <pre className="text-[9px] font-mono text-zinc-300 normal-case bg-zinc-900 p-2 border border-zinc-800 max-h-32 overflow-y-auto whitespace-pre-wrap leading-normal font-normal">
                                          {c.eligibility_raw_text}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>

                            <td className="py-5 px-6 text-right">
                              <div className="flex justify-end gap-3 items-center">
                                {isArchived ? (
                                  // Archived drives: show Restore button
                                  <button
                                    onClick={() => handleOpportunityAction(c.id, 'restore')}
                                    className="h-10 px-4 border-2 border-amber-500/60 bg-amber-500/10 text-amber-400 text-xs font-bold tracking-wider uppercase hover:bg-amber-500/20 transition-all"
                                  >
                                    ↩ RESTORE
                                  </button>
                                ) : (
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleOpportunityAction(c.id, 'track')}
                                      className="h-10 px-3 border-2 border-accent bg-accent text-black text-xs font-bold tracking-wider uppercase hover:bg-accent/80 transition-all"
                                    >
                                      ✅ Apply
                                    </button>
                                    <button
                                      onClick={() => {
                                        setArchiveConfirm({
                                          isOpen: true,
                                          title: "Archive Opportunity",
                                          message: `Are you sure you want to archive ${c.name}?`,
                                          onConfirm: async () => {
                                            setArchiveConfirm(prev => ({ ...prev, isOpen: false }));
                                            await handleOpportunityAction(c.id, 'archive', 'MANUAL_NOT_INTERESTED');
                                          }
                                        });
                                      }}
                                      className="h-10 px-3 border-2 border-border bg-background text-xs font-bold tracking-wider uppercase hover:bg-muted transition-all"
                                    >
                                      ✗ Archive
                                    </button>
                                  </div>
                                )}

                                {c.registration_link && (
                                  <a
                                    href={c.registration_link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex h-10 w-10 items-center justify-center border-2 border-border bg-background text-foreground hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95"
                                    title="Open Registration Link"
                                  >
                                    <ExternalLink size={14} />
                                  </a>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== 2.5 ARCHIVED TAB ==================== */}
        {activeTab === "archived" && (
          <div className="space-y-12 animate-in fade-in duration-300">
            <div className="flex justify-between items-end border-b-2 border-border pb-6">
              <div className="space-y-1">
                <h1 className="text-[clamp(2rem,6vw,4rem)] font-extrabold tracking-tighter uppercase leading-none">
                  ARCHIVED PLACEMENTS
                </h1>
                <p className="text-xs text-muted-foreground uppercase tracking-widest">
                  View and manage placement drives you have skipped, declined, or not been shortlisted for
                </p>
              </div>
              <button
                onClick={() => router.push('/dashboard?tab=opportunities')}
                className="flex items-center justify-center h-14 px-6 border-2 border-border bg-background font-extrabold tracking-wider hover:bg-muted transition-all active:scale-95 uppercase text-sm"
              >
                <span>BACK TO ACTIVE DRIVES</span>
              </button>
            </div>

            {loading ? (
              <div className="text-center py-20 font-bold uppercase tracking-wider text-muted-foreground">
                Loading archive database...
              </div>
            ) : (() => {
              const archivedDrives = companies.filter(c => {
                const opp = opportunityStates[c.id];
                const app = applications[c.id];
                return opp?.state === "archived" || opp?.state === "auto_archived" || app?.user_decision === "archived";
              });

              if (archivedDrives.length === 0) {
                return (
                  <div className="text-center py-20 border-2 border-dashed border-border font-bold uppercase tracking-wider text-muted-foreground">
                    No archived placement drives found.
                  </div>
                );
              }

              return (
                <div className="border-2 border-border overflow-hidden relative bg-card shadow-2xl">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b-2 border-border bg-muted/30 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
                          <th className="py-4 px-6">COMPANY / ROLE</th>
                          <th className="py-4 px-6">CATEGORY</th>
                          <th className="py-4 px-6">CTC / STIPEND</th>
                          <th className="py-4 px-6">ARCHIVED DATE</th>
                          <th className="py-4 px-6">ARCHIVE REASON</th>
                          <th className="py-4 px-6 text-right">ACTION</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {archivedDrives.map((c) => {
                          const opp = opportunityStates[c.id];
                          const archiveDateStr = opp?.archived_at
                            ? new Date(opp.archived_at).toLocaleString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })
                            : 'N/A';
                          
                          // Normalize reason for visual rendering
                          const rawReason = opp?.archive_reason || "MANUAL_NOT_INTERESTED";
                          let reasonText = "MANUAL ARCHIVE";
                          let reasonColor = "border-zinc-500/30 text-zinc-400 bg-zinc-500/5";
                          if (rawReason === "NOT_SHORTLISTED") {
                            reasonText = "NOT SHORTLISTED";
                            reasonColor = "border-red-500/30 text-red-400 bg-red-500/5";
                          } else if (rawReason === "DEADLINE_EXPIRED" || rawReason === "AUTO_ARCHIVED") {
                            reasonText = "EXPIRED DRIVE";
                            reasonColor = "border-amber-500/30 text-amber-400 bg-amber-500/5";
                          }

                          return (
                            <tr key={c.id} className="hover:bg-muted/15 transition-colors">
                              <td className="py-5 px-6 font-bold uppercase text-sm">
                                <div>{c.name}</div>
                                <div className="text-[10px] text-muted-foreground font-normal tracking-tight mt-0.5">{c.role}</div>
                              </td>
                              <td className="py-5 px-6">
                                <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 bg-muted border border-border text-foreground">
                                  {c.category}
                                </span>
                              </td>
                              <td className="py-5 px-6 text-xs text-foreground/80">
                                <div><span className="text-[9px] text-muted-foreground uppercase">CTC:</span> <span className="font-mono font-bold">{c.ctc || "—"}</span></div>
                                <div className="mt-1"><span className="text-[9px] text-muted-foreground uppercase">Stipend:</span> <span className="font-mono font-bold">{c.stipend || "—"}</span></div>
                              </td>
                              <td className="py-5 px-6 text-xs text-muted-foreground">
                                {archiveDateStr}
                              </td>
                              <td className="py-5 px-6">
                                <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 border ${reasonColor}`}>
                                  {reasonText}
                                </span>
                              </td>
                              <td className="py-5 px-6 text-right">
                                <button
                                  onClick={() => handleOpportunityAction(c.id, 'restore')}
                                  className="h-10 px-4 border-2 border-accent text-accent font-extrabold text-xs tracking-wider uppercase hover:bg-accent hover:text-black transition-all active:scale-95"
                                >
                                  RESTORE DRIVE
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ==================== 4. MY APPLICATIONS TAB ==================== */}
        {activeTab === "applications" && (
          <div className="space-y-12">
            <div className="border-b-2 border-border pb-6">
              <h1 className="text-[clamp(2rem,6vw,4rem)] font-extrabold tracking-tighter uppercase leading-none">
                MY APPLICATIONS
              </h1>
              <p className="text-xs text-muted-foreground uppercase tracking-widest">
                Analytics outcomes journal and historical placements results
              </p>
            </div>

            {/* Layout Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Left Column: Metrics & Table */}
              <div className="lg:col-span-8 space-y-8">
                {/* Outcome Analytics Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
                  <div className="border-2 border-border p-6 bg-card flex flex-col justify-between h-32">
                    <span className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">TOTAL APPLICATIONS</span>
                    <span className="text-4xl font-extrabold tracking-tighter text-foreground">{totalAppsCount}</span>
                  </div>
                  <div className="border-2 border-border p-6 bg-card flex flex-col justify-between h-32">
                    <span className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">ASSESSMENTS REACHED</span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-extrabold tracking-tighter text-foreground">{oaReachedCount}</span>
                      <span className="text-xs text-muted-foreground font-mono">({totalAppsCount > 0 ? ((oaReachedCount / totalAppsCount) * 100).toFixed(0) : 0}%)</span>
                    </div>
                  </div>
                  <div className="border-2 border-border p-6 bg-card flex flex-col justify-between h-32">
                    <span className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">INTERVIEWS REACHED</span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-extrabold tracking-tighter text-foreground">{interviewReachedCount}</span>
                      <span className="text-xs text-muted-foreground font-mono">({totalAppsCount > 0 ? ((interviewReachedCount / totalAppsCount) * 100).toFixed(0) : 0}%)</span>
                    </div>
                  </div>
                  <div className="border-2 border-border p-6 bg-card flex flex-col justify-between h-32">
                    <span className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">OFFERS RECEIVED</span>
                    <span className="text-4xl font-extrabold tracking-tighter text-accent flex items-center gap-2">
                      <Award size={28} className="text-accent" />
                      {offersCount}
                    </span>
                  </div>
                  <div className="border-2 border-border p-6 bg-card flex flex-col justify-between h-32 bg-gradient-to-br from-accent/5 to-transparent border-accent/30">
                    <span className="text-[10px] font-black tracking-widest text-accent uppercase flex items-center gap-1">
                      <TrendingUp size={12} />
                      OFFER CONVERSION
                    </span>
                    <span className="text-4xl font-black tracking-tighter text-accent">{conversionRate}%</span>
                  </div>
                </div>

                {/* List of Applications History */}
                <div className="space-y-6">
                  <h3 className="text-xl font-bold tracking-tight uppercase">HISTORICAL PLACEMENTS RECORD</h3>
                  
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="p-4">
                        <div className="space-y-3">
                          {[1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="flex space-x-4">
                              <div className="h-8 bg-muted animate-pulse rounded flex-1"></div>
                              <div className="h-8 bg-muted animate-pulse rounded flex-1"></div>
                              <div className="h-8 bg-muted animate-pulse rounded flex-1"></div>
                              <div className="h-8 bg-muted animate-pulse rounded flex-1"></div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ) : filteredCompanies.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-border text-muted-foreground uppercase font-bold text-xs">
                      No historical applications recorded yet. Past rejections or offers will list here automatically.
                    </div>
                  ) : (
                    <div className="border-2 border-border overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b-2 border-border bg-muted/30 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
                              <th className="py-4 px-6">COMPANY / ROLE</th>
                              <th className="py-4 px-6">CATEGORY</th>
                              <th className="py-4 px-6">CTC / STIPEND</th>
                              <th className="py-4 px-6">FINAL STATUS</th>
                              <th className="py-4 px-6">DECISION STATE</th>
                              <th className="py-4 px-6 text-right">ACTION</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {filteredCompanies.map((c) => {
                              const app = applications[c.id];
                              if (!app) return null;
                              
                              return (
                                <tr key={c.id} className="hover:bg-muted/15 transition-colors" onMouseEnter={() => prefetchCompanyDetails(c.id)}>
                                  <td className="py-4 px-6 cursor-pointer" onClick={() => { setSelectedCompany(c); }}>
                                    <p className="font-bold text-sm uppercase tracking-tight text-foreground">{c.name}</p>
                                    <p className="text-[10px] text-muted-foreground uppercase">{c.role} ✦ {c.job_location || "Unknown"}</p>
                                  </td>

                                  <td className="py-4 px-6">
                                    <span className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 bg-muted border border-border">
                                      {c.category}
                                    </span>
                                  </td>

                                  <td className="py-4 px-6">
                                    <span className="text-xs font-bold font-mono">{c.ctc || "—"}</span>
                                  </td>

                                  <td className="py-4 px-6">
                                    <span className={`inline-block text-[9px] font-black uppercase tracking-wider px-2 py-0.5 ${getStatusColor(app.status)}`}>
                                      {app.status}
                                    </span>
                                  </td>

                                  <td className="py-4 px-6">
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase">
                                      {app.user_decision.toUpperCase()}
                                    </span>
                                  </td>

                                  <td className="py-4 px-6 text-right">
                                    <button
                                      onClick={() => handleUpdateApplication(c.id, { user_decision: 'tracking' })}
                                      className="h-8 px-3 border border-border bg-background text-foreground hover:bg-accent hover:text-black hover:border-accent font-bold text-[9px] uppercase tracking-wider transition-colors"
                                    >
                                      Re-Track Workspace
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Funnel Widget */}
              <div className="lg:col-span-4 border-2 border-border p-6 bg-muted/10 space-y-4">
                <h4 className="text-xs font-black tracking-widest uppercase text-muted-foreground">
                  📊 APPLICATION CONVERSION FUNNEL
                </h4>
                
                <div className="space-y-6 pt-2">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] font-black uppercase">
                      <span>APPLICATIONS SUBMITTED</span>
                      <span>{totalAppsCount} (100%)</span>
                    </div>
                    <div className="h-3.5 w-full bg-muted border border-border">
                      <div className="h-full bg-blue-600" style={{ width: "100%" }} />
                    </div>
                  </div>
                  
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] font-black uppercase">
                      <span>ASSESSMENTS REACHED</span>
                      <span>{oaReachedCount} ({totalAppsCount > 0 ? ((oaReachedCount / totalAppsCount) * 100).toFixed(0) : 0}%)</span>
                    </div>
                    <div className="h-3.5 w-full bg-muted border border-border">
                      <div 
                        className="h-full transition-all duration-500" 
                        style={{ width: `${totalAppsCount > 0 ? (oaReachedCount / totalAppsCount) * 100 : 0}%`, backgroundColor: '#8b5cf6' }} 
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] font-black uppercase">
                      <span>INTERVIEWS REACHED</span>
                      <span>{interviewReachedCount} ({totalAppsCount > 0 ? ((interviewReachedCount / totalAppsCount) * 100).toFixed(0) : 0}%)</span>
                    </div>
                    <div className="h-3.5 w-full bg-muted border border-border">
                      <div 
                        className="h-full transition-all duration-500" 
                        style={{ width: `${totalAppsCount > 0 ? (interviewReachedCount / totalAppsCount) * 100 : 0}%`, backgroundColor: '#f97316' }} 
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] font-black uppercase">
                      <span>OFFERS RECEIVED</span>
                      <span className="text-accent">{offersCount} ({totalAppsCount > 0 ? ((offersCount / totalAppsCount) * 100).toFixed(0) : 0}%)</span>
                    </div>
                    <div className="h-3.5 w-full bg-muted border border-border">
                      <div 
                        className="h-full bg-accent transition-all duration-500" 
                        style={{ width: `${totalAppsCount > 0 ? (offersCount / totalAppsCount) * 100 : 0}%` }} 
                      />
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

      </div>

      {/* Floating Bulk Action Bar */}
      {selectedCompanyIds.length > 0 && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-40 bg-card border-2 border-accent px-6 py-4 flex items-center gap-6 shadow-2xl animate-in slide-in-from-bottom-8 duration-300">
          <span className="text-xs font-black text-accent uppercase tracking-wider">
            ⚡ {selectedCompanyIds.length} SELECTED
          </span>
          
          <div className="h-6 w-px bg-border" />
          
          <div className="flex gap-3">
            <button
              onClick={() => handleBulkAction("tracking")}
              className="h-9 px-4 border border-border bg-foreground text-background font-bold text-xs hover:bg-accent hover:text-black hover:border-accent uppercase tracking-wider transition-all"
            >
              ✅ Apply
            </button>
            <button
              onClick={() => {
                setArchiveConfirm({
                  isOpen: true,
                  title: "Archive Selected",
                  message: `Are you sure you want to archive the ${selectedCompanyIds.length} selected opportunities?`,
                  onConfirm: async () => {
                    setArchiveConfirm(prev => ({ ...prev, isOpen: false }));
                    await handleBulkAction("archived");
                  }
                });
              }}
              className="h-9 px-4 border border-border bg-transparent text-muted-foreground font-bold text-xs hover:bg-red-950 hover:text-red-400 hover:border-red-500 uppercase tracking-wider transition-all"
            >
              👁️ Archive
            </button>
            
            <button
              disabled={selectedCompanyIds.length < 2 || selectedCompanyIds.length > 3}
              onClick={() => setShowComparison(true)}
              className="h-9 px-4 border-2 border-accent bg-accent text-black font-black text-xs hover:bg-black hover:text-accent hover:border-black uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="Compare 2 or 3 selected drives side-by-side"
            >
              📊 Compare Side-by-Side
            </button>
          </div>
          
          <button
            onClick={() => setSelectedCompanyIds([])}
            className="text-muted-foreground hover:text-foreground p-1"
            title="Clear selection"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Side-by-Side Comparison Modal */}
      {showComparison && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="relative w-full max-w-5xl border-2 border-border bg-background p-6 md:p-8 space-y-8 animate-in slide-in-from-bottom-4 duration-300 rounded-none">
            
            {/* Header */}
            <div className="flex justify-between items-center border-b-2 border-border pb-4">
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tight">OPPORTUNITY SIDE-BY-SIDE COMPARISON</h2>
                <p className="text-xs text-muted-foreground uppercase">Comparing CTC, Location, Eligibility and fit metrics</p>
              </div>
              <button
                onClick={() => setShowComparison(false)}
                className="border border-border p-2 bg-card hover:bg-accent hover:text-black hover:border-accent transition-all"
              >
                <X size={16} />
              </button>
            </div>

            {/* Comparison Grid */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse border-2 border-border">
                <thead>
                  <tr className="border-b-2 border-border bg-muted/40 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
                    <th className="py-4 px-6 border-r border-border">SPECIFICATIONS</th>
                    {selectedCompanyIds.slice(0, 3).map(id => {
                      const comp = companies.find(c => c.id === id);
                      return (
                        <th key={id} className="py-4 px-6 border-r border-border text-foreground font-black text-sm">
                          {comp?.name.toUpperCase()}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-medium text-xs text-foreground uppercase">
                  <tr className="hover:bg-muted/10">
                    <td className="py-4 px-6 border-r border-border font-black text-muted-foreground">ROLE</td>
                    {selectedCompanyIds.slice(0, 3).map(id => {
                      const comp = companies.find(c => c.id === id);
                      return <td key={id} className="py-4 px-6 border-r border-border">{comp?.role || "—"}</td>;
                    })}
                  </tr>
                  <tr className="hover:bg-muted/10">
                    <td className="py-4 px-6 border-r border-border font-black text-muted-foreground">CATEGORY</td>
                    {selectedCompanyIds.slice(0, 3).map(id => {
                      const comp = companies.find(c => c.id === id);
                      return <td key={id} className="py-4 px-6 border-r border-border"><span className="px-2 py-0.5 bg-muted border border-border">{comp?.category}</span></td>;
                    })}
                  </tr>
                  <tr className="hover:bg-muted/10">
                    <td className="py-4 px-6 border-r border-border font-black text-muted-foreground">CTC / STIPEND</td>
                    {selectedCompanyIds.slice(0, 3).map(id => {
                      const comp = companies.find(c => c.id === id);
                      return (
                        <td key={id} className="py-4 px-6 border-r border-border">
                          <p className="font-bold">{comp?.ctc || "—"}</p>
                          <p className="text-[10px] text-muted-foreground">{comp?.stipend ? `Stipend: ${comp?.stipend}` : "No stipend"}</p>
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="hover:bg-muted/10">
                    <td className="py-4 px-6 border-r border-border font-black text-muted-foreground">LOCATION</td>
                    {selectedCompanyIds.slice(0, 3).map(id => {
                      const comp = companies.find(c => c.id === id);
                      return <td key={id} className="py-4 px-6 border-r border-border">{comp?.job_location || "—"}</td>;
                    })}
                  </tr>
                  <tr className="hover:bg-muted/10">
                    <td className="py-4 px-6 border-r border-border font-black text-muted-foreground">ACADEMIC ELIGIBILITY</td>
                    {selectedCompanyIds.slice(0, 3).map(id => {
                      const comp = companies.find(c => c.id === id);
                      return (
                        <td key={id} className="py-4 px-6 border-r border-border space-y-1.5 relative group/elig">
                          {comp ? (
                            <>
                              <div className="flex flex-col gap-1 cursor-help">
                                {getEligibilityIcon(comp.eligibility_status)}
                                {comp.eligibility_reason && (
                                  <p className="text-[9px] text-muted-foreground leading-normal max-w-xs uppercase">{comp.eligibility_reason}</p>
                                )}
                              </div>
                              <div className="absolute left-1/2 bottom-full -translate-x-1/2 mb-1 hidden group-hover/elig:block bg-zinc-950 border-2 border-black p-4 shadow-[4px_4px_0px_0px_#000] z-50 text-[10px] min-w-[280px] max-w-md uppercase leading-relaxed font-bold rounded-none">
                                {comp.eligibility_explanation ? (
                                  <div className="space-y-3">
                                    {comp.eligibility_explanation.failed && comp.eligibility_explanation.failed.length > 0 && (
                                      <div className="space-y-1">
                                        <p className="text-red-500 font-extrabold tracking-wider border-b border-red-500/20 pb-0.5">⚠️ FAILED CRITERIA</p>
                                        <ul className="list-disc list-inside text-red-400/90 font-mono text-[9px] space-y-0.5 normal-case">
                                          {comp.eligibility_explanation.failed.map((rule, idx) => (
                                            <li key={idx} className="whitespace-normal">{rule}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {comp.eligibility_explanation.matched && comp.eligibility_explanation.matched.length > 0 && (
                                      <div className="space-y-1">
                                        <p className="text-emerald-500 font-extrabold tracking-wider border-b border-emerald-500/20 pb-0.5">✓ MATCHED CRITERIA</p>
                                        <ul className="list-disc list-inside text-emerald-400/90 font-mono text-[9px] space-y-0.5 normal-case">
                                          {comp.eligibility_explanation.matched.map((rule, idx) => (
                                            <li key={idx} className="whitespace-normal">{rule}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {comp.eligibility_raw_text && (
                                      <div className="space-y-1">
                                        <p className="text-muted-foreground font-extrabold tracking-wider border-b border-zinc-850 pb-0.5">SOURCE TEXT</p>
                                        <pre className="text-[9px] font-mono text-zinc-300 normal-case bg-zinc-900 p-2 border border-zinc-800 max-h-24 overflow-y-auto whitespace-pre-wrap leading-normal font-normal">
                                          {comp.eligibility_raw_text}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <p className="text-muted-foreground">No detailed rules parsed for this company.</p>
                                    {comp.eligibility_raw_text && (
                                      <div className="space-y-1">
                                        <p className="text-muted-foreground font-extrabold tracking-wider border-b border-zinc-850 pb-0.5">SOURCE TEXT</p>
                                        <pre className="text-[9px] font-mono text-zinc-300 normal-case bg-zinc-900 p-2 border border-zinc-800 max-h-24 overflow-y-auto whitespace-pre-wrap leading-normal font-normal">
                                          {comp.eligibility_raw_text}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </>
                          ) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="hover:bg-muted/10">
                    <td className="py-4 px-6 border-r border-border font-black text-muted-foreground">ATS MATCH SCORE</td>
                    {selectedCompanyIds.slice(0, 3).map(id => {
                      const app = applications[id];
                      return (
                        <td key={id} className="py-4 px-6 border-r border-border font-mono font-bold text-sm">
                          {app?.match_score > 0 ? (
                            <span className="text-accent">{app.match_score}% MATCH</span>
                          ) : (
                            <span className="text-muted-foreground">0% (Not Tailored)</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="hover:bg-muted/10">
                    <td className="py-4 px-6 border-r border-border font-black text-muted-foreground">PREPARATION READINESS</td>
                    {selectedCompanyIds.slice(0, 3).map(id => {
                      const comp = companies.find(c => c.id === id);
                      return (
                        <td key={id} className="py-4 px-6 border-r border-border font-mono font-bold text-sm">
                          {comp ? (
                            <span className="text-foreground">{getPrepScore(comp)}%</span>
                          ) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="hover:bg-muted/10">
                    <td className="py-4 px-6 border-r border-border font-black text-muted-foreground">ACTION</td>
                    {selectedCompanyIds.slice(0, 3).map(id => {
                      const comp = companies.find(c => c.id === id);
                      const app = applications[id];
                      const isTracking = app && app.user_decision === 'tracking';
                      
                      return (
                        <td key={id} className="py-4 px-6 border-r border-border">
                          {comp ? (
                            <button
                              onClick={async () => {
                                await handleUpdateApplication(comp.id, { user_decision: isTracking ? 'archived' : 'tracking' });
                              }}
                              className={`h-9 px-4 border font-bold text-xs uppercase tracking-wider transition-all ${
                                isTracking 
                                  ? "bg-transparent text-muted-foreground border-border hover:bg-red-950 hover:text-red-400 hover:border-red-500" 
                                  : "bg-foreground text-background hover:bg-accent hover:text-black hover:border-accent"
                              }`}
                            >
                              {isTracking ? "Stop Tracking" : "Start Tracking"}
                            </button>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

          </div>
        </div>
      )}

      {/* Global modern Company Workspace Drawer / Modal */}
      {selectedCompany && (
        <CompanyWorkspaceModal
          companyId={selectedCompany.id}
          onClose={() => setSelectedCompany(null)}
        />
      )}

      <ConfirmArchiveModal
        isOpen={archiveConfirm.isOpen}
        title={archiveConfirm.title}
        message={archiveConfirm.message}
        onConfirm={archiveConfirm.onConfirm}
        onCancel={() => setArchiveConfirm(prev => ({ ...prev, isOpen: false }))}
      />

    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-8 flex items-center justify-center font-mono">LOADING SYSTEM...</div>}>
      <DashboardPageContent />
    </Suspense>
  );
}

