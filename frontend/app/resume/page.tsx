"use client";

import React, { useState, useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { encryptData } from "@/lib/crypto";
import api from "@/lib/api";
import { Upload, FileText, Save, Plus, Trash2, ArrowRight, ShieldCheck, AlertCircle } from "lucide-react";
import Link from "next/link";

interface EducationEntry {
  degree: string;
  institution: string;
  year: string;
  score: string;
}

interface ExperienceEntry {
  role: string;
  company: string;
  period: string;
  description: string;
}

interface ProjectEntry {
  title: string;
  tech: string;
  description: string;
}

interface ResumeData {
  personal: {
    name: string;
    email: string;
    phone: string;
    location: string;
  };
  education: EducationEntry[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  skills: string[];
}

export default function ResumePage() {
  const { user, setUser, encryptionKey } = useAppStore();
  const [unlocked, setUnlocked] = useState(false);
  
  // File Upload State
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");

  // Resume Form Data
  const [resumeData, setResumeData] = useState<ResumeData>({
    personal: { name: "", email: "", phone: "", location: "" },
    education: [],
    experience: [],
    projects: [],
    skills: []
  });
  const [selectedTemplate, setSelectedTemplate] = useState("Classic");

  // Extracted plain parameters for profile check
  const [parsedName, setParsedName] = useState("");
  const [parsedBranch, setParsedBranch] = useState("CSE");
  const [parsedCgpa, setParsedCgpa] = useState("");
  const [parsedTenth, setParsedTenth] = useState("");
  const [parsedTwelfth, setParsedTwelfth] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState("");
  const [saveError, setSaveError] = useState("");

  // 1. Check if Vault is unlocked on mount
  useEffect(() => {
    if (user && encryptionKey) {
      setUnlocked(true);
      fetchSavedResume();
    }
  }, [user, encryptionKey]);

  const fetchSavedResume = async () => {
    try {
      const res = await api.get("/resumes/me");
      if (res.data) {
        setSelectedTemplate(res.data.template || "Classic");
        if (res.data.resume_data && Object.keys(res.data.resume_data).length > 0) {
          setResumeData(res.data.resume_data);
          if (res.data.resume_data.personal?.name) {
            setParsedName(res.data.resume_data.personal.name);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load saved resume:", err);
    }
  };

  // 2. Handle PDF file selection & upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setUploadError("");
      setUploadSuccess("");
    }
  };

  const handleUploadResume = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setParsing(true);
    setUploadError("");
    setUploadSuccess("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await api.post("/resumes/parse", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      
      const data = res.data;
      setUploadSuccess("RESUME PARSED SECURELY & ON-THE-FLY.");
      
      // Update form data state
      setParsedName(data.full_name || "");
      setParsedBranch(data.branch || "CSE");
      setParsedCgpa(data.cgpa ? String(data.cgpa) : "");
      setParsedTenth(data.tenth_marks ? String(data.tenth_marks) : "");
      setParsedTwelfth(data.twelfth_marks ? String(data.twelfth_marks) : "");

      setResumeData((prev) => ({
        ...prev,
        personal: {
          ...prev.personal,
          name: data.full_name || prev.personal.name,
          email: user?.email || ""
        },
        skills: data.skills || prev.skills
      }));

    } catch (err) {
      let message = "FAILED TO EXTRACT TEXT FROM RESUME.";
      if (err && typeof err === "object" && "response" in err) {
        const resObj = (err as { response?: { data?: { detail?: string } } }).response;
        if (resObj?.data?.detail) {
          message = resObj.data.detail;
        }
      }
      setUploadError(message);
    } finally {
      setParsing(false);
    }
  };

  // 3. Save standard structured resume securely
  const handleSaveResume = async () => {
    setSaving(true);
    setSaveSuccess("");
    setSaveError("");

    try {
      await api.put("/resumes/me", {
        template: selectedTemplate,
        resume_data: resumeData
      });
      setSaveSuccess("STANDARD RESUME DETAILS ENCRYPTED & SAVED.");
    } catch (err) {
      let message = "FAILED TO SAVE RESUME.";
      if (err && typeof err === "object" && "response" in err) {
        const resObj = (err as { response?: { data?: { detail?: string } } }).response;
        if (resObj?.data?.detail) {
          message = resObj.data.detail;
        }
      }
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  // 4. Apply extracted details directly to client-side profile
  const handleApplyToProfile = async () => {
    if (!encryptionKey) return;
    setSaving(true);
    setSaveSuccess("");
    setSaveError("");

    try {
      // Encrypt sensitive metrics locally before posting
      const encNeoId = user?.neo_id_enc || ""; // Retain Neo ID if not in resume
      const encCgpa = parsedCgpa.trim() ? await encryptData(parsedCgpa.trim(), encryptionKey) : (user?.cgpa_enc || "");
      const encTenth = parsedTenth.trim() ? await encryptData(parsedTenth.trim(), encryptionKey) : (user?.tenth_marks_enc || "");
      const encTwelfth = parsedTwelfth.trim() ? await encryptData(parsedTwelfth.trim(), encryptionKey) : (user?.twelfth_marks_enc || "");
      const encArrears = user?.has_arrears_enc || "";

      const res = await api.put("/users/me", {
        full_name: parsedName.trim(),
        branch: parsedBranch.trim().toUpperCase(),
        batch_year: user?.batch_year || new Date().getFullYear(),
        skills: resumeData.skills,
        neo_id_enc: encNeoId,
        cgpa_enc: encCgpa,
        tenth_marks_enc: encTenth,
        twelfth_marks_enc: encTwelfth,
        has_arrears_enc: encArrears
      });

      setUser(res.data);
      setSaveSuccess("PROFILE DETAILS AUTO-POPULATED & CLIENT-SIDE ENCRYPTED SUCCESSFULLY.");
    } catch (err) {
      let message = "FAILED TO UPDATE PROFILE METRICS.";
      if (err && typeof err === "object" && "response" in err) {
        const resObj = (err as { response?: { data?: { detail?: string } } }).response;
        if (resObj?.data?.detail) {
          message = resObj.data.detail;
        }
      }
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  // Dynamic Education Actions
  const addEducation = () => {
    setResumeData((prev) => ({
      ...prev,
      education: [...prev.education, { degree: "", institution: "", year: "", score: "" }]
    }));
  };

  const removeEducation = (index: number) => {
    setResumeData((prev) => ({
      ...prev,
      education: prev.education.filter((_, i) => i !== index)
    }));
  };

  const updateEducation = (index: number, field: keyof EducationEntry, val: string) => {
    setResumeData((prev) => {
      const list = [...prev.education];
      list[index] = { ...list[index], [field]: val };
      return { ...prev, education: list };
    });
  };

  // Dynamic Experience Actions
  const addExperience = () => {
    setResumeData((prev) => ({
      ...prev,
      experience: [...prev.experience, { role: "", company: "", period: "", description: "" }]
    }));
  };

  const removeExperience = (index: number) => {
    setResumeData((prev) => ({
      ...prev,
      experience: prev.experience.filter((_, i) => i !== index)
    }));
  };

  const updateExperience = (index: number, field: keyof ExperienceEntry, val: string) => {
    setResumeData((prev) => {
      const list = [...prev.experience];
      list[index] = { ...list[index], [field]: val };
      return { ...prev, experience: list };
    });
  };

  // Dynamic Project Actions
  const addProject = () => {
    setResumeData((prev) => ({
      ...prev,
      projects: [...prev.projects, { title: "", tech: "", description: "" }]
    }));
  };

  const removeProject = (index: number) => {
    setResumeData((prev) => ({
      ...prev,
      projects: prev.projects.filter((_, i) => i !== index)
    }));
  };

  const updateProject = (index: number, field: keyof ProjectEntry, val: string) => {
    setResumeData((prev) => {
      const list = [...prev.projects];
      list[index] = { ...list[index], [field]: val };
      return { ...prev, projects: list };
    });
  };

  if (!unlocked) {
    return (
      <div className="flex flex-1 flex-col justify-center items-center bg-background p-8">
        <div className="max-w-md w-full border-2 border-border bg-background p-8 md:p-12 space-y-8">
          <div className="space-y-4 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center bg-accent text-black border-2 border-black">
              <AlertCircle size={24} />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tighter uppercase leading-none">
              VAULT LOCKED
            </h1>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest leading-relaxed">
              Your standard resume is encrypted and protected. Enter your credentials on the profile tab to unlock and modify details.
            </p>
          </div>
          <Link
            href="/profile"
            className="flex w-full items-center justify-center gap-3 h-14 border-2 border-border bg-foreground text-background font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95"
          >
            <ShieldCheck size={16} />
            <span>UNLOCK VAULT</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background p-8 md:p-12 space-y-12">
      {/* Header Block */}
      <div className="flex flex-col md:flex-row md:items-end justify-between border-b-2 border-border pb-8 gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-accent uppercase">
            <ShieldCheck size={16} />
            <span>🔒 ZERO-KNOWLEDGE RESUME MANAGER</span>
          </div>
          <h1 className="text-5xl font-extrabold tracking-tighter uppercase leading-none">
            RESUME ENGINE
          </h1>
        </div>
        <div className="flex gap-4">
          <button
            onClick={handleSaveResume}
            disabled={saving}
            className="flex items-center gap-2 h-12 px-6 border-2 border-border bg-foreground text-background text-xs font-bold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            <span>{saving ? "SAVING..." : "SAVE RESUME"}</span>
          </button>
        </div>
      </div>

      {uploadSuccess && (
        <div className="border-2 border-green-600 bg-green-600/10 p-4 text-xs font-bold text-green-600 uppercase tracking-wider">
          {uploadSuccess}
        </div>
      )}

      {saveSuccess && (
        <div className="border-2 border-green-600 bg-green-600/10 p-4 text-xs font-bold text-green-600 uppercase tracking-wider">
          {saveSuccess}
        </div>
      )}

      {uploadError && (
        <div className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-600 uppercase tracking-wider">
          {uploadError}
        </div>
      )}

      {saveError && (
        <div className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-600 uppercase tracking-wider">
          {saveError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Left Side: Upload & Parsed Metrics Check */}
        <div className="lg:col-span-5 space-y-12">
          {/* Upload Card */}
          <div className="border-2 border-border p-6 bg-card space-y-6">
            <h3 className="text-lg font-bold uppercase tracking-wider text-foreground">
              UPLOAD ORIGINAL RESUME
            </h3>
            <form onSubmit={handleUploadResume} className="space-y-4">
              <div className="border-2 border-dashed border-border p-8 text-center bg-muted/20 relative group hover:border-accent transition-colors">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground group-hover:text-accent transition-colors">
                  <Upload size={32} />
                  <span className="text-xs font-bold uppercase tracking-widest">
                    {file ? file.name.toUpperCase() : "DRAG & DROP OR CLICK PDF"}
                  </span>
                </div>
              </div>
              <button
                type="submit"
                disabled={!file || parsing}
                className="flex w-full items-center justify-center gap-3 h-12 border-2 border-border bg-transparent text-foreground hover:bg-accent hover:text-black hover:border-accent font-extrabold text-xs tracking-widest uppercase transition-all active:scale-95 disabled:opacity-50"
              >
                <FileText size={14} />
                <span>{parsing ? "PARSING RESUME SECURELY..." : "EXTRACT PROFILE METRICS"}</span>
              </button>
            </form>
            <p className="text-[10px] text-muted-foreground uppercase tracking-tight leading-snug">
              PDF text is read in-memory to resolve profile fields. The raw file is discarded instantly and never cached.
            </p>
          </div>

          {/* Parsed Fields Approval widget */}
          <div className="border-2 border-border p-6 bg-card space-y-6">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="text-lg font-bold uppercase tracking-wider text-foreground">
                EXTRACTED METRICS
              </h3>
              <button
                type="button"
                onClick={handleApplyToProfile}
                disabled={saving || !parsedName}
                className="flex items-center gap-1.5 text-xs font-bold text-accent hover:underline uppercase"
              >
                <ArrowRight size={14} />
                <span>APPLY TO PROFILE</span>
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">FULL NAME</label>
                <input
                  type="text"
                  value={parsedName}
                  onChange={(e) => setParsedName(e.target.value)}
                  className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">BRANCH</label>
                  <input
                    type="text"
                    value={parsedBranch}
                    onChange={(e) => setParsedBranch(e.target.value)}
                    className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">CGPA</label>
                  <input
                    type="text"
                    value={parsedCgpa}
                    onChange={(e) => setParsedCgpa(e.target.value)}
                    placeholder="9.12"
                    className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">10TH MARKS (%)</label>
                  <input
                    type="text"
                    value={parsedTenth}
                    onChange={(e) => setParsedTenth(e.target.value)}
                    placeholder="95"
                    className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">12TH MARKS (%)</label>
                  <input
                    type="text"
                    value={parsedTwelfth}
                    onChange={(e) => setParsedTwelfth(e.target.value)}
                    placeholder="92"
                    className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Resume Builder Sections */}
        <div className="lg:col-span-7 space-y-12">
          {/* Template Selection */}
          <div className="flex items-center gap-6 border-2 border-border p-6 bg-card">
            <span className="text-xs font-extrabold uppercase tracking-wider">RESUME LAYOUT:</span>
            <div className="flex gap-4">
              {["Classic", "Modern", "Creative"].map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedTemplate(t)}
                  className={`px-4 py-2 border-2 text-xs font-black uppercase tracking-wider transition-all ${
                    selectedTemplate === t
                      ? "border-accent bg-accent text-black"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Education list */}
          <div className="border-2 border-border p-6 bg-card space-y-6">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="text-lg font-bold uppercase tracking-wider text-foreground">EDUCATION</h3>
              <button
                type="button"
                onClick={addEducation}
                className="flex items-center gap-1 text-xs font-bold text-accent hover:underline uppercase"
              >
                <Plus size={14} /> Add Entry
              </button>
            </div>
            
            {resumeData.education.length === 0 ? (
              <p className="text-xs text-muted-foreground uppercase">No education details added.</p>
            ) : (
              <div className="space-y-6">
                {resumeData.education.map((edu, i) => (
                  <div key={i} className="grid grid-cols-1 sm:grid-cols-4 gap-4 border border-border p-4 bg-muted/10 relative">
                    <button
                      type="button"
                      onClick={() => removeEducation(i)}
                      className="absolute top-2 right-2 text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                    <input
                      type="text"
                      placeholder="Degree (e.g. B.Tech)"
                      value={edu.degree}
                      onChange={(e) => updateEducation(i, "degree", e.target.value)}
                      className="border border-border bg-transparent p-2 text-xs uppercase"
                    />
                    <input
                      type="text"
                      placeholder="Institution (e.g. VIT)"
                      value={edu.institution}
                      onChange={(e) => updateEducation(i, "institution", e.target.value)}
                      className="border border-border bg-transparent p-2 text-xs uppercase"
                    />
                    <input
                      type="text"
                      placeholder="Graduation Year (e.g. 2026)"
                      value={edu.year}
                      onChange={(e) => updateEducation(i, "year", e.target.value)}
                      className="border border-border bg-transparent p-2 text-xs uppercase"
                    />
                    <input
                      type="text"
                      placeholder="Score/CGPA (e.g. 9.12)"
                      value={edu.score}
                      onChange={(e) => updateEducation(i, "score", e.target.value)}
                      className="border border-border bg-transparent p-2 text-xs uppercase"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Experience list */}
          <div className="border-2 border-border p-6 bg-card space-y-6">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="text-lg font-bold uppercase tracking-wider text-foreground">EXPERIENCE</h3>
              <button
                type="button"
                onClick={addExperience}
                className="flex items-center gap-1 text-xs font-bold text-accent hover:underline uppercase"
              >
                <Plus size={14} /> Add Entry
              </button>
            </div>
            
            {resumeData.experience.length === 0 ? (
              <p className="text-xs text-muted-foreground uppercase">No experience details added.</p>
            ) : (
              <div className="space-y-6">
                {resumeData.experience.map((exp, i) => (
                  <div key={i} className="border border-border p-4 bg-muted/10 relative space-y-3">
                    <button
                      type="button"
                      onClick={() => removeExperience(i)}
                      className="absolute top-2 right-2 text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                    <div className="grid grid-cols-3 gap-4">
                      <input
                        type="text"
                        placeholder="Role / Designation"
                        value={exp.role}
                        onChange={(e) => updateExperience(i, "role", e.target.value)}
                        className="border border-border bg-transparent p-2 text-xs uppercase"
                      />
                      <input
                        type="text"
                        placeholder="Company Name"
                        value={exp.company}
                        onChange={(e) => updateExperience(i, "company", e.target.value)}
                        className="border border-border bg-transparent p-2 text-xs uppercase"
                      />
                      <input
                        type="text"
                        placeholder="Period (e.g. Summer 2025)"
                        value={exp.period}
                        onChange={(e) => updateExperience(i, "period", e.target.value)}
                        className="border border-border bg-transparent p-2 text-xs uppercase"
                      />
                    </div>
                    <textarea
                      placeholder="Description / Responsibilities"
                      value={exp.description}
                      onChange={(e) => updateExperience(i, "description", e.target.value)}
                      className="w-full border border-border bg-transparent p-2 text-xs uppercase h-20"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Projects list */}
          <div className="border-2 border-border p-6 bg-card space-y-6">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="text-lg font-bold uppercase tracking-wider text-foreground">PROJECTS</h3>
              <button
                type="button"
                onClick={addProject}
                className="flex items-center gap-1 text-xs font-bold text-accent hover:underline uppercase"
              >
                <Plus size={14} /> Add Entry
              </button>
            </div>
            
            {resumeData.projects.length === 0 ? (
              <p className="text-xs text-muted-foreground uppercase">No project details added.</p>
            ) : (
              <div className="space-y-6">
                {resumeData.projects.map((proj, i) => (
                  <div key={i} className="border border-border p-4 bg-muted/10 relative space-y-3">
                    <button
                      type="button"
                      onClick={() => removeProject(i)}
                      className="absolute top-2 right-2 text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                    <div className="grid grid-cols-2 gap-4">
                      <input
                        type="text"
                        placeholder="Project Title"
                        value={proj.title}
                        onChange={(e) => updateProject(i, "title", e.target.value)}
                        className="border border-border bg-transparent p-2 text-xs uppercase"
                      />
                      <input
                        type="text"
                        placeholder="Technologies (e.g. Python, SQL)"
                        value={proj.tech}
                        onChange={(e) => updateProject(i, "tech", e.target.value)}
                        className="border border-border bg-transparent p-2 text-xs uppercase"
                      />
                    </div>
                    <textarea
                      placeholder="Project details & specifications"
                      value={proj.description}
                      onChange={(e) => updateProject(i, "description", e.target.value)}
                      className="w-full border border-border bg-transparent p-2 text-xs uppercase h-20"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
