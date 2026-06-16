/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */

"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAppStore } from "@/lib/store";
import api from "@/lib/api";
import {
  Sparkles,
  Save,
  Check,
  AlertCircle,
  Loader2,
  ArrowLeft,
  Copy,
  Download,
  Play,
  Target,
  CheckCircle,
  FileText,
  Briefcase,
  GraduationCap,
  FolderKanban,
  Wrench,
  ChevronRight
} from "lucide-react";
import {
  generateInBrowser,
  isGeminiNanoAvailable,
  BrowserModelType
} from "@/lib/ai-client";
import {
  extractKeywords,
  segmentTextByKeywords,
  calculateMatchStats
} from "@/lib/utils/keyword-matcher";

interface Company {
  id: string;
  name: string;
  role: string;
  category: string;
  ctc: string | null;
  stipend: string | null;
  job_location: string | null;
  jd_text: string | null;
  jd_required_skills: string[] | null;
  jd_preferred_skills: string[] | null;
  jd_ats_keywords: string[] | null;
  interview_topics: string[] | null;
}

interface ATSResult {
  ats_score: number;
  missing_keywords: string[];
  improvements: string[];
  tailored_resume: {
    optimized_skills: string[];
    optimized_projects: Array<{ title: string; description: string }>;
    optimized_summary: string;
  };
}

interface DocumentVersion {
  version: number;
  content: string;
  created_at: string;
}

interface InterviewPrep {
  technical: string[];
  hr: string[];
  company_specific: string[];
}

