/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */

"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { isProfileComplete } from "@/lib/profile-utils";
import api from "@/lib/api";
import { decryptData, encryptData, deriveKey, exportKeyToHex } from "@/lib/crypto";
import {
  Sparkles,
  Save,
  Check,
  AlertCircle,
  Loader2,
  ArrowLeft,
  Download,
  Target,
  FileText,
  Plus,
  Trash2,
  Printer,
  Eye,
  Edit,
  Highlighter,
  ShieldCheck,
  Unlock
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
}

interface ATSResult {
  ats_score: number;
  missing_keywords: string[];
  tailored_resume: {
    optimized_skills: string[];
    optimized_projects: Array<{ title: string; description: string }>;
    optimized_summary: string;
  };
}

/**
 * Robust JSON extraction and fallback regex parsing to handle malformed LLM outputs.
 */
function stripChineseCharacters(text: string): string {
  return text.replace(/[\u4e00-\u9fa5]/g, "").trim();
}

function cleanObjectStrings(obj: any): any {
  if (typeof obj === "string") {
    return stripChineseCharacters(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanObjectStrings);
  }
  if (obj !== null && typeof obj === "object") {
    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      const cleanKey = stripChineseCharacters(key);
      cleaned[cleanKey] = cleanObjectStrings(obj[key]);
    }
    return cleaned;
  }
  return obj;
}

