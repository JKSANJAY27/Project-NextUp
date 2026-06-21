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

interface CopilotQuestion {
  id: string;
  type: "general" | "job_specific";
  stableKey: string;
  text: string;
  answer: string;
  sourceGapKey?: string;
}

interface VaultQA {
  stableKey?: string;
  question: string;
  answer: string;
  timestamp: string;
}

type Capability =
  | "backend_systems"
  | "real_time_systems"
  | "ml_systems"
  | "research_methodology"
  | "data_structures"
  | "networking"
  | "concurrency"
  | "deployment"
  | "observability";

type AlignmentStrategy =
  | "skill_verification"
  | "experience_enrichment"
  | "transferable_exploration"
  | "minimal_jd_targeting";

interface AlignmentResult {
  score: number;
  level: "High" | "Medium" | "Low";
  directOverlapCount: number;
  transferableOverlapCount: number;
  primaryStrategy: AlignmentStrategy;
}

interface EvidenceNode {
  id: string;
  type: "skill" | "project" | "experience" | "certification";
  name: string;
  confidence: number; // 0-100
  inferredCapabilities: Capability[];
  evidenceStrength: "strong" | "medium" | "weak";
  supportingEvidence: string[];
}

interface EvidenceGap {
  stableKey: string;
  category: "GENERAL" | "JOB_SPECIFIC";
  gapType: "missing_skill" | "weak_skill" | "project_depth" | "missing_metric" | "missing_infrastructure" | "enrichment_opportunity";
  skillOrProjectName: string;
  reason: string;
  evidenceMissing: string;
  importance: number; // 0-100
  confidence: number; // 0-100
  resumeImpactScore: number; // 0-100
  priority?: number;
}

interface VerifiedEvidence {
  stableKey: string;
  category: string;
  confidence: number;
  answer: string;
  usableForResume: boolean;
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

function balanceJSONStack(jsonStr: string): string {
  const s = jsonStr.trim();
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let clean = "";

  for (let i = 0; i < s.length; i++) {
    const char = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      clean += char;
    } else {
      if (char === '"') {
        inString = true;
        clean += char;
      } else if (char === "{") {
        stack.push("}");
        clean += char;
      } else if (char === "[") {
        stack.push("]");
        clean += char;
      } else if (char === "}") {
        const lastIdx = stack.lastIndexOf("}");
        if (lastIdx !== -1) {
          stack.splice(lastIdx, 1);
          clean += char;
        }
      } else if (char === "]") {
        const lastIdx = stack.lastIndexOf("]");
        if (lastIdx !== -1) {
          stack.splice(lastIdx, 1);
          clean += char;
        }
      } else {
        clean += char;
      }
    }
  }

  if (inString) {
    clean += '"';
  }

  while (stack.length > 0) {
    clean += stack.pop();
  }

  return clean;
}

function normalizeStableKey(key: string): string {
  const parts = key.trim().toLowerCase().split(":");
  if (parts.length === 0) return "";
  const prefix = parts[0];
  
  if (prefix === "skill" && parts.length > 1) {
    const skillName = parts.slice(1).join(":").trim();
    // Normalize common aliases
    let norm = skillName;
    if (skillName === "reactjs" || skillName === "react.js" || skillName === "react js") norm = "react";
    if (skillName === "nodejs" || skillName === "node.js" || skillName === "node js") norm = "node.js";
    if (skillName === "golang") norm = "go";
    if (skillName === "amazon web services") norm = "aws";
    if (skillName === "google cloud platform" || skillName === "google cloud") norm = "gcp";
    if (skillName === "microsoft azure") norm = "azure";
    return `skill:${norm}`;
  }
  
  if (prefix === "project" && parts.length > 2) {
    const projName = parts[1].trim();
    const category = parts[2].trim();
    // Ensure category is one of the formal categories
    let finalCat = category;
    if (category === "infra" || category === "hosting") finalCat = "deployment";
    return `project:${projName}:${finalCat}`;
  }
  
  return key.trim().toLowerCase();
}

function buildEvidenceGraph(resumeData: any): EvidenceNode[] {
  const nodes: EvidenceNode[] = [];

  const inferNodeCapabilities = (name: string, description: string, tech: string): Capability[] => {
    const capabilities = new Set<Capability>();
    const combined = `${name} ${description} ${tech}`.toLowerCase();
    if (/backend|fastapi|flask|django|express|spring|node|nest|api|rest|graphql|sql|postgres|mongo|neo4j|redis|database|server/i.test(combined)) {
      capabilities.add("backend_systems");
    }
    if (/real-time|websocket|socket\.io|sse|event-driven|pub\/sub|real time|stream|audio|voice|chat/i.test(combined)) {
      capabilities.add("real_time_systems");
    }
    if (/ml|ai|machine learning|llm|rag|nlp|gpt|gemini|transformer|deep learning|tensorflow|pytorch|model|inference|knowledge graph/i.test(combined)) {
      capabilities.add("ml_systems");
    }
    if (/research|paper|publication|experiment|methodology|benchmarking|feasibility|patent/i.test(combined)) {
      capabilities.add("research_methodology");
    }
    if (/algorithm|data structures|tree|graph|complexity|optimization|parse|search|sorting/i.test(combined)) {
      capabilities.add("data_structures");
    }
    if (/network|tcp|ip|dns|http|tls|ssl|socket|proxy|packet|wireshark|vpn|security/i.test(combined)) {
      capabilities.add("networking");
    }
    if (/concurrency|async|parallel|multithread|thread|goroutine|coroutine|race condition/i.test(combined)) {
      capabilities.add("concurrency");
    }
    if (/deploy|host|cloud|aws|gcp|azure|docker|kubernetes|helm|terraform|ansible|ci\/cd|github actions|jenkins|linux/i.test(combined)) {
      capabilities.add("deployment");
    }
    if (/observability|monitoring|logging|tracing|prometheus|grafana|langfuse|opentelemetry/i.test(combined)) {
      capabilities.add("observability");
    }
    return Array.from(capabilities);
  };

  const getStrength = (type: any, name: string, description: string, tech: string, supCount: number, hasGit: boolean = false): "strong" | "medium" | "weak" => {
    const combined = `${name} ${description} ${tech}`.toLowerCase();
    if (type === "skill") {
      if (supCount >= 2) return "strong";
      if (supCount === 1) return "medium";
      return "weak";
    }
    if (type === "project") {
      const hasMetrics = /[0-9]+%?/.test(description) || /latency|throughput|users|requests|percent|scale/i.test(combined);
      const hasInfra = /aws|gcp|azure|docker|kubernetes|linux|nginx|redis|deploy|host/i.test(combined);
      if ((hasMetrics && hasInfra) || (hasMetrics && hasGit) || description.length > 250) {
        return "strong";
      }
      if (description.length > 80 || hasGit || hasInfra || hasMetrics) {
        return "medium";
      }
      return "weak";
    }
    if (type === "experience") {
      const hasMetrics = /[0-9]+%?/.test(description) || /latency|throughput|users|requests|percent|scale/i.test(combined);
      if (description.length > 200 && hasMetrics) {
        return "strong";
      }
      if (description.length > 50) {
        return "medium";
      }
      return "weak";
    }
    return "strong";
  };

  // 1. Add skill nodes
  (resumeData.skills || []).forEach((s: string) => {
    nodes.push({
      id: `skill:${s.trim().toLowerCase()}`,
      type: "skill",
      name: s.trim(),
      confidence: 100,
      inferredCapabilities: inferNodeCapabilities(s, "", ""),
      evidenceStrength: "medium",
      supportingEvidence: ["Listed explicitly in core skills section of the master resume."]
    });
  });

  // 2. Add project nodes and extract tech-stack supporting evidence
  (resumeData.projects || []).forEach((p: any) => {
    const projId = `project:${p.title.trim().toLowerCase()}`;
    const supporting: string[] = [];
    if (p.description) supporting.push(`Project Description: ${p.description}`);
    if (p.tech) {
      supporting.push(`Project Tech Stack: ${p.tech}`);
      p.tech.split(',').forEach((t: string) => {
        const tTrim = t.trim();
        const skillId = `skill:${tTrim.toLowerCase()}`;
        
        // Link project to skill: Add or increase confidence of the skill if it was already listed
        const existingSkill = nodes.find(n => n.id === skillId);
        if (existingSkill) {
          existingSkill.supportingEvidence.push(`Used in project '${p.title}': "${p.description || ""}"`);
        } else {
          nodes.push({
            id: skillId,
            type: "skill",
            name: tTrim,
            confidence: 90,
            inferredCapabilities: inferNodeCapabilities(tTrim, "", ""),
            evidenceStrength: "medium",
            supportingEvidence: [`Found in tech stack of project '${p.title}'.`]
          });
        }
      });
    }
    
    nodes.push({
      id: projId,
      type: "project",
      name: p.title,
      confidence: 100,
      inferredCapabilities: inferNodeCapabilities(p.title, p.description || "", p.tech || ""),
      evidenceStrength: getStrength("project", p.title, p.description || "", p.tech || "", 0, !!p.github_url),
      supportingEvidence: supporting
    });
  });

  // 3. Add experience nodes and extract supporting evidence
  (resumeData.experience || []).forEach((e: any) => {
    const expId = `experience:${e.company.trim().toLowerCase()}:${e.role.trim().toLowerCase()}`;
    const supporting: string[] = [];
    if (e.description) supporting.push(`Role Description: ${e.description}`);
    
    // We can search the experience description for skills to boost confidence
    const allSkillsLower = nodes.filter(n => n.type === "skill").map(n => n.name.toLowerCase());
    if (e.description) {
      const descLower = e.description.toLowerCase();
      allSkillsLower.forEach(skillLower => {
        const escaped = skillLower.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'i');
        if (regex.test(descLower)) {
          const skillNode = nodes.find(n => n.id === `skill:${skillLower}`);
          if (skillNode) {
            skillNode.supportingEvidence.push(`Mentioned in work experience at '${e.company}' as '${e.role}': "${e.description}"`);
            skillNode.confidence = Math.min(100, skillNode.confidence + 5); // boost confidence
          }
        }
      });
    }

    nodes.push({
      id: expId,
      type: "experience",
      name: `${e.role} at ${e.company}`,
      confidence: 100,
      inferredCapabilities: inferNodeCapabilities(e.role, e.description || "", ""),
      evidenceStrength: getStrength("experience", `${e.role} at ${e.company}`, e.description || "", "", 0),
      supportingEvidence: supporting
    });
  });

  // 4. Add certifications nodes
  (resumeData.certifications || []).forEach((c: string) => {
    nodes.push({
      id: `certification:${c.trim().toLowerCase()}`,
      type: "certification",
      name: c.trim(),
      confidence: 100,
      inferredCapabilities: inferNodeCapabilities(c, "", ""),
      evidenceStrength: "strong",
      supportingEvidence: ["Listed explicitly in certifications section of the master resume."]
    });
  });

  // 5. Re-evaluate skill evidence strength based on collected supporting evidence
  nodes.forEach(n => {
    if (n.type === "skill") {
      n.evidenceStrength = getStrength("skill", n.name, "", "", n.supportingEvidence.length);
    }
  });

  return nodes;
}

