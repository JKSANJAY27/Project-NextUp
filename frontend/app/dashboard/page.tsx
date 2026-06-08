"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useAppStore } from "@/lib/store";
import { decryptData, encryptData } from "@/lib/crypto";
import api from "@/lib/api";
import { 
  Plus, 
  Lock, 
  CheckCircle, 
  XCircle, 
  HelpCircle,
  ExternalLink,
  ChevronDown,
  LayoutDashboard,
  Table as TableIcon
} from "lucide-react";

interface CompanyWithEligibility {
  id: string;
  name: string;
  category: string;
  role: string;
  ctc: string;
  stipend: string;
  job_location: string;
  eligible_branches: string[] | null;
  min_cgpa: number | null;
  min_tenth: number | null;
  min_twelfth: number | null;
  requires_no_arrears: boolean;
  registration_deadline: string | null;
  visit_date: string | null;
  registration_link: string | null;
  website: string | null;
  jd_text: string | null;
  eligibility_status: string;
  eligibility_reason: string | null;
}

interface Application {
  id: string;
  company_id: string;
  status_enc: string;
  current_round: string;
  notes_enc: string | null;
  match_score: number;
}

const KANBAN_COLUMNS = [
  { id: "Applied", name: "APPLIED" },
  { id: "Shortlisted", name: "SHORTLISTED" },
  { id: "OA", name: "ONLINE ASSESSMENT" },
  { id: "Technical", name: "TECHNICAL INTERVIEW" },
  { id: "HR", name: "HR INTERVIEW" },
  { id: "Offer", name: "OFFER RECEIVED" }
];