function normalizeLLMResponseText(text: string): string {
  let s = text.trim();

  // 1. Remove markdown json code block wraps inside the text
  s = s.replace(/```json/gi, "");
  s = s.replace(/```/g, "");

  // 2. Replace common Chinese keys and abbreviations with standard English keys (quoted, unquoted, and mixed)
  s = s.replace(/(['"]?)(?:optimized技能|optimized技能培训|优化技能|优化技能培训|optimized_skills_zh|skills_zh|优化_skills|技能|优化skills)(['"]?)\s*:/gi, '"optimized_skills":');
  s = s.replace(/(['"]?)(?:optimized项目|优化项目|optimized_projects_zh|projects_zh|优化_projects|项目|优化projects)(['"]?)\s*:/gi, '"optimized_projects":');
  s = s.replace(/(['"]?)(?:optimized摘要|优化摘要|optimized_summary_zh|summary_zh|优化_summary|摘要|优化summary)(['"]?)\s*:/gi, '"optimized_summary":');

  // Map other variations like desc, description, title, etc. (quoted or unquoted, prevents duplicate double quotes)
  s = s.replace(/(['"]?)desc(?:ription)?(['"]?)\s*:/gi, '"description":');
  s = s.replace(/(['"]?)title(['"]?)\s*:/gi, '"title":');
  s = s.replace(/(?<!optimized_)(['"]?)skills?(['"]?)\s*:/gi, '"optimized_skills":');
  s = s.replace(/(?<!optimized_)(['"]?)projects?(['"]?)\s*:/gi, '"optimized_projects":');
  s = s.replace(/(?<!optimized_)(['"]?)summary(['"]?)\s*:/gi, '"optimized_summary":');

  // Fix Chinese characters in keys inside quotes like '技能' or 'desc' or 'title'
  s = s.replace(/(['"]?)技能(['"]?)\s*:/g, '"optimized_skills":');

  // 3. Fix unquoted words in arrays (e.g. ["Python", Java] -> ["Python", "Java"])
  s = s.replace(/:\s*\[([^{}[\]]*?)\]/g, (match, arrayContent) => {
    const items = arrayContent.split(",");
    const quotedItems = items.map((item: string) => {
      const trimmed = item.trim();
      if (!trimmed) return "";
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.replace(/'/g, '"');
      }
      if (trimmed === "true" || trimmed === "false" || !isNaN(Number(trimmed))) {
        return trimmed;
      }
      return `"${trimmed.replace(/"/g, '\\"')}"`;
    });
    return `: [${quotedItems.filter(Boolean).join(", ")}]`;
  });

  // 4. Normalize single quotes to double quotes for properties and values
  s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');

  return s;
}

function repairJSONString(jsonStr: string): string {
  let s = jsonStr.trim();
  
  // Strip chat template tags
  s = s.replace(/<\|im_start\|>system[\s\S]*?<\|im_end\|>/g, "");
  s = s.replace(/<\|im_start\|>user[\s\S]*?<\|im_end\|>/g, "");
  s = s.replace(/<\|im_start\|>assistant/gi, "");
  s = s.replace(/<\|im_end\|>/gi, "");
  s = s.replace(/<\/s>/gi, "");
  s = s.replace(/<s>/gi, "");

  // Locate the JSON boundaries
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    s = s.substring(firstBrace, lastBrace + 1);
  } else {
    return jsonStr;
  }

  let inString = false;
  let escape = false;
  let result = "";
  
  for (let i = 0; i < s.length; i++) {
    const char = s[i];
    
    if (inString) {
      if (escape) {
        result += char;
        escape = false;
      } else if (char === "\\") {
        result += char;
        escape = true;
      } else if (char === '"') {
        const nextChars = s.substring(i + 1, i + 10).trim();
        if (nextChars.startsWith(",") || nextChars.startsWith("}") || nextChars.startsWith("]") || nextChars.startsWith(":") || nextChars === "") {
          inString = false;
          result += char;
        } else {
          result += '\\"';
        }
      } else if (char === "\n") {
        result += "\\n";
      } else if (char === "\r") {
        // Skip
      } else {
        result += char;
      }
    } else {
      if (char === '"') {
        inString = true;
      }
      result += char;
    }
  }
  
  return result;
}

function parseRobustLLMJSON(rawText: string): any {
  let cleanText = normalizeLLMResponseText(rawText);
  
  // Step 1: Strip markdown block wrappers
  if (cleanText.includes("```")) {
    const parts = cleanText.split("```");
    for (let i = 1; i < parts.length; i += 2) {
      let candidate = parts[i].trim();
      if (candidate.startsWith("json")) {
        candidate = candidate.substring(4).trim();
      }
      if (candidate.includes("{") && candidate.includes("}")) {
        cleanText = candidate;
        break;
      }
    }
  }

  // Step 2: Extract block between first '{' and last '}'
  const firstBrace = cleanText.indexOf("{");
  const lastBrace = cleanText.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleanText = cleanText.substring(firstBrace, lastBrace + 1);
  }

  // Pre-cleaning: Map common Chinese/hallucinated keys to correct English equivalents in the raw text
  cleanText = cleanText
    .replace(/"(?:optimized技能|optimized技能培训|优化技能|优化技能培训|optimized_skills_zh|skills_zh)"/gi, '"optimized_skills"')
    .replace(/"(?:optimized项目|优化项目|optimized_projects_zh|projects_zh)"/gi, '"optimized_projects"')
    .replace(/"(?:optimized摘要|优化摘要|optimized_summary_zh|summary_zh)"/gi, '"optimized_summary"');

  let repairedText = cleanText;
  try {
    repairedText = repairJSONString(cleanText);
  } catch (repairErr) {
    console.warn("JSON repair helper failed:", repairErr);
  }

  let parsedResult: any = null;

  // Step 3: Try standard JSON.parse after basic comma cleaning
  try {
    const cleanedCommas = repairedText.replace(/,\s*([}\]])/g, "$1");
    parsedResult = JSON.parse(cleanedCommas);
  } catch (err) {
    console.warn("Standard JSON parse failed, attempting regex extraction fallback:", err);
  }

  // Step 4: Regex-based fallback parser if JSON.parse failed
  if (!parsedResult) {
    try {
      const fallbackObj: any = {};

      // Extract optimized_skills / skills / 技能 array
      const skillsMatch = cleanText.match(/"(?:optimized_skills|skills|optimized技能|optimized技能培训|优化技能|优化技能培训)"\s*:\s*\[([\s\S]*?)\]/i);
      if (skillsMatch) {
        const items = skillsMatch[1].match(/"([^"]+)"|'([^']+)'/g);
        if (items) {
          fallbackObj.optimized_skills = items.map(item => item.replace(/^["']|["']$/g, ""));
        }
      }

      // Extract optimized_summary / summary / 摘要
      const summaryMatch = cleanText.match(/"(?:optimized_summary|summary|optimized摘要|优化摘要)"\s*:\s*"([\s\S]*?)"(?=\s*,|\s*})/i);
      if (summaryMatch) {
        fallbackObj.optimized_summary = summaryMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
      }

      // Extract optimized_projects / projects / 项目 array of objects
      const projectsMatch = cleanText.match(/"(?:optimized_projects|projects|optimized项目|优化项目)"\s*:\s*\[([\s\S]*?)\]/i);
      if (projectsMatch) {
        const projArrayText = projectsMatch[1];
        const projObjects = projArrayText.match(/\{([\s\S]*?)\}/g);
        if (projObjects) {
          fallbackObj.optimized_projects = projObjects.map((projText: string) => {
            const titleMatch = projText.match(/"title"\s*:\s*"([^"]*)"/i);
            const descMatch = projText.match(/"description"\s*:\s*"([^"]*)"/i);
            return {
              title: titleMatch ? titleMatch[1] : "Project",
              description: descMatch ? descMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : ""
            };
          });
        }
      }

      if (fallbackObj.optimized_summary || (fallbackObj.optimized_skills && fallbackObj.optimized_skills.length > 0)) {
        parsedResult = fallbackObj;
      }
    } catch (regexErr) {
      console.error("Regex fallback parser failed:", regexErr);
    }
  }

  // Step 5: Normalize and clean keys if we got an object
  if (parsedResult) {
    const normalized: any = {};
    for (const key of Object.keys(parsedResult)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes("skill") || lowerKey.includes("技能") || lowerKey.includes("培训")) {
        normalized.optimized_skills = parsedResult[key];
      } else if (lowerKey.includes("project") || lowerKey.includes("项目")) {
        normalized.optimized_projects = parsedResult[key];
      } else if (lowerKey.includes("summary") || lowerKey.includes("摘要") || lowerKey.includes("profile")) {
        normalized.optimized_summary = parsedResult[key];
      } else {
        normalized[key] = parsedResult[key];
      }
    }

    // Default missing fields to keep it conformant to ATSResult tailored_resume structure
    if (!normalized.optimized_skills) normalized.optimized_skills = [];
    if (!normalized.optimized_projects) normalized.optimized_projects = [];
    if (!normalized.optimized_summary) normalized.optimized_summary = "";

    // Force arrays and structures
    if (normalized.optimized_skills && !Array.isArray(normalized.optimized_skills)) {
      if (typeof normalized.optimized_skills === "string") {
        normalized.optimized_skills = [normalized.optimized_skills];
      } else {
        normalized.optimized_skills = [];
      }
    }
    if (normalized.optimized_projects && !Array.isArray(normalized.optimized_projects)) {
      normalized.optimized_projects = [];
    }

    // Recursively clean all Chinese characters from the keys and values of the final object
    return cleanObjectStrings(normalized);
  }

  throw new Error("Local model returned an unparseable response. Please try again.");
}

function ResumeTemplatePreview({ data, template }: { data: any; template: string }) {
  if (!data) return null;
  const personal = data.personal || {};
  const education = data.education || [];
  const experience = data.experience || [];
  const projects = data.projects || [];
  const skills = data.skills || [];
  const certifications = data.certifications || [];
  const languages = data.languages || [];
  const awards = data.awards || [];

  const renderClassic = () => (
    <div className="font-serif text-zinc-900 bg-white p-8 shadow-lg max-w-[800px] mx-auto text-sm print-area leading-relaxed border border-zinc-200 text-left">
      <div className="text-center space-y-2 border-b pb-4 mb-4">
        <h1 className="text-3xl font-bold tracking-wide uppercase">{personal.name || "Candidate Name"}</h1>
        <div className="text-xs text-zinc-600 flex flex-wrap justify-center gap-x-4 gap-y-1">
          {personal.email && <span>{personal.email}</span>}
          {personal.phone && <span>{personal.phone}</span>}
          {personal.location && <span>{personal.location}</span>}
          {personal.linkedin && <span>LinkedIn: {personal.linkedin}</span>}
          {personal.github && <span>GitHub: {personal.github}</span>}
        </div>
      </div>

      {data.summary && (
        <div className="space-y-1.5 mb-5">
          <h2 className="text-xs font-bold tracking-widest text-zinc-800 uppercase border-b border-zinc-300 pb-0.5">Professional Summary</h2>
          <p className="text-xs text-zinc-700 text-justify">{data.summary}</p>
        </div>
      )}

      {experience.length > 0 && (
        <div className="space-y-3 mb-5">
          <h2 className="text-xs font-bold tracking-widest text-zinc-800 uppercase border-b border-zinc-300 pb-0.5">Professional Experience</h2>
          <div className="space-y-3">
            {experience.map((exp: any, idx: number) => (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between items-baseline font-bold text-xs">
                  <span>{exp.role || "Role"} — <span className="font-normal text-zinc-600">{exp.company || "Company"}</span></span>
                  <span className="text-zinc-500 font-medium text-[11px]">{exp.period}</span>
                </div>
                <p className="text-xs text-zinc-700 text-justify whitespace-pre-wrap">{exp.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {projects.length > 0 && (
        <div className="space-y-3 mb-5">
          <h2 className="text-xs font-bold tracking-widest text-zinc-800 uppercase border-b border-zinc-300 pb-0.5">Projects</h2>
          <div className="space-y-3">
            {projects.map((proj: any, idx: number) => (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between items-baseline font-bold text-xs">
                  <span>{proj.title || "Project"}</span>
                  {proj.tech && <span className="text-zinc-500 font-normal text-[11px]">{proj.tech}</span>}
                </div>
                <p className="text-xs text-zinc-700 text-justify whitespace-pre-wrap">{proj.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {education.length > 0 && (
        <div className="space-y-3 mb-5">
          <h2 className="text-xs font-bold tracking-widest text-zinc-800 uppercase border-b border-zinc-300 pb-0.5">Education</h2>
          <div className="space-y-2">
            {education.map((edu: any, idx: number) => (
              <div key={idx} className="flex justify-between items-center text-xs">
                <span className="font-bold">{edu.degree} <span className="font-normal text-zinc-600">at {edu.institution}</span></span>
                <span className="text-zinc-500 text-[11px] font-medium">{edu.year} | {edu.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {skills.length > 0 && (
        <div className="space-y-1.5 mb-5">
          <h2 className="text-xs font-bold tracking-widest text-zinc-800 uppercase border-b border-zinc-300 pb-0.5">Skills & Tech Stack</h2>
          <p className="text-xs text-zinc-700">{skills.join(", ")}</p>
        </div>
      )}

      {awards.length > 0 && (
        <div className="space-y-1.5 mb-5">
          <h2 className="text-xs font-bold tracking-widest text-zinc-800 uppercase border-b border-zinc-300 pb-0.5">Awards & Honors</h2>
          <ul className="list-disc pl-4 space-y-1 text-xs text-zinc-700">
            {awards.map((a: string, idx: number) => <li key={idx} className="leading-relaxed text-justify">{a}</li>)}
          </ul>
        </div>
      )}

      {(certifications.length > 0 || languages.length > 0) && (
        <div className="grid grid-cols-2 gap-4 text-xs">
          {certifications.length > 0 && (
            <div>
              <h3 className="font-bold text-zinc-800 border-b pb-0.5 mb-1.5 uppercase tracking-wide text-[10px]">Certifications</h3>
              <ul className="list-disc pl-4 space-y-0.5 text-zinc-700 text-[11px]">
                {certifications.map((c: string, idx: number) => <li key={idx}>{c}</li>)}
              </ul>
            </div>
          )}
          {languages.length > 0 && (
            <div>
              <h3 className="font-bold text-zinc-800 border-b pb-0.5 mb-1.5 uppercase tracking-wide text-[10px]">Languages</h3>
              <ul className="list-disc pl-4 space-y-0.5 text-zinc-700 text-[11px]">
                {languages.map((l: string, idx: number) => <li key={idx}>{l}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderModern = () => (
    <div className="font-sans text-slate-900 bg-white p-8 shadow-lg max-w-[800px] mx-auto text-sm print-area leading-relaxed border border-zinc-200 text-left">
      <div className="border-l-8 border-yellow-500 pl-4 mb-6 py-2">
        <h1 className="text-3xl font-black tracking-tight text-slate-800 uppercase">{personal.name || "Candidate Name"}</h1>
        {personal.title && <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">{personal.title}</p>}
        <div className="text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1 mt-2">
          {personal.email && <span>{personal.email}</span>}
          {personal.phone && <span>{personal.phone}</span>}
          {personal.location && <span>{personal.location}</span>}
          {personal.linkedin && <span className="normal-case">LinkedIn: {personal.linkedin}</span>}
          {personal.github && <span className="normal-case">GitHub: {personal.github}</span>}
        </div>
      </div>

      {data.summary && (
        <div className="space-y-1.5 mb-6">
          <h2 className="text-xs font-black tracking-wider text-yellow-600 uppercase border-b-2 border-slate-100 pb-1">Profile Summary</h2>
          <p className="text-xs text-slate-700 text-justify leading-relaxed">{data.summary}</p>
        </div>
      )}

      {experience.length > 0 && (
        <div className="space-y-3 mb-6">
          <h2 className="text-xs font-black tracking-wider text-yellow-600 uppercase border-b-2 border-slate-100 pb-1">Work History</h2>
          <div className="space-y-4">
            {experience.map((exp: any, idx: number) => (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between items-baseline font-bold text-xs">
                  <span className="text-slate-800">{exp.role || "Role"}</span>
                  <span className="text-slate-500 text-[11px] font-medium">{exp.period}</span>
                </div>
                <div className="text-xs font-bold text-yellow-600/90 uppercase tracking-wide">{exp.company}</div>
                <p className="text-xs text-slate-700 text-justify whitespace-pre-wrap">{exp.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {projects.length > 0 && (
        <div className="space-y-3 mb-6">
          <h2 className="text-xs font-black tracking-wider text-yellow-600 uppercase border-b-2 border-slate-100 pb-1">Key Projects</h2>
          <div className="space-y-4">
            {projects.map((proj: any, idx: number) => (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between items-baseline font-bold text-xs">
                  <span className="text-slate-800">{proj.title || "Project"}</span>
                  {proj.tech && <span className="text-yellow-600/90 text-[10px] font-bold uppercase tracking-wider">{proj.tech}</span>}
                </div>
                <p className="text-xs text-slate-700 text-justify whitespace-pre-wrap">{proj.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {education.length > 0 && (
        <div className="space-y-3 mb-6">
          <h2 className="text-xs font-black tracking-wider text-yellow-600 uppercase border-b-2 border-slate-100 pb-1">Academic Background</h2>
          <div className="space-y-3">
            {education.map((edu: any, idx: number) => (
              <div key={idx} className="flex justify-between items-center text-xs">
                <span><span className="font-bold text-slate-800">{edu.degree}</span> — <span className="text-slate-600">{edu.institution}</span></span>
                <span className="text-slate-500 text-[11px] font-medium">{edu.year} | {edu.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {skills.length > 0 && (
        <div className="space-y-2 mb-6">
          <h2 className="text-xs font-black tracking-wider text-yellow-600 uppercase border-b-2 border-slate-100 pb-1">Core Competencies</h2>
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s: string, idx: number) => (
              <span key={idx} className="bg-slate-100 border border-slate-200 text-slate-700 font-bold px-2 py-0.5 text-[10px] uppercase">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {awards.length > 0 && (
        <div className="space-y-1.5 mb-6 pt-4 border-t border-slate-100">
          <h2 className="text-xs font-black tracking-wider text-yellow-600 uppercase pb-1">Awards & Honors</h2>
          <ul className="space-y-1 text-slate-700 text-xs">
            {awards.map((a: string, idx: number) => <li key={idx} className="flex gap-1.5 items-start text-justify leading-relaxed"><span className="text-yellow-500 mt-1">▪</span>{a}</li>)}
          </ul>
        </div>
      )}

      {(certifications.length > 0 || languages.length > 0) && (
        <div className="grid grid-cols-2 gap-6 pt-4 border-t border-slate-100 text-xs">
          {certifications.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="font-black text-slate-800 uppercase tracking-widest text-[9px]">Certifications</h3>
              <ul className="space-y-1 text-slate-600 text-[11px]">
                {certifications.map((c: string, idx: number) => <li key={idx} className="flex gap-1 items-start"><span className="text-yellow-500">▪</span>{c}</li>)}
              </ul>
            </div>
          )}
          {languages.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="font-black text-slate-800 uppercase tracking-widest text-[9px]">Languages</h3>
              <ul className="space-y-1 text-slate-600 text-[11px]">
                {languages.map((l: string, idx: number) => <li key={idx} className="flex gap-1 items-start"><span className="text-yellow-500">▪</span>{l}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderMinimalist = () => (
    <div className="font-sans text-neutral-800 bg-white p-6 shadow-lg max-w-[800px] mx-auto text-xs print-area leading-tight border border-zinc-200 text-left">
      <div className="flex justify-between items-start border-b border-neutral-300 pb-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 uppercase">{personal.name || "Candidate Name"}</h1>
          {personal.title && <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">{personal.title}</p>}
        </div>
        <div className="text-[10px] text-neutral-500 text-right space-y-0.5">
          {personal.email && <div>{personal.email}</div>}
          {personal.phone && <div>{personal.phone}</div>}
          {personal.location && <div>{personal.location}</div>}
          {personal.linkedin && <div className="normal-case">LinkedIn: {personal.linkedin}</div>}
          {personal.github && <div className="normal-case">GitHub: {personal.github}</div>}
        </div>
      </div>

      {data.summary && (
        <div className="mb-4">
          <p className="text-neutral-600 text-justify leading-relaxed">{data.summary}</p>
        </div>
      )}

      {experience.length > 0 && (
        <div className="space-y-2 mb-4">
          <h2 className="text-[10px] font-bold tracking-wider text-neutral-900 uppercase border-b border-neutral-200 pb-0.5">Experience</h2>
          <div className="space-y-3">
            {experience.map((exp: any, idx: number) => (
              <div key={idx} className="space-y-0.5">
                <div className="flex justify-between items-baseline font-bold text-neutral-900">
                  <span>{exp.role || "Role"} — <span className="font-normal text-neutral-500">{exp.company || "Company"}</span></span>
                  <span className="text-neutral-500 font-medium text-[10px]">{exp.period}</span>
                </div>
                <p className="text-neutral-600 text-justify whitespace-pre-wrap">{exp.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {projects.length > 0 && (
        <div className="space-y-2 mb-4">
          <h2 className="text-[10px] font-bold tracking-wider text-neutral-900 uppercase border-b border-neutral-200 pb-0.5">Projects</h2>
          <div className="space-y-3">
            {projects.map((proj: any, idx: number) => (
              <div key={idx} className="space-y-0.5">
                <div className="flex justify-between items-baseline font-bold text-neutral-900">
                  <span>{proj.title || "Project"}</span>
                  {proj.tech && <span className="text-neutral-500 font-normal text-[10px]">{proj.tech}</span>}
                </div>
                <p className="text-neutral-600 text-justify whitespace-pre-wrap">{proj.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {education.length > 0 && (
        <div className="space-y-2 mb-4">
          <h2 className="text-[10px] font-bold tracking-wider text-neutral-900 uppercase border-b border-neutral-200 pb-0.5">Education</h2>
          <div className="space-y-1.5">
            {education.map((edu: any, idx: number) => (
              <div key={idx} className="flex justify-between items-center">
                <span><span className="font-bold text-neutral-900">{edu.degree}</span> <span className="text-neutral-600">at {edu.institution}</span></span>
                <span className="text-neutral-500 text-[10px] font-medium">{edu.year} | {edu.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {skills.length > 0 && (
        <div className="space-y-1 mb-4">
          <h2 className="text-[10px] font-bold tracking-wider text-neutral-900 uppercase border-b border-neutral-200 pb-0.5">Skills</h2>
          <p className="text-neutral-600">{skills.join(", ")}</p>
        </div>
      )}

      {awards.length > 0 && (
        <div className="space-y-1 mb-4 border-t border-neutral-200 pt-3">
          <h2 className="text-[10px] font-bold tracking-wider text-neutral-900 uppercase pb-0.5">Awards & Honors</h2>
          <ul className="list-disc pl-4 space-y-1 text-neutral-600 text-xs">
            {awards.map((a: string, idx: number) => <li key={idx} className="leading-relaxed text-justify">{a}</li>)}
          </ul>
        </div>
      )}

      {(certifications.length > 0 || languages.length > 0) && (
        <div className="grid grid-cols-2 gap-4 border-t border-neutral-200 pt-3">
          {certifications.length > 0 && (
            <div>
              <h3 className="font-bold text-neutral-900 uppercase text-[9px] mb-1">Certifications</h3>
              <ul className="list-disc pl-4 space-y-0.5 text-neutral-600 text-[10px]">
                {certifications.map((c: string, idx: number) => <li key={idx}>{c}</li>)}
              </ul>
            </div>
          )}
          {languages.length > 0 && (
            <div>
              <h3 className="font-bold text-neutral-900 uppercase text-[9px] mb-1">Languages</h3>
              <ul className="list-disc pl-4 space-y-0.5 text-neutral-600 text-[10px]">
                {languages.map((l: string, idx: number) => <li key={idx}>{l}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderCreative = () => (
    <div className="font-sans text-slate-800 bg-white shadow-lg max-w-[800px] mx-auto text-sm print-area leading-relaxed border border-zinc-200 flex flex-col md:flex-row min-h-[842px] text-left">
      <div className="w-full md:w-[32%] bg-slate-900 text-white p-6 flex flex-col gap-6 print:w-[32%] print:bg-slate-900">
        <div className="space-y-1.5 border-b border-slate-700 pb-4">
          <h1 className="text-xl font-black tracking-tight uppercase leading-none">{personal.name || "Candidate"}</h1>
          {personal.title && <p className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest">{personal.title}</p>}
        </div>

        <div className="space-y-2">
          <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Contact Info</h3>
          <div className="text-[10px] space-y-1.5 text-slate-300 font-mono break-all leading-normal">
            {personal.email && <div className="flex gap-1.5"><span>✉</span><span>{personal.email}</span></div>}
            {personal.phone && <div className="flex gap-1.5"><span>☎</span><span>{personal.phone}</span></div>}
            {personal.location && <div className="flex gap-1.5"><span>📍</span><span>{personal.location}</span></div>}
            {personal.linkedin && <div className="flex gap-1.5"><span>in</span><span className="normal-case truncate">{personal.linkedin}</span></div>}
            {personal.github && <div className="flex gap-1.5"><span>git</span><span className="normal-case truncate">{personal.github}</span></div>}
          </div>
        </div>

        {skills.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Expertise</h3>
            <div className="flex flex-wrap gap-1">
              {skills.map((s: string, idx: number) => (
                <span key={idx} className="bg-slate-800 border border-slate-700 text-yellow-500/90 font-bold px-2 py-0.5 text-[9px] uppercase tracking-wider">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {certifications.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Certifications</h3>
            <ul className="text-[10px] space-y-1 text-slate-300 list-none pl-0">
              {certifications.map((c: string, idx: number) => <li key={idx} className="flex gap-1.5 items-start"><span className="text-yellow-500">▪</span>{c}</li>)}
            </ul>
          </div>
        )}

        {languages.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Languages</h3>
            <ul className="text-[10px] space-y-1 text-slate-300 list-none pl-0">
              {languages.map((l: string, idx: number) => <li key={idx} className="flex gap-1.5 items-start"><span className="text-yellow-500">▪</span>{l}</li>)}
            </ul>
          </div>
        )}

        {awards.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Awards</h3>
            <ul className="text-[10px] space-y-1 text-slate-300 list-none pl-0">
              {awards.map((a: string, idx: number) => <li key={idx} className="flex gap-1.5 items-start"><span className="text-yellow-500">▪</span>{a}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="w-full md:w-[68%] p-6 flex flex-col gap-6 print:w-[68%]">
        {data.summary && (
          <div className="space-y-1">
            <h2 className="text-xs font-black tracking-wider text-slate-900 uppercase border-b border-slate-200 pb-1">Professional Summary</h2>
            <p className="text-xs text-slate-600 text-justify leading-relaxed">{data.summary}</p>
          </div>
        )}

        {experience.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-black tracking-wider text-slate-900 uppercase border-b border-slate-200 pb-1">Experience</h2>
            <div className="space-y-4">
              {experience.map((exp: any, idx: number) => (
                <div key={idx} className="space-y-1 border-l border-slate-200 pl-3 relative ml-1">
                  <div className="absolute w-2 h-2 rounded-full bg-slate-900 left-[-4.5px] top-[4px]" />
                  <div className="flex justify-between items-baseline font-bold text-xs">
                    <span className="text-slate-800">{exp.role || "Role"}</span>
                    <span className="text-slate-500 text-[10px] font-medium">{exp.period}</span>
                  </div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{exp.company}</div>
                  <p className="text-xs text-slate-600 text-justify whitespace-pre-wrap leading-relaxed">{exp.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {projects.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-black tracking-wider text-slate-900 uppercase border-b border-slate-200 pb-1">Academic Projects</h2>
            <div className="space-y-4">
              {projects.map((proj: any, idx: number) => (
                <div key={idx} className="space-y-1 border-l border-slate-200 pl-3 relative ml-1">
                  <div className="absolute w-2 h-2 rounded-full bg-slate-900 left-[-4.5px] top-[4px]" />
                  <div className="flex justify-between items-baseline font-bold text-xs">
                    <span className="text-slate-800">{proj.title || "Project"}</span>
                    {proj.tech && <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider">{proj.tech}</span>}
                  </div>
                  <p className="text-xs text-slate-600 text-justify whitespace-pre-wrap leading-relaxed">{proj.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {education.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-black tracking-wider text-slate-900 uppercase border-b border-slate-200 pb-1">Education Background</h2>
            <div className="space-y-3">
              {education.map((edu: any, idx: number) => (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between items-center text-xs font-bold text-slate-800">
                    <span>{edu.degree}</span>
                    <span className="text-slate-500 text-[10px] font-medium">{edu.year}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase">{edu.institution} — SCORE: {edu.score}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  switch (template) {
    case "Modern": return renderModern();
    case "Minimalist": return renderMinimalist();
    case "Creative": return renderCreative();
    case "Classic":
    default:
      return renderClassic();
  }
}

async function getDeterministicSalt(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.trim().toLowerCase());
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function AIToolkitContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, token, encryptionKey, setEncryptionKey } = useAppStore();

  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlockLoading, setUnlockLoading] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError("");
    setUnlockLoading(true);

    if (!user) return;

    try {
      const emailSalt = await getDeterministicSalt(user.email);
      const key = await deriveKey(unlockPassword, emailSalt);
      const keyHex = await exportKeyToHex(key);

      // Verify key is correct by attempting to decrypt neo_id_enc (if it exists)
      if (user.neo_id_enc && user.neo_id_enc !== "UNSET") {
        await decryptData(user.neo_id_enc, key);
      }

      setEncryptionKey(key, keyHex);
      // Re-trigger data loading for active company
      if (companyId) {
        await loadCompanyData(companyId);
      }
    } catch {
      setUnlockError("INCORRECT PASSWORD. DECRYPTION KEY IS INVALID.");
    } finally {
      setUnlockLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      router.push("/login");
      return;
    }
    if (user && !isProfileComplete(user)) {
      router.push("/profile");
    }
  }, [user, token, router]);

  const queryCompanyId = searchParams.get("companyId");

  const [companyId, setCompanyId] = useState<string>(queryCompanyId || "");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  
  const [loading, setLoading] = useState(true);
  
  // Optimizer States
  const [atsResult, setAtsResult] = useState<ATSResult | null>(null);
  const [calculatingATS, setCalculatingATS] = useState(false);
  const [atsModel, setAtsModel] = useState<BrowserModelType>("qwen-0.5b");
  const [optimizerSubView, setOptimizerSubView] = useState<"tailored" | "highlight" | "preview">("tailored");
  const [masterResume, setMasterResume] = useState<any>(null);
  const [activeApplication, setActiveApplication] = useState<any>(null);
  const [tailoredResumeData, setTailoredResumeData] = useState<any>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("Classic");
  const [compareWithMaster, setCompareWithMaster] = useState(false);
  
  // Helpers inside editor
  const [newCert, setNewCert] = useState("");
  const [newLang, setNewLang] = useState("");
  const [newAward, setNewAward] = useState("");

  const [savingDoc, setSavingDoc] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  
  // Local AI State
  const [geminiAvailable, setGeminiAvailable] = useState(false);
  const [localDownloadProgress, setLocalDownloadProgress] = useState<number | null>(null);
  const [localStatusMessage, setLocalStatusMessage] = useState("");

  // Initial Load
  useEffect(() => {
    async function initPage() {
      try {
        setLoading(true);
        const nano = await isGeminiNanoAvailable();
        setGeminiAvailable(nano);
        if (nano) {
          setAtsModel("gemini-nano");
        }

        const res = await api.get("/companies");
        setCompanies(res.data);

        if (companyId) {
          await loadCompanyData(companyId);
        } else if (res.data.length > 0) {
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

  // Sync on Company Change
  useEffect(() => {
    if (companyId && companies.length > 0) {
      loadCompanyData(companyId);
    }
  }, [companyId]);

  const fetchApplicationAndResume = async (compId: string) => {
    try {
      const res = await api.get("/resumes/me");
      let masterData = null;
      if (res.data && res.data.resume_data) {
        masterData = res.data.resume_data;
        setMasterResume(masterData);
      }

      const appsRes = await api.get("/applications");
      const activeApp = appsRes.data.find((a: any) => a.company_id === compId);
      setActiveApplication(activeApp || null);

      if (activeApp && activeApp.tailored_resume_enc && encryptionKey) {
        try {
          const decResume = await decryptData(activeApp.tailored_resume_enc, encryptionKey);
          const trData = JSON.parse(decResume);
          setTailoredResumeData(trData);
        } catch (e) {
          console.error("Failed to decrypt tailored resume:", e);
          if (masterData) {
            setTailoredResumeData(JSON.parse(JSON.stringify(masterData)));
          }
        }
      } else {
        if (masterData) {
          setTailoredResumeData(JSON.parse(JSON.stringify(masterData)));
        } else {
          setTailoredResumeData({
            personal: { name: user?.full_name || "", email: user?.email || "", phone: "", location: "" },
            summary: "",
            education: [],
            experience: [],
            projects: [],
            skills: user?.skills || []
          });
        }
      }
    } catch (err) {
      console.error("Failed to load application and resume details:", err);
    }
  };

  const loadCompanyData = async (id: string) => {
    try {
      setLoading(true);
      setErrorMsg("");
      const compRes = await api.get(`/companies/${id}`);
      setCompany(compRes.data);
      
      setAtsResult(null);
      
      await Promise.all([
        fetchApplicationAndResume(id)
      ]);
      
      await runDeterministicATS(compRes.data);
      
      setLoading(false);
    } catch (err: any) {
      console.error("Failed to load company details", err);
      setErrorMsg("Failed to load details for the selected company.");
      setLoading(false);
    }
  };

  const runDeterministicATS = async (activeCompany: Company) => {
    try {
      setCalculatingATS(true);
      const res = await api.post("/ai/tailor", {
        company_id: activeCompany.id,
        request_source: "browser"
      });
      
      const cleaned = {
        ...res.data,
        improvements: [] // Strip improvements
      };
      setAtsResult(cleaned);
    } catch (err) {
      console.error("ATS optimization check failed", err);
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
      const resMe = await api.get("/resumes/me");
      if (!resMe.data || !resMe.data.resume_data || Object.keys(resMe.data.resume_data).length === 0) {
        throw new Error("No master resume found. Please upload or save your resume details in the Student Profile page first.");
      }
      
      const resumeData = resMe.data.resume_data;

      // 1. Calculate missing keywords and ATS match score deterministically in JS
      const resumeTextForMatch = [
        resumeData.personal?.name || "",
        resumeData.personal?.location || "",
        resumeData.summary || "",
        ...(resumeData.skills || []),
        ...(resumeData.education || []).map((e: any) => `${e.degree} ${e.institution}`),
        ...(resumeData.experience || []).map((e: any) => `${e.role} ${e.company} ${e.description}`),
        ...(resumeData.projects || []).map((e: any) => `${e.title} ${e.tech} ${e.description}`),
      ].join(" ");
      
      const deterministicMatch = calculateMatchStats(resumeTextForMatch, jdKeywords);
      const missingKeywordsVal = Array.from(jdKeywords).filter(k => !deterministicMatch.matchedKeywords.has(k.toLowerCase().trim()));
      const atsScoreVal = deterministicMatch.matchPercentage;

      // 2. Compact JD and Resume to prevent model attention issues and context exhaustion
      const compactResumeData = {
        personal: {
          title: resumeData.personal?.title || ""
        },
        summary: resumeData.summary || "",
        skills: resumeData.skills || [],
        projects: (resumeData.projects || []).map((p: any) => ({ title: p.title, description: p.description }))
      };

      const compactJDText = (company.jd_text || "").substring(0, 800) + "...";

      const prompt = `You are a professional ATS optimizer. Optimize the student's Resume details to fit this Job Description.

Job Title: ${company.role} at ${company.name}
Job Description Context:
${compactJDText}

Required Skills:
${(company.jd_required_skills || []).join(", ")}

Original Student Resume details:
${JSON.stringify(compactResumeData)}

Guidelines:
1. Maintain strict truthfulness and originality: DO NOT invent new projects, certifications, degrees, or experiences out of thin air.
2. Tailor the wording of existing project descriptions and the summary to highlight relevant keywords from the Job Description and required skills.
3. The optimized_skills list must be a subset of the candidate's existing skills combined with those technical skills from the JD that the candidate actually possesses (or are strongly related to their existing projects and experiences). Do not add unrelated skills.

Return ONLY a valid JSON object matching this schema exactly (do NOT wrap in conversational intro/outro, start directly with the JSON):
{
  "optimized_skills": ["Skill1", "Skill2"],
  "optimized_projects": [
    {
      "title": "Project Title",
      "description": "Optimized description highlighting matching keywords from the JD based on original text"
    }
  ],
  "optimized_summary": "Tailored professional profile summary matching the role requirements."
}`;

      const modelNameMap: Record<string, string> = {
        "qwen-0.5b": "Xenova/Qwen1.5-0.5B-Chat",
        "llama-1b": "onnx-community/Llama-3.2-1B-Instruct-ONNX",
        "gemini-nano": "gemini-nano"
      };
      const modelFullName = modelNameMap[atsModel] || atsModel;
      const isDownloaded = typeof window !== "undefined" && (
        localStorage.getItem(`model_downloaded_${atsModel}`) === "true" ||
        localStorage.getItem(`model_downloaded_${modelFullName}`) === "true"
      );
      if (isDownloaded) {
        setLocalStatusMessage(`Waking up cached model ${atsModel}...`);
      } else {
        setLocalStatusMessage(`Downloading model weights for ${atsModel} (first time only)...`);
      }

      const result = await generateInBrowser({
        modelType: atsModel,
        prompt: prompt,
        maxTokens: 2048,
        onProgress: (p) => {
          setLocalDownloadProgress(Math.round(p * 100));
          setLocalStatusMessage(`Loading model weights: ${Math.round(p * 100)}%`);
        }
      });

      try {
        const parsed = parseRobustLLMJSON(result);
        
        // Extract and normalize fields to handle both nested (tailored_resume) and flat structures
        const optSummary = parsed.optimized_summary || parsed.summary || parsed.tailored_resume?.optimized_summary || parsed.tailored_resume?.summary || "";
        const optSkills = parsed.optimized_skills || parsed.skills || parsed.tailored_resume?.optimized_skills || parsed.tailored_resume?.skills || resumeData.skills || [];
        const optProjects = parsed.optimized_projects || parsed.projects || parsed.tailored_resume?.optimized_projects || parsed.tailored_resume?.projects || resumeData.projects || [];

        const mergedATSResult: ATSResult = {
          ats_score: atsScoreVal,
          missing_keywords: missingKeywordsVal,
          tailored_resume: {
            optimized_skills: optSkills,
            optimized_projects: optProjects,
            optimized_summary: optSummary
          }
        };

        setAtsResult(mergedATSResult);

        // Auto-apply optimized values to tailoredResumeData
        let baseData = tailoredResumeData || masterResume;
        if (!baseData && resumeData) {
          baseData = resumeData;
        }
        if (!baseData) {
          throw new Error("No resume template data available to tailor.");
        }

        const updatedData = JSON.parse(JSON.stringify(baseData));
        if (optSummary) {
          updatedData.summary = optSummary;
        }
        if (optSkills && optSkills.length > 0) {
          updatedData.skills = Array.from(new Set([
            ...optSkills,
            ...(updatedData.skills || [])
          ]));
        }
        if (optProjects && optProjects.length > 0) {
          const projects = updatedData.projects || [];
          optProjects.forEach((optProj: any) => {
            const match = projects.find((p: any) => 
              p.title.trim().toLowerCase() === optProj.title.trim().toLowerCase()
            );
            if (match) {
              match.description = optProj.description;
            } else if (projects.length > 0) {
              if (projects.length === 1 && optProjects.length === 1) {
                projects[0].description = optProjects[0].description;
              } else {
                const idx = optProjects.indexOf(optProj);
                if (idx !== -1 && projects[idx]) {
                  projects[idx].description = optProj.description;
                  if (optProj.title) {
                    projects[idx].title = optProj.title;
                  }
                }
              }
            }
          });
        }

        setTailoredResumeData(updatedData);

        // Securely Auto-Save/Encrypt to Backend
        if (encryptionKey && company) {
          try {
            const encResume = await encryptData(JSON.stringify(updatedData), encryptionKey);
            if (activeApplication) {
              const res = await api.patch(`/applications/${activeApplication.id}`, {
                tailored_resume_enc: encResume
              });
              setActiveApplication(res.data);
            } else {
              const res = await api.post("/applications", {
                company_id: company.id,
                status: "Applied",
                tailored_resume_enc: encResume,
                recruitment_state: "Registration"
              });
              setActiveApplication(res.data);
            }
            showSuccess("Local Browser AI tailoring completed, applied, and saved securely!");
          } catch (saveErr) {
            console.error("Auto-save failed:", saveErr);
            showSuccess("Local Browser AI tailoring completed and applied successfully! (Failed to auto-save to database)");
          }
        } else {
          showSuccess("Local Browser AI tailoring completed and applied successfully!");
        }

        setOptimizerSubView("preview");
      } catch (parseErr) {
        console.error("Local LLM JSON parse/regex error:", parseErr, "Raw output:", result);
        throw new Error("Local model returned invalid JSON structure. Please try generating again.");
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

  const jdKeywords = React.useMemo(() => {
    if (!company) return new Set<string>();
    if (company.jd_ats_keywords && company.jd_ats_keywords.length > 0) {
      return new Set(company.jd_ats_keywords.map(k => k.toLowerCase().trim()));
    }
    return extractKeywords(company.jd_text || "");
  }, [company]);

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

  const applySuggestionsToTailored = () => {
    if (!atsResult || !atsResult.tailored_resume || !tailoredResumeData) return;
    
    const opt = atsResult.tailored_resume;
    const updatedData = JSON.parse(JSON.stringify(tailoredResumeData));
    
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
    
    setTailoredResumeData(updatedData);
    showSuccess("AI optimizations applied! Click Save to lock it in.");
  };

  const handleSaveTailoredResume = async () => {
    if (!company || !encryptionKey || !tailoredResumeData) {
      setErrorMsg("Decryption Key or Resume Data missing. Ensure Vault is unlocked.");
      return;
    }
    
    try {
      setSavingDoc(true);
      setErrorMsg("");
      setSuccessMsg("");
      
      const encResume = await encryptData(JSON.stringify(tailoredResumeData), encryptionKey);
      
      if (activeApplication) {
        const res = await api.patch(`/applications/${activeApplication.id}`, {
          tailored_resume_enc: encResume
        });
        setActiveApplication(res.data);
      } else {
        const res = await api.post("/applications", {
          company_id: company.id,
          status: "Applied",
          tailored_resume_enc: encResume,
          recruitment_state: "Registration"
        });
        setActiveApplication(res.data);
      }
      
      showSuccess("Tailored resume saved securely for this application!");
    } catch (err: any) {
      console.error("Failed to save tailored resume:", err);
      setErrorMsg(err.response?.data?.detail || "Failed to save tailored resume.");
    } finally {
      setSavingDoc(false);
    }
  };

  const resetTailoredToMaster = () => {
    if (!masterResume) {
      setErrorMsg("No master resume found to reset to.");
      return;
    }
    setTailoredResumeData(JSON.parse(JSON.stringify(masterResume)));
    showSuccess("Tailored resume reset to Master Resume values!");
  };

  const downloadTailoredResumeText = () => {
    if (!tailoredResumeData) return;
    let text = `=== TAILORED RESUME: ${tailoredResumeData.personal?.name || ""} ===\n`;
    text += `Target: ${company?.name || ""} - ${company?.role || ""}\n\n`;
    
    text += `--- PERSONAL DETAILS ---\n`;
    text += `Name: ${tailoredResumeData.personal?.name || ""}\n`;
    text += `Email: ${tailoredResumeData.personal?.email || ""}\n`;
    text += `Phone: ${tailoredResumeData.personal?.phone || ""}\n`;
    text += `Location: ${tailoredResumeData.personal?.location || ""}\n`;
    if (tailoredResumeData.personal?.title) text += `Title: ${tailoredResumeData.personal.title}\n`;
    if (tailoredResumeData.personal?.github) text += `GitHub: ${tailoredResumeData.personal.github}\n`;
    if (tailoredResumeData.personal?.linkedin) text += `LinkedIn: ${tailoredResumeData.personal.linkedin}\n`;
    if (tailoredResumeData.personal?.website) text += `Website: ${tailoredResumeData.personal.website}\n`;
    
    text += `\n--- PROFESSIONAL SUMMARY ---\n`;
    text += `${tailoredResumeData.summary || ""}\n`;
    
    text += `\n--- EDUCATION HISTORY ---\n`;
    (tailoredResumeData.education || []).forEach((edu: any) => {
      text += `${edu.degree} at ${edu.institution} (${edu.year}) - Score: ${edu.score}\n`;
    });
    
    text += `\n--- WORK EXPERIENCE ---\n`;
    (tailoredResumeData.experience || []).forEach((exp: any) => {
      text += `${exp.role} at ${exp.company} (${exp.period})\nDescription: ${exp.description}\n\n`;
    });
    
    text += `\n--- PROJECTS ---\n`;
    (tailoredResumeData.projects || []).forEach((proj: any) => {
      text += `${proj.title} (Tech: ${proj.tech})\nDescription: ${proj.description}\n\n`;
    });
    
    text += `--- SKILLS ---\n`;
    text += `${(tailoredResumeData.skills || []).join(", ")}\n`;
    
    if (tailoredResumeData.certifications?.length) {
      text += `\n--- CERTIFICATIONS ---\n${tailoredResumeData.certifications.join(", ")}\n`;
    }
    if (tailoredResumeData.languages?.length) {
      text += `\n--- LANGUAGES ---\n${tailoredResumeData.languages.join(", ")}\n`;
    }
    if (tailoredResumeData.awards?.length) {
      text += `\n--- AWARDS & HONORS ---\n${tailoredResumeData.awards.join(", ")}\n`;
    }
    
    downloadAsTextFile(`tailored_resume_${company?.name || "company"}.txt`, text);
  };

  const updateTailoredPersonal = (field: string, val: string) => {
    setTailoredResumeData((prev: any) => ({
      ...prev,
      personal: { ...prev.personal, [field]: val }
    }));
  };

  const addTailoredEducation = () => {
    setTailoredResumeData((prev: any) => ({
      ...prev,
      education: [...(prev.education || []), { degree: "", institution: "", year: "", score: "" }]
    }));
  };

  const removeTailoredEducation = (index: number) => {
    setTailoredResumeData((prev: any) => ({
      ...prev,
      education: (prev.education || []).filter((_: any, i: number) => i !== index)
    }));
  };

  const updateTailoredEducation = (index: number, field: string, val: string) => {
    setTailoredResumeData((prev: any) => {
      const list = [...(prev.education || [])];
      list[index] = { ...list[index], [field]: val };
      return { ...prev, education: list };
    });
  };

  const addTailoredExperience = () => {
    setTailoredResumeData((prev: any) => ({
      ...prev,
      experience: [...(prev.experience || []), { role: "", company: "", period: "", description: "" }]
    }));
  };

  const removeTailoredExperience = (index: number) => {
    setTailoredResumeData((prev: any) => ({
      ...prev,
      experience: (prev.experience || []).filter((_: any, i: number) => i !== index)
    }));
  };

  const updateTailoredExperience = (index: number, field: string, val: string) => {
    setTailoredResumeData((prev: any) => {
      const list = [...(prev.experience || [])];
      list[index] = { ...list[index], [field]: val };
      return { ...prev, experience: list };
    });
  };

  const addTailoredProject = () => {
    setTailoredResumeData((prev: any) => ({
      ...prev,
      projects: [...(prev.projects || []), { title: "", tech: "", description: "" }]
    }));
  };

  const removeTailoredProject = (index: number) => {
    setTailoredResumeData((prev: any) => ({
      ...prev,
      projects: (prev.projects || []).filter((_: any, i: number) => i !== index)
    }));
  };

  const updateTailoredProject = (index: number, field: string, val: string) => {
    setTailoredResumeData((prev: any) => {
      const list = [...(prev.projects || [])];
      list[index] = { ...list[index], [field]: val };
      return { ...prev, projects: list };
    });
  };

  const addTailoredCert = () => {
    if (newCert.trim() && !tailoredResumeData.certifications?.includes(newCert.trim())) {
      setTailoredResumeData((prev: any) => ({
        ...prev,
        certifications: [...(prev.certifications || []), newCert.trim()]
      }));
      setNewCert("");
    }
  };

  const removeTailoredCert = (val: string) => {
    setTailoredResumeData((prev: any) => ({
      ...prev,
      certifications: (prev.certifications || []).filter((c: string) => c !== val)
    }));
  };

  const addTailoredLang = () => {
    if (newLang.trim() && !tailoredResumeData.languages?.includes(newLang.trim())) {
      setTailoredResumeData((prev: any) => ({
        ...prev,
        languages: [...(prev.languages || []), newLang.trim()]
      }));
      setNewLang("");
    }
  };

  const removeTailoredLang = (val: string) => {
    setTailoredResumeData((prev: any) => ({
      ...prev,
      languages: (prev.languages || []).filter((l: string) => l !== val)
    }));
  };

  const addTailoredAward = () => {
    if (newAward.trim() && !tailoredResumeData.awards?.includes(newAward.trim())) {
      setTailoredResumeData((prev: any) => ({
        ...prev,
        awards: [...(prev.awards || []), newAward.trim()]
      }));
      setNewAward("");
    }
  };

  const removeTailoredAward = (val: string) => {
    setTailoredResumeData((prev: any) => ({
      ...prev,
      awards: (prev.awards || []).filter((a: string) => a !== val)
    }));
  };

  const downloadAsTextFile = (filename: string, text: string) => {
    const element = document.createElement("a");
    const file = new Blob([text], { type: "text/plain;charset=utf-8" });
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    showSuccess("Text file downloaded successfully.");
  };

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 3500);
  };

  const getSkillBadgeColor = (skill: string) => {
    const normalizedSkill = skill.trim().toLowerCase();
    const userSkills = user?.skills || [];
    const normalizedUserSkills = userSkills.map(s => s.trim().toLowerCase());
    
    const hasExact = normalizedUserSkills.includes(normalizedSkill);
    if (hasExact) return "bg-green-500/10 border-green-500 text-green-500";
    
    const normUser = normalizedUserSkills.map(s => {
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

  if (!token || (user && !isProfileComplete(user))) {
    return null;
  }

  if (!encryptionKey) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col justify-center items-center font-sans p-8">
        <div className="max-w-md w-full border-2 border-border bg-card p-8 md:p-12 space-y-8">
          <div className="space-y-4 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center bg-accent text-black border-2 border-black">
              <ShieldCheck size={24} />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tighter uppercase leading-none">
              VAULT LOCKED
            </h1>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest leading-relaxed">
              Your placement information is stored securely. Enter your password to derive the decryption key in-memory.
            </p>
          </div>

          {unlockError && (
            <div className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-600 uppercase tracking-wider text-center">
              {unlockError}
            </div>
          )}

          <form onSubmit={handleUnlock} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase block">
                PASSWORD
              </label>
              <input
                type="password"
                required
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-14 border-2 border-border bg-transparent text-xl font-bold tracking-tight placeholder-zinc-700 focus:border-accent focus:outline-none px-4 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={unlockLoading}
              className="flex w-full items-center justify-center gap-3 h-14 border-2 border-border bg-foreground text-background font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95 disabled:opacity-50"
            >
              <Unlock size={16} />
              <span>{unlockLoading ? "UNLOCKING..." : "UNLOCK VAULT"}</span>
            </button>
          </form>

          <div className="text-center">
            <Link href="/dashboard" className="text-xs font-bold text-accent uppercase tracking-widest hover:underline">
              ← Return to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <style jsx global>{`
        @media print {
          /* Print Stylesheet overrides to isolate preview */
          body {
            background: white !important;
            color: black !important;
          }
          header, select, button, .no-print, aside, nav {
            display: none !important;
          }
          .print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            background: white !important;
            color: black !important;
          }
          body * {
            visibility: hidden;
          }
          .print-area, .print-area * {
            visibility: visible;
          }
        }
      `}</style>

      {/* Top Header Bar */}
      <header className="flex h-20 items-center justify-between border-b-2 border-border px-8 bg-background z-10 shrink-0 no-print">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="flex h-10 w-10 items-center justify-center border-2 border-border hover:bg-muted text-foreground transition-all active:scale-95"
          >
            <ArrowLeft size={16} />
          </Link>
          <span className="text-base font-extrabold tracking-tighter uppercase leading-none">
            AI RESUME OPTIMIZER <span className="text-accent">.</span>
          </span>
        </div>
        
        {/* Company Selector */}
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

      {/* Main Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0">
        
        {/* Left Column: Specs & Local model driver */}
        <div className="lg:col-span-4 border-r-2 border-border p-6 md:p-8 space-y-8 overflow-y-auto max-h-[calc(100vh-80px)] no-print">
          {company ? (
            <>
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

              {atsResult && (
                <div className="border-2 border-black bg-muted/20 p-6 space-y-6">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black tracking-widest uppercase">ATS SCORESHEET</span>
                    <span className="bg-black text-accent border border-accent px-2 py-1 text-[11px] font-black tracking-widest">
                      {atsResult.ats_score}% MATCH
                    </span>
                  </div>

                  <div className="w-full bg-muted border border-border h-4 relative overflow-hidden">
                    <div 
                      className="bg-accent h-full transition-all duration-500" 
                      style={{ width: `${atsResult.ats_score}%` }}
                    />
                  </div>

                  {/* Skills Grid */}
                  <div className="space-y-3">
                    <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest block">
                      JD SKILL MATCH MATRIX
                    </span>
                    
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {company.jd_required_skills && company.jd_required_skills.length > 0 ? (
                        company.jd_required_skills.map((skill, index) => (
                          <div key={index} className="flex justify-between items-center text-[10px] font-bold uppercase border-b border-border pb-1.5 font-mono">
                            <span className="text-foreground">{skill}</span>
                            <span className={`border px-1.5 py-0.5 text-[8px] font-extrabold ${getSkillBadgeColor(skill)}`}>
                              {getSkillBadgeColor(skill).includes("green") ? "PRESENT" : 
                               getSkillBadgeColor(skill).includes("yellow") ? "WEAK" : "MISSING"}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-[10px] text-muted-foreground uppercase font-mono">No required skills listed in Job Description.</p>
                      )}
                    </div>
                  </div>

                  {/* Local Model controls */}
                  <div className="pt-4 border-t border-border space-y-4">
                    <div className="space-y-1">
                      <span className="text-[8px] font-black text-muted-foreground uppercase block">LOCAL MODEL SIZE (WASM)</span>
                      <select
                        value={atsModel}
                        onChange={(e) => setAtsModel(e.target.value as BrowserModelType)}
                        className="w-full bg-background border border-border p-2 text-[10px] font-bold uppercase outline-none text-foreground font-mono"
                      >
                        {geminiAvailable && <option value="gemini-nano">GEMINI NANO (CHROME NATIVE)</option>}
                        <option value="qwen-0.5b">QWEN 1.5 0.5B CHAT (350MB - FAST)</option>
                        <option value="llama-1b">LLAMA 3.2 1B INSTRUCT (600MB - SMART)</option>
                      </select>
                    </div>

                    {calculatingATS && localStatusMessage && (
                      <div className="space-y-1.5">
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

                    <button
                      onClick={runLocalATS}
                      disabled={calculatingATS}
                      className="w-full h-10 border-2 border-border bg-background hover:bg-muted font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      {calculatingATS ? (
                        <>
                          <Loader2 className="animate-spin h-3.5 w-3.5" />
                          <span>TAILORING RESUME...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={12} className="text-accent" />
                          <span>TAILOR WITH BROWSER AI</span>
                        </>
                      )}
                    </button>
                    <span className="text-[8px] text-muted-foreground uppercase text-center block leading-normal font-mono">
                      GENERATION RUNS ENTIRELY ON CLIENT COMPUTE. COMPILES TAILORED SKILLS, SUMMARY, AND PROJECTS TO MATCH THE ANNOUNCEMENT.
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-20 text-xs font-bold text-muted-foreground uppercase">
              Select or import a company announcement to begin.
            </div>
          )}
        </div>

        {/* Right Column: Editor and Preview */}
        <div className="lg:col-span-8 flex flex-col max-h-[calc(100vh-80px)] overflow-hidden">
          
          {/* Main Controls Panel */}
          <div className="flex flex-col sm:flex-row justify-between items-stretch border-b border-border bg-muted/10 shrink-0 no-print sm:items-center">
            
            {/* View Subtabs */}
            <div className="flex border-r border-border h-14">
              <button
                onClick={() => setOptimizerSubView("tailored")}
                className={`px-5 text-[10px] font-black tracking-wider uppercase flex items-center gap-1.5 border-r border-border transition-all ${
                  optimizerSubView === "tailored" ? "bg-background border-b-2 border-b-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/5"
                }`}
              >
                <Edit size={12} />
                <span>Tailored Workspace</span>
              </button>
              <button
                onClick={() => setOptimizerSubView("highlight")}
                className={`px-5 text-[10px] font-black tracking-wider uppercase flex items-center gap-1.5 border-r border-border transition-all ${
                  optimizerSubView === "highlight" ? "bg-background border-b-2 border-b-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/5"
                }`}
              >
                <Highlighter size={12} />
                <span>Keyword Highlights</span>
              </button>
              <button
                onClick={() => setOptimizerSubView("preview")}
                className={`px-5 text-[10px] font-black tracking-wider uppercase flex items-center gap-1.5 transition-all ${
                  optimizerSubView === "preview" ? "bg-background border-b-2 border-b-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/5"
                }`}
              >
                <Eye size={12} />
                <span>Live Resume Preview</span>
              </button>
            </div>

            {/* Template Selector Row */}
            {optimizerSubView === "preview" && (
              <div className="flex items-center gap-1.5 px-4 py-2 bg-muted/20 border-t sm:border-t-0 border-border">
                <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">TEMPLATE:</span>
                {["Classic", "Modern", "Minimalist", "Creative"].map((t) => (
                  <button
                    key={t}
                    onClick={() => setSelectedTemplate(t)}
                    className={`px-2.5 py-1 border text-[9px] font-extrabold uppercase transition-all ${
                      selectedTemplate === t ? "border-accent bg-accent text-black" : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Core Content Area */}
          <div className="flex-1 overflow-y-auto p-6 md:p-8">
            {company ? (
              <>
                {/* 1. Editor Form View */}
                {optimizerSubView === "tailored" && (
                  <div className="space-y-6">
                    <div className="border-2 border-border p-6 space-y-3 bg-card">
                      <h3 className="text-lg font-black uppercase tracking-tighter">TAILORED APPLICATION WORKSPACE</h3>
                      <p className="text-xs text-muted-foreground uppercase leading-relaxed">
                        Customize your resume details below specifically for {company.name}. Manual edits made in this workspace are encrypted and saved to your application record, leaving your Master Resume completely untouched.
                      </p>
                    </div>

                    {tailoredResumeData ? (
                      <div className="space-y-6">
                        {/* Action Bar */}
                        <div className="flex flex-wrap gap-3 items-center justify-between border-2 border-border p-4 bg-muted/20">
                          <div className="flex items-center gap-2 text-xs font-black uppercase text-accent">
                            <Target size={14} />
                            <span>Structured Editor Form</span>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {atsResult?.tailored_resume && (
                              <button
                                onClick={applySuggestionsToTailored}
                                className="h-9 px-3 border border-accent bg-accent/10 hover:bg-accent hover:text-black text-accent text-[10px] font-black uppercase flex items-center gap-1.5 transition-all"
                              >
                                <Sparkles size={11} />
                                <span>Apply AI suggestions</span>
                              </button>
                            )}
                            <button
                              onClick={handleSaveTailoredResume}
                              disabled={savingDoc}
                              className="h-9 px-3 bg-foreground text-background hover:bg-accent hover:text-black border border-border text-[10px] font-black uppercase flex items-center gap-1.5 transition-all"
                            >
                              <Save size={11} />
                              <span>{savingDoc ? "Saving..." : "Save Tailored Resume"}</span>
                            </button>
                            <button
                              onClick={downloadTailoredResumeText}
                              className="h-9 px-3 bg-muted border border-border hover:border-accent hover:text-accent text-[10px] font-black uppercase flex items-center gap-1.5 transition-all"
                            >
                              <Download size={11} />
                              <span>Export as Text</span>
                            </button>
                            <button
                              onClick={resetTailoredToMaster}
                              className="h-9 px-3 border border-red-500/50 hover:bg-red-500 hover:text-white text-red-500 text-[10px] font-black uppercase flex items-center gap-1.5 transition-all"
                            >
                              Reset to Master
                            </button>
                          </div>
                        </div>

                        {/* Interactive Form */}
                        <div className="border-2 border-border p-6 bg-card space-y-8">
                          
                          {/* Personal info */}
                          <div className="space-y-4">
                            <h4 className="text-xs font-black uppercase tracking-widest text-accent">Personal Information</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                              <div className="space-y-1">
                                <label className="text-[9px] font-black uppercase text-zinc-500">Full Name</label>
                                <input
                                  type="text"
                                  value={tailoredResumeData.personal?.name || ""}
                                  onChange={(e) => updateTailoredPersonal("name", e.target.value)}
                                  className="w-full h-10 border border-border bg-background text-xs font-bold uppercase px-3 focus:border-accent focus:outline-none"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-black uppercase text-zinc-500">Email Address</label>
                                <input
                                  type="text"
                                  value={tailoredResumeData.personal?.email || ""}
                                  onChange={(e) => updateTailoredPersonal("email", e.target.value)}
                                  className="w-full h-10 border border-border bg-background text-xs font-bold px-3 focus:border-accent focus:outline-none"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-black uppercase text-zinc-500">Phone Number</label>
                                <input
                                  type="text"
                                  value={tailoredResumeData.personal?.phone || ""}
                                  onChange={(e) => updateTailoredPersonal("phone", e.target.value)}
                                  className="w-full h-10 border border-border bg-background text-xs font-bold px-3 focus:border-accent focus:outline-none"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-black uppercase text-zinc-500">Location</label>
                                <input
                                  type="text"
                                  value={tailoredResumeData.personal?.location || ""}
                                  onChange={(e) => updateTailoredPersonal("location", e.target.value)}
                                  className="w-full h-10 border border-border bg-background text-xs font-bold px-3 focus:border-accent focus:outline-none"
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="space-y-1">
                                <label className="text-[9px] font-black uppercase text-zinc-500">Headline/Title</label>
                                <input
                                  type="text"
                                  value={tailoredResumeData.personal?.title || ""}
                                  onChange={(e) => updateTailoredPersonal("title", e.target.value)}
                                  placeholder="e.g. SOFTWARE ENGINEER INTERN"
                                  className="w-full h-10 border border-border bg-background text-xs font-bold uppercase px-3 focus:border-accent focus:outline-none"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-black uppercase text-zinc-500">LinkedIn Username</label>
                                <input
                                  type="text"
                                  value={tailoredResumeData.personal?.linkedin || ""}
                                  onChange={(e) => updateTailoredPersonal("linkedin", e.target.value)}
                                  placeholder="linkedin.com/in/..."
                                  className="w-full h-10 border border-border bg-background text-xs font-bold px-3 focus:border-accent focus:outline-none"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9px] font-black uppercase text-zinc-500">GitHub Username</label>
                                <input
                                  type="text"
                                  value={tailoredResumeData.personal?.github || ""}
                                  onChange={(e) => updateTailoredPersonal("github", e.target.value)}
                                  placeholder="github.com/..."
                                  className="w-full h-10 border border-border bg-background text-xs font-bold px-3 focus:border-accent focus:outline-none"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Summary */}
                          <div className="space-y-2">
                            <label className="text-xs font-black uppercase tracking-widest text-accent">Professional Summary</label>
                            <textarea
                              value={tailoredResumeData.summary || ""}
                              onChange={(e) => setTailoredResumeData((prev: any) => ({ ...prev, summary: e.target.value }))}
                              rows={3}
                              className="w-full border border-border bg-background text-xs p-3 focus:border-accent focus:outline-none uppercase font-bold"
                            />
                          </div>

                          {/* Skills */}
                          <div className="space-y-2">
                            <label className="text-xs font-black uppercase tracking-widest text-accent">Core Skills (Comma-separated)</label>
                            <input
                              type="text"
                              value={tailoredResumeData.skills ? tailoredResumeData.skills.join(", ") : ""}
                              onChange={(e) => {
                                const arr = e.target.value.split(",").map(s => s.trim());
                                setTailoredResumeData((prev: any) => ({ ...prev, skills: arr }));
                              }}
                              className="w-full h-10 border border-border bg-background text-xs font-bold uppercase px-3 focus:border-accent focus:outline-none"
                            />
                          </div>

                          {/* Education */}
                          <div className="space-y-4 pt-4 border-t border-border">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-black uppercase tracking-widest text-accent">Education Background</span>
                              <button
                                type="button"
                                onClick={addTailoredEducation}
                                className="flex items-center gap-1 text-[9px] bg-muted border border-border hover:bg-accent hover:text-black px-2 py-1 uppercase font-bold"
                              >
                                <Plus size={11} />
                                <span>Add School/College</span>
                              </button>
                            </div>
                            <div className="space-y-3">
                              {(tailoredResumeData.education || []).map((edu: any, idx: number) => (
                                <div key={idx} className="flex flex-col md:flex-row gap-3 border border-border p-3 bg-background">
                                  <input
                                    type="text"
                                    value={edu.degree}
                                    onChange={(e) => updateTailoredEducation(idx, "degree", e.target.value)}
                                    placeholder="Degree / Course"
                                    className="flex-2 border border-border bg-background text-xs font-bold uppercase px-3 h-10 focus:outline-none focus:border-accent"
                                  />
                                  <input
                                    type="text"
                                    value={edu.institution}
                                    onChange={(e) => updateTailoredEducation(idx, "institution", e.target.value)}
                                    placeholder="School / University"
                                    className="flex-2 border border-border bg-background text-xs font-bold uppercase px-3 h-10 focus:outline-none focus:border-accent"
                                  />
                                  <input
                                    type="text"
                                    value={edu.year}
                                    onChange={(e) => updateTailoredEducation(idx, "year", e.target.value)}
                                    placeholder="Year (e.g. 2024)"
                                    className="flex-1 border border-border bg-background text-xs font-bold px-3 h-10 focus:outline-none focus:border-accent"
                                  />
                                  <input
                                    type="text"
                                    value={edu.score}
                                    onChange={(e) => updateTailoredEducation(idx, "score", e.target.value)}
                                    placeholder="Score / GPA"
                                    className="flex-1 border border-border bg-background text-xs font-bold px-3 h-10 focus:outline-none focus:border-accent"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeTailoredEducation(idx)}
                                    className="border border-red-600 bg-red-600/10 text-red-600 hover:bg-red-600 hover:text-white px-3 h-10 flex items-center justify-center transition-all"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Work Experience */}
                          <div className="space-y-4 pt-4 border-t border-border">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-black uppercase tracking-widest text-accent">Professional Experience</span>
                              <button
                                type="button"
                                onClick={addTailoredExperience}
                                className="flex items-center gap-1 text-[9px] bg-muted border border-border hover:bg-accent hover:text-black px-2 py-1 uppercase font-bold"
                              >
                                <Plus size={11} />
                                <span>Add Experience</span>
                              </button>
                            </div>
                            <div className="space-y-4">
                              {(tailoredResumeData.experience || []).map((exp: any, idx: number) => (
                                <div key={idx} className="border border-border p-4 bg-background space-y-3">
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <input
                                      type="text"
                                      value={exp.role}
                                      onChange={(e) => updateTailoredExperience(idx, "role", e.target.value)}
                                      placeholder="Job Title"
                                      className="border border-border bg-background text-xs font-bold uppercase px-3 h-10 focus:outline-none focus:border-accent"
                                    />
                                    <input
                                      type="text"
                                      value={exp.company}
                                      onChange={(e) => updateTailoredExperience(idx, "company", e.target.value)}
                                      placeholder="Company Name"
                                      className="border border-border bg-background text-xs font-bold uppercase px-3 h-10 focus:outline-none focus:border-accent"
                                    />
                                    <input
                                      type="text"
                                      value={exp.period}
                                      onChange={(e) => updateTailoredExperience(idx, "period", e.target.value)}
                                      placeholder="Period (e.g. June 2023 - Present)"
                                      className="border border-border bg-background text-xs font-bold px-3 h-10 focus:outline-none focus:border-accent"
                                    />
                                  </div>
                                  <textarea
                                    value={exp.description}
                                    onChange={(e) => updateTailoredExperience(idx, "description", e.target.value)}
                                    placeholder="Responsibilities and accomplishments..."
                                    rows={3}
                                    className="w-full border border-border bg-background text-xs p-3 focus:outline-none focus:border-accent font-mono uppercase"
                                  />
                                  <div className="flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() => removeTailoredExperience(idx)}
                                      className="flex items-center gap-1 text-[9px] border border-red-600 bg-red-600/10 text-red-600 hover:bg-red-600 hover:text-white px-3 py-1 uppercase font-bold"
                                    >
                                      <Trash2 size={11} />
                                      <span>Remove Experience</span>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Projects */}
                          <div className="space-y-4 pt-4 border-t border-border">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-black uppercase tracking-widest text-accent">Projects</span>
                              <button
                                type="button"
                                onClick={addTailoredProject}
                                className="flex items-center gap-1 text-[9px] bg-muted border border-border hover:bg-accent hover:text-black px-2 py-1 uppercase font-bold"
                              >
                                <Plus size={11} />
                                <span>Add Project</span>
                              </button>
                            </div>
                            <div className="space-y-4">
                              {(tailoredResumeData.projects || []).map((proj: any, idx: number) => (
                                <div key={idx} className="border border-border p-4 bg-background space-y-3">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <input
                                      type="text"
                                      value={proj.title}
                                      onChange={(e) => updateTailoredProject(idx, "title", e.target.value)}
                                      placeholder="Project Title"
                                      className="border border-border bg-background text-xs font-bold uppercase px-3 h-10 focus:outline-none focus:border-accent"
                                    />
                                    <input
                                      type="text"
                                      value={proj.tech}
                                      onChange={(e) => updateTailoredProject(idx, "tech", e.target.value)}
                                      placeholder="Technologies (e.g. Next.js, Python)"
                                      className="border border-border bg-background text-xs font-bold uppercase px-3 h-10 focus:outline-none focus:border-accent"
                                    />
                                  </div>
                                  <textarea
                                    value={proj.description}
                                    onChange={(e) => updateTailoredProject(idx, "description", e.target.value)}
                                    placeholder="Project description and results..."
                                    rows={3}
                                    className="w-full border border-border bg-background text-xs p-3 focus:outline-none focus:border-accent font-mono uppercase"
                                  />
                                  <div className="flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() => removeTailoredProject(idx)}
                                      className="flex items-center gap-1 text-[9px] border border-red-600 bg-red-600/10 text-red-600 hover:bg-red-600 hover:text-white px-3 py-1 uppercase font-bold"
                                    >
                                      <Trash2 size={11} />
                                      <span>Remove Project</span>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Certifications, Languages, Awards */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-border">
                            {/* Certs */}
                            <div className="space-y-3">
                              <span className="text-xs font-black uppercase tracking-widest text-accent block">Certifications</span>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={newCert}
                                  onChange={(e) => setNewCert(e.target.value)}
                                  placeholder="e.g. AWS Developer"
                                  className="flex-1 h-10 border border-border bg-background text-xs px-3 focus:outline-none focus:border-accent"
                                />
                                <button
                                  type="button"
                                  onClick={addTailoredCert}
                                  className="h-10 px-3 bg-muted border border-border hover:bg-accent hover:text-black text-xs font-bold uppercase"
                                >
                                  Add
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {(tailoredResumeData.certifications || []).map((val: string, i: number) => (
                                  <span key={i} className="inline-flex items-center gap-1.5 bg-muted px-2 py-1 text-[9px] font-bold border border-border uppercase">
                                    <span>{val}</span>
                                    <button type="button" onClick={() => removeTailoredCert(val)} className="text-red-500 hover:text-red-300 font-extrabold">×</button>
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Languages */}
                            <div className="space-y-3">
                              <span className="text-xs font-black uppercase tracking-widest text-accent block">Languages</span>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={newLang}
                                  onChange={(e) => setNewLang(e.target.value)}
                                  placeholder="e.g. English"
                                  className="flex-1 h-10 border border-border bg-background text-xs px-3 focus:outline-none focus:border-accent"
                                />
                                <button
                                  type="button"
                                  onClick={addTailoredLang}
                                  className="h-10 px-3 bg-muted border border-border hover:bg-accent hover:text-black text-xs font-bold uppercase"
                                >
                                  Add
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {(tailoredResumeData.languages || []).map((val: string, i: number) => (
                                  <span key={i} className="inline-flex items-center gap-1.5 bg-muted px-2 py-1 text-[9px] font-bold border border-border uppercase">
                                    <span>{val}</span>
                                    <button type="button" onClick={() => removeTailoredLang(val)} className="text-red-500 hover:text-red-300 font-extrabold">×</button>
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Awards */}
                            <div className="space-y-3">
                              <span className="text-xs font-black uppercase tracking-widest text-accent block">Awards & Honors</span>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={newAward}
                                  onChange={(e) => setNewAward(e.target.value)}
                                  placeholder="e.g. Dean's List"
                                  className="flex-1 h-10 border border-border bg-background text-xs px-3 focus:outline-none focus:border-accent"
                                />
                                <button
                                  type="button"
                                  onClick={addTailoredAward}
                                  className="h-10 px-3 bg-muted border border-border hover:bg-accent hover:text-black text-xs font-bold uppercase"
                                >
                                  Add
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {(tailoredResumeData.awards || []).map((val: string, i: number) => (
                                  <span key={i} className="inline-flex items-center gap-1.5 bg-muted px-2 py-1 text-[9px] font-bold border border-border uppercase">
                                    <span>{val}</span>
                                    <button type="button" onClick={() => removeTailoredAward(val)} className="text-red-500 hover:text-red-300 font-extrabold">×</button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>

                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-20 border border-dashed border-border text-xs font-bold text-muted-foreground uppercase">
                        Loading your workspace...
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Keyword Highlights View */}
                {optimizerSubView === "highlight" && (
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
                    {/* Left: Job Description */}
                    <div className="xl:col-span-5 border-2 border-border p-6 bg-card space-y-6 max-h-[650px] overflow-y-auto">
                      <div className="flex items-center gap-2 border-b border-border pb-3">
                        <FileText className="w-4 h-4 text-accent" />
                        <h3 className="text-sm font-black uppercase tracking-widest text-foreground">JOB DESCRIPTION</h3>
                      </div>
                      
                      <div className="space-y-4 text-xs leading-relaxed uppercase tracking-wider font-mono text-muted-foreground whitespace-pre-wrap select-text text-left">
                        {company.jd_text ? (
                          <HighlightedText text={company.jd_text} keywords={jdKeywords} />
                        ) : (
                          "No job description details available."
                        )}
                      </div>
                    </div>

                    {/* Right: Master Resume */}
                    <div className="xl:col-span-7 border-2 border-border p-6 bg-card space-y-6 max-h-[650px] overflow-y-auto">
                      <div className="flex items-center justify-between border-b border-border pb-3">
                        <div className="flex items-center gap-2">
                          <Target className="w-4 h-4 text-accent" />
                          <h3 className="text-sm font-black uppercase tracking-widest text-foreground">MASTER RESUME MATCH</h3>
                        </div>
                        <span className="bg-black text-accent border border-accent px-2 py-1 text-[10px] font-black uppercase tracking-widest">
                          {matchStats.matchPercentage}% REAL MATCH
                        </span>
                      </div>

                      {masterResume ? (
                        <div className="space-y-6">
                          {masterResume.summary && (
                            <div className="space-y-2">
                              <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block border-b border-border pb-1">SUMMARY</span>
                              <p className="text-xs bg-muted/20 border border-border p-3 leading-relaxed uppercase tracking-wider font-mono text-left">
                                <HighlightedText text={masterResume.summary} keywords={jdKeywords} />
                              </p>
                            </div>
                          )}

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

                          {masterResume.experience && masterResume.experience.length > 0 && (
                            <div className="space-y-3">
                              <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block border-b border-border pb-1">EXPERIENCE</span>
                              <div className="space-y-3">
                                {masterResume.experience.map((exp: any, i: number) => (
                                  <div key={i} className="border border-border p-3.5 space-y-2 bg-muted/5 text-left">
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

                          {masterResume.projects && masterResume.projects.length > 0 && (
                            <div className="space-y-3">
                              <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block border-b border-border pb-1">PROJECTS</span>
                              <div className="space-y-3">
                                {masterResume.projects.map((proj: any, i: number) => (
                                  <div key={i} className="border border-border p-3.5 space-y-2 bg-muted/5 text-left">
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

                          {masterResume.education && masterResume.education.length > 0 && (
                            <div className="space-y-3">
                              <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block border-b border-border pb-1">EDUCATION</span>
                              <div className="space-y-2 bg-muted/20 border border-border p-3.5 text-left font-mono">
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
                          No master resume available. Please create one in Student Profile first.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 3. Live Resume Preview */}
                {optimizerSubView === "preview" && (
                  <div className="space-y-6">
                    {/* Floating Premium controls bar */}
                    <div className="flex flex-wrap gap-3 items-center justify-between border-2 border-border p-4 bg-muted/20 no-print">
                      <div className="flex items-center gap-2 text-xs font-black uppercase text-accent">
                        <Printer size={14} />
                        <span>Interactive Preview & PDF Export</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setCompareWithMaster(prev => !prev)}
                          className={`h-10 px-4 border text-[10px] font-black uppercase flex items-center gap-2 transition-all ${
                            compareWithMaster 
                              ? "bg-accent border-accent text-black hover:bg-black hover:text-accent hover:border-black"
                              : "bg-background border-border text-foreground hover:bg-muted"
                          }`}
                        >
                          <span>{compareWithMaster ? "Hide Comparison" : "Compare with Master"}</span>
                        </button>
                        <button
                          onClick={() => window.print()}
                          className="h-10 px-4 bg-accent text-black border border-accent hover:bg-black hover:text-accent hover:border-black text-[10px] font-black uppercase flex items-center gap-2 transition-all"
                        >
                          <Printer size={12} />
                          <span>Save PDF / Print</span>
                        </button>
                      </div>
                    </div>

                    {/* Paper layout wrapper */}
                    <div className="w-full overflow-x-auto py-4 bg-zinc-950/10 border-2 border-dashed border-border">
                      {compareWithMaster ? (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 max-w-[1680px] mx-auto px-4">
                          <div className="space-y-2">
                            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest block text-center no-print">Master Resume</span>
                            <div className="shadow-2xl bg-white">
                              <ResumeTemplatePreview data={masterResume} template={selectedTemplate} />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <span className="text-[10px] font-black text-accent uppercase tracking-widest block text-center no-print">Tailored Resume (Optimized)</span>
                            <div className="print-area shadow-2xl bg-white">
                              <ResumeTemplatePreview data={tailoredResumeData} template={selectedTemplate} />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="print-area shadow-2xl bg-white max-w-[800px] mx-auto">
                          <ResumeTemplatePreview data={tailoredResumeData} template={selectedTemplate} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-20 text-xs font-bold text-muted-foreground uppercase">
                Select a placement drive announcement to display the AI Resume Optimizer.
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