function calculateAnswerUsability(answer: string): number {
  const text = answer.trim();
  if (text.length === 0) return 0;
  
  const lower = text.toLowerCase();
  if (/^(yes|no|none|na|n\/a|not yet|never|yeah|sure|yep|nop|nope)$/.test(lower)) {
    return 10;
  }
  
  let score = 20;
  
  if (text.length > 20) score += 10;
  if (text.length > 50) score += 20;
  if (text.length > 100) score += 20;
  
  const hasNumbers = /[0-9]+%?/.test(text);
  if (hasNumbers) score += 15;
  
  const techKeywords = ["docker", "kubernetes", "aws", "gcp", "azure", "ec2", "s3", "lambda", "nginx", "redis", "postgresql", "mongodb", "fastapi", "react", "next.js", "node", "concurrency", "websocket", "latency", "throughput", "monitoring", "prometheus", "grafana", "git", "ci/cd"];
  let techCount = 0;
  techKeywords.forEach(kw => {
    if (lower.includes(kw)) techCount++;
  });
  score += Math.min(25, techCount * 8);

  return Math.min(100, score);
}

function getAnswerFeedback(answer: string): { status: "empty" | "weak" | "strong"; feedback: string } {
  const usability = calculateAnswerUsability(answer);
  if (answer.trim().length === 0) {
    return { status: "empty", feedback: "Please provide technical details or metrics to help optimize your resume." };
  }
  if (usability < 40) {
    return { status: "weak", feedback: "⚠️ Too brief. Try adding specific tools, metrics, or details (e.g. 'Used AWS S3 for storage' instead of 'Yes')." };
  }
  return { status: "strong", feedback: "✨ Excellent detail! This contains strong evidence that can be integrated into your resume." };
}

function buildFallbackGaps(resumeData: any, activeCompany: Company, evidenceGraph: EvidenceNode[]): EvidenceGap[] {
  const gaps: EvidenceGap[] = [];
  const provenSkills = new Set<string>();
  
  evidenceGraph.forEach(node => {
    if (node.type === "skill" && node.confidence >= 80) {
      provenSkills.add(node.name.toLowerCase().trim());
    }
  });

  const resumeTextParts: string[] = [];
  if (resumeData.summary) resumeTextParts.push(resumeData.summary.toLowerCase());
  (resumeData.experience || []).forEach((e: any) => {
    if (e.role) resumeTextParts.push(e.role.toLowerCase());
    if (e.company) resumeTextParts.push(e.company.toLowerCase());
    if (e.description) resumeTextParts.push(e.description.toLowerCase());
  });
  (resumeData.projects || []).forEach((p: any) => {
    if (p.title) resumeTextParts.push(p.title.toLowerCase());
    if (p.tech) resumeTextParts.push(p.tech.toLowerCase());
    if (p.description) resumeTextParts.push(p.description.toLowerCase());
  });
  const resumeText = resumeTextParts.join(" ");

  const domainKeywords = [
    "air purification", "indoor air quality", "iaq", "hvac", "biotechnology",
    "materials science", "nanotechnology", "life sciences", "polymer technology",
    "chemical engineering", "prototype development", "invention disclosures",
    "patent-related activities", "technology transfer", "feasibility assessments",
    "benchmarking",
    
    "penetration testing", "pentesting", "adversarial simulation", "ethical hacking",
    "threat modeling", "vulnerability assessment", "owasp top 10", "sql injection",
    "xss", "csrf", "ssrf", "idor", "api security", "llm security", "prompt injection",
    "jailbreaks", "retrieval poisoning", "cryptography", "aes", "rsa", "ssl/tls",
    "burp suite", "nmap", "wireshark", "metasploit", "owasp zap", "tryhackme",
    "hack the box", "ctf", "networking", "tcp/ip", "dns", "http/https", "proxies",
    "sockets", "packet analysis", "cybersecurity", "web security",
    
    "linux", "docker", "kubernetes", "helm charts", "aws", "gcp", "google cloud",
    "azure", "microsoft azure", "ec2", "s3", "rds", "iam", "lambda", "vpc",
    "nginx", "redis", "terraform", "ansible", "jenkins", "ci/cd", "github actions",
    
    "python", "javascript", "typescript", "go", "golang", "java", "c++", "rust",
    "node.js", "react", "next.js", "fastapi", "flask", "django", "sql", "postgresql",
    "mongodb", "neo4j", "concurrency", "async streaming", "scaling", "latency",
    "observability", "microservices", "websockets"
  ];

  const jdTextLower = (activeCompany.jd_text || "").toLowerCase();
  const extractedFromJD = new Set<string>();

  domainKeywords.forEach(keyword => {
    const escaped = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(jdTextLower)) {
      extractedFromJD.add(keyword);
    }
  });

  const dbRequired = activeCompany.jd_required_skills || [];
  const dbATS = activeCompany.jd_ats_keywords || [];
  const blacklistWords = new Set([
    "strong", "active", "excellent", "global", "basic", "solutions", "environment", 
    "team", "growth", "skills", "details", "attention", "communication", "collaborative",
    "technologies", "opportunity", "department", "limited", "company", "role", "work",
    "experience", "interest", "learning", "growth", "development", "product", "lines",
    "support", "explore", "internal", "external", "business", "units", "activities",
    "efforts", "methods", "materials", "systems", "processes"
  ]);

  [...dbRequired, ...dbATS].forEach(skill => {
    const sLower = skill.toLowerCase().trim();
    if (sLower.length <= 2) return;
    if (sLower === activeCompany.name.toLowerCase()) return;
    if (blacklistWords.has(sLower)) return;
    
    let shouldAdd = true;
    Array.from(extractedFromJD).forEach(existing => {
      if (existing.includes(sLower) || sLower.includes(existing)) {
        shouldAdd = false;
      }
    });
    if (shouldAdd) {
      extractedFromJD.add(sLower);
    }
  });

  Array.from(extractedFromJD).forEach(skill => {
    const sLower = skill.toLowerCase().trim();
    let isProven = false;
    provenSkills.forEach(ps => {
      if (ps.includes(sLower) || sLower.includes(ps)) {
        isProven = true;
      }
    });

    if (!isProven) {
      const escaped = sLower.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      const inText = regex.test(resumeText);
      if (inText) {
        gaps.push({
          stableKey: normalizeStableKey(`skill:${sLower}`),
          category: "JOB_SPECIFIC",
          gapType: "weak_skill",
          skillOrProjectName: skill,
          reason: `The job description requires '${skill}', which is mentioned but not listed as a core skill.`,
          evidenceMissing: "Project contexts and depth of experience with this skill.",
          importance: 75,
          confidence: 50,
          resumeImpactScore: 80
        });
      } else {
        gaps.push({
          stableKey: normalizeStableKey(`skill:${sLower}`),
          category: "JOB_SPECIFIC",
          gapType: "missing_skill",
          skillOrProjectName: skill,
          reason: `The job description requires '${skill}', which is missing from your master resume.`,
          evidenceMissing: "Proof of training, coursework, or practical project work.",
          importance: 90,
          confidence: 0,
          resumeImpactScore: 85
        });
      }
    }
  });

  (resumeData.projects || []).forEach((p: any) => {
    const descLower = (p.description || "").toLowerCase();
    const hasMetrics = /[0-9]+%?/.test(descLower) || descLower.includes("percent") || descLower.includes("latency") || descLower.includes("scale") || descLower.includes("throughput") || descLower.includes("users");
    const hasInfra = /aws|gcp|azure|docker|kubernetes|linux|nginx|redis|dockerfile|yaml|deploy|hosting|cloud/.test(descLower) || (p.tech && /aws|gcp|azure|docker|kubernetes|linux|nginx|redis/.test(p.tech.toLowerCase()));

    if (!hasMetrics) {
      gaps.push({
        stableKey: normalizeStableKey(`project:${p.title.trim().toLowerCase()}:metrics`),
        category: "GENERAL",
        gapType: "missing_metric",
        skillOrProjectName: p.title,
        reason: `The project '${p.title}' lacks quantitative metrics or performance gains.`,
        evidenceMissing: "Scalability stats, latency reductions, requests/sec, or efficiency metrics.",
        importance: 70,
        confidence: 20,
        resumeImpactScore: 90
      });
    }

    if (!hasInfra) {
      gaps.push({
        stableKey: normalizeStableKey(`project:${p.title.trim().toLowerCase()}:deployment`),
        category: "GENERAL",
        gapType: "missing_infrastructure",
        skillOrProjectName: p.title,
        reason: `The project '${p.title}' lacks cloud deployment or container hosting context.`,
        evidenceMissing: "Cloud providers (e.g. AWS, GCP), containers (Docker), Nginx, or Linux details.",
        importance: 80,
        confidence: 10,
        resumeImpactScore: 85
      });
    }

    gaps.push({
      stableKey: normalizeStableKey(`project:${p.title.trim().toLowerCase()}:challenge`),
      category: "GENERAL",
      gapType: "enrichment_opportunity",
      skillOrProjectName: p.title,
      reason: `Verifying complex technical challenges solved in '${p.title}' can enrich your resume.`,
      evidenceMissing: "System design tradeoffs, concurrency, data streaming, or concurrency solutions.",
      importance: 70,
      confidence: 30,
      resumeImpactScore: 80
    });
  });

  return gaps;
}

