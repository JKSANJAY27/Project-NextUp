"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";
import { 
  Plus, 
  Lock, 
  CheckCircle, 
  XCircle, 
  HelpCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Globe,
  AlertCircle,
  X,
  Link2,
  Clock,
  Calendar,
  ArrowRight,
  Pin,
  TrendingUp,
  Award,
  AlertTriangle,
  Megaphone,
  Download,
  Eye
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
}

interface CompanyWithEligibility extends Company {
  eligibility_status: string;
  eligibility_reason: string | null;
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

const KANBAN_COLUMNS = [
  { id: "Applied", name: "APPLIED" },
  { id: "Shortlisted", name: "SHORTLISTED" },
  { id: "OA", name: "ONLINE ASSESSMENT" },
  { id: "Technical", name: "TECHNICAL INTERVIEW" },
  { id: "HR", name: "HR INTERVIEW" },
  { id: "Offer", name: "OFFER RECEIVED" }
];

async function calculateHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getEligibility(user: any, company: Company): { status: string; reason: string | null } {
  if (!user) {
    return { status: "CHECK", reason: "Profile not loaded." };
  }

  if (company.eligible_branches && company.eligible_branches.length > 0) {
    const userBranch = (user.branch || "").trim().toUpperCase();
    const eligibleBranches = company.eligible_branches.map((b: string) => b.trim().toUpperCase());
    if (!eligibleBranches.includes(userBranch)) {
      return {
        status: "NOT_ELIGIBLE",
        reason: `Your branch '${user.branch || "Unknown"}' is not eligible.`,
      };
    }
  }

  const rules = company.eligibility_rules || {};

  const minCgpa = rules.min_cgpa !== undefined ? rules.min_cgpa : null;
  if (minCgpa !== null && minCgpa !== undefined) {
    if (user.cgpa === null || user.cgpa === undefined) {
      return { status: "CHECK", reason: "CGPA not set in profile." };
    }
    if (Number(user.cgpa) < Number(minCgpa)) {
      return {
        status: "NOT_ELIGIBLE",
        reason: `Your CGPA (${Number(user.cgpa).toFixed(2)}) is below the required ${Number(minCgpa).toFixed(2)}.`,
      };
    }
  }

  const minTenth = rules.min_tenth_marks || rules.min_tenth || null;
  if (minTenth !== null && minTenth !== undefined) {
    if (user.tenth_marks === null || user.tenth_marks === undefined) {
      return { status: "CHECK", reason: "10th marks not set in profile." };
    }
    if (Number(user.tenth_marks) < Number(minTenth)) {
      return {
        status: "NOT_ELIGIBLE",
        reason: `Your 10th marks (${Number(user.tenth_marks).toFixed(1)}%) are below the required ${Number(minTenth).toFixed(1)}%.`,
      };
    }
  }

  const minTwelfth = rules.min_twelfth_marks || rules.min_twelfth || null;
  if (minTwelfth !== null && minTwelfth !== undefined) {
    if (user.twelfth_marks === null || user.twelfth_marks === undefined) {
      return { status: "CHECK", reason: "12th marks not set in profile." };
    }
    if (Number(user.twelfth_marks) < Number(minTwelfth)) {
      return {
        status: "NOT_ELIGIBLE",
        reason: `Your 12th marks (${Number(user.twelfth_marks).toFixed(1)}%) are below the required ${Number(minTwelfth).toFixed(1)}%.`,
      };
    }
  }

  const requiresNoArrears = rules.requires_no_arrears !== undefined ? rules.requires_no_arrears : false;
  if (requiresNoArrears) {
    if (user.has_arrears) {
      return {
        status: "NOT_ELIGIBLE",
        reason: "Company requires no standing arrears, but you have arrears.",
      };
    }
  }

  return { status: "ELIGIBLE", reason: "You meet all academic criteria." };
}

function DashboardPageContent() {
  const { user, encryptionKey } = useAppStore();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") || "action-center";

  const [companies, setCompanies] = useState<CompanyWithEligibility[]>([]);
  const [applications, setApplications] = useState<Record<string, Application>>({});
  const [opportunityStates, setOpportunityStates] = useState<Record<string, OpportunityState>>({});
  const [notificationBundles, setNotificationBundles] = useState<NotificationBundle[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [showArchivedOpportunities, setShowArchivedOpportunities] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [filterCategory, setFilterCategory] = useState("ALL");
  const [filterEligibility, setFilterEligibility] = useState("ALL");
  const [draggedOverColumn, setDraggedOverColumn] = useState<string | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<CompanyWithEligibility | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  // Bulk Selection and Comparison states
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  // Company Workspace Drawer state
  const [modalTab, setModalTab] = useState<"overview" | "details" | "toolkit">("overview");
  const [editingRoundNote, setEditingRoundNote] = useState<string | null>(null);
  const [tempNoteText, setTempNoteText] = useState("");
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);
  const [decryptedNotes, setDecryptedNotes] = useState<Record<string, string>>({});
  const [companyEvents, setCompanyEvents] = useState<CompanyEvent[]>([]);
  const [isPrepPanelExpanded, setIsPrepPanelExpanded] = useState(false);

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

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      // 1. Fetch companies directly from Supabase
      const { data: compData, error: compError } = await supabase
        .from("companies")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (compError) throw compError;

      // 2. Fetch user profile from Supabase
      let activeProfile = user;
      if (user?.id) {
        const { data: profileData } = await supabase
          .from("student_profiles")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();
        if (profileData) {
          activeProfile = { ...user, ...profileData };
        }
      }

      // Compute client-side eligibility
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const companiesWithEligibility: CompanyWithEligibility[] = (compData || []).map((c: any) => {
        const eligibility = getEligibility(activeProfile, c);
        return {
          ...c,
          eligibility_status: eligibility.status,
          eligibility_reason: eligibility.reason
        };
      });
      setCompanies(companiesWithEligibility);

      // 3. Fetch applications from FastAPI to get computed priority scoring and stale status
      let appData = [];
      try {
        const res = await api.get("/applications");
        appData = res.data;
      } catch (err) {
        console.error("FastAPI applications endpoint failed, falling back to Supabase", err);
        const { data: sbData } = await supabase
          .from("applications")
          .select("*");
        appData = sbData || [];
      }

      const appMap: Record<string, Application> = {};
      const oppStateMap: Record<string, OpportunityState> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (appData || []).forEach((record: any) => {
        if (record.record_type === "opportunity_state") {
          oppStateMap[record.company_id] = record as OpportunityState;
        } else {
          // Real application tracker
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

      // 4. Fetch notifications bundled by company workspace
      if (user) {
        try {
          const notifRes = await api.get("/notifications");
          setNotificationBundles(notifRes.data || []);
        } catch (err) {
          console.error("Failed to fetch notification bundles:", err);
        }
      }

      // 5. Fetch general announcements
      if (user) {
        try {
          const annRes = await api.get("/announcements");
          const data = annRes.data || [];
          setAnnouncements(data);
          if (data.length > 0) {
            setSelectedAnnouncement((prev) => {
              if (prev) {
                // If we already had one selected, see if it's still in the list and update it
                const found = data.find((a: Announcement) => a.id === prev.id);
                if (found) return found;
              }
              return data[0];
            });
          }
        } catch (err) {
          console.error("Failed to fetch announcements:", err);
        }
      }
    } catch (err) {
      console.error("Error fetching dashboard data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();

    // Set up real-time subscription for realtime updates from Supabase
    const companiesChannel = supabase
      .channel("supabase-realtime-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "companies" },
        () => {
          fetchDashboardData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "applications" },
        () => {
          fetchDashboardData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => {
          fetchDashboardData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(companiesChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, encryptionKey]);

  // Auto-select announcement if id parameter is in URL
  useEffect(() => {
    if (announcements.length > 0) {
      const idParam = searchParams.get("id");
      if (idParam) {
        const found = announcements.find(a => a.id === idParam);
        if (found) {
          setSelectedAnnouncement(found);
          setTimeout(() => {
            const element = document.getElementById("announcements-archive");
            if (element) {
              element.scrollIntoView({ behavior: "smooth" });
            }
          }, 100);
        }
      }
    }
  }, [searchParams, announcements]);

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

  // Generic Create or Update Application (calls FastAPI backend endpoints)
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
      console.error("Failed to update application tracker:", err);
      alert("FAILED TO UPDATE TRACKING STATUS.");
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

  // Opportunity state actions: track | archive | snooze | restore
  // Called for companies in decision_pending / archived state (no Application workspace yet)
  const handleOpportunityAction = async (companyId: string, action: "track" | "archive" | "snooze" | "restore") => {
    try {
      await api.post(`/applications/opportunity-state?company_id=${companyId}&action=${action}`);
      await fetchDashboardData();
    } catch (err) {
      console.error(`Opportunity action '${action}' failed:`, err);
      alert(`Failed to ${action} opportunity.`);
    }
  };

  const handleStatusChange = async (companyId: string, newStatus: string) => {
    await handleUpdateApplication(companyId, {
      status: newStatus,
      current_round: newStatus
    });
  };

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
  const handleDragStart = (e: React.DragEvent, companyId: string) => {
    e.dataTransfer.setData("text/plain", companyId);
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    setDraggedOverColumn(colId);
  };

  const handleDragLeave = () => {
    setDraggedOverColumn(null);
  };

  const handleDrop = async (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    setDraggedOverColumn(colId);
    const companyId = e.dataTransfer.getData("text/plain");
    if (companyId) {
      await handleStatusChange(companyId, colId);
    }
  };

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
    } else if (comp.eligibility_status === "CHECK") {
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
  const getTodayEvents = () => {
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
  };

  const handleViewAnnouncement = (ann: Announcement) => {
    setSelectedAnnouncement(ann);
    setTimeout(() => {
      const element = document.getElementById("announcements-archive");
      if (element) {
        element.scrollIntoView({ behavior: "smooth" });
      }
    }, 50);
  };

  const getDailyDigest = () => {
    const userName = user?.full_name || "Sanjay";
    const todayEvents = getTodayEvents();
    
    let eventText = "You have no events scheduled for today.";
    if (todayEvents.length > 0) {
      const mainEvent = todayEvents[0];
      eventText = `You have ${mainEvent.title} at ${mainEvent.time.toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' })} today.`;
    }
    
    const trackedApps = Object.values(applications).filter(app => app.user_decision === 'tracking');
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

    return `Good morning, ${userName}. ${eventText} ${statsText} ${focusText}`;
  };

  const getNextActionMessage = (app: Application, comp: Company) => {
    const stage = app.recruitment_state || app.status || 'Registration';
    const stageLower = stage.toLowerCase();
    
    if (stageLower.includes('registration') || stageLower.includes('interested')) {
      if (comp.registration_link) return "Apply on the CDC Portal before the registration window closes.";
      return "Tailor your resume and submit your application.";
    }
    if (stageLower.includes('applied') || stageLower.includes('awaiting shortlist')) {
      return "Practice core CS fundamentals and review projects while awaiting shortlist results.";
    }
    if (stageLower.includes('shortlisted')) {
      return "Revise data structures, algorithms, and mock assessments in preparation for the OA.";
    }
    if (stageLower.includes('oa') || stageLower.includes('awaiting oa result')) {
      return "Review your OA responses and prepare answers for potential technical interview rounds.";
    }
    if (stageLower.includes('interview') || stageLower.includes('awaiting interview result')) {
      return "Revise core system design, project architectures, and schedule a mock behavioral panel.";
    }
    if (stageLower.includes('offer')) {
      return "Review contract offer terms, compensation CTC split, and complete onboarding steps.";
    }
    return "Check details or archive if you do not plan to track this placement drive further.";
  };

  const getRiskLevel = (app: Application, comp: Company) => {
    if (!comp.registration_deadline) return 'low';
    
    const now = Date.now();
    const deadline = new Date(comp.registration_deadline).getTime();
    const diffHours = (deadline - now) / (3600 * 1000);
    
    const stage = app.recruitment_state || app.status || 'Registration';
    const isAppliedOrBeyond = !['Registration', 'Interested', 'unseen'].includes(stage);

    if (diffHours < 4 && !isAppliedOrBeyond) {
      return 'high';
    }
    if (diffHours < 24 && !isAppliedOrBeyond) {
      return 'medium';
    }
    return 'low';
  };

  // Compile timeline events list for the selected company drawer
  const getTimelineEvents = () => {
    if (!selectedCompany) return [];
    
    const events: TimelineEvent[] = [];
    
    if (companyEvents && companyEvents.length > 0) {
      companyEvents.forEach(e => {
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
  };

  // Calculate Application Health Score checkmarks
  const getHealthScore = (app: Application | undefined) => {
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



  // Filter lists based on tab selection
  const filteredCompanies = companies.filter((c) => {
    const app = applications[c.id];
    const oppState = opportunityStates[c.id];
    const effectiveState = oppState?.state;

    if (activeTab === "opportunities") {
      // Hide archived/auto_archived unless user wants to see them
      if (effectiveState === "archived" || effectiveState === "auto_archived") {
        return showArchivedOpportunities;
      }
      // Hide if it is a confirmed tracking app (belongs in Tracking tab)
      if (app && app.user_decision === "tracking") return false;
    }

    if (activeTab === "tracking") {
      if (!app || app.user_decision !== "tracking") return false;
      if (isSnoozed(app)) return false;
      if (focusMode && app.workspace_priority_override !== "pinned") return false;
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
  });

  // Companies awaiting user decision (deadline expired, no app workspace yet)
  const decisionPendingCompanies = companies.filter(c => {
    const oppState = opportunityStates[c.id];
    return oppState?.state === "decision_pending";
  });

  // Active decision-pending (not snoozed) — shown in Action Center
  const activeDecisionPendingCompanies = decisionPendingCompanies.filter(c => {
    const oppState = opportunityStates[c.id];
    if (!oppState?.snoozed_until) return true;
    return new Date(oppState.snoozed_until) <= new Date();
  });

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
  const todayEvents = getTodayEvents();
  const untriagedBundles = notificationBundles.filter(b => b.unread_count > 0);
  const trackedApps = Object.values(applications)
    .filter(app => app.user_decision === 'tracking' && !isSnoozed(app))
    .sort((a, b) => b.priority_score - a.priority_score);

  // My Applications conversion stats
  const historyApps = Object.values(applications);
  const totalAppsCount = historyApps.length;
  const oaReachedCount = historyApps.filter(app => ["OA", "Technical", "HR", "Offer"].includes(app.status) || app.recruitment_state.includes("OA") || app.recruitment_state.includes("Interview")).length;
  const interviewReachedCount = historyApps.filter(app => ["Technical", "HR", "Offer"].includes(app.status) || app.recruitment_state.includes("Interview")).length;
  const offersCount = historyApps.filter(app => app.status === "Offer" || app.recruitment_state === "Offer").length;
  const conversionRate = totalAppsCount > 0 ? ((offersCount / totalAppsCount) * 100).toFixed(1) : "0.0";

  // Timeline and Workspace Drawer computed states
  const workspaceEvents = getTimelineEvents();
  const selectedApp = selectedCompany ? applications[selectedCompany.id] : undefined;
  const healthVal = getHealthScore(selectedApp);
  const selectedNextAction = selectedCompany && selectedApp ? getNextActionMessage(selectedApp, selectedCompany) : "Track this workspace to begin preparation.";

  // circular progress SVG values
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (healthVal / 100) * circumference;

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
        {activeTab === "action-center" && (
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
                    <button 
                      onClick={() => handleViewAnnouncement(ann)}
                      className="border-2 border-red-500 bg-red-500 text-black text-xs font-bold tracking-widest px-6 py-3 hover:bg-transparent hover:text-red-500 transition-colors uppercase block whitespace-nowrap"
                    >
                      VIEW ANNOUNCEMENT
                    </button>
                  </div>
                );
              })
            }

            {/* Side-by-Side: Today's Timeline & Notifications Triage */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Today timeline */}
              <div className="lg:col-span-5 border-2 border-border p-6 bg-muted/10 space-y-4">
                <div className="border-b border-border pb-3 flex justify-between items-center">
                  <h4 className="text-xs font-black tracking-widest uppercase text-muted-foreground">
                    📅 TODAY&apos;S SCHEDULE TIMELINE
                  </h4>
                  <span className="text-[10px] font-bold bg-muted px-2 py-0.5 border border-border">
                    {todayEvents.length} EVENT{todayEvents.length !== 1 ? 'S' : ''}
                  </span>
                </div>
                
                <div className="overflow-y-auto max-h-[350px] space-y-4 pr-1">
                  {todayEvents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-20 text-muted-foreground gap-1">
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

              {/* Placements Triage Feed */}
              <div className="lg:col-span-7 border-2 border-border p-6 bg-muted/10 space-y-4">
                <div className="border-b border-border pb-3 flex justify-between items-center">
                  <h4 className="text-xs font-black tracking-widest uppercase text-muted-foreground">
                    🔔 BUNDLED NOTIFICATIONS TRIAGE FEED
                  </h4>
                  <span className="text-[10px] font-bold bg-muted px-2 py-0.5 border border-border">
                    {untriagedBundles.length} UNTRIAGED BUNDLES
                  </span>
                </div>

                <div className="overflow-y-auto max-h-[350px] space-y-4 pr-1">
                  {untriagedBundles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-20 text-muted-foreground gap-1">
                      <span className="text-xs font-bold uppercase tracking-wider">NO UNTRIAGED ALERTS</span>
                      <span className="text-[10px] uppercase">Your placements email inbox is fully processed.</span>
                    </div>
                  ) : (
                    untriagedBundles.map((bundle) => (
                      <div key={bundle.company_id} className="border-2 border-border p-4 bg-background space-y-4 relative">
                        <div className="flex justify-between items-start">
                          <div>
                            <h5 className="font-extrabold text-sm uppercase tracking-tighter text-foreground">
                              {bundle.company_name}
                            </h5>
                            <p className="text-[10px] text-muted-foreground uppercase">
                              {bundle.role} ✦ {bundle.category}
                            </p>
                          </div>
                          <span className="bg-accent/20 border border-accent text-accent text-[9px] font-black px-1.5 py-0.5 uppercase">
                            {bundle.unread_count} NEW
                          </span>
                        </div>

                        <div className="space-y-1.5 border-t border-border pt-2.5">
                          {bundle.notifications.slice(0, 3).map((notif) => {
                            const severityStars = notif.severity >= 4 ? '🔴' : notif.severity >= 3 ? '🟠' : '🟡';
                            const isHighVis = (notif.severity || 1) >= 3;
                            return (
                              <div key={notif.id} className="text-[11px] text-foreground leading-normal flex items-start gap-1">
                                <span className="shrink-0 mt-0.5" title={`Severity ${notif.severity}`}>{severityStars}</span>
                                <p className={`flex-1 ${isHighVis ? 'font-semibold' : ''}`}>{notif.message}</p>
                              </div>
                            );
                          })}
                          {bundle.notifications.length > 3 && (
                            <p className="text-[9px] text-muted-foreground uppercase font-bold pl-3">
                              + {bundle.notifications.length - 3} more updates
                            </p>
                          )}
                        </div>

                        <div className="border-t border-border pt-3 flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleUpdateApplication(bundle.company_id, { user_decision: 'tracking' })}
                            className="h-8 px-3 border border-border bg-foreground text-background font-bold text-[10px] hover:bg-accent hover:text-black hover:border-accent uppercase tracking-wider transition-all"
                          >
                            🎯 Track
                          </button>
                          
                          <button
                            onClick={async () => {
                              try {
                                await api.post(`/notifications/company/${bundle.company_id}/read`);
                                // Archive via opportunity-state if no real app exists, else update app
                                const hasApp = !!applications[bundle.company_id];
                                if (hasApp) {
                                  handleUpdateApplication(bundle.company_id, { user_decision: 'archived' });
                                } else {
                                  handleOpportunityAction(bundle.company_id, 'archive');
                                }
                              } catch (err) {
                                console.error("Failed to dismiss bundle:", err);
                              }
                            }}
                            className="h-8 px-3 border border-border bg-transparent text-foreground font-bold text-[10px] hover:bg-muted uppercase tracking-wider transition-all"
                          >
                            👁️ Dismiss
                          </button>
                          
                          <div className="relative group">
                            <button
                              className="h-8 px-3 border border-border bg-transparent text-muted-foreground font-bold text-[10px] hover:bg-muted hover:text-foreground uppercase tracking-wider transition-all"
                            >
                              ⏰ Snooze
                            </button>
                            <div className="absolute right-0 bottom-full z-10 mb-1 hidden group-hover:block hover:block bg-background border border-border py-1 shadow-xl min-w-[120px]">
                              {[1, 3, 7].map((days) => (
                                <button
                                  key={days}
                                  onClick={() => {
                                    const snoozeDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
                                    handleUpdateApplication(bundle.company_id, { 
                                      user_decision: 'snoozed',
                                      snoozed_until: snoozeDate
                                    });
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider hover:bg-muted text-foreground"
                                >
                                  {days} Day{days > 1 ? 's' : ''}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Recent Announcements Widget */}
            <div className="border-2 border-border p-6 bg-muted/10 space-y-6">
              <div className="border-b border-border pb-3 flex justify-between items-center">
                <h4 className="text-xs font-black tracking-widest uppercase text-muted-foreground">
                  📢 LATEST GENERAL ANNOUNCEMENTS
                </h4>
                <button
                  onClick={() => {
                    const element = document.getElementById("announcements-archive");
                    if (element) {
                      element.scrollIntoView({ behavior: "smooth" });
                    }
                  }}
                  className="text-[10px] font-bold text-accent hover:underline uppercase flex items-center gap-1 bg-transparent border-0 cursor-pointer"
                >
                  View All Announcements <ArrowRight size={10} />
                </button>
              </div>

              {announcements.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground uppercase font-bold text-[10px]">
                  No announcements posted.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {announcements.slice(0, 3).map((ann) => {
                    const deadline = ann.deadline;
                    const deadlineDate = deadline ? new Date(deadline) : null;
                    const formattedDate = new Date(ann.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    });
                    return (
                      <div
                        key={ann.id}
                        onClick={() => handleViewAnnouncement(ann)}
                        className="border-2 border-border p-4 bg-background hover:border-accent transition-all duration-300 flex flex-col justify-between space-y-3 group cursor-pointer"
                      >
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className={`text-[8px] font-black uppercase px-2 py-0.5 border ${
                              ann.announcement_type === 'MANDATORY_REQUIREMENT'
                                ? 'bg-red-950/40 border-red-500/50 text-red-400'
                                : ann.announcement_type === 'TRAINING'
                                ? 'bg-purple-950/40 border-purple-500/50 text-purple-400'
                                : ann.announcement_type === 'PLACEMENT_REGISTRATION'
                                ? 'bg-amber-950/40 border-amber-500/50 text-amber-400'
                                : 'bg-muted border-border text-muted-foreground'
                            }`}>
                              {ann.announcement_type.replace('_', ' ')}
                            </span>
                            <span className="text-[9px] font-mono text-muted-foreground">{formattedDate}</span>
                          </div>
                          <h5 className="font-extrabold text-sm uppercase tracking-tight text-foreground line-clamp-1 group-hover:text-accent transition-colors">
                            {ann.title}
                          </h5>
                          <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                            {ann.body}
                          </p>
                        </div>
                        {deadlineDate && (
                          <div className="text-[9px] font-bold text-amber-500 flex items-center gap-1 pt-2 border-t border-border/40">
                            <Clock size={10} />
                            <span>Deadline: {deadlineDate.toLocaleDateString("en-IN", { month: "short", day: "numeric" })}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Decision Pending Widget — Companies past deadline with no decision */}
            {activeDecisionPendingCompanies.length > 0 && (
              <div className="border-2 border-amber-500/60 bg-amber-500/5 p-6 space-y-4">
                <div className="border-b border-amber-500/40 pb-3 flex justify-between items-center">
                  <h4 className="text-xs font-black tracking-widest uppercase text-amber-400">
                    ⏰ DECISION REQUIRED — {activeDecisionPendingCompanies.length} EXPIRED DRIVE{activeDecisionPendingCompanies.length !== 1 ? 'S' : ''}
                  </h4>
                  <span className="text-[10px] font-bold text-amber-500/70 uppercase">Deadline has passed. Did you apply?</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {activeDecisionPendingCompanies.slice(0, 6).map((comp) => {
                    const opp = opportunityStates[comp.id];
                    const deadlineStr = comp.registration_deadline
                      ? new Date(comp.registration_deadline).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : 'N/A';
                    const pendingSince = opp?.decision_pending_since
                      ? new Date(opp.decision_pending_since).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
                      : null;
                    return (
                      <div key={comp.id} className="border-2 border-amber-500/40 bg-background p-4 space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <h5 className="font-extrabold text-sm uppercase tracking-tighter text-foreground">{comp.name}</h5>
                            <p className="text-[10px] text-muted-foreground uppercase">{comp.role} ✦ {comp.category}</p>
                          </div>
                          <span className="text-[8px] font-black bg-amber-950/60 border border-amber-500/50 text-amber-400 px-1.5 py-0.5 uppercase shrink-0">
                            PENDING
                          </span>
                        </div>
                        <div className="text-[10px] text-amber-500/80 font-bold uppercase">
                          ⏰ Deadline: {deadlineStr}
                          {pendingSince && <span className="ml-2 text-muted-foreground">• Pending since {pendingSince}</span>}
                        </div>
                        <div className="flex gap-2 pt-1 border-t border-border/40">
                          <button
                            onClick={() => handleOpportunityAction(comp.id, 'track')}
                            className="flex-1 h-7 bg-accent text-black font-bold text-[9px] uppercase tracking-wider hover:bg-accent/80 transition-all border border-accent"
                          >
                            ✅ Yes, I Applied
                          </button>
                          <button
                            onClick={() => handleOpportunityAction(comp.id, 'archive')}
                            className="flex-1 h-7 bg-transparent text-muted-foreground font-bold text-[9px] uppercase tracking-wider hover:bg-muted border border-border transition-all"
                          >
                            ✗ No, Archive
                          </button>
                          <button
                            onClick={() => handleOpportunityAction(comp.id, 'snooze')}
                            className="h-7 px-3 bg-transparent text-muted-foreground font-bold text-[9px] uppercase tracking-wider hover:bg-muted border border-border transition-all"
                            title="Remind me in 7 days"
                          >
                            ⏰
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Immediate Actions Feed */}
            <div className="space-y-6">
              <div className="border-b-2 border-border pb-3">
                <h4 className="text-sm font-black tracking-widest uppercase text-muted-foreground">
                  🔥 IMMEDIATE ACTION QUEUE
                </h4>
              </div>

              {loading ? (
                <div className="text-center py-12 text-muted-foreground uppercase font-bold text-xs">Loading queue...</div>
              ) : trackedApps.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-border text-muted-foreground font-bold uppercase tracking-wider text-xs">
                  You are not tracking any active companies. Visit the Opportunities tab to discover openings.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {trackedApps.slice(0, 6).map((app) => {
                    const comp = companies.find(c => c.id === app.company_id);
                    if (!comp) return null;
                    
                    const risk = getRiskLevel(app, comp);

                    return (
                      <div key={app.id} className="border-2 border-border p-6 bg-card relative space-y-4 hover:border-accent transition-all duration-300">
                        <div className="flex justify-between items-start">
                          <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 bg-muted border border-border text-foreground">
                            {comp.category}
                          </span>
                          <div className="flex items-center gap-2">
                            {app.workspace_priority_override === 'pinned' && (
                              <span className="text-[9px] font-black text-black bg-accent border border-accent px-1.5 py-0.5 animate-pulse">
                                📌 PINNED
                              </span>
                            )}
                            <span className="text-[9px] font-black text-muted-foreground">
                              PRIORITY: {app.priority_score}
                            </span>
                          </div>
                        </div>

                        <div className="cursor-pointer" onClick={() => { setSelectedCompany(comp); setModalTab("overview"); }}>
                          <h4 className="font-extrabold text-base uppercase tracking-tighter hover:text-accent transition-colors">
                            {comp.name}
                          </h4>
                          <p className="text-xs text-muted-foreground uppercase">
                            {comp.role}
                          </p>
                        </div>

                        <div className="flex items-center justify-between border-t border-border pt-3 text-[10px] font-bold">
                          <span className="uppercase text-muted-foreground">Stage: {app.recruitment_state}</span>
                          {app.is_stale ? (
                            <span className="text-red-500 animate-pulse">⚠️ STALE</span>
                          ) : (
                            <span className={`
                              px-2 py-0.5 text-[8px] font-black uppercase border
                              ${risk === 'high' ? 'bg-red-950 border-red-500 text-red-400' : 
                                risk === 'medium' ? 'bg-amber-950 border-amber-500 text-amber-400' : 
                                'bg-emerald-950 border-emerald-500 text-emerald-400'}
                            `}>
                              {risk === 'high' ? '🔴 HIGH RISK' : risk === 'medium' ? '🟡 ATTENTION' : '🟢 ON TRACK'}
                            </span>
                          )}
                        </div>

                        <div className="bg-muted/30 border border-border/50 p-3 text-[11px] font-semibold text-foreground uppercase leading-relaxed">
                          👉 {getNextActionMessage(app, comp)}
                        </div>

                        <div className="flex justify-between items-center border-t border-border pt-3">
                          <button 
                            onClick={() => { setSelectedCompany(comp); setModalTab("overview"); }}
                            className="text-xs font-bold text-accent hover:underline uppercase"
                          >
                            Open Workspace →
                          </button>
                          
                          <button
                            onClick={() => {
                              const isPinned = app.workspace_priority_override === 'pinned';
                              handleUpdateApplication(comp.id, {
                                workspace_priority_override: isPinned ? null : 'pinned'
                              });
                            }}
                            className="text-[10px] font-black text-muted-foreground hover:text-foreground uppercase"
                          >
                            {app.workspace_priority_override === 'pinned' ? 'Unpin' : 'Pin to Top'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Announcements Archive Section */}
            <div id="announcements-archive" className="border-t-2 border-border pt-12 mt-12 space-y-6">
              <div className="border-b-2 border-border pb-6 flex justify-between items-end">
                <div className="space-y-1">
                  <h2 className="text-3xl font-extrabold tracking-tighter uppercase leading-none">
                    ANNOUNCEMENTS
                  </h2>
                  <p className="text-xs text-muted-foreground uppercase tracking-widest">
                    Important notices, training completion deadlines, and policy updates from the CDC
                  </p>
                </div>
              </div>

              {announcements.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-20 border-2 border-dashed border-border bg-muted/10 gap-3">
                  <div className="h-12 w-12 bg-muted text-muted-foreground flex items-center justify-center border-2 border-border">
                    <Megaphone size={24} />
                  </div>
                  <div>
                    <p className="text-sm font-black uppercase tracking-wider text-muted-foreground">NO ANNOUNCEMENTS YET</p>
                    <p className="text-[10px] text-muted-foreground/80 uppercase">General updates and notices from CDC will appear here.</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  
                  {/* Left Column: Announcements List */}
                  <div className="lg:col-span-5 space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                    {announcements.map((ann) => {
                      const isSelected = selectedAnnouncement?.id === ann.id;
                      const formattedDate = new Date(ann.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric"
                      });
                      const deadline = ann.deadline;
                      const deadlineDate = deadline ? new Date(deadline) : null;
                      const isDeadlinePassed = deadlineDate ? deadlineDate.getTime() < Date.now() : false;

                      return (
                        <div
                          key={ann.id}
                          onClick={() => setSelectedAnnouncement(ann)}
                          className={`border-2 p-4 cursor-pointer transition-all duration-200 relative ${
                            isSelected
                              ? "border-accent bg-accent/5"
                              : "border-border hover:border-muted-foreground/50 bg-card"
                          }`}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <span className={`text-[8px] font-black uppercase px-2 py-0.5 border ${
                              ann.announcement_type === 'MANDATORY_REQUIREMENT'
                                ? 'bg-red-950 border-red-500 text-red-400'
                                : ann.announcement_type === 'TRAINING'
                                ? 'bg-purple-950 border-purple-500 text-purple-400'
                                : ann.announcement_type === 'PLACEMENT_REGISTRATION'
                                ? 'bg-amber-950 border-amber-500 text-amber-400'
                                : 'bg-muted border-border text-muted-foreground'
                            }`}>
                              {ann.announcement_type.replace('_', ' ')}
                            </span>
                            <span className="text-[9px] font-mono text-muted-foreground">
                              {formattedDate}
                            </span>
                          </div>
                          <h4 className="font-extrabold text-sm uppercase tracking-tight text-foreground line-clamp-1 mb-1">
                            {ann.title}
                          </h4>
                          <p className="text-[11px] text-muted-foreground line-clamp-2 leading-snug mb-3">
                            {ann.body}
                          </p>
                          
                          {deadlineDate && (
                            <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase mt-2 pt-2 border-t border-border/40 ${
                              isDeadlinePassed ? "text-muted-foreground" : "text-amber-500"
                            }`}>
                              <Clock size={10} />
                              <span>
                                Deadline: {deadlineDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Right Column: Detailed View */}
                  <div className="lg:col-span-7 border-2 border-border p-6 bg-card space-y-6">
                    {selectedAnnouncement ? (
                      <>
                        <div className="space-y-4">
                          <div className="flex flex-wrap gap-2 items-center justify-between border-b border-border pb-4">
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 border ${
                              selectedAnnouncement.announcement_type === 'MANDATORY_REQUIREMENT'
                                ? 'bg-red-950/40 border-red-500/50 text-red-400'
                                : selectedAnnouncement.announcement_type === 'TRAINING'
                                ? 'bg-purple-950/40 border-purple-500/50 text-purple-400'
                                : selectedAnnouncement.announcement_type === 'PLACEMENT_REGISTRATION'
                                ? 'bg-amber-950/40 border-amber-500/50 text-amber-400'
                                : 'bg-muted border-border text-muted-foreground'
                            }`}>
                              {selectedAnnouncement.announcement_type.replace('_', ' ')}
                            </span>
                            <span className="text-xs font-mono text-muted-foreground">
                              Received: {new Date(selectedAnnouncement.created_at).toLocaleString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit"
                              })}
                            </span>
                          </div>
                          
                          <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight text-foreground leading-snug">
                            {selectedAnnouncement.title}
                          </h2>

                          {selectedAnnouncement.deadline && (
                            <div className="border-2 border-amber-500/30 bg-amber-500/5 p-4 flex items-center gap-3">
                              <Clock size={18} className="text-amber-500 animate-pulse" />
                              <div>
                                <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">ACTION DEADLINE</p>
                                <p className="text-xs font-black uppercase text-foreground">
                                  {new Date(selectedAnnouncement.deadline).toLocaleString("en-US", {
                                    weekday: "short",
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit"
                                  })}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="border-t border-border pt-4">
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">BODY // DETAILS</p>
                          <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed border-2 border-border p-4 bg-muted/10 font-medium">
                            {selectedAnnouncement.body}
                          </div>
                        </div>

                        {/* Attachments Section */}
                        <div className="border-t border-border pt-4">
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">
                            📄 ATTACHMENTS ({selectedAnnouncement.attachments.length})
                          </p>
                          {selectedAnnouncement.attachments.length === 0 ? (
                            <p className="text-xs text-muted-foreground uppercase italic pl-2">No attachments available for this announcement.</p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {selectedAnnouncement.attachments.map((att) => {
                                const isExcel = att.file_name.toLowerCase().endsWith('.xlsx') || att.file_name.toLowerCase().endsWith('.xls');
                                const downloadUrl = `${api.defaults.baseURL}/announcements/attachment/${att.id}`;
                                return (
                                  <div key={att.id} className="border border-border p-3 flex flex-col justify-between bg-muted/10">
                                    <div className="flex items-start gap-2.5 mb-3">
                                      <span className={`text-[9px] font-mono font-black border px-1.5 py-0.5 ${
                                        isExcel ? "bg-emerald-950 border-emerald-500 text-emerald-400" : "bg-red-950 border-red-500 text-red-400"
                                      }`}>
                                        {isExcel ? "XLSX" : "PDF"}
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <p className="text-xs font-bold text-foreground truncate uppercase" title={att.file_name}>
                                          {att.file_name}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground font-mono">
                                          {att.file_type.replace('_', ' ')}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex gap-2">
                                      <a
                                        href={downloadUrl}
                                        download
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex-1 flex items-center justify-center gap-1.5 h-8 border border-border bg-background hover:bg-muted font-bold text-[10px] uppercase tracking-wider transition-colors"
                                      >
                                        <Download size={12} />
                                        <span>Download</span>
                                      </a>
                                      <a
                                        href={downloadUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center justify-center h-8 w-8 border border-border bg-background hover:bg-muted font-bold transition-colors"
                                        title="Open in new window"
                                      >
                                        <Eye size={12} />
                                      </a>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-center py-40 text-muted-foreground">
                        <Megaphone size={32} className="mb-2 text-muted-foreground/60" />
                        <p className="text-xs font-bold uppercase">Select an announcement to view details</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== 1b. ANNOUNCEMENTS CENTER TAB ==================== */}
        {activeTab === "announcements" && (
          <div className="space-y-12 animate-fade-in">
            <div className="border-b-2 border-border pb-6 flex justify-between items-end">
              <div className="space-y-1">
                <h1 className="text-[clamp(2rem,6vw,4rem)] font-extrabold tracking-tighter uppercase leading-none">
                  ANNOUNCEMENTS
                </h1>
                <p className="text-xs text-muted-foreground uppercase tracking-widest">
                  Important notices, training completion deadlines, and policy updates from the CDC
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

            {announcements.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-32 border-2 border-dashed border-border bg-muted/10 gap-3">
                <div className="h-12 w-12 bg-muted text-muted-foreground flex items-center justify-center border-2 border-border">
                  <Megaphone size={24} />
                </div>
                <div>
                  <p className="text-sm font-black uppercase tracking-wider text-muted-foreground">NO ANNOUNCEMENTS YET</p>
                  <p className="text-[10px] text-muted-foreground/80 uppercase">General updates and notices from CDC will appear here.</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* Left Column: Announcements List */}
                <div className="lg:col-span-5 space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                  {announcements.map((ann) => {
                    const isSelected = selectedAnnouncement?.id === ann.id;
                    const formattedDate = new Date(ann.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric"
                    });
                    const deadline = ann.deadline;
                    const deadlineDate = deadline ? new Date(deadline) : null;
                    const isDeadlinePassed = deadlineDate ? deadlineDate.getTime() < Date.now() : false;

                    return (
                      <div
                        key={ann.id}
                        onClick={() => setSelectedAnnouncement(ann)}
                        className={`border-2 p-4 cursor-pointer transition-all duration-200 relative ${
                          isSelected
                            ? "border-accent bg-accent/5"
                            : "border-border hover:border-muted-foreground/50 bg-card"
                        }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <span className={`text-[8px] font-black uppercase px-2 py-0.5 border ${
                            ann.announcement_type === 'MANDATORY_REQUIREMENT'
                              ? 'bg-red-950 border-red-500 text-red-400'
                              : ann.announcement_type === 'TRAINING'
                              ? 'bg-purple-950 border-purple-500 text-purple-400'
                              : ann.announcement_type === 'PLACEMENT_REGISTRATION'
                              ? 'bg-amber-950 border-amber-500 text-amber-400'
                              : 'bg-muted border-border text-muted-foreground'
                          }`}>
                            {ann.announcement_type.replace('_', ' ')}
                          </span>
                          <span className="text-[9px] font-mono text-muted-foreground">
                            {formattedDate}
                          </span>
                        </div>
                        <h4 className="font-extrabold text-sm uppercase tracking-tight text-foreground line-clamp-1 mb-1">
                          {ann.title}
                        </h4>
                        <p className="text-[11px] text-muted-foreground line-clamp-2 leading-snug mb-3">
                          {ann.body}
                        </p>
                        
                        {deadlineDate && (
                          <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase mt-2 pt-2 border-t border-border/40 ${
                            isDeadlinePassed ? "text-muted-foreground" : "text-amber-500"
                          }`}>
                            <Clock size={10} />
                            <span>
                              Deadline: {deadlineDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Right Column: Detailed View */}
                <div className="lg:col-span-7 border-2 border-border p-6 bg-card space-y-6">
                  {selectedAnnouncement ? (
                    <>
                      <div className="space-y-4">
                        <div className="flex flex-wrap gap-2 items-center justify-between border-b border-border pb-4">
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 border ${
                            selectedAnnouncement.announcement_type === 'MANDATORY_REQUIREMENT'
                              ? 'bg-red-950/40 border-red-500/50 text-red-400'
                              : selectedAnnouncement.announcement_type === 'TRAINING'
                              ? 'bg-purple-950/40 border-purple-500/50 text-purple-400'
                              : selectedAnnouncement.announcement_type === 'PLACEMENT_REGISTRATION'
                              ? 'bg-amber-950/40 border-amber-500/50 text-amber-400'
                              : 'bg-muted border-border text-muted-foreground'
                          }`}>
                            {selectedAnnouncement.announcement_type.replace('_', ' ')}
                          </span>
                          <span className="text-xs font-mono text-muted-foreground">
                            Received: {new Date(selectedAnnouncement.created_at).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit"
                            })}
                          </span>
                        </div>
                        
                        <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight text-foreground leading-snug">
                          {selectedAnnouncement.title}
                        </h2>

                        {selectedAnnouncement.deadline && (
                          <div className="border-2 border-amber-500/30 bg-amber-500/5 p-4 flex items-center gap-3">
                            <Clock size={18} className="text-amber-500 animate-pulse" />
                            <div>
                              <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">ACTION DEADLINE</p>
                              <p className="text-xs font-black uppercase text-foreground">
                                {new Date(selectedAnnouncement.deadline).toLocaleString("en-US", {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit"
                                })}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="border-t border-border pt-4">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">BODY // DETAILS</p>
                        <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed border-2 border-border p-4 bg-muted/10 font-medium">
                          {selectedAnnouncement.body}
                        </div>
                      </div>

                      {/* Attachments Section */}
                      <div className="border-t border-border pt-4">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">
                          📄 ATTACHMENTS ({selectedAnnouncement.attachments.length})
                        </p>
                        {selectedAnnouncement.attachments.length === 0 ? (
                          <p className="text-xs text-muted-foreground uppercase italic pl-2">No attachments available for this announcement.</p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {selectedAnnouncement.attachments.map((att) => {
                              const isExcel = att.file_name.toLowerCase().endsWith('.xlsx') || att.file_name.toLowerCase().endsWith('.xls');
                              const downloadUrl = `${api.defaults.baseURL}/announcements/attachment/${att.id}`;
                              return (
                                <div key={att.id} className="border border-border p-3 flex flex-col justify-between bg-muted/10">
                                  <div className="flex items-start gap-2.5 mb-3">
                                    <span className={`text-[9px] font-mono font-black border px-1.5 py-0.5 ${
                                      isExcel ? "bg-emerald-950 border-emerald-500 text-emerald-400" : "bg-red-950 border-red-500 text-red-400"
                                    }`}>
                                      {isExcel ? "XLSX" : "PDF"}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-bold text-foreground truncate uppercase" title={att.file_name}>
                                        {att.file_name}
                                      </p>
                                      <p className="text-[10px] text-muted-foreground font-mono">
                                        {att.file_type.replace('_', ' ')}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex gap-2">
                                    <a
                                      href={downloadUrl}
                                      download
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex-1 flex items-center justify-center gap-1.5 h-8 border border-border bg-background hover:bg-muted font-bold text-[10px] uppercase tracking-wider transition-colors"
                                    >
                                      <Download size={12} />
                                      <span>Download</span>
                                    </a>
                                    <a
                                      href={downloadUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex items-center justify-center h-8 w-8 border border-border bg-background hover:bg-muted font-bold transition-colors"
                                      title="Open in new window"
                                    >
                                      <Eye size={12} />
                                    </a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center py-40 text-muted-foreground">
                      <Megaphone size={32} className="mb-2 text-muted-foreground/60" />
                      <p className="text-xs font-bold uppercase">Select an announcement to view details</p>
                    </div>
                  )}
                </div>
              </div>
            )}
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
                  onClick={() => setShowArchivedOpportunities(prev => !prev)}
                  className={`flex items-center justify-center gap-2 h-14 px-6 border-2 font-extrabold tracking-wider transition-all active:scale-95 uppercase text-sm ${
                    showArchivedOpportunities
                      ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                      : 'border-border bg-background hover:bg-muted'
                  }`}
                >
                  {showArchivedOpportunities ? 'HIDE ARCHIVED' : 'SHOW ARCHIVED'}
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
                    className="bg-transparent text-xs font-bold uppercase outline-none cursor-pointer text-foreground"
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
                    className="bg-transparent text-xs font-bold uppercase outline-none cursor-pointer text-foreground"
                  >
                    <option value="ALL">ALL STATUSES</option>
                    <option value="ELIGIBLE">ELIGIBLE</option>
                    <option value="NOT_ELIGIBLE">INELIGIBLE</option>
                    <option value="CONDITIONALLY_ELIGIBLE">CONDITIONALLY</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Opportunities Table View */}
            {loading ? (
              <div className="text-center py-20 font-bold uppercase tracking-wider text-muted-foreground">
                Parsing placement drives database...
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
                        <th className="py-4 px-6">FIT & READINESS</th>
                        <th className="py-4 px-6">TRACKING STAGE</th>
                        <th className="py-4 px-6 text-right">ACTION</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredCompanies.map((c) => {
                        const app = applications[c.id];
                        const oppState = opportunityStates[c.id];
                        const effectiveState = oppState?.state;
                        const activeStatus = app ? app.status : "";
                        const deadlineDate = c.registration_deadline ? new Date(c.registration_deadline) : null;
                        const isDeadlinePast = deadlineDate ? deadlineDate < new Date() : false;
                        const isAppSnoozed = app ? isSnoozed(app) : false;
                        const isRowChecked = selectedCompanyIds.includes(c.id);
                        const isArchived = effectiveState === 'archived' || effectiveState === 'auto_archived';
                        
                        return (
                          <tr key={c.id} className={`hover:bg-muted/15 transition-colors ${isRowChecked ? 'bg-accent/5' : ''} ${isArchived ? 'opacity-60' : ''}`}>
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
                              onClick={() => { setSelectedCompany(c); setModalTab("overview"); }}
                            >
                              <div className="flex items-center gap-2">
                                <p className="font-bold text-base uppercase tracking-tighter text-foreground group-hover:text-accent transition-colors">{c.name}</p>
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
                                  <p className="text-xs font-bold uppercase">{deadlineDate.toLocaleDateString("en-IN", { day: '2-digit', month: 'short' })}</p>
                                  <p className="text-[10px] text-muted-foreground">{deadlineDate.toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' })}</p>
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>

                            <td className="py-5 px-6">
                              {getEligibilityIcon(c.eligibility_status)}
                              {c.eligibility_reason && (
                                <p className="text-[10px] text-muted-foreground max-w-xs mt-1 leading-normal uppercase">
                                  {c.eligibility_reason}
                                </p>
                              )}
                            </td>

                            <td className="py-5 px-6 font-mono text-[10px] font-bold space-y-0.5">
                              <p>MATCH: <span className="text-accent">{app?.match_score > 0 ? `${app.match_score}%` : '0%'}</span></p>
                              <p>PREP: <span className="text-foreground">{getPrepScore(c)}%</span></p>
                            </td>

                            <td className="py-5 px-6">
                              {app ? (
                                <div className="flex flex-col gap-1 items-start">
                                  <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${getStatusColor(activeStatus)}`}>
                                    {activeStatus}
                                  </span>
                                  {isAppSnoozed && (
                                    <span className="text-[8px] font-bold text-amber-500 uppercase flex items-center gap-0.5">
                                      <Clock size={8} /> SNOOZED
                                    </span>
                                  )}
                                  {app.user_decision === 'archived' && (
                                    <span className="text-[8px] font-bold text-muted-foreground uppercase">ARCHIVED</span>
                                  )}
                                </div>
                              ) : effectiveState === 'decision_pending' ? (
                                <span className="text-[9px] font-black text-amber-400 uppercase px-2 py-0.5 bg-amber-950/40 border border-amber-500/50">
                                  ⏰ DECISION PENDING
                                </span>
                              ) : effectiveState === 'archived' || effectiveState === 'auto_archived' ? (
                                <span className="text-[9px] font-bold text-muted-foreground uppercase px-2 py-0.5 bg-muted border border-border">
                                  📦 {effectiveState === 'auto_archived' ? 'AUTO-ARCHIVED' : 'ARCHIVED'}
                                </span>
                              ) : isDeadlinePast ? (
                                <span className="text-[9px] font-bold text-red-400 uppercase">EXPIRED</span>
                              ) : (
                                <span className="text-xs text-muted-foreground uppercase">NOT TRACKING</span>
                              )}
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
                                ) : effectiveState === 'decision_pending' ? (
                                  // Decision pending: show quick decision buttons
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleOpportunityAction(c.id, 'track')}
                                      className="h-10 px-3 border-2 border-accent bg-accent text-black text-xs font-bold tracking-wider uppercase hover:bg-accent/80 transition-all"
                                    >
                                      ✅ Applied
                                    </button>
                                    <button
                                      onClick={() => handleOpportunityAction(c.id, 'archive')}
                                      className="h-10 px-3 border-2 border-border bg-background text-xs font-bold tracking-wider uppercase hover:bg-muted transition-all"
                                    >
                                      ✗ Skip
                                    </button>
                                  </div>
                                ) : encryptionKey ? (
                                  <div className="relative inline-block text-left group">
                                    <button className="h-10 px-4 border-2 border-border bg-background hover:bg-muted text-xs font-bold tracking-wider uppercase flex items-center gap-2">
                                      <span>{app && app.user_decision === 'tracking' ? "UPDATE ROUND" : "TRACK WORKSPACE"}</span>
                                      <ChevronDown size={12} />
                                    </button>
                                    <div className="absolute right-0 bottom-full z-10 mb-1 w-44 border-2 border-black bg-background py-1 hidden group-hover:block hover:block">
                                      {["Applied", "Shortlisted", "OA", "Technical", "HR", "Offer", "Rejected"].map((s) => (
                                        <button
                                          key={s}
                                          onClick={() => handleUpdateApplication(c.id, { 
                                            status: s,
                                            current_round: s,
                                            user_decision: 'tracking' 
                                          })}
                                          className={`
                                            w-full text-left px-4 py-2 text-xs font-bold uppercase tracking-wider
                                            ${activeStatus === s && app?.user_decision === 'tracking' ? "bg-accent text-black" : "hover:bg-muted text-foreground"}
                                          `}
                                        >
                                          {s}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}

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

        {/* ==================== 3. ACTIVE TRACKING TAB ==================== */}
        {activeTab === "tracking" && (
          <div className="space-y-12">
            <div className="flex justify-between items-center border-b-2 border-border pb-6">
              <div className="space-y-1">
                <h1 className="text-[clamp(2rem,6vw,4rem)] font-extrabold tracking-tighter uppercase leading-none">
                  ACTIVE TRACKING
                </h1>
                <p className="text-xs text-muted-foreground uppercase tracking-widest">
                  Kanban workflow for active application tracking workspaces
                </p>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => setFocusMode(!focusMode)}
                  className={`
                    flex items-center gap-2 px-6 h-12 border-2 font-bold text-xs tracking-wider transition-all uppercase
                    ${focusMode 
                      ? "bg-accent border-black text-black animate-pulse" 
                      : "border-border hover:bg-muted text-muted-foreground"
                    }
                  `}
                >
                  <span>📌 FOCUS MODE: {focusMode ? "ON" : "OFF"}</span>
                </button>
              </div>
            </div>

            {loading ? (
              <div className="text-center py-20 font-bold uppercase tracking-wider text-muted-foreground">
                Loading workspace tracker board...
              </div>
            ) : filteredCompanies.length === 0 ? (
              <div className="text-center py-20 border-2 border-dashed border-border text-muted-foreground font-bold uppercase tracking-wider text-xs">
                {focusMode 
                  ? "No focus/pinned applications in active tracking. Pin workspaces to display them in focus mode."
                  : "No companies currently in active tracking. Go to the Opportunities board to start tracking drives."}
              </div>
            ) : (
              /* Kanban View Mode with HTML5 Drag-and-Drop */
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-6 items-start">
                {KANBAN_COLUMNS.map((col) => {
                  const columnApps = filteredCompanies.filter((c) => {
                    const app = applications[c.id];
                    if (!app) return false;
                    const activeStatus = app.status || "Applied";
                    
                    if (col.id === "Applied") return activeStatus === "Applied";
                    if (col.id === "Shortlisted") return activeStatus === "Shortlisted";
                    if (col.id === "OA") return activeStatus === "OA" || activeStatus === "Online Assessment";
                    if (col.id === "Technical") return activeStatus === "Technical" || activeStatus.includes("Technical");
                    if (col.id === "HR") return activeStatus === "HR" || activeStatus.includes("HR");
                    if (col.id === "Offer") return activeStatus === "Offer" || activeStatus.includes("Offer");
                    return false;
                  });

                  const isOver = draggedOverColumn === col.id;

                  return (
                    <div 
                      key={col.id}
                      onDragOver={(e) => handleDragOver(e, col.id)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, col.id)}
                      className={`
                        border-2 p-4 min-h-[500px] flex flex-col gap-4 transition-all duration-200
                        ${isOver ? "border-accent bg-accent/5 scale-[1.02]" : "border-border bg-muted/10"}
                      `}
                    >
                      {/* Column Header */}
                      <div className="border-b-2 border-border pb-2 flex justify-between items-center bg-background p-2">
                        <span className="text-xs font-black tracking-wider uppercase truncate max-w-[85%]">
                          {col.name}
                        </span>
                        <span className="h-5 w-5 bg-muted text-[10px] font-bold flex items-center justify-center border border-border">
                          {columnApps.length}
                        </span>
                      </div>

                      {/* Column Cards */}
                      <div className="flex-1 space-y-4 overflow-y-auto max-h-[600px] pr-1">
                        {columnApps.length === 0 ? (
                          <div className="text-center py-12 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                            DRAG HERE
                          </div>
                        ) : (
                          columnApps.map((c) => {
                            const app = applications[c.id];
                            const risk = getRiskLevel(app, c);
                            const isPinned = app.workspace_priority_override === 'pinned';

                            return (
                              <div
                                key={c.id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, c.id)}
                                className="border-2 border-border p-4 bg-background hover:border-accent cursor-grab active:cursor-grabbing group transition-all duration-300 relative space-y-3"
                              >
                                <div className="flex justify-between items-start">
                                  <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 bg-muted border border-border text-foreground">
                                    {c.category}
                                  </span>
                                  <button
                                    onClick={() => handleUpdateApplication(c.id, {
                                      workspace_priority_override: isPinned ? null : 'pinned'
                                    })}
                                    className="text-muted-foreground hover:text-accent transition-colors"
                                    title={isPinned ? "Unpin workspace" : "Pin workspace"}
                                  >
                                    <Pin size={10} className={isPinned ? "fill-accent stroke-accent" : ""} />
                                  </button>
                                </div>

                                <div onClick={() => { setSelectedCompany(c); setModalTab("overview"); }} className="cursor-pointer">
                                  <h4 className="font-extrabold text-sm uppercase tracking-tighter text-foreground truncate group-hover:text-accent transition-colors">
                                    {c.name}
                                  </h4>
                                  <p className="text-[10px] text-muted-foreground uppercase truncate">
                                    {c.role}
                                  </p>
                                </div>

                                {/* Transition recruitment_state Sub-state badge */}
                                {app.recruitment_state && app.recruitment_state !== app.status && (
                                  <div className="text-[8px] font-black uppercase text-accent border border-accent/30 bg-accent/5 px-2 py-0.5 w-max">
                                    ⏳ {app.recruitment_state}
                                  </div>
                                )}

                                {/* Stale Flag */}
                                {app.is_stale && (
                                  <div className="text-[8px] font-black uppercase text-red-500 border border-red-500/30 bg-red-500/5 px-2 py-0.5 w-max animate-pulse">
                                    ⚠️ No updates: 30 days
                                  </div>
                                )}

                                {/* Risk Level Badge */}
                                {risk !== 'low' && (
                                  <div className={`text-[8px] font-black uppercase border px-2 py-0.5 w-max ${
                                    risk === 'high' ? 'bg-red-950 border-red-500 text-red-400' : 'bg-amber-950 border-amber-500 text-amber-400'
                                  }`}>
                                    {risk === 'high' ? '🔴 HIGH RISK' : '🟡 NEEDS ATTENTION'}
                                  </div>
                                )}

                                <div className="border-t border-border pt-2 flex justify-between items-center text-[9px] font-bold text-muted-foreground uppercase">
                                  <span>{c.ctc || "—"}</span>
                                  <span>Priority: {app.priority_score}</span>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
                    <div className="text-center py-12 text-muted-foreground font-bold">Loading records...</div>
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
                                <tr key={c.id} className="hover:bg-muted/15 transition-colors">
                                  <td className="py-4 px-6 cursor-pointer" onClick={() => { setSelectedCompany(c); setModalTab("overview"); }}>
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
              🎯 Track Selected
            </button>
            <button
              onClick={() => handleBulkAction("interested")}
              className="h-9 px-4 border border-border bg-transparent text-foreground font-bold text-xs hover:bg-muted uppercase tracking-wider transition-all"
            >
              🎯 Mark Interested
            </button>
            <button
              onClick={() => handleBulkAction("archived")}
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
                        <td key={id} className="py-4 px-6 border-r border-border space-y-1.5">
                          {comp ? (
                            <>
                              <div className="flex items-center gap-1.5">
                                {getEligibilityIcon(comp.eligibility_status)}
                              </div>
                              {comp.eligibility_reason && (
                                <p className="text-[9px] text-muted-foreground leading-normal max-w-xs">{comp.eligibility_reason}</p>
                              )}
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

              <button
                onClick={() => setSelectedCompany(null)}
                className="hidden md:block h-14 border-t border-border bg-muted/30 hover:bg-red-650 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest"
              >
                CLOSE WORKSPACE
              </button>
            </div>

            {/* Right Content Pane */}
            <div className="flex-1 flex flex-col min-h-0 bg-background relative">
              <button
                onClick={() => setSelectedCompany(null)}
                className="absolute top-4 right-4 z-10 border border-border p-2 bg-card hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95 md:hidden"
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
                    <div className="border-b border-border pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <h2 className="text-2xl font-black uppercase tracking-tighter leading-none">{selectedCompany.name} Workspace</h2>
                        <p className="text-xs text-muted-foreground uppercase mt-1">{selectedCompany.role} ✦ {selectedCompany.job_location || "Unknown location"}</p>
                      </div>
                      <span className="bg-accent px-2 py-0.5 border border-accent text-[9px] font-black text-black uppercase w-max">
                        {selectedCompany.category}
                      </span>
                    </div>

                    {/* Specifications Grid */}
                    <div className="border-2 border-border p-5 bg-muted/5 space-y-4">
                      <h4 className="text-xs font-black tracking-widest text-accent uppercase">
                        📋 Placement Specifications
                      </h4>
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
                            {selectedCompany.eligibility_rules?.date_of_visit || "Will be announced later"}
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
                            {selectedCompany.eligibility_rules?.min_cgpa ? `>= ${selectedCompany.eligibility_rules.min_cgpa}` : "N/A"}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[9px] font-black text-muted-foreground uppercase block">History of Arrears</span>
                          <span className="text-sm font-bold text-foreground block">
                            {selectedCompany.eligibility_rules?.requires_no_arrears ? "No Active Backlogs" : "Backlogs Allowed"}
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

                    {/* Collapsible Action & Health Accordion */}
                    <div className="border-2 border-border overflow-hidden">
                      <button
                        onClick={() => setIsPrepPanelExpanded(!isPrepPanelExpanded)}
                        className="w-full flex items-center justify-between p-4 bg-muted/10 hover:bg-muted/20 transition-all text-left"
                      >
                        <span className="text-xs font-black tracking-widest text-foreground uppercase flex items-center gap-2">
                          ⚡ PREPARATION TOOLKIT & HEALTH STATUS
                        </span>
                        <span className="text-muted-foreground">
                          {isPrepPanelExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </span>
                      </button>
                      
                      {isPrepPanelExpanded && (
                        <div className="p-5 border-t border-border bg-background grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch animate-in slide-in-from-top-1 duration-200">
                          {/* Next Action */}
                          <div className="md:col-span-8 border border-border p-4 bg-gradient-to-r from-accent/5 to-transparent relative overflow-hidden flex flex-col justify-between">
                            <div className="absolute -right-12 -top-12 w-32 h-32 bg-accent/10 rounded-full blur-2xl" />
                            <span className="text-[9px] font-black tracking-widest text-accent uppercase block">⚡ NEXT RECOMMENDATION</span>
                            <p className="text-sm font-bold text-foreground uppercase leading-relaxed mt-2 relative z-10">
                              👉 {selectedNextAction}
                            </p>
                          </div>

                          {/* Application Health Score */}
                          <div className="md:col-span-4 border border-border p-4 bg-muted/5 flex items-center justify-between">
                            <div>
                              <span className="text-[9px] font-black tracking-widest text-muted-foreground uppercase block">HEALTH SCORE</span>
                              <span className="text-xs font-bold text-muted-foreground uppercase block mt-1">Application readiness</span>
                            </div>
                            {selectedApp ? (
                              <div className="relative flex items-center justify-center h-16 w-16">
                                <svg className="w-full h-full transform -rotate-90">
                                  <circle
                                    cx="32"
                                    cy="32"
                                    r={radius}
                                    className="stroke-muted"
                                    strokeWidth="5"
                                    fill="transparent"
                                  />
                                  <circle
                                    cx="32"
                                    cy="32"
                                    r={radius}
                                    className="stroke-accent transition-all duration-500"
                                    strokeWidth="5"
                                    fill="transparent"
                                    strokeDasharray={circumference}
                                    strokeDashoffset={strokeDashoffset}
                                  />
                                </svg>
                                <span className="absolute text-xs font-black">{healthVal}%</span>
                              </div>
                            ) : (
                              <span className="text-xs font-bold text-muted-foreground uppercase">NOT TRACKED</span>
                            )}
                          </div>
                        </div>
                      )}
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
                              <button
                                onClick={() => setExpandedEmailId(expandedEmailId === evt.id ? null : evt.id)}
                                className="text-[9px] font-bold text-accent hover:underline uppercase border border-border px-2.5 py-1 bg-background"
                              >
                                {expandedEmailId === evt.id ? "Hide Source" : "View Source Email"}
                              </button>
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
                              <div className="border border-border/80 p-4 bg-muted/20 font-mono text-[10px] leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto border-dashed">
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
                    <div className="border-b border-border pb-4">
                      <h2 className="text-2xl font-black uppercase tracking-tighter">Placement Specifications</h2>
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
                          {getEligibilityIcon(selectedCompany.eligibility_status)}
                          <span className="text-xs font-bold uppercase">{selectedCompany.eligibility_status}</span>
                        </div>
                        {selectedCompany.eligibility_reason && (
                          <p className="text-[10px] text-muted-foreground uppercase leading-snug">
                            {selectedCompany.eligibility_reason}
                          </p>
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

                    {/* Full JD text */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-black tracking-wider uppercase text-muted-foreground">JOB DESCRIPTION</h4>
                      <div className="border border-border p-4 bg-muted/10 max-h-60 overflow-y-auto rounded-none font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-foreground">
                        {selectedCompany.jd_text || "No detailed job description text loaded."}
                      </div>
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
                          {selectedCompany.eligibility_status === 'ELIGIBLE' ? '100%' : '50%'}
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
                      
                      <div>
                        <Link
                          href={`/ai-toolkit?companyId=${selectedCompany.id}&tab=ats`}
                          className="flex items-center justify-between border border-border p-4 bg-muted/15 hover:bg-accent hover:text-black hover:border-accent transition-all uppercase w-full"
                        >
                          <span className="text-xs font-black tracking-wider">Tailor & Optimize Resume</span>
                          <ArrowRight size={14} />
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