export default function DashboardPage() {
  const { user, encryptionKey } = useAppStore();
  const [companies, setCompanies] = useState<CompanyWithEligibility[]>([]);
  const [applications, setApplications] = useState<Record<string, Application>>({});
  const [decryptedStatuses, setDecryptedStatuses] = useState<Record<string, string>>({});
  
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"table" | "kanban">("table");
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [filterCategory, setFilterCategory] = useState("ALL");
  const [filterEligibility, setFilterEligibility] = useState("ALL");
  const [onlyShowApplied, setOnlyShowApplied] = useState(false);
  const [draggedOverColumn, setDraggedOverColumn] = useState<string | null>(null);

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
      // Fetch companies
      const compRes = await api.get("/companies");
      setCompanies(compRes.data);

      // Fetch applications
      const appRes = await api.get("/applications");
      const appMap: Record<string, Application> = {};
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appRes.data.forEach((app: any) => {
        appMap[app.company_id] = {
          id: app.id,
          company_id: app.company_id,
          status_enc: app.status_enc,
          current_round: app.current_round,
          notes_enc: app.notes_enc,
          match_score: app.match_score
        };
      });
      setApplications(appMap);
    } catch (err) {
      console.error("Error fetching dashboard data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [encryptionKey]);

  // Decrypt application statuses when encryptionKey or applications change
  useEffect(() => {
    const decryptAll = async () => {
      if (!encryptionKey) return;
      const decMap: Record<string, string> = {};
      for (const compId in applications) {
        const app = applications[compId];
        try {
          const decStatus = await decryptData(app.status_enc, encryptionKey);
          decMap[compId] = decStatus;
        } catch {
          decMap[compId] = "DECRYPT ERROR";
        }
      }
      setDecryptedStatuses(decMap);
    };

    decryptAll();
  }, [applications, encryptionKey]);

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

      await api.post("/companies", {
        name: compName.trim(),
        category: compCategory,
        role: compRole.trim(),
        ctc: compCtc.trim() || null,
        stipend: compStipend.trim() || null,
        job_location: compLocation.trim() || null,
        eligible_branches: branchesArray.length > 0 ? branchesArray : null,
        min_cgpa: compMinCgpa ? parseFloat(compMinCgpa) : null,
        requires_no_arrears: compRequiresNoArrears,
        registration_deadline: compDeadline ? new Date(compDeadline).toISOString() : null,
        registration_link: compRegLink.trim() || null,
        jd_text: compJd.trim() || null
      });

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
      setFormError(err.response?.data?.detail || "FAILED TO CREATE DRIVE.");
    }
  };

  // Create or Update Application Status
  const handleStatusChange = async (companyId: string, newStatus: string) => {
    if (!encryptionKey) {
      alert("UNSEAL YOUR VAULT FIRST TO TRACK APPLICATIONS.");
      return;
    }

    try {
      const encStatus = await encryptData(newStatus, encryptionKey);
      const app = applications[companyId];

      if (app) {
        // Update existing application
        const res = await api.patch(`/applications/${app.id}`, {
          status_enc: encStatus,
          current_round: newStatus
        });
        
        setApplications(prev => ({
          ...prev,
          [companyId]: {
            ...prev[companyId],
            status_enc: res.data.status_enc,
            current_round: res.data.current_round
          }
        }));
      } else {
        // Create new application
        const res = await api.post("/applications", {
          company_id: companyId,
          status_enc: encStatus,
          current_round: newStatus
        });
        
        setApplications(prev => ({
          ...prev,
          [companyId]: {
            id: res.data.id,
            company_id: companyId,
            status_enc: res.data.status_enc,
            current_round: res.data.current_round,
            notes_enc: res.data.notes_enc,
            match_score: res.data.match_score
          }
        }));
      }
    } catch {
      alert("FAILED TO UPDATE TRACKING STATUS.");
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
    setDraggedOverColumn(null);
    const companyId = e.dataTransfer.getData("text/plain");
    if (companyId) {
      await handleStatusChange(companyId, colId);
    }
  };

  // Filters application
  const filteredCompanies = companies.filter((c) => {
    if (filterCategory !== "ALL" && c.category !== filterCategory) return false;
    if (filterEligibility !== "ALL" && c.eligibility_status !== filterEligibility) return false;
    
    const hasApplied = !!applications[c.id];
    if (onlyShowApplied && !hasApplied) return false;
    
    return true;
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
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getEligibilityIcon = (status: string) => {
    switch (status) {
      case "ELIGIBLE": 
        return <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 border border-emerald-600 px-2 py-0.5"><CheckCircle size={12} /> ELIGIBLE</span>;
      case "NOT_ELIGIBLE": 
        return <span className="flex items-center gap-1.5 text-xs font-bold text-red-600 border border-red-600 px-2 py-0.5"><XCircle size={12} /> INELIGIBLE</span>;
      default: 
        return <span className="flex items-center gap-1.5 text-xs font-bold text-amber-500 border border-amber-500 px-2 py-0.5"><HelpCircle size={12} /> CHECK</span>;
    }
  };

  return (
    <div className="flex-1 bg-background flex flex-col">
      
      {/* High-energy stats scrolling marquee */}
      <div className="border-b-2 border-border bg-accent py-3 overflow-hidden select-none">
        <div className="flex w-max animate-marquee">
          {Array(4).fill(0).map((_, i) => (
            <div key={i} className="flex items-center gap-16 text-black font-extrabold text-sm tracking-widest uppercase shrink-0 pr-16">
              <span>ACTIVE COMPANIES: {companies.length}</span>
              <span>✦</span>
              <span>MY APPLICATIONS: {Object.keys(applications).length}</span>
              <span>✦</span>
              <span>E2E DECRYPTION ACTIVE: {encryptionKey ? "YES" : "NO"}</span>
              <span>✦</span>
              <span>UNIVERSITY SENDER: {user?.email || "CDC@VIT.AC.IN"}</span>
              <span>✦</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main Container */}
      <div className="p-8 md:p-12 space-y-12 flex-1">
        
        {/* Header Block */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b-2 border-border pb-8">
          <div className="space-y-2">
            <h1 className="text-[clamp(2rem,6vw,4rem)] font-extrabold tracking-tighter uppercase leading-none">
              JOB DRIVES
            </h1>
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
              Track university placements, eligibility criteria, and application stages
            </p>
          </div>
          
          <button 
            onClick={() => setShowAddCompany(!showAddCompany)}
            className="flex items-center justify-center gap-2 h-14 px-6 border-2 border-border bg-foreground text-background font-extrabold tracking-wider hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95 uppercase text-sm"
          >
            <Plus size={16} />
            <span>MANUAL DRIVE CREATION</span>
          </button>
        </div>

        {/* Lock Warning Banner */}
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

        {/* Manual Drive Creation Form block */}
        {showAddCompany && (
          <div className="border-2 border-border p-8 bg-muted/10 space-y-6">
            <h2 className="text-2xl font-bold tracking-tighter uppercase">
              CREATE NEW DRIVE ANNOUNCEMENT
            </h2>

            {formError && (
              <div className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-600 uppercase tracking-wider">
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

        {/* Filters Panel & View Toggle */}
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

          <div className="flex flex-col sm:flex-row gap-4 items-stretch">
            {/* View Mode Toggle */}
            <div className="flex border-2 border-border p-1 bg-background shrink-0">
              <button
                onClick={() => setViewMode("table")}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
                  viewMode === "table" ? "bg-accent text-black" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <TableIcon size={14} />
                <span>TABLE</span>
              </button>
              <button
                onClick={() => setViewMode("kanban")}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
                  viewMode === "kanban" ? "bg-accent text-black" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayoutDashboard size={14} />
                <span>KANBAN</span>
              </button>
            </div>

            {/* Toggle Applied */}
            <button 
              onClick={() => setOnlyShowApplied(!onlyShowApplied)}
              className={`
                flex items-center justify-center gap-2 px-6 h-12 border-2 font-bold text-xs tracking-wider transition-all uppercase
                ${onlyShowApplied 
                  ? "bg-accent border-black text-black" 
                  : "border-border hover:bg-muted text-muted-foreground"
                }
              `}
            >
              <span>SHOW ONLY APPLIED</span>
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        {loading ? (
          <div className="text-center py-20 font-bold uppercase tracking-wider text-muted-foreground">
            Decrypting & parsing placement database...
          </div>
        ) : filteredCompanies.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-border font-bold uppercase tracking-wider text-muted-foreground">
            No active placement drives match the current filter criteria.
          </div>
        ) : viewMode === "table" ? (
          
          /* Table View Mode */
          <div className="border-2 border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-border bg-muted/30 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
                    <th className="py-4 px-6">COMPANY / ROLE</th>
                    <th className="py-4 px-6">CATEGORY</th>
                    <th className="py-4 px-6">CTC / STIPEND</th>
                    <th className="py-4 px-6">DEADLINE</th>
                    <th className="py-4 px-6">ELIGIBILITY</th>
                    <th className="py-4 px-6">TRACKING STAGE</th>
                    <th className="py-4 px-6 text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredCompanies.map((c) => {
                    const app = applications[c.id];
                    const decStatus = app ? (decryptedStatuses[c.id] || "Applied") : "";
                    const deadlineDate = c.registration_deadline ? new Date(c.registration_deadline) : null;
                    
                    return (
                      <tr key={c.id} className="hover:bg-muted/15 transition-colors">
                        
                        <td className="py-5 px-6">
                          <p className="font-bold text-base uppercase tracking-tighter text-foreground">{c.name}</p>
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

                        <td className="py-5 px-6">
                          {app ? (
                            encryptionKey ? (
                              <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-1 ${getStatusColor(decStatus)}`}>
                                {decStatus}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 bg-muted border border-border text-muted-foreground">
                                <Lock size={10} /> ENCRYPTED
                              </span>
                            )
                          ) : (
                            <span className="text-xs text-muted-foreground uppercase">NOT APPLIED</span>
                          )}
                        </td>

                        <td className="py-5 px-6 text-right">
                          <div className="flex justify-end gap-3 items-center">
                            {encryptionKey ? (
                              <div className="relative inline-block text-left group">
                                <button className="h-10 px-4 border-2 border-border bg-background hover:bg-muted text-xs font-bold tracking-wider uppercase flex items-center gap-2">
                                  <span>{app ? "UPDATE ROUND" : "TRACK ROUND"}</span>
                                  <ChevronDown size={12} />
                                </button>
                                <div className="absolute right-0 bottom-full z-10 mb-1 w-44 border-2 border-black bg-background py-1 hidden group-hover:block hover:block">
                                  {["Applied", "Shortlisted", "OA", "Technical", "HR", "Offer", "Rejected"].map((s) => (
                                    <button
                                      key={s}
                                      onClick={() => handleStatusChange(c.id, s)}
                                      className={`
                                        w-full text-left px-4 py-2 text-xs font-bold uppercase tracking-wider
                                        ${decStatus === s ? "bg-accent text-black" : "hover:bg-muted text-foreground"}
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
        ) : (
          
          /* Kanban View Mode with HTML5 Drag-and-Drop */
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-6 items-start">
            {KANBAN_COLUMNS.map((col) => {
              // Get applications belonging to this column
              const columnApps = filteredCompanies.filter((c) => {
                const app = applications[c.id];
                if (!app) return false;
                const decStatus = decryptedStatuses[c.id] || "Applied";
                
                // Group both OA/Assessment under OA, Interview under Technical, etc.
                if (col.id === "Applied") return decStatus === "Applied";
                if (col.id === "Shortlisted") return decStatus === "Shortlisted";
                if (col.id === "OA") return decStatus === "OA" || decStatus === "Online Assessment";
                if (col.id === "Technical") return decStatus === "Technical" || decStatus.includes("Technical Interview");
                if (col.id === "HR") return decStatus === "HR" || decStatus.includes("HR Interview");
                if (col.id === "Offer") return decStatus === "Offer" || decStatus.includes("Offer Received");
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
                    <span className="text-xs font-black tracking-wider uppercase truncate max-w-[80%]">
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
                        return (
                          <div
                            key={c.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, c.id)}
                            className="border-2 border-border p-4 bg-background hover:border-accent cursor-grab active:cursor-grabbing group transition-all duration-300"
                          >
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 bg-muted border border-border text-foreground">
                                {c.category}
                              </span>
                              {app.match_score > 0 && (
                                <span className="text-[9px] font-black text-accent bg-black border border-accent px-1.5 py-0.5">
                                  {app.match_score}% MATCH
                                </span>
                              )}
                            </div>

                            <h4 className="font-extrabold text-sm uppercase tracking-tighter text-foreground truncate group-hover:text-accent transition-colors">
                              {c.name}
                            </h4>
                            <p className="text-[10px] text-muted-foreground uppercase truncate mb-3">
                              {c.role}
                            </p>

                            <div className="border-t border-border pt-2 flex justify-between items-center text-[10px] font-bold text-muted-foreground uppercase">
                              <span>{c.ctc || "—"}</span>
                              {c.job_location && <span className="truncate max-w-[50%]">{c.job_location}</span>}
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
    </div>
  );
}