function AIToolkitContent() {
  const searchParams = useSearchParams();
  const { user } = useAppStore();
  
  const queryCompanyId = searchParams.get("companyId");
  
  const [companyId, setCompanyId] = useState<string>(queryCompanyId || "");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  
  const [activeTab, setActiveTab] = useState<"ats" | "sop" | "cl" | "prep">("ats");
  const [loading, setLoading] = useState(true);
  
  // ATS Matrix State
  const [atsResult, setAtsResult] = useState<ATSResult | null>(null);
  const [calculatingATS, setCalculatingATS] = useState(false);
  const [atsSource, setAtsSource] = useState<"browser" | "cloud">("browser");
  const [atsModel, setAtsModel] = useState<BrowserModelType>("qwen-0.5b");
  const [optimizerSubView, setOptimizerSubView] = useState<"tailored" | "highlight">("tailored");
  const [masterResume, setMasterResume] = useState<any>(null);

  // SOP State
  const [sopContent, setSopContent] = useState("");
  const [sopSource, setSopSource] = useState<"browser" | "cloud">("browser");
  const [sopModel, setSopModel] = useState<BrowserModelType>("qwen-0.5b");
  const [sopPrompt, setSopPrompt] = useState("");
  const [generatingSOP, setGeneratingSOP] = useState(false);
  const [sopVersions, setSopVersions] = useState<DocumentVersion[]>([]);
  
  // Cover Letter State
  const [clContent, setClContent] = useState("");
  const [clSource, setClSource] = useState<"browser" | "cloud">("browser");
  const [clModel, setClModel] = useState<BrowserModelType>("qwen-0.5b");
  const [clPrompt, setClPrompt] = useState("");
  const [generatingCL, setGeneratingCL] = useState(false);
  const [clVersions, setClVersions] = useState<DocumentVersion[]>([]);
  
  // Interview Prep State
  const [generatingPrep, setGeneratingPrep] = useState(false);
  const [prepData, setPrepData] = useState<InterviewPrep | null>(null);
  
  // Common loading / error states
  const [savingDoc, setSavingDoc] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  
  // Browser AI capability state
  const [geminiAvailable, setGeminiAvailable] = useState(false);
  const [localDownloadProgress, setLocalDownloadProgress] = useState<number | null>(null);
  const [localStatusMessage, setLocalStatusMessage] = useState("");

  // Load companies & initial details
  useEffect(() => {
    async function initPage() {
      try {
        setLoading(true);
        // Check local Gemini Nano availability
        const nano = await isGeminiNanoAvailable();
        setGeminiAvailable(nano);
        if (nano) {
          setSopModel("gemini-nano");
          setClModel("gemini-nano");
          setAtsModel("gemini-nano");
        }

        // Fetch list of companies
        const res = await api.get("/companies");
        setCompanies(res.data);

        if (companyId) {
          await loadCompanyData(companyId);
        } else if (res.data.length > 0) {
          // Default to first company if none specified
          setCompanyId(res.data[0].id);
          await loadCompanyData(res.data[0].id);
        } else {
          setLoading(false);
        }
      } catch (err: any) {
        console.error("Initialization failed", err);
        setErrorMsg("Failed to initialize placement toolkit.");
        setLoading(false);
      }
    }
    initPage();
  }, []);

  // Handle manual selection change
  useEffect(() => {
    if (companyId && companies.length > 0) {
      loadCompanyData(companyId);
    }
  }, [companyId]);

  const fetchMasterResume = async () => {
    try {
      const res = await api.get("/resumes/me");
      if (res.data && res.data.resume_data) {
        setMasterResume(res.data.resume_data);
      }
    } catch (err) {
      console.error("Failed to load master resume:", err);
    }
  };

  const loadCompanyData = async (id: string) => {
    try {
      setLoading(true);
      setErrorMsg("");
      const compRes = await api.get(`/companies/${id}`);
      setCompany(compRes.data);
      
      // Reset generated data when changing company
      setAtsResult(null);
      setSopContent("");
      setClContent("");
      setPrepData(null);
      
      // Load current document drafts for the company and master resume
      await Promise.all([
        fetchLatestDraft(id, "sop"),
        fetchLatestDraft(id, "cover_letter"),
        fetchDocumentVersions(id, "sop"),
        fetchDocumentVersions(id, "cover_letter"),
        fetchMasterResume()
      ]);
      
      // Run deterministic ATS Match and fetch Interview Prep deterministically first
      await runDeterministicATS(compRes.data);
      await fetchDeterministicPrep(compRes.data);
      
      setLoading(false);
    } catch (err: any) {
      console.error("Failed to load company details", err);
      setErrorMsg("Failed to load details for the selected company.");
      setLoading(false);
    }
  };

  const fetchLatestDraft = async (compId: string, type: "sop" | "cover_letter") => {
    try {
      const res = await api.get(`/ai/documents/latest?company_id=${compId}&doc_type=${type}`);
      if (res.data && res.data.content) {
        if (type === "sop") setSopContent(res.data.content);
        else setClContent(res.data.content);
      }
    } catch {
      console.warn(`No active draft for ${type}`);
    }
  };

  const fetchDocumentVersions = async (compId: string, type: "sop" | "cover_letter") => {
    try {
      const res = await api.get(`/ai/documents?company_id=${compId}&doc_type=${type}`);
      if (type === "sop") setSopVersions(res.data || []);
      else setClVersions(res.data || []);
    } catch {
      console.warn(`Failed to fetch versions for ${type}`);
    }
  };

  const runDeterministicATS = async (activeCompany: Company) => {
    try {
      setCalculatingATS(true);
      const res = await api.post("/ai/tailor", {
        company_id: activeCompany.id,
        request_source: "browser" // triggers fast deterministic return
      });
      setAtsResult(res.data);
    } catch (err) {
      console.error("ATS optimization check failed", err);
    } finally {
      setCalculatingATS(false);
    }
  };

  const runCloudATS = async () => {
    if (!company) return;
    try {
      setCalculatingATS(true);
      setErrorMsg("");
      const res = await api.post("/ai/tailor", {
        company_id: company.id,
        request_source: "cloud"
      });
      setAtsResult(res.data);
      showSuccess("Cloud ATS optimization generated successfully.");
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || "Cloud AI generation failed. Verify Hugging Face API keys.");
    } finally {
      setCalculatingATS(false);
    }
  };

  const runLocalATS = async () => {
    if (!company) return;
    setCalculatingATS(true);
    setErrorMsg("");
    setLocalDownloadProgress(null);
    setLocalStatusMessage("");

    try {
      // 1. Fetch user's decrypted resume from backend
      const resMe = await api.get("/resumes/me");
      if (!resMe.data || !resMe.data.resume_data || Object.keys(resMe.data.resume_data).length === 0) {
        throw new Error("No master resume found. Please upload or save your resume details in the Resume Engine tab first.");
      }
      
      const resumeData = resMe.data.resume_data;

      // 2. Prepare the prompt
      const prompt = `You are a professional ATS optimizer. Analyze the student's Resume JSON and the Job Description text.
Generate a JSON output tailoring the resume to fit the JD perfectly.

TRUTHFULNESS & GROUNDING RULES:
1. ONLY modify text phrasing to better align with the JD; NEVER invent metrics, years of experience, certifications, or achievements.
2. NEVER modify or invent candidate name, contact details, company names, job titles, institutions, degrees, or dates.
3. Keep project titles exactly as they are in the original resume.
4. Do NOT use buzzwords or fluff (e.g., spearheaded, synergized, revolutionized, best-in-class). Write simple, direct, metric-driven accomplishments.
5. Emphasize matching skills and keywords from the Job Description where supported by candidate experience.

Student Resume Data:
${JSON.stringify(resumeData)}

Company JD Text:
${company.jd_text || ""}

Required Skills:
${(company.jd_required_skills || []).join(", ")}

Return ONLY a valid JSON object matching this schema exactly (do NOT wrap in conversational intro/outro, do NOT add prefix explanations, start directly with the JSON):
{
  "ats_score": 85,
  "missing_keywords": ["Kubernetes", "Redis"],
  "improvements": ["Highlight cloud project", "Move Python to core skills"],
  "tailored_resume": {
    "optimized_skills": ["Python", "React", "Docker"],
    "optimized_projects": [
      {
        "title": "Project Title",
        "description": "Optimized description highlighting matching keywords from the JD based on original text"
      }
    ],
    "optimized_summary": "Tailored professional profile summary matching the role requirements."
  }
}`;

      // 3. Call local generation
      setLocalStatusMessage(`Loading local model ${atsModel}...`);
      const result = await generateInBrowser({
        modelType: atsModel,
        prompt: prompt,
        maxTokens: 1024,
        onProgress: (p) => {
          setLocalDownloadProgress(Math.round(p * 100));
          setLocalStatusMessage(`Downloading model weights: ${Math.round(p * 100)}%`);
        },
        onToken: (text) => {
          // Streaming parsing is hard for complete JSON, but we can log or just wait for complete text
        }
      });

      // 4. Parse JSON result
      let cleanText = result.trim();
      if (cleanText.startsWith("```")) {
        cleanText = cleanText.split("```")[1];
        if (cleanText.startsWith("json")) {
          cleanText = cleanText.substring(4);
        }
      }
      
      // Attempt to find the first '{' and last '}' to strip extra wrapper text
      const firstBrace = cleanText.indexOf("{");
      const lastBrace = cleanText.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleanText = cleanText.substring(firstBrace, lastBrace + 1);
      }

      try {
        const parsed = JSON.parse(cleanText);
        setAtsResult(parsed);
        showSuccess("Local Browser ATS optimization generated successfully.");
      } catch (parseErr) {
        console.error("Local LLM JSON parse error:", parseErr, "Raw text:", result);
        throw new Error("Local model returned invalid JSON. Please try again or switch to Server Cloud AI.");
      }
    } catch (err: any) {
      console.error("Local ATS tailoring failed:", err);
      setErrorMsg(err.message || "Local ATS generation failed. Ensure WebAssembly is supported.");
    } finally {
      setCalculatingATS(false);
      setLocalDownloadProgress(null);
      setLocalStatusMessage("");
    }
  };

  const fetchDeterministicPrep = async (activeCompany: Company) => {
    try {
      const res = await api.post("/ai/interview-prep", {
        company_id: activeCompany.id,
        request_source: "browser"
      });
      setPrepData(res.data);
    } catch (err) {
      console.error("Prep questions failed", err);
    }
  };

  const runCloudPrep = async () => {
    if (!company) return;
    try {
      setGeneratingPrep(true);
      setErrorMsg("");
      const res = await api.post("/ai/interview-prep", {
        company_id: company.id,
        request_source: "cloud"
      });
      setPrepData(res.data);
      showSuccess("Cloud interview prep topics generated.");
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || "Cloud prep generation failed.");
    } finally {
      setGeneratingPrep(false);
    }
  };

  const generateSOP = async () => {
    if (!company) return;
    setGeneratingSOP(true);
    setErrorMsg("");
    setLocalDownloadProgress(null);
    setLocalStatusMessage("");

    const basePrompt = `Generate aStatement of Purpose for ${company.name} applying for the ${company.role} role. ${
      sopPrompt ? `Include these details: ${sopPrompt}` : ""
    }`;

    try {
      if (sopSource === "cloud") {
        const res = await api.post("/ai/sop", {
          company_id: company.id,
          request_source: "cloud",
          custom_prompt: sopPrompt || undefined
        });
        setSopContent(res.data.sop);
        showSuccess("Cloud Statement of Purpose draft generated.");
      } else {
        // Local Browser Generation
        setLocalStatusMessage(`Loading local model ${sopModel}...`);
        const result = await generateInBrowser({
          modelType: sopModel,
          prompt: basePrompt,
          onProgress: (p) => {
            setLocalDownloadProgress(Math.round(p * 100));
            setLocalStatusMessage(`Downloading model weights: ${Math.round(p * 100)}%`);
          },
          onToken: (text) => {
            setSopContent(text);
          }
        });
        setSopContent(result);
        showSuccess("Browser-side local LLM SOP generated.");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.response?.data?.detail || err.message || "Local generation failed. Ensure WebAssembly is supported.");
    } finally {
      setGeneratingSOP(false);
      setLocalDownloadProgress(null);
      setLocalStatusMessage("");
    }
  };

  const generateCoverLetter = async () => {
    if (!company) return;
    setGeneratingCL(true);
    setErrorMsg("");
    setLocalDownloadProgress(null);
    setLocalStatusMessage("");

    const basePrompt = `Write a cover letter for ${company.name} for the role of ${company.role}. ${
      clPrompt ? `Additional guidelines: ${clPrompt}` : ""
    }`;

    try {
      if (clSource === "cloud") {
        const res = await api.post("/ai/cover-letter", {
          company_id: company.id,
          request_source: "cloud",
          custom_prompt: clPrompt || undefined
        });
        setClContent(res.data.cover_letter);
        showSuccess("Cloud Cover Letter draft generated.");
      } else {
        // Local Browser Generation
        setLocalStatusMessage(`Loading local model ${clModel}...`);
        const result = await generateInBrowser({
          modelType: clModel,
          prompt: basePrompt,
          onProgress: (p) => {
            setLocalDownloadProgress(Math.round(p * 100));
            setLocalStatusMessage(`Downloading model weights: ${Math.round(p * 100)}%`);
          },
          onToken: (text) => {
            setClContent(text);
          }
        });
        setClContent(result);
        showSuccess("Browser-side local LLM Cover Letter generated.");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.response?.data?.detail || err.message || "Local Cover Letter generation failed.");
    } finally {
      setGeneratingCL(false);
      setLocalDownloadProgress(null);
      setLocalStatusMessage("");
    }
  };

  const saveDocument = async (type: "sop" | "cover_letter", content: string) => {
    if (!company || !content) return;
    setSavingDoc(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const res = await api.post("/ai/documents/save", {
        company_id: company.id,
        doc_type: type,
        content: content
      });
      showSuccess(res.data.message || "Draft version saved securely.");
      await fetchDocumentVersions(company.id, type);
    } catch {
      setErrorMsg("Failed to save draft version to database.");
    } finally {
      setSavingDoc(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showSuccess("Copied to clipboard!");
  };

  // 1. Extract Keywords from JD
  const jdKeywords = React.useMemo(() => {
    if (!company) return new Set<string>();
    if (company.jd_ats_keywords && company.jd_ats_keywords.length > 0) {
      return new Set(company.jd_ats_keywords.map(k => k.toLowerCase().trim()));
    }
    return extractKeywords(company.jd_text || "");
  }, [company]);

  // 2. Real-time ATS match stats of active resume
  const matchStats = React.useMemo(() => {
    if (!masterResume || jdKeywords.size === 0) {
      return { matchedKeywords: new Set<string>(), matchCount: 0, totalKeywords: jdKeywords.size, matchPercentage: 0 };
    }
    
    const parts: string[] = [];
    if (masterResume.personal) {
      if (masterResume.personal.name) parts.push(masterResume.personal.name);
      if (masterResume.personal.location) parts.push(masterResume.personal.location);
    }
    if (masterResume.summary) {
      parts.push(masterResume.summary);
    }
    
    const edu = masterResume.education || [];
    edu.forEach((e: any) => {
      if (e.degree) parts.push(e.degree);
      if (e.institution) parts.push(e.institution);
    });
    
    const exp = masterResume.experience || [];
    exp.forEach((e: any) => {
      if (e.role) parts.push(e.role);
      if (e.company) parts.push(e.company);
      if (e.description) parts.push(e.description);
    });
    
    const proj = masterResume.projects || [];
    proj.forEach((e: any) => {
      if (e.title) parts.push(e.title);
      if (e.tech) parts.push(e.tech);
      if (e.description) parts.push(e.description);
    });
    
    const skills = masterResume.skills || [];
    skills.forEach((s: string) => parts.push(s));
    
    return calculateMatchStats(parts.join(" "), jdKeywords);
  }, [masterResume, jdKeywords]);

  // 3. HighlightedText Component
  const HighlightedText = ({ text, keywords }: { text: string; keywords: Set<string> }) => {
    const segments = React.useMemo(() => segmentTextByKeywords(text, keywords), [text, keywords]);
    return (
      <span>
        {segments.map((segment, i) =>
          segment.isMatch ? (
            <mark key={i} className="bg-yellow-500/30 text-foreground px-0.5 rounded-sm">
              {segment.text}
            </mark>
          ) : (
            <span key={i}>{segment.text}</span>
          )
        )}
      </span>
    );
  };

  // 4. Apply optimized sections to Master Resume
  const applySuggestionsToMaster = async () => {
    if (!atsResult || !atsResult.tailored_resume || !company) return;
    
    try {
      setSavingDoc(true);
      setErrorMsg("");
      setSuccessMsg("");
      
      const res = await api.get("/resumes/me");
      const currentData = res.data?.resume_data || {
        personal: { name: user?.full_name || "", email: user?.email || "", phone: "", location: "" },
        summary: "",
        education: [],
        experience: [],
        projects: [],
        skills: []
      };
      
      const updatedData = JSON.parse(JSON.stringify(currentData));
      const opt = atsResult.tailored_resume;
      
      if (opt.optimized_summary) {
        updatedData.summary = opt.optimized_summary;
      }
      
      if (opt.optimized_skills && opt.optimized_skills.length > 0) {
        const mergedSkills = Array.from(new Set([
          ...opt.optimized_skills,
          ...(updatedData.skills || [])
        ]));
        updatedData.skills = mergedSkills;
      }
      
      if (opt.optimized_projects && opt.optimized_projects.length > 0) {
        const projects = updatedData.projects || [];
        opt.optimized_projects.forEach((optProj: any) => {
          const match = projects.find((p: any) => 
            p.title.trim().toLowerCase() === optProj.title.trim().toLowerCase()
          );
          if (match) {
            match.description = optProj.description;
          } else if (projects.length > 0) {
            if (projects.length === 1 && opt.optimized_projects.length === 1) {
              projects[0].description = opt.optimized_projects[0].description;
            }
          }
        });
      }
      
      await api.put("/resumes/me", {
        template: res.data?.template || "Classic Single",
        resume_data: updatedData
      });
      
      setMasterResume(updatedData);
      showSuccess("AI suggestions successfully applied to Master Resume!");
    } catch (err: any) {
      console.error("Failed to apply suggestions:", err);
      setErrorMsg("Failed to update Master Resume with AI suggestions.");
    } finally {
      setSavingDoc(false);
    }
  };

  const downloadAsTextFile = (filename: string, text: string) => {
    const element = document.createElement("a");
    const file = new Blob([text], { type: "text/plain;charset=utf-8" });
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    showSuccess("Draft downloaded successfully.");
  };

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 3500);
  };

  const getSkillBadgeColor = (skill: string) => {
    const normalizedSkill = skill.trim().toLowerCase();
    const userSkills = user?.skills || [];
    const normalizedUserSkills = userSkills.map(s => s.trim().toLowerCase());
    
    // Check match or normalization matches
    const hasExact = normalizedUserSkills.includes(normalizedSkill);
    if (hasExact) return "bg-green-500/10 border-green-500 text-green-500";
    
    // Check if it is a normalized skill mapping match (e.g. react js -> react)
    const normUser = normalizedUserSkills.map(s => {
      // Very basic normalization mapping equivalent to backend dictionary
      if (s === "reactjs" || s === "react.js" || s === "react js") return "react";
      if (s === "nodejs" || s === "node.js" || s === "node js") return "node";
      if (s === "javascript") return "js";
      if (s === "typescript") return "ts";
      return s;
    });
    const normSearch = normalizedSkill === "reactjs" || normalizedSkill === "react.js" || normalizedSkill === "react js" ? "react" :
                       normalizedSkill === "nodejs" || normalizedSkill === "node.js" || normalizedSkill === "node js" ? "node" :
                       normalizedSkill === "javascript" ? "js" :
                       normalizedSkill === "typescript" ? "ts" : normalizedSkill;
                       
    if (normUser.includes(normSearch)) {
      return "bg-yellow-500/10 border-yellow-500 text-yellow-500";
    }
    
    return "bg-red-500/10 border-red-500 text-red-500";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center font-sans">
        <div className="text-center space-y-4">
          <Loader2 className="animate-spin text-accent h-12 w-12 mx-auto" />
          <p className="text-xs font-bold tracking-widest uppercase text-muted-foreground">
            Synchronizing AI Placement Engine...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      
      {/* Top Header Bar */}
      <header className="flex h-20 items-center justify-between border-b-2 border-border px-8 bg-background z-10 shrink-0">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="flex h-10 w-10 items-center justify-center border-2 border-border hover:bg-muted text-foreground transition-all active:scale-95"
          >
            <ArrowLeft size={16} />
          </Link>
          <span className="text-base font-extrabold tracking-tighter uppercase leading-none">
            AI PLACEMENT TOOLKIT <span className="text-accent">.</span>
          </span>
        </div>
        
        {/* Company Dropdown Selection */}
        {companies.length > 0 && (
          <div className="flex items-center border-2 border-border px-3 bg-background h-10">
            <span className="text-[9px] font-black text-muted-foreground uppercase mr-2">DRIVE</span>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="bg-transparent text-xs font-bold uppercase outline-none cursor-pointer text-foreground max-w-[150px] md:max-w-xs"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name.toUpperCase()} — {c.role.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      {/* Main Container */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0">
        
        {/* Left Column: Company specs & ATS Checker */}
        <div className="lg:col-span-4 border-r-2 border-border p-6 md:p-8 space-y-8 overflow-y-auto max-h-[calc(100vh-80px)]">
          {company ? (
            <>
              {/* Company Header */}
              <div className="border-b-2 border-border pb-6 space-y-3">
                <div className="flex gap-2">
                  <span className="bg-accent px-2 py-0.5 text-[9px] font-extrabold tracking-widest text-black border border-accent uppercase">
                    {company.category}
                  </span>
                  <span className="bg-muted px-2 py-0.5 text-[9px] font-bold tracking-widest text-muted-foreground border border-border uppercase">
                    {company.job_location || "REMOTE"}
                  </span>
                </div>
                <h2 className="text-3xl font-black tracking-tighter uppercase leading-[0.9]">
                  {company.name}
                </h2>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  {company.role}
                </p>
              </div>

              {/* Specs Grid */}
              <div className="grid grid-cols-2 gap-4 text-xs font-bold border-b border-border pb-6">
                <div>
                  <span className="text-[9px] text-muted-foreground uppercase block mb-1">CTC</span>
                  <span className="uppercase text-foreground">{company.ctc || "—"}</span>
                </div>
                <div>
                  <span className="text-[9px] text-muted-foreground uppercase block mb-1">STIPEND</span>
                  <span className="uppercase text-foreground">{company.stipend || "—"}</span>
                </div>
              </div>

              {/* Notification Banner for Success/Error */}
              {errorMsg && (
                <div className="border-2 border-red-500 bg-red-500/10 p-4 flex gap-3 text-red-500 text-xs font-bold uppercase items-start leading-snug">
                  <AlertCircle size={18} className="shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}
              {successMsg && (
                <div className="border-2 border-green-500 bg-green-500/10 p-4 flex gap-3 text-green-500 text-xs font-bold uppercase items-start leading-snug">
                  <Check size={18} className="shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* ATS SCORE CARD */}
              {atsResult && (
                <div className="border-2 border-black bg-muted/20 p-6 space-y-6">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black tracking-widest uppercase">ATS SCORESHEET</span>
                    <span className="bg-black text-accent border border-accent px-2 py-1 text-[11px] font-black tracking-widest">
                      {atsResult.ats_score}% MATCH
                    </span>
                  </div>

                  {/* Radial/Bar Indicator */}
                  <div className="w-full bg-muted border border-border h-4 relative overflow-hidden">
                    <div 
                      className="bg-accent h-full transition-all duration-500" 
                      style={{ width: `${atsResult.ats_score}%` }}
                    />
                  </div>

                  {/* Skills side by side matrix */}
                  <div className="space-y-3">
                    <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest block">
                      JD SKILL MATCH MATRIX
                    </span>
                    
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {company.jd_required_skills && company.jd_required_skills.length > 0 ? (
                        company.jd_required_skills.map((skill, index) => (
                          <div key={index} className="flex justify-between items-center text-[10px] font-bold uppercase border-b border-border pb-1.5">
                            <span className="text-foreground">{skill}</span>
                            <span className={`border px-1.5 py-0.5 text-[8px] font-extrabold ${getSkillBadgeColor(skill)}`}>
                              {getSkillBadgeColor(skill).includes("green") ? "PRESENT" : 
                               getSkillBadgeColor(skill).includes("yellow") ? "WEAK" : "MISSING"}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-[10px] text-muted-foreground uppercase">No specific required skills listed in JD.</p>
                      )}
                    </div>
                  </div>

                  {/* Actionable Gap Improvements */}
                  {atsResult.improvements && atsResult.improvements.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest block">
                        ATS GAP SUGGESTIONS
                      </span>
                      <ul className="space-y-1.5 text-[10px] text-foreground font-medium uppercase list-none">
                        {atsResult.improvements.map((imp, i) => (
                          <li key={i} className="flex gap-2 items-start leading-snug">
                            <span className="text-accent shrink-0">✦</span>
                            <span>{imp}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {/* AI Core Engine Selector & Actions */}
                  <div className="pt-4 border-t border-border space-y-4">
                    <div className="space-y-1">
                      <span className="text-[8px] font-black text-muted-foreground uppercase block">AI CORE ENGINE</span>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => setAtsSource("browser")}
                          className={`h-8 border text-[10px] font-bold uppercase transition-all ${
                            atsSource === "browser" ? "border-accent bg-accent/10 text-accent" : "border-border bg-background text-muted-foreground"
                          }`}
                        >
                          💻 LOCAL BROWSER
                        </button>
                        <button
                          onClick={() => setAtsSource("cloud")}
                          className={`h-8 border text-[10px] font-bold uppercase transition-all ${
                            atsSource === "cloud" ? "border-accent bg-accent/10 text-accent" : "border-border bg-background text-muted-foreground"
                          }`}
                        >
                          ☁️ SERVER CLOUD
                        </button>
                      </div>
                    </div>

                    {/* Local Model dropdown */}
                    {atsSource === "browser" && (
                      <div className="space-y-1">
                        <span className="text-[8px] font-black text-muted-foreground uppercase block">LOCAL MODEL (WASM)</span>
                        <select
                          value={atsModel}
                          onChange={(e) => setAtsModel(e.target.value as BrowserModelType)}
                          className="w-full bg-background border border-border p-1 text-[10px] font-bold uppercase outline-none text-foreground"
                        >
                          {geminiAvailable && <option value="gemini-nano">GEMINI NANO (CHROME NATIVE)</option>}
                          <option value="qwen-0.5b">QWEN 1.5 0.5B CHAT (350MB - FAST)</option>
                          <option value="llama-1b">LLAMA 3.2 1B INSTRUCT (600MB - SMART)</option>
                        </select>
                      </div>
                    )}

                    {/* Loader status message */}
                    {calculatingATS && localStatusMessage && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-[9px] font-bold uppercase">
                          <span className="text-accent animate-pulse">{localStatusMessage}</span>
                        </div>
                        {localDownloadProgress !== null && (
                          <div className="w-full bg-muted border border-border h-1.5 relative overflow-hidden">
                            <div 
                              className="bg-accent h-full transition-all duration-300"
                              style={{ width: `${localDownloadProgress}%` }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Main Trigger Button */}
                    <button
                      onClick={atsSource === "browser" ? runLocalATS : runCloudATS}
                      disabled={calculatingATS}
                      className="w-full h-10 border-2 border-border bg-background hover:bg-muted font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      {calculatingATS ? (
                        <>
                          <Loader2 className="animate-spin h-3.5 w-3.5" />
                          <span>GENERATING TAILORING...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={12} className="text-accent" />
                          <span>TAILOR RESUME WITH {atsSource === "browser" ? "LOCAL AI" : "CLOUD AI"}</span>
                        </>
                      )}
                    </button>
                    <span className="text-[8px] text-muted-foreground uppercase text-center block mt-1">
                      {atsSource === "browser" 
                        ? "Runs completely client-side. Zero server cost or data sharing." 
                        : "Cloud completes comprehensive projects / summary rewrites (5 completions limit/day)"
                      }
                    </span>
                  </div>  </div>
              )}
            </>
          ) : (
            <div className="text-center py-20 text-xs font-bold text-muted-foreground uppercase">
              Select or import a company drive announcement to begin.
            </div>
          )}
        </div>

        {/* Right Column: Generative workspace & Interview Prep */}
        <div className="lg:col-span-8 flex flex-col max-h-[calc(100vh-80px)] overflow-hidden">
          
          {/* Tabs Navigation */}
          <div className="flex border-b-2 border-border bg-muted/10 shrink-0">
            <button
              onClick={() => setActiveTab("ats")}
              className={`flex-1 py-4 text-xs font-black tracking-wider uppercase border-r border-border transition-all ${
                activeTab === "ats" ? "bg-background border-b-2 border-b-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/5"
              }`}
            >
              RESUME OPTIMIZER
            </button>
            <button
              onClick={() => setActiveTab("sop")}
              className={`flex-1 py-4 text-xs font-black tracking-wider uppercase border-r border-border transition-all ${
                activeTab === "sop" ? "bg-background border-b-2 border-b-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/5"
              }`}
            >
              STATEMENT OF PURPOSE
            </button>
            <button
              onClick={() => setActiveTab("cl")}
              className={`flex-1 py-4 text-xs font-black tracking-wider uppercase border-r border-border transition-all ${
                activeTab === "cl" ? "bg-background border-b-2 border-b-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/5"
              }`}
            >
              COVER LETTER
            </button>
            <button
              onClick={() => setActiveTab("prep")}
              className={`flex-1 py-4 text-xs font-black tracking-wider uppercase transition-all ${
                activeTab === "prep" ? "bg-background border-b-2 border-b-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/5"
              }`}
            >
              INTERVIEW PREPARATION
            </button>
          </div>

          {/* Workspace Area */}
          <div className="flex-1 overflow-y-auto p-6 md:p-8">
            {company ? (
              <>
                {activeTab === "ats" && (
                  <div className="space-y-8">
                    {/* Sub-View Navigation and Actions */}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b-2 border-border pb-4 gap-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setOptimizerSubView("tailored")}
                          className={`h-9 px-4 border-2 text-[10px] font-black uppercase tracking-wider transition-all ${
                            optimizerSubView === "tailored"
                              ? "border-accent bg-accent/10 text-accent font-black"
                              : "border-border hover:bg-muted text-muted-foreground"
                          }`}
                        >
                          📝 Tailored Suggestions
                        </button>
                        <button
                          onClick={() => setOptimizerSubView("highlight")}
                          className={`h-9 px-4 border-2 text-[10px] font-black uppercase tracking-wider transition-all ${
                            optimizerSubView === "highlight"
                              ? "border-accent bg-accent/10 text-accent font-black"
                              : "border-border hover:bg-muted text-muted-foreground"
                          }`}
                        >
                          🔍 ATS Keyword Highlighting
                        </button>
                      </div>
                      
                      {atsResult?.tailored_resume && optimizerSubView === "tailored" && (
                        <button
                          onClick={applySuggestionsToMaster}
                          disabled={savingDoc}
                          className="h-9 px-4 border-2 border-accent bg-accent text-black hover:bg-black hover:text-accent hover:border-black text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 active:scale-95 transition-all disabled:opacity-50"
                        >
                          <Sparkles size={11} />
                          <span>Apply to Master Resume</span>
                        </button>
                      )}
                    </div>

                    {optimizerSubView === "tailored" ? (
                      <>
                        <div className="border-2 border-border p-6 space-y-4">
                          <h3 className="text-lg font-black uppercase tracking-tighter">TAILORED RESUME SUGGESTIONS</h3>
                          <p className="text-xs text-muted-foreground uppercase leading-relaxed">
                            These sections are optimized for {company.name}&apos;s specific requirements. Click the button above to merge them directly into your master resume, or copy them manually.
                          </p>
                        </div>

                        {atsResult?.tailored_resume ? (
                          <div className="space-y-6">
                            
                            {/* Summary Section */}
                            <div className="border-2 border-border p-4 bg-muted/10 space-y-3">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-black text-muted-foreground uppercase">OPTIMIZED PROFESSIONAL PROFILE SUMMARY</span>
                                <button
                                  onClick={() => copyToClipboard(atsResult.tailored_resume.optimized_summary)}
                                  className="h-8 px-3 border border-border bg-background hover:bg-muted text-[10px] font-bold uppercase flex items-center gap-1"
                                >
                                  <Copy size={10} />
                                  <span>COPY</span>
                                </button>
                              </div>
                              <p className="text-xs font-mono bg-background border border-border p-3 select-all leading-relaxed whitespace-pre-wrap">
                                {atsResult.tailored_resume.optimized_summary}
                              </p>
                            </div>

                            {/* Projects Section */}
                            {atsResult.tailored_resume.optimized_projects && atsResult.tailored_resume.optimized_projects.length > 0 && (
                              <div className="space-y-4">
                                <span className="text-[10px] font-black text-muted-foreground uppercase">OPTIMIZED WORK PROJECTS DESCRIPTIONS</span>
                                
                                {atsResult.tailored_resume.optimized_projects.map((proj, i) => (
                                  <div key={i} className="border border-border p-4 bg-muted/5 space-y-2.5">
                                    <div className="flex justify-between items-center">
                                      <span className="text-[10px] font-bold text-foreground">{proj.title.toUpperCase()}</span>
                                      <button
                                        onClick={() => copyToClipboard(`${proj.title}\n${proj.description}`)}
                                        className="h-7 px-2 border border-border bg-background hover:bg-muted text-[9px] font-bold uppercase flex items-center gap-1"
                                      >
                                        <Copy size={9} />
                                        <span>COPY BULLETS</span>
                                      </button>
                                    </div>
                                    <p className="text-xs font-mono bg-background border border-border p-3 select-all leading-relaxed">
                                      {proj.description}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Skills optimization */}
                            <div className="border border-border p-4 bg-muted/5 space-y-3">
                              <span className="text-[10px] font-black text-muted-foreground uppercase">SUGGESTED TECH STACK (ORDERED BY JD RELEVANCE)</span>
                              <div className="flex flex-wrap gap-1.5">
                                {atsResult.tailored_resume.optimized_skills.map((s, i) => (
                                  <span key={i} className="text-[9px] font-bold bg-background border border-accent text-accent px-2 py-0.5 uppercase">
                                    {s}
                                  </span>
                                ))}
                              </div>
                            </div>

                          </div>
                        ) : (
                          <div className="text-center py-20 border border-dashed border-border text-xs font-bold text-muted-foreground uppercase">
                            Tailored suggestions are computed dynamically.
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
                        {/* Left: Job Description */}
                        <div className="xl:col-span-5 border-2 border-border p-6 bg-card space-y-6 max-h-[650px] overflow-y-auto">
                          <div className="flex items-center gap-2 border-b border-border pb-3">
                            <FileText className="w-4 h-4 text-accent" />
                            <h3 className="text-sm font-black uppercase tracking-widest text-foreground">JOB DESCRIPTION</h3>
                          </div>
                          
                          <div className="space-y-4 text-xs leading-relaxed uppercase tracking-wider font-mono text-muted-foreground whitespace-pre-wrap select-text">
                            {company.jd_text ? (
                              <HighlightedText text={company.jd_text} keywords={jdKeywords} />
                            ) : (
                              "No job description details available."
                            )}
                          </div>
                        </div>

                        {/* Right: Master Resume with Highlights */}
                        <div className="xl:col-span-7 border-2 border-border p-6 bg-card space-y-6 max-h-[650px] overflow-y-auto">
                          <div className="flex items-center justify-between border-b border-border pb-3">
                            <div className="flex items-center gap-2">
                              <Target className="w-4 h-4 text-accent" />
                              <h3 className="text-sm font-black uppercase tracking-widest text-foreground">YOUR MASTER RESUME MATCH</h3>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="bg-black text-accent border border-accent px-2 py-1 text-[10px] font-black uppercase tracking-widest">
                                {matchStats.matchPercentage}% REAL MATCH
                              </span>
                            </div>
                          </div>

                          {masterResume ? (
                            <div className="space-y-6">
                              {/* Summary Section */}
                              {masterResume.summary && (
                                <div className="space-y-2">
                                  <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block border-b border-border pb-1">SUMMARY</span>
                                  <p className="text-xs bg-muted/20 border border-border p-3 leading-relaxed uppercase tracking-wider font-mono">
                                    <HighlightedText text={masterResume.summary} keywords={jdKeywords} />
                                  </p>
                                </div>
                              )}

                              {/* Skills Section */}
                              {masterResume.skills && masterResume.skills.length > 0 && (
                                <div className="space-y-2">
                                  <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block border-b border-border pb-1">SKILLS & TECH STACK</span>
                                  <div className="flex flex-wrap gap-1.5 bg-muted/20 border border-border p-3">
                                    {masterResume.skills.map((skill: string, i: number) => {
                                      const isMatch = jdKeywords.has(skill.toLowerCase().trim());
                                      return (
                                        <span 
                                          key={i} 
                                          className={`text-[9px] font-bold px-2 py-0.5 border uppercase transition-colors ${
                                            isMatch ? "bg-yellow-500/20 border-yellow-500 text-yellow-500 font-black" : "bg-background border-border text-muted-foreground"
                                          }`}
                                        >
                                          {skill}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Experience Section */}
                              {masterResume.experience && masterResume.experience.length > 0 && (
                                <div className="space-y-3">
                                  <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block border-b border-border pb-1">EXPERIENCE</span>
                                  <div className="space-y-3">
                                    {masterResume.experience.map((exp: any, i: number) => (
                                      <div key={i} className="border border-border p-3.5 space-y-2 bg-muted/5">
                                        <div className="flex justify-between items-baseline text-[10px] font-bold uppercase">
                                          <span>
                                            <span className="text-foreground">{exp.company}</span>
                                            <span className="mx-1.5 text-muted-foreground">|</span>
                                            <span className="text-muted-foreground font-medium">{exp.role}</span>
                                          </span>
                                          <span className="text-[8px] text-muted-foreground">{exp.period}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap select-text uppercase tracking-wider">
                                          <HighlightedText text={exp.description} keywords={jdKeywords} />
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Projects Section */}
                              {masterResume.projects && masterResume.projects.length > 0 && (
                                <div className="space-y-3">
                                  <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block border-b border-border pb-1">PROJECTS</span>
                                  <div className="space-y-3">
                                    {masterResume.projects.map((proj: any, i: number) => (
                                      <div key={i} className="border border-border p-3.5 space-y-2 bg-muted/5">
                                        <div className="flex justify-between items-baseline text-[10px] font-bold uppercase">
                                          <span className="text-foreground">{proj.title}</span>
                                          {proj.tech && <span className="text-[8px] border border-border px-1.5 text-muted-foreground">{proj.tech}</span>}
                                        </div>
                                        <p className="text-xs text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap select-text uppercase tracking-wider">
                                          <HighlightedText text={proj.description} keywords={jdKeywords} />
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Education Section */}
                              {masterResume.education && masterResume.education.length > 0 && (
                                <div className="space-y-3">
                                  <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block border-b border-border pb-1">EDUCATION</span>
                                  <div className="space-y-2 bg-muted/20 border border-border p-3.5">
                                    {masterResume.education.map((edu: any, i: number) => (
                                      <div key={i} className="flex justify-between items-center text-[10px] font-bold uppercase border-b border-border last:border-0 pb-1.5 last:pb-0">
                                        <span className="text-foreground">{edu.degree} — {edu.institution}</span>
                                        <span className="text-muted-foreground text-[8px]">{edu.year} | {edu.score}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-center py-20 text-xs font-bold text-muted-foreground uppercase border border-dashed border-border">
                              No master resume available. Please create one in Resume Engine first.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. STATEMENT OF PURPOSE TAB */}
                {activeTab === "sop" && (
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
                    
                    {/* SOP Generator controls */}
                    <div className="xl:col-span-5 border-2 border-border p-6 bg-muted/10 space-y-6">
                      <h3 className="text-sm font-black uppercase tracking-widest border-b border-border pb-3">SOP DRAFTER</h3>
                      
                      {/* Generation Mode */}
                      <div className="space-y-2">
                        <span className="text-[9px] font-black text-muted-foreground uppercase block">AI CORE ENGINE</span>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setSopSource("browser")}
                            className={`h-10 border-2 text-xs font-bold uppercase transition-all ${
                              sopSource === "browser" ? "border-accent bg-accent/10 text-accent font-black" : "border-border bg-background text-muted-foreground"
                            }`}
                          >
                            💻 LOCAL BROWSER
                          </button>
                          <button
                            onClick={() => setSopSource("cloud")}
                            className={`h-10 border-2 text-xs font-bold uppercase transition-all ${
                              sopSource === "cloud" ? "border-accent bg-accent/10 text-accent font-black" : "border-border bg-background text-muted-foreground"
                            }`}
                          >
                            ☁️ SERVER CLOUD
                          </button>
                        </div>
                      </div>

                      {/* Local Model dropdown */}
                      {sopSource === "browser" && (
                        <div className="space-y-2 border-t border-border pt-4">
                          <span className="text-[9px] font-black text-muted-foreground uppercase block">LOCAL MODEL SIZE (WASM)</span>
                          <select
                            value={sopModel}
                            onChange={(e) => setSopModel(e.target.value as BrowserModelType)}
                            className="w-full bg-background border-2 border-border p-2 text-xs font-bold uppercase outline-none text-foreground"
                          >
                            {geminiAvailable && <option value="gemini-nano">GEMINI NANO (CHROME NATIVE)</option>}
                            <option value="qwen-0.5b">QWEN 1.5 0.5B CHAT (350MB - FASTEST)</option>
                            <option value="llama-1b">LLAMA 3.2 1B INSTRUCT (600MB - SMART)</option>
                          </select>
                        </div>
                      )}

                      {/* Guidelines input */}
                      <div className="space-y-2 border-t border-border pt-4">
                        <span className="text-[9px] font-black text-muted-foreground uppercase block">CUSTOM DIRECTIVES / PROJECTS (OPTIONAL)</span>
                        <textarea
                          placeholder="E.G. HIGHLIGHT MY BLOCKCHAIN PROJECT OR RECENT MOCKATHON EXPERIENCE..."
                          value={sopPrompt}
                          onChange={(e) => setSopPrompt(e.target.value)}
                          className="w-full min-h-[80px] bg-background border-2 border-border p-3 text-xs font-mono placeholder:text-muted-foreground uppercase tracking-wider outline-none text-foreground"
                        />
                      </div>

                      {/* Trigger generate button */}
                      <button
                        onClick={generateSOP}
                        disabled={generatingSOP}
                        className="w-full h-12 border-2 border-accent bg-accent text-black font-extrabold text-xs tracking-widest uppercase flex items-center justify-center gap-2 hover:bg-black hover:text-accent hover:border-black active:scale-[0.98] transition-all disabled:opacity-50"
                      >
                        {generatingSOP ? (
                          <>
                            <Loader2 className="animate-spin h-4 w-4" />
                            <span>COMPILING DRAFT...</span>
                          </>
                        ) : (
                          <>
                            <Play size={12} fill="currentColor" />
                            <span>COMPILE STATEMENT OF PURPOSE</span>
                          </>
                        )}
                      </button>

                      {/* Download status */}
                      {localStatusMessage && (
                        <div className="space-y-1.5 pt-2">
                          <p className="text-[9px] font-bold text-accent uppercase">{localStatusMessage}</p>
                          {localDownloadProgress !== null && (
                            <div className="w-full bg-muted border border-border h-2 relative overflow-hidden">
                              <div className="bg-accent h-full transition-all" style={{ width: `${localDownloadProgress}%` }} />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Version history list */}
                      {sopVersions.length > 0 && (
                        <div className="border-t border-border pt-4 space-y-2">
                          <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest block">
                            VERSION DRAFT ARCHIVE
                          </span>
                          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                            {sopVersions.map((v) => (
                              <button
                                key={v.version}
                                onClick={() => setSopContent(v.content)}
                                className="w-full flex justify-between items-center text-[10px] font-bold bg-background border border-border p-2 hover:border-accent hover:text-accent transition-colors"
                              >
                                <span>VERSION {v.version}</span>
                                <span className="text-[8px] text-muted-foreground">
                                  {new Date(v.created_at).toLocaleString("en-IN", { hour: "numeric", minute: "2-digit" })}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                    </div>

                    {/* SOP Editor Workspace */}
                    <div className="xl:col-span-7 space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-black tracking-widest uppercase">WORKSPACE WORKPAD</span>
                        <div className="flex gap-2">
                          {sopContent && (
                            <>
                              <button
                                onClick={() => saveDocument("sop", sopContent)}
                                disabled={savingDoc}
                                className="h-9 px-3 border-2 border-border hover:border-accent hover:text-accent bg-background text-xs font-bold uppercase flex items-center gap-1.5 active:scale-95 transition-all"
                                title="Commit Draft Version"
                              >
                                <Save size={12} />
                                <span>SAVE DRAFT</span>
                              </button>
                              <button
                                onClick={() => downloadAsTextFile(`${company.name}_SOP.txt`, sopContent)}
                                className="h-9 w-9 border-2 border-border hover:border-accent hover:text-accent bg-background flex items-center justify-center active:scale-95 transition-all"
                                title="Download as Text"
                              >
                                <Download size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      
                      <textarea
                        value={sopContent}
                        onChange={(e) => setSopContent(e.target.value)}
                        placeholder="Statement of Purpose content will generate here... You can freely edit this content once loaded."
                        className="w-full min-h-[480px] bg-background border-2 border-border p-6 font-mono text-xs leading-relaxed outline-none text-foreground select-text"
                      />
                    </div>

                  </div>
                )}

                {/* 3. COVER LETTER TAB */}
                {activeTab === "cl" && (
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
                    
                    {/* Cover Letter controls */}
                    <div className="xl:col-span-5 border-2 border-border p-6 bg-muted/10 space-y-6">
                      <h3 className="text-sm font-black uppercase tracking-widest border-b border-border pb-3">COVER LETTER DRAFTER</h3>
                      
                      {/* Generation Mode */}
                      <div className="space-y-2">
                        <span className="text-[9px] font-black text-muted-foreground uppercase block">AI CORE ENGINE</span>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setClSource("browser")}
                            className={`h-10 border-2 text-xs font-bold uppercase transition-all ${
                              clSource === "browser" ? "border-accent bg-accent/10 text-accent font-black" : "border-border bg-background text-muted-foreground"
                            }`}
                          >
                            💻 LOCAL BROWSER
                          </button>
                          <button
                            onClick={() => setClSource("cloud")}
                            className={`h-10 border-2 text-xs font-bold uppercase transition-all ${
                              clSource === "cloud" ? "border-accent bg-accent/10 text-accent font-black" : "border-border bg-background text-muted-foreground"
                            }`}
                          >
                            ☁️ SERVER CLOUD
                          </button>
                        </div>
                      </div>

                      {/* Local Model dropdown */}
                      {clSource === "browser" && (
                        <div className="space-y-2 border-t border-border pt-4">
                          <span className="text-[9px] font-black text-muted-foreground uppercase block">LOCAL MODEL SIZE (WASM)</span>
                          <select
                            value={clModel}
                            onChange={(e) => setClModel(e.target.value as BrowserModelType)}
                            className="w-full bg-background border-2 border-border p-2 text-xs font-bold uppercase outline-none text-foreground"
                          >
                            {geminiAvailable && <option value="gemini-nano">GEMINI NANO (CHROME NATIVE)</option>}
                            <option value="qwen-0.5b">QWEN 1.5 0.5B CHAT (350MB - FASTEST)</option>
                            <option value="llama-1b">LLAMA 3.2 1B INSTRUCT (600MB - SMART)</option>
                          </select>
                        </div>
                      )}

                      {/* Guidelines input */}
                      <div className="space-y-2 border-t border-border pt-4">
                        <span className="text-[9px] font-black text-muted-foreground uppercase block">CUSTOM DIRECTIVES / PROFILE EMPHASIS</span>
                        <textarea
                          placeholder="E.G. HIGHLIGHT MY INTERN CONTRACT OR FRONTEND CONCENTRATION..."
                          value={clPrompt}
                          onChange={(e) => setClPrompt(e.target.value)}
                          className="w-full min-h-[80px] bg-background border-2 border-border p-3 text-xs font-mono placeholder:text-muted-foreground uppercase tracking-wider outline-none text-foreground"
                        />
                      </div>

                      {/* Trigger generate button */}
                      <button
                        onClick={generateCoverLetter}
                        disabled={generatingCL}
                        className="w-full h-12 border-2 border-accent bg-accent text-black font-extrabold text-xs tracking-widest uppercase flex items-center justify-center gap-2 hover:bg-black hover:text-accent hover:border-black active:scale-[0.98] transition-all disabled:opacity-50"
                      >
                        {generatingCL ? (
                          <>
                            <Loader2 className="animate-spin h-4 w-4" />
                            <span>COMPILING DRAFT...</span>
                          </>
                        ) : (
                          <>
                            <Play size={12} fill="currentColor" />
                            <span>COMPILE COVER LETTER</span>
                          </>
                        )}
                      </button>

                      {/* Download status */}
                      {localStatusMessage && (
                        <div className="space-y-1.5 pt-2">
                          <p className="text-[9px] font-bold text-accent uppercase">{localStatusMessage}</p>
                          {localDownloadProgress !== null && (
                            <div className="w-full bg-muted border border-border h-2 relative overflow-hidden">
                              <div className="bg-accent h-full transition-all" style={{ width: `${localDownloadProgress}%` }} />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Version history list */}
                      {clVersions.length > 0 && (
                        <div className="border-t border-border pt-4 space-y-2">
                          <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest block">
                            VERSION DRAFT ARCHIVE
                          </span>
                          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                            {clVersions.map((v) => (
                              <button
                                key={v.version}
                                onClick={() => setClContent(v.content)}
                                className="w-full flex justify-between items-center text-[10px] font-bold bg-background border border-border p-2 hover:border-accent hover:text-accent transition-colors"
                              >
                                <span>VERSION {v.version}</span>
                                <span className="text-[8px] text-muted-foreground">
                                  {new Date(v.created_at).toLocaleString("en-IN", { hour: "numeric", minute: "2-digit" })}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                    </div>

                    {/* Cover Letter Editor Workspace */}
                    <div className="xl:col-span-7 space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-black tracking-widest uppercase">WORKSPACE WORKPAD</span>
                        <div className="flex gap-2">
                          {clContent && (
                            <>
                              <button
                                onClick={() => saveDocument("cover_letter", clContent)}
                                disabled={savingDoc}
                                className="h-9 px-3 border-2 border-border hover:border-accent hover:text-accent bg-background text-xs font-bold uppercase flex items-center gap-1.5 active:scale-95 transition-all"
                                title="Commit Draft Version"
                              >
                                <Save size={12} />
                                <span>SAVE DRAFT</span>
                              </button>
                              <button
                                onClick={() => downloadAsTextFile(`${company.name}_CoverLetter.txt`, clContent)}
                                className="h-9 w-9 border-2 border-border hover:border-accent hover:text-accent bg-background flex items-center justify-center active:scale-95 transition-all"
                                title="Download as Text"
                              >
                                <Download size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      
                      <textarea
                        value={clContent}
                        onChange={(e) => setClContent(e.target.value)}
                        placeholder="Cover Letter content will generate here... You can freely edit this content once loaded."
                        className="w-full min-h-[480px] bg-background border-2 border-border p-6 font-mono text-xs leading-relaxed outline-none text-foreground select-text"
                      />
                    </div>

                  </div>
                )}

                {/* 4. INTERVIEW PREP TAB */}
                {activeTab === "prep" && (
                  <div className="space-y-8">
                    
                    {/* Header with trigger button */}
                    <div className="border-2 border-border p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-muted/10">
                      <div className="space-y-1">
                        <h3 className="text-lg font-black uppercase tracking-tighter">PLACEMENT INTERVIEW SIMULATION</h3>
                        <p className="text-xs text-muted-foreground uppercase">
                          Deterministic core CS / technical questions mapping to JD specifications. Generate Cloud questions for behavioral matching.
                        </p>
                      </div>
                      
                      <button
                        onClick={runCloudPrep}
                        disabled={generatingPrep}
                        className="h-12 px-6 border-2 border-accent bg-accent text-black font-extrabold text-xs tracking-wider uppercase flex items-center gap-2 active:scale-95 transition-all shrink-0"
                      >
                        {generatingPrep ? (
                          <>
                            <Loader2 className="animate-spin h-3.5 w-3.5" />
                            <span>GENERATING...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles size={12} />
                            <span>GENERATE CLOUD QUESTIONS</span>
                          </>
                        )}
                      </button>
                    </div>

                    {prepData ? (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        
                        {/* Technical Questions */}
                        <div className="border-2 border-border p-5 space-y-4 bg-background">
                          <span className="text-[10px] font-black bg-black text-accent border border-black px-2 py-0.5 tracking-widest uppercase">
                            CORE TECHNICAL SPECIFIC
                          </span>
                          <div className="space-y-3.5 max-h-[400px] overflow-y-auto pr-1">
                            {prepData.technical && prepData.technical.length > 0 ? (
                              prepData.technical.map((q, i) => (
                                <div key={i} className="border border-border p-3 space-y-2 bg-muted/5">
                                  <p className="text-xs font-extrabold uppercase text-foreground leading-normal">{q}</p>
                                  <span className="text-[8px] text-muted-foreground uppercase font-black">TOPIC MATCH: {company.jd_required_skills?.[0] || "COMPILERS/DBMS"}</span>
                                </div>
                              ))
                            ) : (
                              <p className="text-xs text-muted-foreground uppercase">No technical questions available.</p>
                            )}
                          </div>
                        </div>

                        {/* HR Questions */}
                        <div className="border-2 border-border p-5 space-y-4 bg-background">
                          <span className="text-[10px] font-black bg-muted border border-border px-2 py-0.5 tracking-widest uppercase text-muted-foreground">
                            HR & FOUNDATION QUESTIONS
                          </span>
                          <div className="space-y-3.5 max-h-[400px] overflow-y-auto pr-1">
                            {prepData.hr && prepData.hr.length > 0 ? (
                              prepData.hr.map((q, i) => (
                                <div key={i} className="border border-border p-3 space-y-1 bg-muted/5">
                                  <p className="text-xs font-extrabold uppercase text-foreground leading-normal">{q}</p>
                                </div>
                              ))
                            ) : (
                              <p className="text-xs text-muted-foreground uppercase">No HR questions available.</p>
                            )}
                          </div>
                        </div>

                        {/* Company Specific / Behavioral */}
                        <div className="border-2 border-border p-5 space-y-4 bg-background">
                          <span className="text-[10px] font-black bg-accent/20 border border-accent/20 px-2 py-0.5 tracking-widest uppercase text-accent">
                            COMPANY SPECIFIC & BEHAVIORAL
                          </span>
                          <div className="space-y-3.5 max-h-[400px] overflow-y-auto pr-1">
                            {prepData.company_specific && prepData.company_specific.length > 0 ? (
                              prepData.company_specific.map((q, i) => (
                                <div key={i} className="border border-border p-3 space-y-2 bg-accent/5 border-accent/20">
                                  <p className="text-xs font-extrabold uppercase text-foreground leading-normal">{q}</p>
                                </div>
                              ))
                            ) : (
                              <p className="text-xs text-muted-foreground uppercase">Trigger Cloud AI to compile behavioral questions for this drive.</p>
                            )}
                          </div>
                        </div>

                      </div>
                    ) : (
                      <div className="text-center py-20 border border-dashed border-border text-xs font-bold text-muted-foreground uppercase">
                        Interview questions will compile here.
                      </div>
                    )}

                  </div>
                )}

              </>
            ) : (
              <div className="text-center py-20 text-xs font-bold text-muted-foreground uppercase">
                Select a placement drive announcement to display the AI Toolkit Workspace.
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  );
}

export default function AIToolkitPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center font-sans">
        <div className="text-center space-y-4">
          <Loader2 className="animate-spin text-accent h-12 w-12 mx-auto" />
          <p className="text-xs font-bold tracking-widest uppercase text-muted-foreground">
            Synchronizing AI Placement Engine...
          </p>
        </div>
      </div>
    }>
      <AIToolkitContent />
    </Suspense>
  );
}