function parseRobustGapsJSON(rawText: string): EvidenceGap[] {
  let cleanText = rawText.trim();
  cleanText = cleanText.replace(/```json/gi, "");
  cleanText = cleanText.replace(/```/g, "");

  const firstBracket = cleanText.indexOf("[");
  const lastBracket = cleanText.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1) {
    cleanText = cleanText.substring(firstBracket, lastBracket + 1);
  } else {
    throw new Error("No JSON array bounds found.");
  }
  
  cleanText = balanceJSONStack(cleanText);

  try {
    return JSON.parse(cleanText);
  } catch (err) {
    console.warn("JSON parse on gaps LLM output failed, trying regex fallback:", err);
  }

  const list: EvidenceGap[] = [];
  const objMatches = cleanText.match(/\{[\s\S]*?\}/g);
  if (objMatches) {
    objMatches.forEach(objText => {
      try {
        const stableKeyMatch = objText.match(/"stableKey"\s*:\s*"([^"]*)"/i);
        const categoryMatch = objText.match(/"category"\s*:\s*"([^"]*)"/i);
        const gapTypeMatch = objText.match(/"gapType"\s*:\s*"([^"]*)"/i);
        const skillOrProjectNameMatch = objText.match(/"skillOrProjectName"\s*:\s*"([^"]*)"/i);
        const reasonMatch = objText.match(/"reason"\s*:\s*"([^"]*)"/i);
        const evidenceMissingMatch = objText.match(/"evidenceMissing"\s*:\s*"([^"]*)"/i);
        const importanceMatch = objText.match(/"importance"\s*:\s*([0-9]+)/i);
        const confidenceMatch = objText.match(/"confidence"\s*:\s*([0-9]+)/i);
        const resumeImpactScoreMatch = objText.match(/"resumeImpactScore"\s*:\s*([0-9]+)/i);

        if (stableKeyMatch && gapTypeMatch) {
          list.push({
            stableKey: stableKeyMatch[1],
            category: (categoryMatch ? categoryMatch[1].toUpperCase() : "JOB_SPECIFIC") as any,
            gapType: gapTypeMatch[1] as any,
            skillOrProjectName: skillOrProjectNameMatch ? skillOrProjectNameMatch[1] : "",
            reason: reasonMatch ? reasonMatch[1] : "",
            evidenceMissing: evidenceMissingMatch ? evidenceMissingMatch[1] : "",
            importance: importanceMatch ? parseInt(importanceMatch[1]) : 50,
            confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 0,
            resumeImpactScore: resumeImpactScoreMatch ? parseInt(resumeImpactScoreMatch[1]) : 50
          });
        }
      } catch (e) {
        console.warn("Regex object extract failed:", e);
      }
    });
  }
  return list;
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

  // Pre-process unquoted keys, single-quoted keys, and trailing commas lookbehind-free
  cleanText = cleanText.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
  cleanText = cleanText.replace(/([{,]\s*)'([a-zA-Z0-9_]+)'\s*:/g, '$1"$2":');
  cleanText = cleanText.replace(/,\s*([}\]])/g, "$1");

  // Step 2: Extract block between first '{' and last '}'
  const firstBrace = cleanText.indexOf("{");
  const lastBrace = cleanText.lastIndexOf("}");
  if (firstBrace !== -1) {
    if (lastBrace !== -1 && lastBrace > firstBrace) {
      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    } else {
      cleanText = cleanText.substring(firstBrace);
    }
  }

  cleanText = balanceJSONStack(cleanText);

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
                  <span className="flex items-center gap-1">
                    {proj.title || "Project"}
                    {proj.github_url && (
                      <a href={proj.github_url} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-zinc-700 transition-colors" title="View on GitHub">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </a>
                    )}
                  </span>
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
                  <span className="text-slate-800 flex items-center gap-1">
                    {proj.title || "Project"}
                    {proj.github_url && (
                      <a href={proj.github_url} target="_blank" rel="noopener noreferrer" className="text-yellow-400 hover:text-yellow-600 transition-colors" title="View on GitHub">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </a>
                    )}
                  </span>
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
                  <span className="flex items-center gap-1">
                    {proj.title || "Project"}
                    {proj.github_url && (
                      <a href={proj.github_url} target="_blank" rel="noopener noreferrer" className="text-neutral-400 hover:text-neutral-700 transition-colors" title="View on GitHub">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </a>
                    )}
                  </span>
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
                    <span className="text-slate-800 flex items-center gap-1">
                      {proj.title || "Project"}
                      {proj.github_url && (
                        <a href={proj.github_url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-slate-700 transition-colors" title="View on GitHub">
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        </a>
                      )}
                    </span>
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

interface JDConcept {
  name: string;
  type:
    | "Required Skill"
    | "Preferred Skill"
    | "Responsibility"
    | "Domain Knowledge"
    | "Industry Context"
    | "Company Name"
    | "Product Name"
    | "Soft Skill"
    | "Educational Requirement"
    | "Ignore";
}

function classifyJDConcepts(concepts: string[], companyName: string): JDConcept[] {
  const result: JDConcept[] = [];
  const coNameLower = companyName.toLowerCase();

  const softSkills = new Set([
    "communication", "teamwork", "leadership", "collaborative", "problem-solving",
    "interpersonal", "written", "verbal", "attention to detail", "presentation",
    "analytical", "creativity", "strong", "excellent", "active", "interpersonal skills",
    "verbal skills", "written skills", "communication skills", "problem solving",
    "team player", "motivation", "motivated", "detail-oriented"
  ]);

  const eduTerms = new Set([
    "b.tech", "m.tech", "degree", "computer science", "bachelor", "master", "phd",
    "gpa", "undergraduate", "graduate", "cgpa", "bachelors", "masters", "education"
  ]);

  const domainKnowledge = new Set([
    "indoor air quality", "air purification", "iaq", "aerosol", "hvac", "ventilation",
    "biotechnology", "life sciences", "materials science", "chemistry", "nanotechnology",
    "polymer technology", "aerosol science", "filtration", "carbon footprint", "sustainability",
    "threat landscape", "cybersecurity", "web security", "network security", "information security",
    "cryptographic protocols", "cryptography", "aes", "rsa", "ssl/tls", "signatures", "owasp top 10"
  ]);

  const productNames = new Set([
    "burp suite", "wireshark", "nmap", "metasploit", "owasp zap", "tryhackme", "hack the box",
    "gobuster", "nikto", "github", "git", "gitlab"
  ]);

  const responsibilities = new Set([
    "prototype development", "invention disclosures", "patent-related activities",
    "technology transfer", "feasibility assessments", "benchmarking", "threat modeling",
    "adversarial simulation", "vulnerability assessment", "system design", "requirements analysis",
    "technical feasibility assessment", "code review", "refactoring", "debugging",
    "testing", "documentation"
  ]);

  const requiredSkills = new Set([
    "python", "javascript", "typescript", "go", "golang", "java", "c++", "rust",
    "node.js", "react", "next.js", "fastapi", "flask", "django", "sql", "postgresql",
    "mongodb", "neo4j", "redis", "concurrency", "async streaming", "scaling", "latency",
    "observability", "microservices", "websockets", "docker", "kubernetes", "helm", "helm charts",
    "aws", "gcp", "google cloud", "azure", "microsoft azure", "nginx", "terraform", "ansible",
    "jenkins", "ci/cd", "github actions", "penetration testing", "pentesting", "ethical hacking",
    "rest", "api", "graphql", "routing", "linux"
  ]);

  concepts.forEach(concept => {
    const cLower = concept.trim().toLowerCase();
    if (!cLower) return;

    if (cLower.includes(coNameLower) || coNameLower.includes(cLower) || cLower === "blue star limited" || cLower === "blue star") {
      result.push({ name: concept, type: "Company Name" });
      return;
    }

    if (softSkills.has(cLower) || cLower.includes("communication") || cLower.includes("interpersonal") || cLower.includes("collaborative")) {
      result.push({ name: concept, type: "Soft Skill" });
      return;
    }

    if (eduTerms.has(cLower) || cLower.includes("degree") || cLower.includes("computer science") || cLower.includes("bachelor") || cLower.includes("master")) {
      result.push({ name: concept, type: "Educational Requirement" });
      return;
    }

    if (responsibilities.has(cLower) || cLower.includes("development") || cLower.includes("assessment") || cLower.includes("benchmarking") || cLower.includes("modeling")) {
      result.push({ name: concept, type: "Responsibility" });
      return;
    }

    if (requiredSkills.has(cLower) || requiredSkills.has(cLower.replace(".js", "")) || /python|react|docker|aws|kubernetes|security|testing|hacking|sql|postgres|mongodb|fastapi|django|flask|networking|concurrency/i.test(cLower)) {
      result.push({ name: concept, type: "Required Skill" });
      return;
    }

    if (domainKnowledge.has(cLower) || /air|quality|purification|hvac|bio|nano|chemical|poly|environmental/i.test(cLower)) {
      result.push({ name: concept, type: "Domain Knowledge" });
      return;
    }

    if (productNames.has(cLower)) {
      result.push({ name: concept, type: "Product Name" });
      return;
    }

    result.push({ name: concept, type: "Preferred Skill" });
  });

  return result;
}

function getJDConceptCapabilities(concept: string): Capability[] {
  const cLower = concept.toLowerCase();
  const caps: Capability[] = [];
  if (/python|javascript|typescript|go|golang|java|c\+\+|rust|node|fastapi|flask|django|backend|express|api|rest|graphql|sql|postgres|mongodb|neo4j|redis/i.test(cLower)) {
    caps.push("backend_systems");
  }
  if (/real-time|websocket|socket\.io|sse|stream|audio|voice|chat/i.test(cLower)) {
    caps.push("real_time_systems");
  }
  if (/ml|ai|machine learning|llm|rag|nlp|gpt|gemini|transformer|deep learning|tensorflow|pytorch|model|inference/i.test(cLower)) {
    caps.push("ml_systems");
  }
  if (/research|paper|publication|experiment|methodology|benchmarking|feasibility|patent/i.test(cLower)) {
    caps.push("research_methodology");
  }
  if (/algorithm|data structures|tree|graph|complexity|optimization|sorting/i.test(cLower)) {
    caps.push("data_structures");
  }
  if (/network|tcp|ip|dns|http|tls|ssl|socket|proxy|packet/i.test(cLower)) {
    caps.push("networking");
  }
  if (/concurrency|async|parallel|multithread|thread|goroutine|coroutine/i.test(cLower)) {
    caps.push("concurrency");
  }
  if (/deploy|host|cloud|aws|gcp|azure|docker|kubernetes|helm|terraform|ansible|ci\/cd/i.test(cLower)) {
    caps.push("deployment");
  }
  if (/observability|monitoring|logging|tracing|prometheus|grafana|langfuse/i.test(cLower)) {
    caps.push("observability");
  }
  return caps;
}

function calculateAlignmentResult(
  evidenceGraph: EvidenceNode[],
  jdConcepts: JDConcept[]
): AlignmentResult {
  const eligibleJDConcepts = jdConcepts.filter(c => 
    c.type === "Required Skill" || 
    c.type === "Preferred Skill" || 
    c.type === "Responsibility"
  );

  if (eligibleJDConcepts.length === 0) {
    return {
      score: 50,
      level: "Medium",
      directOverlapCount: 0,
      transferableOverlapCount: 0,
      primaryStrategy: "minimal_jd_targeting"
    };
  }

  let directOverlap = 0;
  let transferableOverlap = 0;

  const candidateSkills = new Set<string>();
  const candidateCapabilities = new Set<Capability>();

  evidenceGraph.forEach(n => {
    if (n.type === "skill" && n.confidence >= 80) {
      candidateSkills.add(n.name.toLowerCase().trim());
    }
    n.inferredCapabilities.forEach(cap => candidateCapabilities.add(cap));
  });

  eligibleJDConcepts.forEach(jc => {
    const jcLower = jc.name.toLowerCase().trim();
    let isDirect = false;
    candidateSkills.forEach(cs => {
      if (cs === jcLower || cs.includes(jcLower) || jcLower.includes(cs)) {
        isDirect = true;
      }
    });

    if (isDirect) {
      directOverlap++;
    } else {
      const conceptCaps = getJDConceptCapabilities(jc.name);
      const isTransferable = conceptCaps.some(cap => candidateCapabilities.has(cap));
      if (isTransferable) {
        transferableOverlap++;
      }
    }
  });

  const totalEligible = eligibleJDConcepts.length;
  const rawScore = ((directOverlap * 1.0) + (transferableOverlap * 0.5)) / totalEligible * 100;
  const score = Math.min(100, Math.round(rawScore));

  let level: "High" | "Medium" | "Low" = "Low";
  if (score >= 70) {
    level = "High";
  } else if (score >= 40) {
    level = "Medium";
  }

  let primaryStrategy: AlignmentStrategy = "minimal_jd_targeting";
  if (level === "High") {
    primaryStrategy = "experience_enrichment";
  } else if (level === "Medium") {
    if (directOverlap > 0) {
      primaryStrategy = "skill_verification";
    } else {
      primaryStrategy = "transferable_exploration";
    }
  } else {
    if (transferableOverlap > directOverlap) {
      primaryStrategy = "transferable_exploration";
    } else {
      primaryStrategy = "minimal_jd_targeting";
    }
  }

  return {
    score,
    level,
    directOverlapCount: directOverlap,
    transferableOverlapCount: transferableOverlap,
    primaryStrategy
  };
}

function questionUtility(gap: EvidenceGap, alignment: AlignmentResult, isAnswered: boolean): number {
  if (isAnswered) return 0;

  let score = 50;
  score += (gap.importance - 50) * 0.4;
  score += (gap.resumeImpactScore - 50) * 0.4;
  score += (100 - gap.confidence) * 0.3;

  if (alignment.primaryStrategy === "experience_enrichment") {
    if (gap.gapType === "missing_metric" || gap.gapType === "enrichment_opportunity" || gap.gapType === "project_depth") {
      score += 15;
    }
  } else if (alignment.primaryStrategy === "skill_verification") {
    if (gap.gapType === "missing_skill" || gap.gapType === "weak_skill") {
      score += 15;
    }
  } else if (alignment.primaryStrategy === "transferable_exploration") {
    if (gap.gapType === "enrichment_opportunity" || gap.gapType === "project_depth") {
      score += 10;
    }
  } else if (alignment.primaryStrategy === "minimal_jd_targeting") {
    if (gap.importance > 80) {
      score += 10;
    } else {
      score -= 20;
    }
  }

  if (gap.category === "GENERAL" && alignment.level === "Low") {
    score -= 15;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function getOverfittingProofQuestion(gapName: string): string {
  const nameLower = gapName.toLowerCase();
  if (nameLower.includes("air purification") || nameLower.includes("indoor air quality") || nameLower.includes("iaq") || nameLower.includes("hvac") || nameLower.includes("aerosol")) {
    return "This role involves Air Purification and Indoor Air Quality. Since your background is in a different domain, can you describe your process for researching unfamiliar fields, setting up experiment designs, or constructing prototype systems?";
  }
  if (nameLower.includes("biotechnology") || nameLower.includes("life sciences") || nameLower.includes("chemistry") || nameLower.includes("nanotechnology")) {
    return "This role involves Life Sciences and Biotech. Can you describe your process for conducting academic research, reviewing scientific publications, or doing data analysis on scientific experimental results?";
  }
  return `This role requires ${gapName}. Can you describe a time you had to quickly learn a new technology or domain, evaluate its feasibility, and build a prototype or proof-of-concept?`;
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
  
  // Resume Q&A Copilot States
  const [copilotQuestions, setCopilotQuestions] = useState<CopilotQuestion[]>([]);
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [savingVault, setSavingVault] = useState(false);
  
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

      // 2. Compact JD and Resume — keep it very short for small browser models
      const jdKeywordsStr = (company.jd_required_skills || []).slice(0, 15).join(", ");
      const compactJDText = (company.jd_text || "").substring(0, 400);
      const existingSkills = (resumeData.skills || []).slice(0, 20);
      const existingProjects = (resumeData.projects || []).slice(0, 4).map((p: any, i: number) => `${i+1}. ${p.title}: ${(p.description || "").substring(0, 200)}`);
      const existingSummary = (resumeData.summary || "").substring(0, 300);

      // 3. Construct verified candidate context
      const verifiedEvidenceStore: VerifiedEvidence[] = [];
      const addedKeys = new Set<string>();

      // Add active copilot questions that have been answered
      copilotQuestions.forEach(q => {
        if (q.answer.trim()) {
          const normKey = normalizeStableKey(q.stableKey);
          addedKeys.add(normKey);
          verifiedEvidenceStore.push({
            stableKey: normKey,
            category: q.type,
            confidence: calculateAnswerUsability(q.answer),
            answer: q.answer.trim(),
            usableForResume: calculateAnswerUsability(q.answer) >= 40
          });
        }
      });

      // Add vault items that were not answered in the current session
      const existingVault: VaultQA[] = resumeData.context_vault || [];
      existingVault.forEach(v => {
        const normKey = v.stableKey ? normalizeStableKey(v.stableKey) : "";
        if (normKey && !addedKeys.has(normKey) && v.answer.trim()) {
          addedKeys.add(normKey);
          verifiedEvidenceStore.push({
            stableKey: normKey,
            category: "vault",
            confidence: calculateAnswerUsability(v.answer),
            answer: v.answer.trim(),
            usableForResume: calculateAnswerUsability(v.answer) >= 40
          });
        }
      });

      const usableEvidence = verifiedEvidenceStore.filter(e => e.usableForResume);

      let verifiedContextBlock = "";
      if (usableEvidence.length > 0) {
        verifiedContextBlock = `\nVerified Factual Context from Candidate (Use these verified facts, metrics, and details to enrich the resume): \n` +
          usableEvidence.map(e => {
            if (e.stableKey.startsWith("skill:")) {
              const skillName = e.stableKey.split(":")[1];
              return `- Verified Skill Fact [${skillName}]: ${e.answer}`;
            } else if (e.stableKey.startsWith("project:")) {
              const parts = e.stableKey.split(":");
              const projName = parts[1];
              const category = parts[2];
              return `- Verified Project Fact [${projName} -> ${category}]: ${e.answer}`;
            } else {
              return `- Verified Fact: ${e.answer}`;
            }
          }).join("\n");
      }

      // Simplified few-shot prompt designed for small (0.5B–1B) models to guarantee correct JSON structure
      const prompt = `You are a resume optimizer. Output ONLY a valid JSON object matching the requested schema. Do NOT write any introduction, explanation, markdown code blocks, or extra text.

Task: Optimize the summary, skills, and projects based on the target job keywords and JD snippet.
Guidelines:
1. In "optimized_summary", write a tailored professional summary that aligns with the target job role.
2. In "optimized_skills", keep all original skills, and add new skills from the target job keywords ONLY if they are confirmed or mentioned in the "Verified Factual Context" above. Do NOT add any missing skills that the candidate has not confirmed.
3. In "optimized_projects", update the project descriptions to incorporate the specific technical libraries, databases, or performance metrics provided in the "Verified Factual Context" above. Keep other projects' descriptions concise but professional.
4. Do NOT fabricate any new experience, job titles, or skills not present in the original resume or verified context.

Target Job: ${company.role} at ${company.name}
Job Keywords: ${jdKeywordsStr}
JD Snippet: ${compactJDText}
${verifiedContextBlock}
Original Resume:
- Summary: ${existingSummary}
- Skills: ${existingSkills.join(", ")}
- Projects:
${existingProjects.join("\n")}

Example JSON Output:
{
  "optimized_summary": "Highly motivated software engineering student focused on building scalable AI systems and real-world RAG applications.",
  "optimized_skills": ["Python", "React", "FastAPI", "SQL"],
  "optimized_projects": [
    {
      "title": "LLM Knowledge Assistant",
      "description": "Built a Retrieval-Augmented Generation (RAG) system with hybrid search and Langfuse observability."
    }
  ]
}

Optimize the original resume now and return ONLY the JSON object:`;

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
        maxTokens: 1024,
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
        console.warn("Local LLM JSON parse/regex error (applying graceful fallback):", parseErr, "Raw output:", result);
        // ── Graceful fallback: use original resume data as the tailored base ───
        // The small browser model couldn't produce parseable JSON, but we still
        // want to show SOMETHING useful rather than a hard error.
        const fallbackData = JSON.parse(JSON.stringify(tailoredResumeData || masterResume || resumeData));
        setTailoredResumeData(fallbackData);
        setAtsResult({
          ats_score: atsScoreVal,
          missing_keywords: missingKeywordsVal,
          tailored_resume: {
            optimized_skills: fallbackData.skills || [],
            optimized_projects: fallbackData.projects || [],
            optimized_summary: fallbackData.summary || ""
          }
        });
        setOptimizerSubView("preview");
        showSuccess("Browser AI ran but couldn't generate structured output. Your original resume is loaded — you can edit it manually in the tailored workspace.");
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

  const generateCopilotQuestions = async () => {
    if (!company) return;
    setGeneratingQuestions(true);
    setErrorMsg("");
    setSuccessMsg("");
    setLocalStatusMessage("");

    try {
      const resMe = await api.get("/resumes/me");
      const resumeData = resMe.data?.resume_data || masterResume || {};
      if (!resumeData || Object.keys(resumeData).length === 0) {
        throw new Error("No master resume found. Please ensure you have parsed your master resume first.");
      }

      // 1. Build Evidence Graph
      const evidenceGraph = buildEvidenceGraph(resumeData);

      // 2. Discover Gaps (Fallback + LLM if available)
      let discoveredGaps = buildFallbackGaps(resumeData, company, evidenceGraph);

      const gapDiscoveryPrompt = `You are an AI Resume Evidence Discovery Agent.
Analyze the Master Resume and the target Job Description to identify technical gaps.
Output ONLY a JSON array of EvidenceGap objects matching this schema:
interface EvidenceGap {
  stableKey: string;
  category: "GENERAL" | "JOB_SPECIFIC";
  gapType: "missing_skill" | "weak_skill" | "project_depth" | "missing_metric" | "missing_infrastructure" | "enrichment_opportunity";
  skillOrProjectName: string;
  reason: string;
  evidenceMissing: string;
  importance: number; // 1 to 100
  confidence: number; // 0 to 100
  resumeImpactScore: number; // 1 to 100
}

Target Job Role: ${company.role}
Job Description: ${(company.jd_text || "").substring(0, 500)}

Resume Summary: ${resumeData.summary || ""}
Resume Skills: ${(resumeData.skills || []).join(", ")}
Resume Projects:
${(resumeData.projects || []).map((p: any) => `- ${p.title}: ${p.description}`).join("\n")}

Rules:
- For missing skills from the JD: category "JOB_SPECIFIC", gapType "missing_skill", stableKey "skill:<normalized_skill_name>".
- For weak skills mentioned but not core: category "JOB_SPECIFIC", gapType "weak_skill", stableKey "skill:<normalized_skill_name>".
- For missing metrics in projects: category "GENERAL", gapType "missing_metric", stableKey "project:<project_name>:metrics".
- For missing deployment/infra in projects: category "GENERAL", gapType "missing_infrastructure", stableKey "project:<project_name>:deployment".

Return ONLY the JSON array starting with [ and ending with ]:`;

      const isDownloaded = typeof window !== "undefined" && (
        localStorage.getItem(`model_downloaded_${atsModel}`) === "true" ||
        localStorage.getItem(`model_downloaded_onnx-community/Llama-3.2-1B-Instruct-ONNX`) === "true"
      );

      if (geminiAvailable || atsModel !== "qwen-0.5b" || isDownloaded) {
        try {
          setLocalStatusMessage("Running Local AI Gap Discovery...");
          const llmGapsText = await generateInBrowser({
            modelType: atsModel,
            prompt: gapDiscoveryPrompt,
            maxTokens: 1024,
            onProgress: (p) => {
              setLocalStatusMessage(`AI analyzing resume gaps: ${Math.round(p * 100)}%`);
            }
          });
          const llmGaps = parseRobustGapsJSON(llmGapsText);
          if (llmGaps && llmGaps.length > 0) {
            llmGaps.forEach(g => {
              g.stableKey = normalizeStableKey(g.stableKey);
            });
            const mergedMap = new Map<string, EvidenceGap>();
            discoveredGaps.forEach(g => mergedMap.set(g.stableKey, g));
            llmGaps.forEach(g => mergedMap.set(g.stableKey, g));
            discoveredGaps = Array.from(mergedMap.values());
          }
        } catch (llmErr) {
          console.warn("Local AI Gap Discovery failed, using deterministic fallback:", llmErr);
        }
      }

      // 3. Vault Coverage Check
      const existingVault: VaultQA[] = resumeData.context_vault || [];
      discoveredGaps.forEach(gap => {
        const normKey = normalizeStableKey(gap.stableKey);
        const match = existingVault.find(v => {
          if (v.stableKey) {
            return normalizeStableKey(v.stableKey) === normKey;
          }
          return false;
        });

        if (match) {
          const usability = calculateAnswerUsability(match.answer);
          if (usability >= 40) {
            gap.priority = 0;
            gap.confidence = 100;
          } else {
            gap.confidence = Math.max(gap.confidence || 0, 40);
          }
        }
      });

      // 4. Score & Rank Gaps
      discoveredGaps.forEach(gap => {
        if (gap.priority === undefined || gap.priority > 0) {
          gap.priority = gap.importance * 0.45 + (100 - gap.confidence) * 0.25 + gap.resumeImpactScore * 0.30;
        }
      });

      const activeGaps = discoveredGaps.filter(g => g.priority !== undefined && g.priority > 0);

      // 5. Merge & Deduplicate redundant project details
      const finalGaps: EvidenceGap[] = [];
      const projectGapsMap = new Map<string, EvidenceGap[]>();

      activeGaps.forEach(gap => {
        const normKey = normalizeStableKey(gap.stableKey);
        if (normKey.startsWith("project:")) {
          const parts = normKey.split(":");
          const projName = parts[1];
          if (!projectGapsMap.has(projName)) {
            projectGapsMap.set(projName, []);
          }
          projectGapsMap.get(projName)!.push(gap);
        } else {
          if (!finalGaps.some(g => normalizeStableKey(g.stableKey) === normKey)) {
            finalGaps.push(gap);
          }
        }
      });

      projectGapsMap.forEach((projGaps, projName) => {
        if (projGaps.length === 1) {
          finalGaps.push(projGaps[0]);
        } else {
          const highestPriorityGap = projGaps.reduce((prev, current) => (prev.priority || 0) > (current.priority || 0) ? prev : current);
          const combinedReasons = projGaps.map(g => g.reason).join(" Additionally, ");
          const combinedEvidenceMissing = projGaps.map(g => g.evidenceMissing).join(", ");
          const displayProjectName = projGaps[0].skillOrProjectName || projName;

          finalGaps.push({
            ...highestPriorityGap,
            stableKey: `project:${projName}:details`,
            skillOrProjectName: displayProjectName,
            reason: `Combined project details: ${combinedReasons}`,
            evidenceMissing: combinedEvidenceMissing,
            priority: Math.max(...projGaps.map(g => g.priority || 0))
          });
        }
      });

      finalGaps.sort((a, b) => (b.priority || 0) - (a.priority || 0));

      // 6. Calculate Alignment & Strategy
      const jdConcepts = classifyJDConcepts(Array.from(jdKeywords), company.name);
      const alignment = calculateAlignmentResult(evidenceGraph, jdConcepts);

      // Anti-overfitting check: If transferable overlap > direct overlap,
      // pivot all job-specific skill-gaps to process/experimentation questions
      const useAntiOverfitting = alignment.transferableOverlapCount > alignment.directOverlapCount;

      // 7. Question Generation Layer
      const skillQuestionTemplates: Record<string, string> = {
        "air purification": "Have you worked with air purification systems, filtration technologies (e.g. HEPA, activated carbon), or aerosol science? Describe your exposure or prototype projects.",
        "indoor air quality": "Have you measured, analyzed, or optimized indoor air quality (IAQ) parameters like CO2, PM2.5, VOCs, temperature, or relative humidity?",
        "iaq": "Have you measured, analyzed, or optimized indoor air quality (IAQ) parameters like CO2, PM2.5, VOCs, temperature, or relative humidity?",
        "hvac": "Have you worked with Heating, Ventilation, and Air Conditioning (HVAC) systems, ventilation design, or airflow modeling?",
        "biotechnology": "Have you worked in biotechnology labs, molecular biology, bioprocessing, or related assay methods? Describe your coursework or lab projects.",
        "materials science": "Have you studied or worked with synthesis, characterization, or application of materials (e.g. polymers, nanomaterials, metals)? Describe your lab experience.",
        "nanotechnology": "Have you worked with nanomaterials, nanoparticles, or nanotech-based filtration/adsorption systems?",
        "life sciences": "Have you participated in life sciences research, biological assays, or biochemistry lab work?",
        "polymer technology": "Have you worked with polymer synthesis, polymer characterization (e.g. DSC, TGA), or plastics engineering?",
        "chemical engineering": "Have you performed chemical process modeling, chemical reactor design, mass transfer, or fluid mechanics calculations?",
        "prototype development": "Have you designed, built, and tested lab-scale or functional prototypes? Describe the tools (CAD, 3D printing), components, and testing results.",
        "invention disclosures": "Have you contributed to invention disclosures, patent searches, or drafting patent applications? Describe your exposure.",
        "patent-related activities": "Have you contributed to invention disclosures, patent searches, or drafting patent applications? Describe your exposure.",
        "technology transfer": "Have you been involved in technology transfer, scaling up lab processes, or commercializing research concepts?",
        "feasibility assessments": "Have you conducted preliminary technical calculations, cost-benefit analyses, or technical feasibility studies for a product?",
        "benchmarking": "Have you conducted benchmarking studies to compare product specifications, performance metrics, or technologies against global competitors?",

        "penetration testing": "Have you participated in web, API, or infrastructure penetration testing or adversarial simulation labs?",
        "pentesting": "Have you participated in web, API, or infrastructure penetration testing or adversarial simulation labs?",
        "adversarial simulation": "Have you participated in web, API, or infrastructure penetration testing or adversarial simulation labs?",
        "ethical hacking": "Have you completed coursework, labs, or certifications related to ethical hacking, secure coding, or network security?",
        "threat modeling": "Have you performed threat modeling (e.g. STRIDE) to identify attack paths, trust boundaries, or security risks in systems?",
        "vulnerability assessment": "Have you identified or validated security vulnerabilities (e.g. OWASP Top 10), performed scanning, or written vulnerability reports?",
        "owasp top 10": "Have you studied or worked with OWASP Top 10 vulnerabilities (e.g. SQL Injection, XSS, CSRF, SSRF, IDOR, or insecure APIs)? Describe your exposure.",
        "api security": "Your projects expose APIs. Have you implemented authentication, authorization, rate limiting, token validation, or abuse prevention mechanisms?",
        "llm security": "Have you explored security risks in AI/LLM systems such as prompt injection, jailbreaks, data leakage, agent exploitation, or retrieval poisoning?",
        "prompt injection": "Have you explored security risks in AI/LLM systems such as prompt injection, jailbreaks, data leakage, agent exploitation, or retrieval poisoning?",
        "jailbreaks": "Have you explored security risks in AI/LLM systems such as prompt injection, jailbreaks, data leakage, agent exploitation, or retrieval poisoning?",
        "retrieval poisoning": "Have you explored security risks in AI/LLM systems such as prompt injection, jailbreaks, data leakage, agent exploitation, or retrieval poisoning?",
        "cryptography": "Have you worked with cryptographic principles (AES, RSA, hashing, SSL/TLS, signatures) in any project?",
        "aes": "Have you worked with cryptographic principles (AES, RSA, hashing, SSL/TLS, signatures) in any project?",
        "rsa": "Have you worked with cryptographic principles (AES, RSA, hashing, SSL/TLS, signatures) in any project?",
        "ssl/tls": "Have you worked with cryptographic principles (AES, RSA, hashing, SSL/TLS, signatures) in any project?",
        "burp suite": "Have you used security tools like Burp Suite, Nmap, Wireshark, Metasploit, Gobuster, Nikto, or OWASP ZAP? Describe how.",
        "nmap": "Have you used security tools like Burp Suite, Nmap, Wireshark, Metasploit, Gobuster, Nikto, or OWASP ZAP? Describe how.",
        "wireshark": "Have you used security tools like Burp Suite, Nmap, Wireshark, Metasploit, Gobuster, Nikto, or OWASP ZAP? Describe how.",
        "metasploit": "Have you used security tools like Burp Suite, Nmap, Wireshark, Metasploit, Gobuster, Nikto, or OWASP ZAP? Describe how.",
        "owasp zap": "Have you used security tools like Burp Suite, Nmap, Wireshark, Metasploit, Gobuster, Nikto, or OWASP ZAP? Describe how.",
        "tryhackme": "Have you participated in CTFs (Capture The Flag), TryHackMe, Hack The Box, or bug bounty programs?",
        "hack the box": "Have you participated in CTFs (Capture The Flag), TryHackMe, Hack The Box, or bug bounty programs?",
        "ctf": "Have you participated in CTFs (Capture The Flag), TryHackMe, Hack The Box, or bug bounty programs?",
        "networking": "What networking concepts have you worked with (TCP/IP, DNS, HTTP/HTTPS, TLS, proxies, sockets, packet analysis)?",
        "tcp/ip": "What networking concepts have you worked with (TCP/IP, DNS, HTTP/HTTPS, TLS, proxies, sockets, packet analysis)?",
        "dns": "What networking concepts have you worked with (TCP/IP, DNS, HTTP/HTTPS, TLS, proxies, sockets, packet analysis)?",
        "http/https": "What networking concepts have you worked with (TCP/IP, DNS, HTTP/HTTPS, TLS, proxies, sockets, packet analysis)?",
        "cybersecurity": "Have you completed coursework, labs, or certifications related to cybersecurity, network security, or ethical hacking?",
        "web security": "Have you studied or worked with OWASP Top 10 vulnerabilities (e.g. SQL Injection, XSS, CSRF, SSRF, IDOR, or insecure APIs)? Describe your exposure.",

        "linux": "Have you used Linux extensively for development, server administration, Docker deployments, or shell scripting? Describe your experience.",
        "docker": "Have you packaged, run, or deployed any of your projects using Docker containers?",
        "kubernetes": "Have you worked with Kubernetes, container orchestration, or Helm charts for microservices?",
        "helm charts": "Have you worked with Kubernetes, container orchestration, or Helm charts for microservices?",
        "aws": "Have you hosted applications or used services on AWS (e.g. EC2, S3, RDS, IAM, Lambda, VPC)?",
        "amazon web services": "Have you hosted applications or used services on AWS (e.g. EC2, S3, RDS, IAM, Lambda, VPC)?",
        "gcp": "Have you hosted services or used APIs on Google Cloud Platform (e.g. Compute Engine, Cloud Run, GCS)?",
        "google cloud": "Have you hosted services or used APIs on Google Cloud Platform (e.g. Compute Engine, Cloud Run, GCS)?",
        "azure": "Have you deployed applications or managed IAM policies on Microsoft Azure?",
        "microsoft azure": "Have you deployed applications or managed IAM policies on Microsoft Azure?",
        "nginx": "Have you used Nginx as a reverse proxy, load balancer, or web server in your deployments?",
        "redis": "Have you used Redis for caching, session management, or pub/sub messaging in any of your real-time projects?",
        "terraform": "Have you written Terraform configurations to define and provision cloud infrastructure (IaC)?",
        "ansible": "Have you used Ansible for configuration management or application deployment?",
        "jenkins": "Have you set up CI/CD pipelines (e.g. Jenkins, GitHub Actions) for automated testing or deployment?",
        "ci/cd": "Have you set up CI/CD pipelines (e.g. Jenkins, GitHub Actions) for automated testing or deployment?",
        "github actions": "Have you set up CI/CD pipelines (e.g. Jenkins, GitHub Actions) for automated testing or deployment?",

        "python": "Have you written Python code for backend APIs, data processing, machine learning, or automation scripting?",
        "javascript": "Have you built frontend components or backend logic using JavaScript/ES6+?",
        "typescript": "Have you worked with TypeScript for type-safe application development?",
        "go": "Have you built concurrent services, microservices, or APIs using Go/Golang?",
        "golang": "Have you built concurrent services, microservices, or APIs using Go/Golang?",
        "java": "Have you worked with Java, Spring Boot, or enterprise OOP architectures?",
        "c++": "Have you written C++ code for system programming, high-performance applications, or algorithms?",
        "rust": "Have you written Rust code for safe systems programming or web assembly modules?",
        "node.js": "Have you built backend services, REST APIs, or real-time systems using Node.js?",
        "react": "Have you built responsive single-page applications using React and its lifecycle hooks?",
        "next.js": "Have you built server-rendered React applications using Next.js (App Router or Pages Router)?",
        "fastapi": "Have you built high-performance backend APIs using Python and FastAPI?",
        "flask": "Have you built web applications or REST APIs using Python and Flask?",
        "django": "Have you built database-driven web applications using Django and its ORM?",
        "sql": "Have you written complex SQL queries, designed schemas, or optimized database indexes?",
        "postgresql": "Have you used PostgreSQL for relational database storage and query optimization?",
        "mongodb": "Have you designed document schemas or queried MongoDB collections?",
        "neo4j": "Have you modeled knowledge graphs or written Cypher queries in Neo4j?",
        "concurrency": "Have you handled multi-threading, concurrency, race conditions, or async execution in any project?",
        "async streaming": "Have you implemented real-time async streaming (e.g. SSE, WebSockets, gRPC streaming) in any application?",
        "scaling": "Have you designed systems for high throughput, load balancing, or horizontal scaling?",
        "latency": "Have you analyzed or optimized system latency, query performance, or response times?",
        "observability": "Have you integrated logging, tracing, or APM monitoring tools (e.g. Prometheus, Grafana, OpenTelemetry, Langfuse)?",
        "microservices": "Have you designed or integrated decoupled microservices communicating via REST, gRPC, or message brokers?",
        "websockets": "Have you used WebSockets or socket.io to enable real-time bidirectional communication?"
      };

      interface CandidateQuestion {
        question: CopilotQuestion;
        utility: number;
      }

      const candidateQuestions: CandidateQuestion[] = [];
      const processedKeys = new Set<string>();

      // A. Populate General Project Questions
      const projectTitles = (resumeData.projects || []).slice(0, 4).map((p: any) => p.title).join(", ");
      const defaultGeneralQuestions = [
        {
          stableKey: "general:projects:infrastructure",
          text: `Several of your projects involve deployment and real-time systems. Can you describe the infrastructure, cloud services, operating systems, containers, databases, caching systems, or deployment tools (e.g. Linux, Docker, AWS, EC2, Nginx, Redis) used?`,
          gap: {
            stableKey: "general:projects:infrastructure",
            category: "GENERAL" as const,
            gapType: "missing_infrastructure" as const,
            skillOrProjectName: "projects",
            reason: "Verifying infrastructure stack",
            evidenceMissing: "Cloud/container hosting details",
            importance: 80,
            confidence: 10,
            resumeImpactScore: 85
          }
        },
        {
          stableKey: "general:projects:challenges",
          text: `For your major projects (${projectTitles || "projects"}), what were the most technically challenging engineering problems you solved (e.g. concurrency, async streaming, scaling, latency, observability)?`,
          gap: {
            stableKey: "general:projects:challenges",
            category: "GENERAL" as const,
            gapType: "enrichment_opportunity" as const,
            skillOrProjectName: "projects",
            reason: "Verifying engineering challenges",
            evidenceMissing: "System design/concurrency complexity details",
            importance: 70,
            confidence: 30,
            resumeImpactScore: 80
          }
        },
        {
          stableKey: "general:projects:metrics",
          text: `Do you have additional quantitative metrics or performance gains (e.g. user count, requests/day, latency improvements, throughput, evaluation scores, or cost reductions) for your projects or internships?`,
          gap: {
            stableKey: "general:projects:metrics",
            category: "GENERAL" as const,
            gapType: "missing_metric" as const,
            skillOrProjectName: "projects",
            reason: "Verifying metrics",
            evidenceMissing: "Scalability or efficiency metrics",
            importance: 70,
            confidence: 20,
            resumeImpactScore: 90
          }
        },
        {
          stableKey: "general:skills:additional",
          text: `Are there any other programming languages, frameworks, databases, security tools, DevOps tools, or AI frameworks you have used but are not listed on your resume?`,
          gap: {
            stableKey: "general:skills:additional",
            category: "GENERAL" as const,
            gapType: "missing_skill" as const,
            skillOrProjectName: "skills",
            reason: "Verifying any additional tools",
            evidenceMissing: "Unlisted tech skills",
            importance: 60,
            confidence: 40,
            resumeImpactScore: 70
          }
        }
      ];

      defaultGeneralQuestions.forEach(q => {
        const normKey = normalizeStableKey(q.stableKey);
        processedKeys.add(normKey);
        const match = existingVault.find(v => v.stableKey === normKey || v.question.toLowerCase().trim() === q.text.toLowerCase().trim());
        const isAnswered = !!(match && match.answer.trim());
        const utility = questionUtility(q.gap, alignment, isAnswered);

        candidateQuestions.push({
          question: {
            id: `gen_${normKey}`,
            type: "general",
            stableKey: normKey,
            text: q.text,
            answer: match ? match.answer : ""
          },
          utility
        });
      });

      // B. Populate Job-Specific questions from Discovered Gaps
      finalGaps.forEach(gap => {
        const normKey = normalizeStableKey(gap.stableKey);
        if (processedKeys.has(normKey)) return;
        processedKeys.add(normKey);

        let qText = "";
        
        // Anti-overfitting check: If the rule triggers, pivot all job-specific skill-gaps to transferable process questions
        if (useAntiOverfitting && gap.category === "JOB_SPECIFIC" && normKey.startsWith("skill:")) {
          qText = getOverfittingProofQuestion(gap.skillOrProjectName);
        } else {
          // Standard question builder
          if (normKey.startsWith("skill:")) {
            const skillName = gap.skillOrProjectName;
            const templateKey = Object.keys(skillQuestionTemplates).find(k => 
              skillName.toLowerCase() === k || 
              skillName.toLowerCase().includes(k) || 
              k.includes(skillName.toLowerCase())
            );
            if (templateKey) {
              qText = skillQuestionTemplates[templateKey];
            } else {
              const displaySkill = skillName.split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
              qText = `The job description requires experience with '${displaySkill}'. Have you worked with this tool, framework, or concept in any projects, coursework, or self-learning? Describe your exposure.`;
            }
          } else if (normKey.startsWith("project:")) {
            const projName = gap.skillOrProjectName;
            if (normKey.endsWith(":details")) {
              qText = `For your project '${projName}', what was the infrastructure, cloud services, databases, or deployment tools used, and what were the most challenging engineering problems or quantitative metrics/performance gains achieved?`;
            } else if (normKey.endsWith(":metrics")) {
              qText = `Do you have additional quantitative metrics or performance gains (e.g. user count, latency improvements, throughput, or cost reductions) for your project '${projName}'?`;
            } else if (normKey.endsWith(":deployment")) {
              qText = `Can you describe the infrastructure, cloud services, databases, or deployment tools (e.g. Linux, Docker, AWS, EC2, Nginx, Redis) used in your project '${projName}'?`;
            } else if (normKey.endsWith(":challenge")) {
              qText = `For your project '${projName}', what were the most technically challenging engineering problems you solved (e.g. concurrency, async streaming, scaling, latency, observability)?`;
            } else {
              qText = `Can you provide more technical details or explain the architecture of your project '${projName}'?`;
            }
          }
        }

        if (qText) {
          const match = existingVault.find(v => v.stableKey === normKey || v.question.toLowerCase().trim() === qText.toLowerCase().trim());
          const isAnswered = !!(match && match.answer.trim());
          const utility = questionUtility(gap, alignment, isAnswered);

          candidateQuestions.push({
            question: {
              id: `job_${normKey}`,
              type: "job_specific",
              stableKey: normKey,
              text: qText,
              answer: match ? match.answer : "",
              sourceGapKey: normKey
            },
            utility
          });
        }
      });

      // Filter questions below utility threshold (40)
      const highUtilityQuestions = candidateQuestions.filter(cq => cq.utility >= 40);

      // Sort by utility score descending
      highUtilityQuestions.sort((a, b) => b.utility - a.utility);

      // Question Budgeting: Limit strictly by alignment level
      const budgetMap = { High: 6, Medium: 5, Low: 3 };
      const maxAllowed = budgetMap[alignment.level];
      const budgetedQuestions = highUtilityQuestions.slice(0, maxAllowed).map(cq => cq.question);

      setCopilotQuestions(budgetedQuestions);
      
      const debugMsg = `Generated ${budgetedQuestions.length} questions (Budget: ${maxAllowed}, Alignment: ${alignment.level}, Strategy: ${alignment.primaryStrategy}, Score: ${alignment.score}%).`;
      showSuccess(debugMsg);
    } catch (err: any) {
      console.error("Failed to generate copilot questions:", err);
      setErrorMsg(err.message || "Failed to generate Copilot questions.");
    } finally {
      setGeneratingQuestions(false);
      setLocalStatusMessage("");
    }
  };

  const handleSaveToVault = async () => {
    if (!masterResume || !encryptionKey) {
      setErrorMsg("Decryption Key or Master Resume missing. Please ensure your Vault is unlocked.");
      return;
    }
    setSavingVault(true);
    try {
      const answeredQAs: VaultQA[] = copilotQuestions
        .filter(q => q.answer.trim().length > 0)
        .map(q => ({
          stableKey: normalizeStableKey(q.stableKey),
          question: q.text,
          answer: q.answer.trim(),
          timestamp: new Date().toISOString()
        }));

      if (answeredQAs.length === 0) {
        showSuccess("No answers to save.");
        setSavingVault(false);
        return;
      }

      const existingVault: VaultQA[] = masterResume.context_vault || [];
      const updatedVault = [...existingVault];

      answeredQAs.forEach(newQA => {
        const idx = updatedVault.findIndex(q => {
          if (q.stableKey && newQA.stableKey) {
            return normalizeStableKey(q.stableKey) === normalizeStableKey(newQA.stableKey);
          }
          return q.question.toLowerCase().trim() === newQA.question.toLowerCase().trim();
        });
        
        if (idx !== -1) {
          updatedVault[idx] = newQA;
        } else {
          updatedVault.push(newQA);
        }
      });

      const updatedMaster = {
        ...masterResume,
        context_vault: updatedVault
      };

      const payload = {
        template: selectedTemplate,
        resume_data: updatedMaster
      };
      await api.put("/resumes/me", payload);
      setMasterResume(updatedMaster);
      showSuccess("Saved answers to your Master Vault successfully!");
    } catch (err: any) {
      console.error("Failed to save to vault", err);
      setErrorMsg(err.response?.data?.detail || "Failed to save answers to secure vault.");
    } finally {
      setSavingVault(false);
    }
  };

  const updateCopilotAnswer = (id: string, val: string) => {
    setCopilotQuestions(prev => prev.map(q => q.id === id ? { ...q, answer: val } : q));
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

                    {generatingQuestions ? (
                      <button
                        disabled
                        className="w-full h-10 border-2 border-border bg-background font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition-all opacity-50 font-mono"
                      >
                        <Loader2 className="animate-spin h-3.5 w-3.5" />
                        <span>Generating Questions...</span>
                      </button>
                    ) : copilotQuestions.length === 0 ? (
                      <button
                        onClick={generateCopilotQuestions}
                        className="w-full h-10 border-2 border-accent bg-accent/5 hover:bg-accent hover:text-black font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 active:scale-[0.98] transition-all font-mono"
                      >
                        <Sparkles size={12} className="text-accent" />
                        <span>Start AI Resume Copilot</span>
                      </button>
                    ) : (
                      <button
                        onClick={runLocalATS}
                        disabled={calculatingATS}
                        className="w-full h-10 border-2 border-accent bg-accent text-black hover:bg-black hover:text-accent hover:border-accent font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50 font-mono"
                      >
                        {calculatingATS ? (
                          <>
                            <Loader2 className="animate-spin h-3.5 w-3.5" />
                            <span>TAILORING RESUME...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles size={12} />
                            <span>{atsResult ? "Re-Optimize Resume" : "Generate Optimized Resume"}</span>
                          </>
                        )}
                      </button>
                    )}
                    <span className="text-[8px] text-muted-foreground uppercase text-center block leading-normal font-mono">
                      {copilotQuestions.length === 0 
                        ? "Wizards the Job Description against your resume and generates targeted Q&A to build a verified fact matrix."
                        : atsResult 
                        ? "Re-runs optimization with any updated general or job-specific answers."
                        : "Processes your verified facts through local AI to output your tailored resume."
                      }
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

                        {/* AI Resume Copilot Panel */}
                        <div className="border-2 border-border p-6 bg-card space-y-6">
                          <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-border pb-4 gap-4">
                            <div>
                              <h3 className="text-sm font-black tracking-widest text-accent uppercase flex items-center gap-2">
                                <Sparkles size={16} className="text-accent" />
                                <span>🤖 AI RESUME COPILOT Q&A INTERVIEW</span>
                              </h3>
                              <p className="text-[10px] text-zinc-500 uppercase mt-1 leading-normal">
                                Provide verified facts and confirm details so the AI optimizer matches your resume to this role without fabricating skills.
                              </p>
                              <p className="text-[10px] text-accent/80 font-mono uppercase mt-1.5 leading-normal">
                                Note: The Copilot is not attempting to assess your qualifications. It is discovering verifiable evidence that may already exist but is missing from your resume.
                              </p>
                            </div>
                            {copilotQuestions.length === 0 ? (
                              <button
                                onClick={generateCopilotQuestions}
                                disabled={generatingQuestions}
                                className="h-9 px-4 border-2 border-accent bg-accent/5 hover:bg-accent hover:text-black text-accent text-[10px] font-black uppercase flex items-center gap-1.5 transition-all shrink-0"
                              >
                                {generatingQuestions ? (
                                  <>
                                    <Loader2 className="animate-spin h-3.5 w-3.5" />
                                    <span>Generating Questions...</span>
                                  </>
                                ) : (
                                  <>
                                    <Sparkles size={11} />
                                    <span>Generate Copilot Questions</span>
                                  </>
                                )}
                              </button>
                            ) : (
                              <div className="flex gap-2 shrink-0">
                                <button
                                  onClick={handleSaveToVault}
                                  disabled={savingVault}
                                  className="h-9 px-3 border border-border bg-muted hover:border-accent hover:text-accent text-[10px] font-black uppercase flex items-center gap-1 transition-all"
                                  title="Persist general project/experience details to your encrypted master resume vault for reuse"
                                >
                                  {savingVault ? "Saving..." : "Save to Master Vault"}
                                </button>
                                <button
                                  onClick={() => setCopilotQuestions([])}
                                  className="h-9 px-3 border border-red-500/30 text-red-500 hover:bg-red-500/10 text-[10px] font-black uppercase transition-all"
                                >
                                  Clear Questions
                                </button>
                              </div>
                            )}
                          </div>

                          {copilotQuestions.length > 0 ? (
                            <div className="space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {copilotQuestions.map((q) => {
                                  const feedback = getAnswerFeedback(q.answer);
                                  return (
                                    <div key={q.id} className="border border-border bg-background p-4 space-y-3 relative flex flex-col justify-between">
                                      <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                          <span className={`px-2 py-0.5 text-[8px] font-black border ${
                                            q.type === "general" ? "border-blue-500/55 text-blue-400 bg-blue-500/5" : "border-amber-500/55 text-amber-400 bg-amber-500/5"
                                          }`}>
                                            {q.type === "general" ? "🔄 PERSISTED TO MASTER VAULT" : "🎯 JOB-SPECIFIC (THIS APP ONLY)"}
                                          </span>
                                        </div>
                                        <p className="text-xs font-bold text-foreground leading-normal">{q.text}</p>
                                      </div>
                                      <div className="space-y-2">
                                        <textarea
                                          value={q.answer}
                                          onChange={(e) => updateCopilotAnswer(q.id, e.target.value)}
                                          placeholder={q.type === "general" 
                                            ? "Describe technical details, databases, libraries used, or metrics..." 
                                            : "Enter details (e.g. Yes, I have worked with this tool in...)"}
                                          rows={2}
                                          className="w-full border border-border bg-background text-xs p-2.5 focus:border-accent focus:outline-none font-bold"
                                        />
                                        <div className={`text-[10px] font-bold ${
                                          feedback.status === "strong" ? "text-green-500" : feedback.status === "weak" ? "text-yellow-500" : "text-zinc-500"
                                        }`}>
                                          {feedback.feedback}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="border-t border-border pt-4 flex justify-between items-center">
                                <span className="text-[9px] text-zinc-500 uppercase leading-snug">
                                  {copilotQuestions.some(q => q.type === "general" && q.answer.trim()) && "🔄 Answers to Persisted Vault questions will be saved. Click 'Save to Master Vault' to persist manually."}
                                </span>
                                <button
                                  onClick={async () => {
                                    await handleSaveToVault();
                                    await runLocalATS();
                                  }}
                                  disabled={calculatingATS}
                                  className="h-10 px-5 border-2 border-accent bg-accent text-black hover:bg-black hover:text-accent hover:border-accent text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all"
                                >
                                  <Sparkles size={13} />
                                  <span>{calculatingATS ? "Tailoring..." : "Tailor Resume using verified context"}</span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="border border-dashed border-border p-6 text-center">
                              <p className="text-xs text-muted-foreground uppercase leading-relaxed font-bold">
                                Want a highly optimized, accurate resume tailoring? Let the Copilot analyze the Job Description and your resume to generate targeted verification questions.
                              </p>
                            </div>
                          )}
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
                                  <input
                                    type="url"
                                    value={proj.github_url || ""}
                                    onChange={(e) => updateTailoredProject(idx, "github_url", e.target.value)}
                                    placeholder="GitHub Repo URL (auto-filled from PDF, or paste manually)"
                                    className="w-full border border-border bg-background text-xs px-3 h-10 focus:outline-none focus:border-accent font-mono text-zinc-500"
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
