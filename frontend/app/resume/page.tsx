"use client";

import React, { useState, useEffect } from "react";
import { useAppStore } from "@/lib/store";
import api from "@/lib/api";
import { 
  Upload, 
  FileText, 
  Save, 
  Plus, 
  Trash2, 
  ArrowRight, 
  ShieldCheck, 
  AlertCircle, 
  Printer, 
  ArrowUp, 
  ArrowDown
} from "lucide-react";
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
    title?: string;
    github?: string;
    linkedin?: string;
    website?: string;
  };
  summary?: string;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  skills: string[];
  certifications?: string[];
  languages?: string[];
  awards?: string[];
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
    personal: { name: "", email: "", phone: "", location: "", title: "", github: "", linkedin: "", website: "" },
    summary: "",
    education: [],
    experience: [],
    projects: [],
    skills: [],
    certifications: [],
    languages: [],
    awards: []
  });
  const [selectedTemplate, setSelectedTemplate] = useState("Classic Single");
  const [sectionOrder, setSectionOrder] = useState<string[]>([
    "summary",
    "education",
    "experience",
    "projects",
    "skills",
    "certifications",
    "languages",
    "awards"
  ]);

  // Extracted plain parameters for profile check
  const [parsedName, setParsedName] = useState("");
  const [parsedBranch, setParsedBranch] = useState("CSE");
  const [parsedCgpa, setParsedCgpa] = useState("");
  const [parsedTenth, setParsedTenth] = useState("");
  const [parsedTwelfth, setParsedTwelfth] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState("");
  const [saveError, setSaveError] = useState("");

  // Input helpers
  const [newSkill, setNewSkill] = useState("");
  const [newCertification, setNewCertification] = useState("");
  const [newLanguage, setNewLanguage] = useState("");
  const [newAward, setNewAward] = useState("");

  const { 
    education, 
    experience, 
    projects, 
    skills, 
    certifications = [], 
    languages = [], 
    awards = [] 
  } = resumeData;

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
        setSelectedTemplate(res.data.template || "Classic Single");
        if (res.data.resume_data && Object.keys(res.data.resume_data).length > 0) {
          const loadedData = res.data.resume_data;
          setResumeData({
            personal: {
              name: loadedData.personal?.name || "",
              email: loadedData.personal?.email || "",
              phone: loadedData.personal?.phone || "",
              location: loadedData.personal?.location || "",
              title: loadedData.personal?.title || "",
              github: loadedData.personal?.github || "",
              linkedin: loadedData.personal?.linkedin || "",
              website: loadedData.personal?.website || ""
            },
            summary: loadedData.summary || "",
            education: loadedData.education || [],
            experience: loadedData.experience || [],
            projects: loadedData.projects || [],
            skills: loadedData.skills || [],
            certifications: loadedData.certifications || [],
            languages: loadedData.languages || [],
            awards: loadedData.awards || []
          });
          if (loadedData.personal?.name) {
            setParsedName(loadedData.personal.name);
          }
          if (loadedData.sectionOrder) {
            setSectionOrder(loadedData.sectionOrder);
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
        resume_data: {
          ...resumeData,
          sectionOrder
        }
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
      // Retain Neo ID from active profile
      const encNeoId = user?.neo_id_enc || "UNSET";

      // Parse plaintext values or fallback to profile defaults
      const cgpaVal = parsedCgpa.trim() ? parseFloat(parsedCgpa.trim()) : (user?.cgpa || 0.0);
      const tenthVal = parsedTenth.trim() ? parseFloat(parsedTenth.trim()) : (user?.tenth_marks || 0.0);
      const twelfthVal = parsedTwelfth.trim() ? parseFloat(parsedTwelfth.trim()) : (user?.twelfth_marks || 0.0);
      const arrearsVal = user?.has_arrears || false;

      const res = await api.put("/users/me", {
        full_name: parsedName.trim(),
        branch: parsedBranch.trim().toUpperCase(),
        batch_year: user?.batch_year || new Date().getFullYear(),
        skills: resumeData.skills,
        neo_id_enc: encNeoId,
        cgpa: cgpaVal,
        tenth_marks: tenthVal,
        twelfth_marks: twelfthVal,
        has_arrears: arrearsVal
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

  // Skills tag actions
  const addSkill = () => {
    if (newSkill.trim() && !resumeData.skills.includes(newSkill.trim())) {
      setResumeData((prev) => ({ ...prev, skills: [...prev.skills, newSkill.trim()] }));
      setNewSkill("");
    }
  };
  const removeSkill = (skill: string) => {
    setResumeData((prev) => ({ ...prev, skills: prev.skills.filter((s) => s !== skill) }));
  };

  // Certifications tag actions
  const addCertification = () => {
    if (newCertification.trim() && !resumeData.certifications?.includes(newCertification.trim())) {
      setResumeData((prev) => ({ 
        ...prev, 
        certifications: [...(prev.certifications || []), newCertification.trim()] 
      }));
      setNewCertification("");
    }
  };
  const removeCertification = (cert: string) => {
    setResumeData((prev) => ({ 
      ...prev, 
      certifications: (prev.certifications || []).filter((c) => c !== cert) 
    }));
  };

  // Languages tag actions
  const addLanguage = () => {
    if (newLanguage.trim() && !resumeData.languages?.includes(newLanguage.trim())) {
      setResumeData((prev) => ({ 
        ...prev, 
        languages: [...(prev.languages || []), newLanguage.trim()] 
      }));
      setNewLanguage("");
    }
  };
  const removeLanguage = (lang: string) => {
    setResumeData((prev) => ({ 
      ...prev, 
      languages: (prev.languages || []).filter((l) => l !== lang) 
    }));
  };

  // Awards tag actions
  const addAward = () => {
    if (newAward.trim() && !resumeData.awards?.includes(newAward.trim())) {
      setResumeData((prev) => ({ 
        ...prev, 
        awards: [...(prev.awards || []), newAward.trim()] 
      }));
      setNewAward("");
    }
  };
  const removeAward = (award: string) => {
    setResumeData((prev) => ({ 
      ...prev, 
      awards: (prev.awards || []).filter((a) => a !== award) 
    }));
  };

  // Section Reordering
  const moveSection = (index: number, direction: "up" | "down") => {
    const newOrder = [...sectionOrder];
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx >= 0 && targetIdx < newOrder.length) {
      const temp = newOrder[index];
      newOrder[index] = newOrder[targetIdx];
      newOrder[targetIdx] = temp;
      setSectionOrder(newOrder);
    }
  };

  // Trigger browser print PDF flow
  const handlePrint = () => {
    window.print();
  };

  // Render Preview sections
  const renderResumePreview = () => {
    const { personal, education, experience, projects, skills, certifications = [], languages = [], awards = [] } = resumeData;

    // Contact line formatting helper
    const contactItems = [];
    if (personal.email) contactItems.push(personal.email);
    if (personal.phone) contactItems.push(personal.phone);
    if (personal.location) contactItems.push(personal.location);
    if (personal.github) contactItems.push(personal.github);
    if (personal.linkedin) contactItems.push(personal.linkedin);
    if (personal.website) contactItems.push(personal.website);

    const renderSectionByOrder = (isSidebar: boolean = false) => {
      // Filter out sections based on template needs
      const listToRender = sectionOrder.filter(key => {
        if (selectedTemplate === "Classic Two" || selectedTemplate === "Modern Two" || selectedTemplate === "Vivid") {
          // Two column layouts
          const sidebarKeys = ["skills", "languages", "education"];
          if (selectedTemplate === "Vivid") {
            sidebarKeys.push("awards");
          }
          return isSidebar ? sidebarKeys.includes(key) : !sidebarKeys.includes(key);
        }
        // One column layout
        return !isSidebar;
      });

      return listToRender.map(key => {
        switch (key) {
          case "summary":
            if (!resumeData.summary) return null;
            return (
              <div key="summary" className="mb-5">
                {selectedTemplate === "LaTeX" ? (
                  <>
                    <h3 className="text-[11px] font-bold uppercase border-b border-black pb-0.5 mb-1.5 tracking-wider font-serif">Summary</h3>
                    <p className="text-[10px] text-justify font-serif text-black leading-relaxed">{resumeData.summary}</p>
                  </>
                ) : selectedTemplate === "Clean" ? (
                  <>
                    <h3 className="text-xs font-extrabold uppercase text-gray-700 mb-1 tracking-widest">Summary</h3>
                    <p className="text-xs text-justify text-gray-600 leading-relaxed">{resumeData.summary}</p>
                  </>
                ) : selectedTemplate === "Vivid" ? (
                  <>
                    <h3 className="text-[13px] font-black uppercase text-indigo-700 tracking-wider mb-2 border-b-2 border-indigo-100 pb-0.5">Professional Summary</h3>
                    <p className="text-xs text-justify text-gray-700 leading-relaxed pl-2 border-l-2 border-indigo-400">{resumeData.summary}</p>
                  </>
                ) : (
                  <>
                    <h3 className="text-[13px] font-black uppercase border-b border-gray-400 pb-1 mb-2 tracking-wider">Summary</h3>
                    <p className="text-xs text-justify text-gray-700 leading-relaxed">{resumeData.summary}</p>
                  </>
                )}
              </div>
            );

          case "education":
            if (education.length === 0) return null;
            return (
              <div key="education" className="mb-5">
                {selectedTemplate === "LaTeX" ? (
                  <>
                    <h3 className="text-[11px] font-bold uppercase border-b border-black pb-0.5 mb-2 tracking-wider font-serif">Education</h3>
                    <div className="space-y-2 font-serif text-[10px]">
                      {education.map((edu, idx) => (
                        <div key={idx} className="flex justify-between items-baseline">
                          <div>
                            <span className="font-bold">{edu.institution}</span>
                            <span className="mx-1.5">·</span>
                            <span className="italic">{edu.degree}</span>
                          </div>
                          <span className="text-right font-bold">{edu.year} | {edu.score}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : selectedTemplate === "Clean" ? (
                  <>
                    <h3 className="text-xs font-extrabold uppercase text-gray-700 mb-2 tracking-widest">Education</h3>
                    <div className="space-y-2.5">
                      {education.map((edu, idx) => (
                        <div key={idx} className="text-xs">
                          <div className="flex justify-between font-bold text-gray-800">
                            <span>{edu.institution}</span>
                            <span>{edu.year}</span>
                          </div>
                          <div className="flex justify-between text-gray-500 italic mt-0.5">
                            <span>{edu.degree}</span>
                            <span>{edu.score}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : selectedTemplate === "Vivid" ? (
                  <>
                    <h3 className="text-[13px] font-black uppercase text-indigo-700 tracking-wider mb-2 border-b-2 border-indigo-100 pb-0.5">Education</h3>
                    <div className="space-y-3">
                      {education.map((edu, idx) => (
                        <div key={idx} className="text-xs">
                          <h4 className="font-extrabold text-gray-900 uppercase leading-snug">{edu.institution}</h4>
                          <div className="text-[11px] text-gray-500 font-bold uppercase mt-0.5">{edu.degree}</div>
                          <div className="text-[10px] text-indigo-600 font-extrabold mt-0.5">{edu.year} | {edu.score}</div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="text-[13px] font-black uppercase border-b border-gray-400 pb-1 mb-2 tracking-wider">Education</h3>
                    <div className="space-y-2">
                      {education.map((edu, idx) => (
                        <div key={idx} className="flex justify-between items-baseline text-xs leading-normal">
                          <div>
                            <span className="font-extrabold uppercase">{edu.institution}</span>
                            <span className="mx-2 text-gray-400">|</span>
                            <span className="italic uppercase">{edu.degree}</span>
                          </div>
                          <div className="text-right font-bold text-gray-700">
                            {edu.year} {edu.score && `| ${edu.score}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );

          case "experience":
            if (experience.length === 0) return null;
            return (
              <div key="experience" className="mb-5">
                {selectedTemplate === "LaTeX" ? (
                  <>
                    <h3 className="text-[11px] font-bold uppercase border-b border-black pb-0.5 mb-2 tracking-wider font-serif">Experience</h3>
                    <div className="space-y-3 font-serif text-[10px]">
                      {experience.map((exp, idx) => (
                        <div key={idx} className="space-y-1">
                          <div className="flex justify-between items-baseline font-bold">
                            <span>{exp.company} — {exp.role}</span>
                            <span>{exp.period}</span>
                          </div>
                          <p className="text-[9.5px] leading-relaxed text-justify whitespace-pre-wrap pl-2 border-l border-black/40">{exp.description}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : selectedTemplate === "Clean" ? (
                  <>
                    <h3 className="text-xs font-extrabold uppercase text-gray-700 mb-2 tracking-widest">Experience</h3>
                    <div className="space-y-4">
                      {experience.map((exp, idx) => (
                        <div key={idx} className="text-xs space-y-1">
                          <div className="flex justify-between font-bold text-gray-800">
                            <span>{exp.company}</span>
                            <span>{exp.period}</span>
                          </div>
                          <div className="text-gray-500 italic uppercase text-[10px] font-semibold">{exp.role}</div>
                          <p className="text-gray-600 leading-relaxed whitespace-pre-wrap text-[11px]">{exp.description}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : selectedTemplate === "Vivid" ? (
                  <>
                    <h3 className="text-[13px] font-black uppercase text-indigo-700 tracking-wider mb-2 border-b-2 border-indigo-100 pb-0.5">Experience</h3>
                    <div className="space-y-4">
                      {experience.map((exp, idx) => (
                        <div key={idx} className="text-xs space-y-1">
                          <div className="flex justify-between items-baseline font-bold uppercase text-gray-900">
                            <span>{exp.company}</span>
                            <span className="text-[10px] text-gray-500">{exp.period}</span>
                          </div>
                          <div className="text-indigo-600 font-extrabold text-[10px] uppercase">{exp.role}</div>
                          <p className="text-gray-700 leading-relaxed whitespace-pre-wrap pl-2.5 border-l border-indigo-200 text-[11px]">{exp.description}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="text-[13px] font-black uppercase border-b border-gray-400 pb-1 mb-2 tracking-wider">Experience</h3>
                    <div className="space-y-3">
                      {experience.map((exp, idx) => (
                        <div key={idx} className="space-y-1">
                          <div className="flex justify-between items-baseline text-xs leading-normal">
                            <div>
                              <span className="font-extrabold uppercase">{exp.company}</span>
                              <span className="mx-2 text-gray-400">|</span>
                              <span className="italic uppercase">{exp.role}</span>
                            </div>
                            <div className="text-right font-bold text-gray-500">{exp.period}</div>
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap pl-2 border-l border-gray-200">{exp.description}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );

          case "projects":
            if (projects.length === 0) return null;
            return (
              <div key="projects" className="mb-5">
                {selectedTemplate === "LaTeX" ? (
                  <>
                    <h3 className="text-[11px] font-bold uppercase border-b border-black pb-0.5 mb-2 tracking-wider font-serif">Projects</h3>
                    <div className="space-y-3 font-serif text-[10px]">
                      {projects.map((proj, idx) => (
                        <div key={idx} className="space-y-1">
                          <div className="flex justify-between items-baseline font-bold">
                            <span>{proj.title} {proj.tech && `[${proj.tech}]`}</span>
                          </div>
                          <p className="text-[9.5px] leading-relaxed text-justify whitespace-pre-wrap pl-2 border-l border-black/40">{proj.description}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : selectedTemplate === "Clean" ? (
                  <>
                    <h3 className="text-xs font-extrabold uppercase text-gray-700 mb-2 tracking-widest">Projects</h3>
                    <div className="space-y-4">
                      {projects.map((proj, idx) => (
                        <div key={idx} className="text-xs space-y-1">
                          <div className="flex justify-between font-bold text-gray-800">
                            <span>{proj.title}</span>
                            {proj.tech && <span className="text-[10px] font-bold text-gray-500 uppercase bg-gray-100 px-1.5 py-0.5 border border-gray-200">{proj.tech}</span>}
                          </div>
                          <p className="text-gray-600 leading-relaxed whitespace-pre-wrap text-[11px]">{proj.description}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : selectedTemplate === "Vivid" ? (
                  <>
                    <h3 className="text-[13px] font-black uppercase text-indigo-700 tracking-wider mb-2 border-b-2 border-indigo-100 pb-0.5">Projects</h3>
                    <div className="space-y-4">
                      {projects.map((proj, idx) => (
                        <div key={idx} className="text-xs space-y-1">
                          <div className="flex justify-between items-baseline font-bold uppercase text-gray-900">
                            <span>{proj.title}</span>
                            {proj.tech && <span className="text-[9px] font-extrabold text-indigo-600 uppercase bg-indigo-50 border border-indigo-100 px-1.5 py-0.5">{proj.tech}</span>}
                          </div>
                          <p className="text-gray-700 leading-relaxed whitespace-pre-wrap pl-2.5 border-l border-indigo-200 text-[11px]">{proj.description}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="text-[13px] font-black uppercase border-b border-gray-400 pb-1 mb-2 tracking-wider">Projects</h3>
                    <div className="space-y-3">
                      {projects.map((proj, idx) => (
                        <div key={idx} className="space-y-1">
                          <div className="flex justify-between items-baseline text-xs leading-normal">
                            <div>
                              <span className="font-extrabold uppercase">{proj.title}</span>
                              {proj.tech && (
                                <>
                                  <span className="mx-2 text-gray-400">|</span>
                                  <span className="font-bold text-gray-600 uppercase text-[10px] bg-gray-100 px-1.5 py-0.5 border border-gray-200">{proj.tech}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap pl-2 border-l border-gray-200">{proj.description}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );

          case "skills":
            if (skills.length === 0) return null;
            return (
              <div key="skills" className="mb-5">
                {selectedTemplate === "LaTeX" ? (
                  <>
                    <h3 className="text-[11px] font-bold uppercase border-b border-black pb-0.5 mb-1.5 tracking-wider font-serif">Skills</h3>
                    <div className="text-[10px] font-serif text-black leading-relaxed">{skills.join(", ")}</div>
                  </>
                ) : selectedTemplate === "Clean" ? (
                  <>
                    <h3 className="text-xs font-extrabold uppercase text-gray-700 mb-1 tracking-widest">Skills</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {skills.map((skill, idx) => (
                        <span key={idx} className="border border-gray-300 px-2 py-0.5 bg-gray-50 text-gray-600 font-bold uppercase text-[9px]">{skill}</span>
                      ))}
                    </div>
                  </>
                ) : selectedTemplate === "Vivid" ? (
                  <>
                    <h3 className="text-[13px] font-black uppercase text-indigo-700 tracking-wider mb-2 border-b-2 border-indigo-100 pb-0.5">Skills</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {skills.map((skill, idx) => (
                        <span key={idx} className="border-2 border-indigo-200 px-2 py-0.5 bg-indigo-50/30 text-indigo-700 font-extrabold uppercase text-[9px]">{skill}</span>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="text-[13px] font-black uppercase border-b border-gray-400 pb-1 mb-2 tracking-wider">Skills</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {skills.map((skill, idx) => (
                        <span key={idx} className="border border-gray-300 px-2 py-0.5 bg-gray-50 font-bold uppercase text-[10px]">{skill}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );

          case "certifications":
            if (certifications.length === 0) return null;
            return (
              <div key="certifications" className="mb-5">
                {selectedTemplate === "LaTeX" ? (
                  <>
                    <h3 className="text-[11px] font-bold uppercase border-b border-black pb-0.5 mb-1.5 tracking-wider font-serif">Certifications</h3>
                    <div className="text-[10px] font-serif text-black leading-relaxed">{certifications.join(", ")}</div>
                  </>
                ) : selectedTemplate === "Clean" ? (
                  <>
                    <h3 className="text-xs font-extrabold uppercase text-gray-700 mb-1 tracking-widest">Certifications</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {certifications.map((cert, idx) => (
                        <span key={idx} className="border border-gray-300 px-2 py-0.5 bg-gray-50 text-gray-600 font-bold uppercase text-[9px]">{cert}</span>
                      ))}
                    </div>
                  </>
                ) : selectedTemplate === "Vivid" ? (
                  <>
                    <h3 className="text-[13px] font-black uppercase text-indigo-700 tracking-wider mb-2 border-b-2 border-indigo-100 pb-0.5">Certifications</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {certifications.map((cert, idx) => (
                        <span key={idx} className="border-2 border-indigo-200 px-2 py-0.5 bg-indigo-50/30 text-indigo-700 font-extrabold uppercase text-[9px]">{cert}</span>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="text-[13px] font-black uppercase border-b border-gray-400 pb-1 mb-2 tracking-wider">Certifications</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {certifications.map((cert, idx) => (
                        <span key={idx} className="border border-gray-300 px-2 py-0.5 bg-gray-50 font-bold uppercase text-[10px]">{cert}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );

          case "languages":
            if (languages.length === 0) return null;
            return (
              <div key="languages" className="mb-5">
                {selectedTemplate === "LaTeX" ? (
                  <>
                    <h3 className="text-[11px] font-bold uppercase border-b border-black pb-0.5 mb-1.5 tracking-wider font-serif">Languages</h3>
                    <div className="text-[10px] font-serif text-black leading-relaxed">{languages.join(", ")}</div>
                  </>
                ) : selectedTemplate === "Clean" ? (
                  <>
                    <h3 className="text-xs font-extrabold uppercase text-gray-700 mb-1 tracking-widest">Languages</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {languages.map((lang, idx) => (
                        <span key={idx} className="border border-gray-300 px-2 py-0.5 bg-gray-50 text-gray-600 font-bold uppercase text-[9px]">{lang}</span>
                      ))}
                    </div>
                  </>
                ) : selectedTemplate === "Vivid" ? (
                  <>
                    <h3 className="text-[13px] font-black uppercase text-indigo-700 tracking-wider mb-2 border-b-2 border-indigo-100 pb-0.5">Languages</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {languages.map((lang, idx) => (
                        <span key={idx} className="border-2 border-indigo-200 px-2 py-0.5 bg-indigo-50/30 text-indigo-700 font-extrabold uppercase text-[9px]">{lang}</span>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="text-[13px] font-black uppercase border-b border-gray-400 pb-1 mb-2 tracking-wider">Languages</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {languages.map((lang, idx) => (
                        <span key={idx} className="border border-gray-300 px-2 py-0.5 bg-gray-50 font-bold uppercase text-[10px]">{lang}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );

          case "awards":
            if (awards.length === 0) return null;
            return (
              <div key="awards" className="mb-5">
                {selectedTemplate === "LaTeX" ? (
                  <>
                    <h3 className="text-[11px] font-bold uppercase border-b border-black pb-0.5 mb-1.5 tracking-wider font-serif">Awards</h3>
                    <div className="text-[10px] font-serif text-black leading-relaxed">{awards.join(", ")}</div>
                  </>
                ) : selectedTemplate === "Clean" ? (
                  <>
                    <h3 className="text-xs font-extrabold uppercase text-gray-700 mb-1 tracking-widest">Awards</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {awards.map((award, idx) => (
                        <span key={idx} className="border border-gray-300 px-2 py-0.5 bg-gray-50 text-gray-600 font-bold uppercase text-[9px]">{award}</span>
                      ))}
                    </div>
                  </>
                ) : selectedTemplate === "Vivid" ? (
                  <>
                    <h3 className="text-[13px] font-black uppercase text-indigo-700 tracking-wider mb-2 border-b-2 border-indigo-100 pb-0.5">Awards</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {awards.map((award, idx) => (
                        <span key={idx} className="border-2 border-indigo-200 px-2 py-0.5 bg-indigo-50/30 text-indigo-700 font-extrabold uppercase text-[9px]">{award}</span>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="text-[13px] font-black uppercase border-b border-gray-400 pb-1 mb-2 tracking-wider">Awards</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {awards.map((award, idx) => (
                        <span key={idx} className="border border-gray-300 px-2 py-0.5 bg-gray-50 font-bold uppercase text-[10px]">{award}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          default:
            return null;
        }
      });
    };

    if (selectedTemplate === "Classic Single") {
      return (
        <div id="resume-preview-sheet" className="w-full bg-white text-black p-8 shadow-md border border-gray-200 font-sans min-h-[297mm]">
          <div className="text-center space-y-2 mb-6">
            <h1 className="text-3xl font-black uppercase tracking-tight">{personal.name || "Student Candidate"}</h1>
            {personal.title && <div className="text-xs font-bold text-gray-500 uppercase tracking-widest">{personal.title}</div>}
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-gray-600 font-bold uppercase">
              {contactItems.map((item, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="text-gray-300">|</span>}
                  <span>{item}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            {renderSectionByOrder(false)}
          </div>
        </div>
      );
    } 
    
    if (selectedTemplate === "Modern Single") {
      return (
        <div id="resume-preview-sheet" className="w-full bg-white text-black p-8 shadow-md border border-gray-200 font-sans min-h-[297mm]">
          <div className="border-l-4 border-black pl-4 py-1 space-y-1.5 mb-8">
            <h1 className="text-3xl font-black uppercase tracking-tight">{personal.name || "Student Candidate"}</h1>
            {personal.title && <div className="text-xs font-bold text-gray-600 uppercase tracking-widest">{personal.title}</div>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 font-bold uppercase">
              {contactItems.map((item, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="text-gray-300">·</span>}
                  <span>{item}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="space-y-6">
            {renderSectionByOrder(false)}
          </div>
        </div>
      );
    }

    if (selectedTemplate === "Classic Two") {
      return (
        <div id="resume-preview-sheet" className="w-full bg-white text-black p-8 shadow-md border border-gray-200 font-sans min-h-[297mm] grid grid-cols-12 gap-8">
          {/* Sidebar */}
          <div className="col-span-4 border-r border-gray-200 pr-6 space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl font-black uppercase leading-tight">{personal.name || "Student"}</h1>
              {personal.title && <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{personal.title}</div>}
            </div>
            
            <div className="space-y-3 text-[10px] font-bold uppercase text-gray-600">
              {contactItems.map((item, idx) => (
                <div key={idx} className="break-all">
                  <span className="block text-[8px] text-gray-400 font-black uppercase">LINK / CONTACT {idx + 1}</span>
                  {item}
                </div>
              ))}
            </div>

            {renderSectionByOrder(true)}
          </div>

          {/* Main Area */}
          <div className="col-span-8 space-y-6">
            {renderSectionByOrder(false)}
          </div>
        </div>
      );
    }

    if (selectedTemplate === "Modern Two") {
      return (
        <div id="resume-preview-sheet" className="w-full bg-white text-black p-8 shadow-md border border-gray-200 font-sans min-h-[297mm]">
          <div className="bg-gray-950 text-white p-6 -mx-8 -mt-8 mb-6 space-y-2">
            <h1 className="text-3xl font-black uppercase tracking-tight">{personal.name || "Student Candidate"}</h1>
            {personal.title && <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">{personal.title}</div>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-300 font-bold uppercase">
              {contactItems.map((item, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="text-gray-600">|</span>}
                  <span>{item}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
          
          <div className="grid grid-cols-12 gap-8">
            <div className="col-span-4 space-y-6">
              {renderSectionByOrder(true)}
            </div>

            <div className="col-span-8 space-y-6">
              {renderSectionByOrder(false)}
            </div>
          </div>
        </div>
      );
    }

    if (selectedTemplate === "Vivid") {
      return (
        <div id="resume-preview-sheet" className="w-full bg-white text-black p-8 shadow-md border border-gray-200 font-sans min-h-[297mm]">
          <div className="bg-gradient-to-r from-indigo-900 to-indigo-700 text-white p-6 -mx-8 -mt-8 mb-6 space-y-2.5">
            <h1 className="text-3xl font-black uppercase tracking-tight">{personal.name || "Student Candidate"}</h1>
            {personal.title && <div className="text-xs font-extrabold text-indigo-200 uppercase tracking-widest">{personal.title}</div>}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-indigo-100 font-bold uppercase">
              {contactItems.map((item, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="text-indigo-400">✦</span>}
                  <span>{item}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
          
          <div className="grid grid-cols-12 gap-8">
            {/* Main Area */}
            <div className="col-span-8 space-y-6">
              {renderSectionByOrder(false)}
            </div>

            {/* Sidebar */}
            <div className="col-span-4 bg-indigo-50/20 -my-8 -mr-8 p-6 space-y-6 border-l border-indigo-100">
              {renderSectionByOrder(true)}
            </div>
          </div>
        </div>
      );
    }

    if (selectedTemplate === "LaTeX") {
      return (
        <div id="resume-preview-sheet" className="w-full bg-white text-black p-8 shadow-md border border-gray-200 font-serif min-h-[297mm]">
          <div className="text-center space-y-1.5 mb-6 font-serif">
            <h1 className="text-3xl font-bold uppercase tracking-tight font-serif">{personal.name || "Student Candidate"}</h1>
            {personal.title && <div className="text-xs font-bold text-gray-700 uppercase tracking-wider font-serif">{personal.title}</div>}
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] text-black font-semibold font-serif">
              {contactItems.map((item, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="text-gray-400">·</span>}
                  <span>{item}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="space-y-4 font-serif">
            {renderSectionByOrder(false)}
          </div>
        </div>
      );
    }

    if (selectedTemplate === "Clean") {
      return (
        <div id="resume-preview-sheet" className="w-full bg-white text-black p-8 shadow-md border border-gray-200 font-sans min-h-[297mm]">
          <div className="text-left space-y-2 mb-8 border-b border-gray-100 pb-6">
            <h1 className="text-4xl font-extrabold tracking-tighter text-gray-800">{personal.name || "Student Candidate"}</h1>
            {personal.title && <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">{personal.title}</div>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 font-semibold uppercase">
              {contactItems.map((item, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="text-gray-200">/</span>}
                  <span>{item}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="space-y-6">
            {renderSectionByOrder(false)}
          </div>
        </div>
      );
    }

    return null;
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
      {/* CSS print override styles */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          body * {
            visibility: hidden;
          }
          #resume-preview-sheet, #resume-preview-sheet * {
            visibility: visible;
          }
          #resume-preview-sheet {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            background: white !important;
            color: black !important;
          }
        }
      `}} />

      {/* Header Block */}
      <div className="flex flex-col md:flex-row md:items-end justify-between border-b-2 border-border pb-8 gap-6 no-print">
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
            onClick={handlePrint}
            className="flex items-center gap-2 h-12 px-6 border-2 border-border bg-background text-foreground text-xs font-bold tracking-widest uppercase hover:bg-muted transition-colors"
          >
            <Printer size={14} />
            <span>PRINT / SAVE PDF</span>
          </button>
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
        <div className="border-2 border-green-600 bg-green-600/10 p-4 text-xs font-bold text-green-600 uppercase tracking-wider no-print">
          {uploadSuccess}
        </div>
      )}

      {saveSuccess && (
        <div className="border-2 border-green-600 bg-green-600/10 p-4 text-xs font-bold text-green-600 uppercase tracking-wider no-print">
          {saveSuccess}
        </div>
      )}

      {uploadError && (
        <div className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-600 uppercase tracking-wider no-print">
          {uploadError}
        </div>
      )}

      {saveError && (
        <div className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-600 uppercase tracking-wider no-print">
          {saveError}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-12 items-start">
        
        {/* Left Column: Form Editors */}
        <div className="xl:col-span-7 space-y-12 no-print">
          
          {/* 1. Upload Card */}
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

          {/* 2. Extracted Metrics check */}
          {parsedName && (
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
                    className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">BRANCH</label>
                    <input
                      type="text"
                      value={parsedBranch}
                      onChange={(e) => setParsedBranch(e.target.value)}
                      className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">CGPA</label>
                    <input
                      type="text"
                      value={parsedCgpa}
                      onChange={(e) => setParsedCgpa(e.target.value)}
                      placeholder="9.12"
                      className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">10TH MARKS (%)</label>
                    <input
                      type="text"
                      value={parsedTenth}
                      onChange={(e) => setParsedTenth(e.target.value)}
                      placeholder="95"
                      className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">12TH MARKS (%)</label>
                    <input
                      type="text"
                      value={parsedTwelfth}
                      onChange={(e) => setParsedTwelfth(e.target.value)}
                      placeholder="92"
                      className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. Personal Details Form */}
          <div className="border-2 border-border p-6 bg-card space-y-6">
            <h3 className="text-lg font-bold uppercase tracking-wider text-foreground border-b border-border pb-3">PERSONAL DETAILS</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">FULL NAME</label>
                  <input
                    type="text"
                    value={resumeData.personal.name}
                    onChange={(e) => setResumeData(prev => ({
                      ...prev,
                      personal: { ...prev.personal, name: e.target.value }
                    }))}
                    className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">EMAIL ADDRESS</label>
                  <input
                    type="email"
                    value={resumeData.personal.email}
                    onChange={(e) => setResumeData(prev => ({
                      ...prev,
                      personal: { ...prev.personal, email: e.target.value }
                    }))}
                    className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">PHONE NUMBER</label>
                  <input
                    type="text"
                    value={resumeData.personal.phone}
                    onChange={(e) => setResumeData(prev => ({
                      ...prev,
                      personal: { ...prev.personal, phone: e.target.value }
                    }))}
                    placeholder="e.g. +91 98765 43210"
                    className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">LOCATION</label>
                  <input
                    type="text"
                    value={resumeData.personal.location}
                    onChange={(e) => setResumeData(prev => ({
                      ...prev,
                      personal: { ...prev.personal, location: e.target.value }
                    }))}
                    placeholder="e.g. Chennai, India"
                    className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">PROFESSIONAL TITLE</label>
                  <input
                    type="text"
                    value={resumeData.personal.title || ""}
                    onChange={(e) => setResumeData(prev => ({
                      ...prev,
                      personal: { ...prev.personal, title: e.target.value }
                    }))}
                    placeholder="e.g. SOFTWARE ENGINEER"
                    className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">GITHUB PROFILE</label>
                  <input
                    type="text"
                    value={resumeData.personal.github || ""}
                    onChange={(e) => setResumeData(prev => ({
                      ...prev,
                      personal: { ...prev.personal, github: e.target.value }
                    }))}
                    placeholder="e.g. github.com/username"
                    className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">LINKEDIN PROFILE</label>
                  <input
                    type="text"
                    value={resumeData.personal.linkedin || ""}
                    onChange={(e) => setResumeData(prev => ({
                      ...prev,
                      personal: { ...prev.personal, linkedin: e.target.value }
                    }))}
                    placeholder="e.g. linkedin.com/in/username"
                    className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">PERSONAL WEBSITE</label>
                  <input
                    type="text"
                    value={resumeData.personal.website || ""}
                    onChange={(e) => setResumeData(prev => ({
                      ...prev,
                      personal: { ...prev.personal, website: e.target.value }
                    }))}
                    placeholder="e.g. portfolio.com"
                    className="w-full h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Professional Summary Form */}
          <div className="border-2 border-border p-6 bg-card space-y-6">
            <h3 className="text-lg font-bold uppercase tracking-wider text-foreground border-b border-border pb-3">PROFESSIONAL SUMMARY</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">SUMMARY DESCRIPTION</label>
                <textarea
                  value={resumeData.summary || ""}
                  onChange={(e) => setResumeData(prev => ({
                    ...prev,
                    summary: e.target.value
                  }))}
                  placeholder="e.g. HIGHLY MOTIVATED SOFTWARE ENGINEER WITH EXPERIENCE IN..."
                  className="w-full min-h-[100px] border-2 border-border bg-transparent text-xs font-bold uppercase p-3 outline-none text-foreground"
                />
              </div>
            </div>
          </div>

          {/* Tech Stack & Skills */}
          <div className="border-2 border-border p-6 bg-card space-y-6">
            <h3 className="text-lg font-bold uppercase tracking-wider text-foreground border-b border-border pb-3">TECH STACK & SKILLS</h3>
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. PYTHON (PRESS ENTER OR ADD)"
                  value={newSkill}
                  onChange={(e) => setNewSkill(e.target.value)}
                  className="flex-1 h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                />
                <button
                  type="button"
                  onClick={addSkill}
                  className="h-10 px-4 border-2 border-border bg-foreground text-background text-xs font-bold uppercase hover:bg-accent hover:text-black transition-colors"
                >
                  ADD
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {skills.map((skill) => (
                  <span key={skill} className="inline-flex items-center gap-1.5 bg-muted border border-border px-2.5 py-1 text-[10px] font-bold uppercase">
                    {skill}
                    <button type="button" onClick={() => removeSkill(skill)} className="text-muted-foreground hover:text-red-500 font-extrabold">×</button>
                  </span>
                ))}
                {skills.length === 0 && (
                  <span className="text-xs text-muted-foreground uppercase font-bold">No skills added yet.</span>
                )}
              </div>
            </div>
          </div>

          {/* Certifications Tag Editor */}
          <div className="border-2 border-border p-6 bg-card space-y-6">
            <h3 className="text-lg font-bold uppercase tracking-wider text-foreground border-b border-border pb-3">CERTIFICATIONS & TRAINING</h3>
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. AWS SOLUTIONS ARCHITECT"
                  value={newCertification}
                  onChange={(e) => setNewCertification(e.target.value)}
                  className="flex-1 h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCertification(); } }}
                />
                <button
                  type="button"
                  onClick={addCertification}
                  className="h-10 px-4 border-2 border-border bg-foreground text-background text-xs font-bold uppercase hover:bg-accent hover:text-black transition-colors"
                >
                  ADD
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {certifications.map((cert) => (
                  <span key={cert} className="inline-flex items-center gap-1.5 bg-muted border border-border px-2.5 py-1 text-[10px] font-bold uppercase">
                    {cert}
                    <button type="button" onClick={() => removeCertification(cert)} className="text-muted-foreground hover:text-red-500 font-extrabold">×</button>
                  </span>
                ))}
                {certifications.length === 0 && (
                  <span className="text-xs text-muted-foreground uppercase font-bold">No certifications added yet.</span>
                )}
              </div>
            </div>
          </div>

          {/* Languages Tag Editor */}
          <div className="border-2 border-border p-6 bg-card space-y-6">
            <h3 className="text-lg font-bold uppercase tracking-wider text-foreground border-b border-border pb-3">LANGUAGES</h3>
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. ENGLISH"
                  value={newLanguage}
                  onChange={(e) => setNewLanguage(e.target.value)}
                  className="flex-1 h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLanguage(); } }}
                />
                <button
                  type="button"
                  onClick={addLanguage}
                  className="h-10 px-4 border-2 border-border bg-foreground text-background text-xs font-bold uppercase hover:bg-accent hover:text-black transition-colors"
                >
                  ADD
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {languages.map((lang) => (
                  <span key={lang} className="inline-flex items-center gap-1.5 bg-muted border border-border px-2.5 py-1 text-[10px] font-bold uppercase">
                    {lang}
                    <button type="button" onClick={() => removeLanguage(lang)} className="text-muted-foreground hover:text-red-500 font-extrabold">×</button>
                  </span>
                ))}
                {languages.length === 0 && (
                  <span className="text-xs text-muted-foreground uppercase font-bold">No languages added yet.</span>
                )}
              </div>
            </div>
          </div>

          {/* Awards Tag Editor */}
          <div className="border-2 border-border p-6 bg-card space-y-6">
            <h3 className="text-lg font-bold uppercase tracking-wider text-foreground border-b border-border pb-3">AWARDS & HONORS</h3>
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. HACKATHON WINNER"
                  value={newAward}
                  onChange={(e) => setNewAward(e.target.value)}
                  className="flex-1 h-10 border-2 border-border bg-transparent text-xs font-bold uppercase px-3 text-foreground"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAward(); } }}
                />
                <button
                  type="button"
                  onClick={addAward}
                  className="h-10 px-4 border-2 border-border bg-foreground text-background text-xs font-bold uppercase hover:bg-accent hover:text-black transition-colors"
                >
                  ADD
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {awards.map((award) => (
                  <span key={award} className="inline-flex items-center gap-1.5 bg-muted border border-border px-2.5 py-1 text-[10px] font-bold uppercase">
                    {award}
                    <button type="button" onClick={() => removeAward(award)} className="text-muted-foreground hover:text-red-500 font-extrabold">×</button>
                  </span>
                ))}
                {awards.length === 0 && (
                  <span className="text-xs text-muted-foreground uppercase font-bold">No awards added yet.</span>
                )}
              </div>
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
            
            {education.length === 0 ? (
              <p className="text-xs text-muted-foreground uppercase">No education details added.</p>
            ) : (
              <div className="space-y-6">
                {education.map((edu, i) => (
                  <div key={i} className="grid grid-cols-1 sm:grid-cols-4 gap-4 border border-border p-4 bg-muted/10 relative pt-8">
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
                      className="border border-border bg-transparent p-2 text-xs uppercase text-foreground"
                    />
                    <input
                      type="text"
                      placeholder="Institution (e.g. VIT)"
                      value={edu.institution}
                      onChange={(e) => updateEducation(i, "institution", e.target.value)}
                      className="border border-border bg-transparent p-2 text-xs uppercase text-foreground"
                    />
                    <input
                      type="text"
                      placeholder="Graduation Year (e.g. 2026)"
                      value={edu.year}
                      onChange={(e) => updateEducation(i, "year", e.target.value)}
                      className="border border-border bg-transparent p-2 text-xs uppercase text-foreground"
                    />
                    <input
                      type="text"
                      placeholder="Score/CGPA (e.g. 9.12)"
                      value={edu.score}
                      onChange={(e) => updateEducation(i, "score", e.target.value)}
                      className="border border-border bg-transparent p-2 text-xs uppercase text-foreground"
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
            
            {experience.length === 0 ? (
              <p className="text-xs text-muted-foreground uppercase">No experience details added.</p>
            ) : (
              <div className="space-y-6">
                {experience.map((exp, i) => (
                  <div key={i} className="border border-border p-4 bg-muted/10 relative space-y-3 pt-8">
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
                        className="border border-border bg-transparent p-2 text-xs uppercase text-foreground"
                      />
                      <input
                        type="text"
                        placeholder="Company Name"
                        value={exp.company}
                        onChange={(e) => updateExperience(i, "company", e.target.value)}
                        className="border border-border bg-transparent p-2 text-xs uppercase text-foreground"
                      />
                      <input
                        type="text"
                        placeholder="Period (e.g. Summer 2025)"
                        value={exp.period}
                        onChange={(e) => updateExperience(i, "period", e.target.value)}
                        className="border border-border bg-transparent p-2 text-xs uppercase text-foreground"
                      />
                    </div>
                    <textarea
                      placeholder="Description / Responsibilities"
                      value={exp.description}
                      onChange={(e) => updateExperience(i, "description", e.target.value)}
                      className="w-full border border-border bg-transparent p-2 text-xs uppercase h-20 text-foreground"
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
            
            {projects.length === 0 ? (
              <p className="text-xs text-muted-foreground uppercase">No project details added.</p>
            ) : (
              <div className="space-y-6">
                {projects.map((proj, i) => (
                  <div key={i} className="border border-border p-4 bg-muted/10 relative space-y-3 pt-8">
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
                        className="border border-border bg-transparent p-2 text-xs uppercase text-foreground"
                      />
                      <input
                        type="text"
                        placeholder="Technologies (e.g. Python, SQL)"
                        value={proj.tech}
                        onChange={(e) => updateProject(i, "tech", e.target.value)}
                        className="border border-border bg-transparent p-2 text-xs uppercase text-foreground"
                      />
                    </div>
                    <textarea
                      placeholder="Project details & specifications"
                      value={proj.description}
                      onChange={(e) => updateProject(i, "description", e.target.value)}
                      className="w-full border border-border bg-transparent p-2 text-xs uppercase h-20 text-foreground"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Live Interactive Preview */}
        <div className="xl:col-span-5 space-y-8">
          
          {/* Reordering & Layout controls */}
          <div className="border-2 border-border p-6 bg-card space-y-6 no-print">
            <h3 className="text-lg font-bold uppercase tracking-wider text-foreground border-b border-border pb-3">
              PREVIEW SETTINGS
            </h3>

            {/* Template selector */}
            <div className="space-y-2">
              <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest block">
                TEMPLATE LAYOUT
              </span>
              <div className="grid grid-cols-2 gap-2">
                {["Classic Single", "Modern Single", "Classic Two", "Modern Two", "Vivid", "LaTeX", "Clean"].map((t) => (
                  <button
                    key={t}
                    onClick={() => setSelectedTemplate(t)}
                    className={`h-10 border-2 text-[10px] font-black uppercase tracking-wider transition-all ${
                      selectedTemplate === t
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Section order */}
            <div className="space-y-2">
              <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest block">
                REARRANGE SECTIONS
              </span>
              <div className="space-y-1.5">
                {sectionOrder.map((section, idx) => (
                  <div key={section} className="flex justify-between items-center bg-muted/20 border border-border px-3 py-2 text-xs font-bold uppercase">
                    <span>{section}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => moveSection(idx, "up")}
                        disabled={idx === 0}
                        className="hover:text-accent disabled:opacity-30 p-1 border border-border bg-background"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSection(idx, "down")}
                        disabled={idx === sectionOrder.length - 1}
                        className="hover:text-accent disabled:opacity-30 p-1 border border-border bg-background"
                      >
                        <ArrowDown size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Render Actual Preview A4 Sheet */}
          <div className="border-2 border-border p-2 bg-muted/10 relative max-h-[85vh] overflow-y-auto shadow-inner">
            <div className="absolute top-4 right-4 z-10 no-print">
              <span className="bg-black/80 text-[8px] font-bold text-white px-2 py-1 uppercase tracking-widest">
                A4 LIVE SHEET
              </span>
            </div>
            {renderResumePreview()}
          </div>

        </div>
      </div>
    </div>
  );
}
