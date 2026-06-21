"""
patch_page.py  —  Applies all GapEngine refactoring changes to page.tsx atomically.
Run from: d:/Sanjay/B.Tech CSE/nextup/frontend/
  python patch_page.py
"""
import sys, re

FILE = "app/ai-toolkit/page.tsx"

with open(FILE, "r", encoding="utf-8", newline="") as f:
    src = f.read()

orig_len = len(src)
print(f"Original file: {orig_len} chars, {src.count(chr(10))} lines")

def apply(name, old, new):
    global src
    if old not in src:
        print(f"❌ PATCH {name}: target string not found!")
        sys.exit(1)
    count = src.count(old)
    if count > 1:
        print(f"⚠  PATCH {name}: target appears {count} times — replacing first only")
    src = src.replace(old, new, 1)
    print(f"✅ PATCH {name} applied")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 1: Add gapRef / target fields to CopilotQuestion interface
# ─────────────────────────────────────────────────────────────────────────────
apply("1:CopilotQuestion",
'''interface CopilotQuestion {\r
  id: string;\r
  type: "general" | "job_specific";\r
  stableKey: string;\r
  text: string;\r
  answer: string;\r
  sourceGapKey?: string;\r
  placeholder?: string;\r
}''',
'''interface CopilotQuestion {\r
  id: string;\r
  type: "general" | "job_specific";\r
  stableKey: string;\r
  text: string;\r
  answer: string;\r
  sourceGapKey?: string;\r
  placeholder?: string;\r
  gapRef?: CanonicalGap;\r
  target?: "metric" | "tool" | "architecture";\r
}''')

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 2: Add CanonicalGap interface after VaultQA
# ─────────────────────────────────────────────────────────────────────────────
apply("2:CanonicalGap",
'''interface VaultQA {\r
  stableKey?: string;\r
  question: string;\r
  answer: string;\r
  timestamp: string;\r
}\r
\r
type Capability =''',
'''interface VaultQA {\r
  stableKey?: string;\r
  question: string;\r
  answer: string;\r
  timestamp: string;\r
}\r
\r
interface CanonicalGap {\r
  id: string;\r
  type: "skill" | "experience" | "infrastructure" | "impact";\r
  canonicalName: string;\r
  normalizedAliases: string[];\r
  source: "jd" | "resume" | "inferred";\r
  evidenceRefs: string[];\r
  jdStrength: number;\r
  resumeCoverage: number;\r
}\r
\r
type Capability =''')

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 3: Fix buildResumeFromAnswers — remove unused jobDescription / gaps
# ─────────────────────────────────────────────────────────────────────────────
apply("3:buildResumeFromAnswers-params",
'''function buildResumeFromAnswers({\r
  masterResume,\r
  questions,\r
  answers\r
}: {\r
  masterResume: any;\r
  jobDescription: string;\r
  gaps: EvidenceGap[];\r
  questions: CopilotQuestion[];\r
  answers: Record<string, string>;\r
}): any {''',
'''function buildResumeFromAnswers({\r
  masterResume,\r
  questions,\r
  answers\r
}: {\r
  masterResume: any;\r
  questions: CopilotQuestion[];\r
  answers: Record<string, string>;\r
}): any {''')

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 4: Fix handleGenerateTailoredResume call site
# ─────────────────────────────────────────────────────────────────────────────
apply("4:handleGenerateTailoredResume-call",
'''      const resultResume = buildResumeFromAnswers({\r
        masterResume,\r
        jobDescription: company?.jd_text || "",\r
        gaps: evidenceGaps,\r
        questions: copilotQuestions,\r
        answers\r
      });''',
'''      const resultResume = buildResumeFromAnswers({\r
        masterResume,\r
        questions: copilotQuestions,\r
        answers\r
      });''')

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 5: Insert GapEngine before buildFallbackGaps
# ─────────────────────────────────────────────────────────────────────────────
GAPENGINE_CODE = r'''// ============================================================
// SKILL ONTOLOGY + STAGE-0 PREPROCESSING ENGINE (GapEngine)
// ============================================================

const SKILL_ONTOLOGY: Record<string, { canonical: string; aliases: string[]; category: string }> = {
  "penetration testing": { canonical: "Penetration Testing", aliases: ["pentesting", "pen testing", "vulnerability assessment", "ethical hacking"], category: "cybersecurity" },
  "threat modeling": { canonical: "Threat Modeling", aliases: ["threat modelling"], category: "cybersecurity" },
  "owasp top 10": { canonical: "OWASP Top 10", aliases: ["owasp", "owasp top ten"], category: "cybersecurity" },
  "adversarial simulation": { canonical: "Adversarial Simulation", aliases: ["red teaming"], category: "cybersecurity" },
  "ssrf": { canonical: "SSRF", aliases: ["server-side request forgery"], category: "cybersecurity" },
  "burp suite": { canonical: "Burp Suite", aliases: ["burpsuite"], category: "cybersecurity" },
  "metasploit": { canonical: "Metasploit", aliases: ["metasploit framework"], category: "cybersecurity" },
  "wireshark": { canonical: "Wireshark", aliases: [], category: "cybersecurity" },
  "nmap": { canonical: "Nmap", aliases: ["network mapper"], category: "cybersecurity" },
  "owasp zap": { canonical: "OWASP ZAP", aliases: ["zap"], category: "cybersecurity" },
  "cryptography": { canonical: "Cryptography", aliases: ["encryption", "aes", "rsa", "ssl", "tls", "ssl/tls"], category: "cybersecurity" },
  "networking": { canonical: "Networking", aliases: ["tcp/ip", "dns", "http/https", "sockets", "packet analysis"], category: "cybersecurity" },
  "docker": { canonical: "Docker", aliases: ["containers", "dockerfile"], category: "devops" },
  "kubernetes": { canonical: "Kubernetes", aliases: ["k8s", "helm", "helm charts"], category: "devops" },
  "aws": { canonical: "AWS", aliases: ["amazon web services", "ec2", "s3", "rds", "iam", "lambda", "vpc"], category: "devops" },
  "gcp": { canonical: "GCP", aliases: ["google cloud platform", "google cloud"], category: "devops" },
  "azure": { canonical: "Azure", aliases: ["microsoft azure"], category: "devops" },
  "terraform": { canonical: "Terraform", aliases: ["infrastructure as code", "iac"], category: "devops" },
  "ansible": { canonical: "Ansible", aliases: [], category: "devops" },
  "jenkins": { canonical: "Jenkins", aliases: ["continuous integration"], category: "devops" },
  "github actions": { canonical: "GitHub Actions", aliases: ["github-actions"], category: "devops" },
  "linux": { canonical: "Linux", aliases: ["ubuntu", "debian", "alpine", "centos", "unix"], category: "devops" },
  "nginx": { canonical: "Nginx", aliases: ["reverse proxy"], category: "devops" },
  "redis": { canonical: "Redis", aliases: ["caching", "in-memory database"], category: "devops" },
  "python": { canonical: "Python", aliases: ["py"], category: "backend" },
  "javascript": { canonical: "JavaScript", aliases: ["js", "es6"], category: "backend" },
  "typescript": { canonical: "TypeScript", aliases: ["ts"], category: "backend" },
  "golang": { canonical: "Go", aliases: ["go"], category: "backend" },
  "java": { canonical: "Java", aliases: [], category: "backend" },
  "c++": { canonical: "C++", aliases: ["cpp"], category: "backend" },
  "rust": { canonical: "Rust", aliases: [], category: "backend" },
  "node.js": { canonical: "Node.js", aliases: ["node", "nodejs"], category: "backend" },
  "fastapi": { canonical: "FastAPI", aliases: [], category: "backend" },
  "flask": { canonical: "Flask", aliases: [], category: "backend" },
  "django": { canonical: "Django", aliases: [], category: "backend" },
  "postgresql": { canonical: "PostgreSQL", aliases: ["postgres", "sql"], category: "backend" },
  "mongodb": { canonical: "MongoDB", aliases: ["mongo", "nosql"], category: "backend" },
  "neo4j": { canonical: "Neo4j", aliases: ["graph database"], category: "backend" },
  "react": { canonical: "React", aliases: ["react.js", "reactjs"], category: "frontend" },
  "next.js": { canonical: "Next.js", aliases: ["nextjs"], category: "frontend" },
  "concurrency": { canonical: "Concurrency", aliases: ["multithreading", "async", "parallelism", "goroutines"], category: "backend" },
  "microservices": { canonical: "Microservices", aliases: ["distributed systems", "soa"], category: "backend" },
  "websockets": { canonical: "WebSockets", aliases: ["websocket"], category: "backend" },
  "observability": { canonical: "Observability", aliases: ["monitoring", "logging", "tracing", "prometheus", "grafana", "opentelemetry"], category: "devops" },
  "xss": { canonical: "XSS", aliases: ["cross-site scripting"], category: "cybersecurity" },
  "csrf": { canonical: "CSRF", aliases: ["cross-site request forgery"], category: "cybersecurity" },
  "idor": { canonical: "IDOR", aliases: ["insecure direct object references"], category: "cybersecurity" },
  "api security": { canonical: "API Security", aliases: [], category: "cybersecurity" },
  "llm security": { canonical: "LLM Security", aliases: ["prompt injection", "jailbreaks", "retrieval poisoning"], category: "cybersecurity" }
};

const STOPWORDS = new Set([
  "world", "data", "our", "information", "tools", "star", "blue", "iaq", "job", "description",
  "candidate", "role", "work", "experience", "skills", "team", "growth", "solutions",
  "environment", "basic", "excellent", "global", "opportunity", "department", "company",
  "interest", "learning", "development", "product", "lines", "support", "explore",
  "internal", "external", "business", "units", "activities", "efforts", "methods",
  "materials", "systems", "processes", "strong", "active", "collaborative",
  "details", "attention", "communication", "technologies", "limited", "ltd", "inc"
]);

const ONTOLOGY_PATTERNS: { pattern: string; canonical: string }[] = [];
(function buildOntologyPatterns() {
  Object.entries(SKILL_ONTOLOGY).forEach(([key, entry]) => {
    ONTOLOGY_PATTERNS.push({ pattern: key.toLowerCase(), canonical: entry.canonical });
    entry.aliases.forEach(alias => {
      ONTOLOGY_PATTERNS.push({ pattern: alias.toLowerCase(), canonical: entry.canonical });
    });
  });
  ONTOLOGY_PATTERNS.sort((a, b) => b.pattern.length - a.pattern.length);
})();

const CLUSTER_MAPPING: Record<string, { id: string; name: string }> = {
  "penetration testing": { id: "cluster:cybersecurity", name: "Cybersecurity Vulnerability Assessment" },
  "threat modeling": { id: "cluster:cybersecurity", name: "Cybersecurity Vulnerability Assessment" },
  "owasp top 10": { id: "cluster:cybersecurity", name: "Cybersecurity Vulnerability Assessment" },
  "ssrf": { id: "cluster:cybersecurity", name: "Cybersecurity Vulnerability Assessment" },
  "burp suite": { id: "cluster:cybersecurity", name: "Cybersecurity Vulnerability Assessment" },
  "metasploit": { id: "cluster:cybersecurity", name: "Cybersecurity Vulnerability Assessment" },
  "owasp zap": { id: "cluster:cybersecurity", name: "Cybersecurity Vulnerability Assessment" },
  "docker": { id: "cluster:devops", name: "Cloud Infrastructure & DevOps" },
  "kubernetes": { id: "cluster:devops", name: "Cloud Infrastructure & DevOps" },
  "aws": { id: "cluster:devops", name: "Cloud Infrastructure & DevOps" },
  "gcp": { id: "cluster:devops", name: "Cloud Infrastructure & DevOps" },
  "azure": { id: "cluster:devops", name: "Cloud Infrastructure & DevOps" },
  "terraform": { id: "cluster:devops", name: "Cloud Infrastructure & DevOps" },
  "ansible": { id: "cluster:devops", name: "Cloud Infrastructure & DevOps" },
  "jenkins": { id: "cluster:devops", name: "Cloud Infrastructure & DevOps" },
  "github actions": { id: "cluster:devops", name: "Cloud Infrastructure & DevOps" },
  "concurrency": { id: "cluster:backend_scaling", name: "Distributed Systems & Backend Scaling" },
  "microservices": { id: "cluster:backend_scaling", name: "Distributed Systems & Backend Scaling" },
  "websockets": { id: "cluster:backend_scaling", name: "Distributed Systems & Backend Scaling" },
  "redis": { id: "cluster:backend_scaling", name: "Distributed Systems & Backend Scaling" },
};

const GapEngine = {
  getSimilarity(s1: string, s2: string): number {
    const len1 = s1.length, len2 = s2.length;
    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;
    const dp: number[][] = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
    for (let i = 0; i <= len1; i++) dp[i][0] = i;
    for (let j = 0; j <= len2; j++) dp[0][j] = j;
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        dp[i][j] = s1[i-1] === s2[j-1] ? dp[i-1][j-1] : Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+1);
      }
    }
    return 1 - dp[len1][len2] / Math.max(len1, len2);
  },

  getCompanyTokens(companyName: string): Set<string> {
    const tokens = new Set<string>();
    companyName.toLowerCase().split(/[\s,.'"';:()\-?!]+/).forEach(p => { if (p.length > 2) tokens.add(p); });
    ["limited","ltd","inc","corporation","corp","solutions","technologies","services"].forEach(t => tokens.add(t));
    return tokens;
  },

  stage0Preprocess(jdText: string, companyName: string): string[] {
    const companyTokens = GapEngine.getCompanyTokens(companyName);
    let cleanText = jdText.toLowerCase().replace(/[^a-z0-9\s\-\/]/g, " ");
    const matched = new Set<string>();
    ONTOLOGY_PATTERNS.forEach(target => {
      const escaped = target.pattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'g');
      if (regex.test(cleanText)) {
        const hasStopword = target.pattern.split(/\s+/).some(w => STOPWORDS.has(w) || companyTokens.has(w));
        if (!hasStopword) {
          matched.add(target.canonical);
          cleanText = cleanText.replace(regex, " ");
        }
      }
    });
    cleanText.split(/[\s,.'"';:()\-?!]+/).filter(w => w.length > 2).forEach(tok => {
      const t = tok.toLowerCase().trim();
      if (STOPWORDS.has(t) || companyTokens.has(t)) return;
      for (const pat of ONTOLOGY_PATTERNS) {
        if (pat.pattern.length > 3 && t.length > 3 && GapEngine.getSimilarity(t, pat.pattern) >= 0.87) {
          matched.add(pat.canonical);
          break;
        }
      }
    });
    return Array.from(matched);
  },

  buildCanonicalGaps(jdSkills: string[], resumeGraph: EvidenceNode[]): CanonicalGap[] {
    const gaps: CanonicalGap[] = [];
    const provenSkills = new Set(
      resumeGraph.filter(n => n.type === "skill" && n.confidence >= 80).map(n => n.name.toLowerCase().trim())
    );
    jdSkills.forEach(skill => {
      const sLower = skill.toLowerCase().trim();
      if (!provenSkills.has(sLower)) {
        const partial = resumeGraph.find(n => n.type === "skill" && n.name.toLowerCase().trim() === sLower);
        gaps.push({ id: `skill:${sLower}`, type: "skill", canonicalName: skill, normalizedAliases: [skill], source: partial ? "resume" : "jd", evidenceRefs: partial ? [partial.id] : [], jdStrength: 90, resumeCoverage: partial ? 40 : 0 });
      }
    });
    resumeGraph.filter(n => n.type === "project").forEach(node => {
      const desc = node.supportingEvidence.join(" ").toLowerCase();
      const hasMetrics = /[0-9]+%?/.test(desc) || /latency|throughput|users|requests|scale/i.test(desc);
      const hasInfra = /aws|gcp|azure|docker|kubernetes|linux|nginx|redis|deploy|cloud/i.test(desc);
      const hasComplexity = desc.length > 200 || /concurrency|async|parallel|tradeoff|design/i.test(desc);
      if (!hasMetrics) gaps.push({ id: `${node.id}:metrics`, type: "impact", canonicalName: node.name, normalizedAliases: [node.name], source: "resume", evidenceRefs: [node.id], jdStrength: 70, resumeCoverage: 20 });
      if (!hasInfra) gaps.push({ id: `${node.id}:deployment`, type: "infrastructure", canonicalName: node.name, normalizedAliases: [node.name], source: "resume", evidenceRefs: [node.id], jdStrength: 80, resumeCoverage: 10 });
      if (!hasComplexity) gaps.push({ id: `${node.id}:challenge`, type: "experience", canonicalName: node.name, normalizedAliases: [node.name], source: "resume", evidenceRefs: [node.id], jdStrength: 70, resumeCoverage: 30 });
    });
    return gaps;
  },

  mergeAndClusterGaps(gaps: CanonicalGap[]): CanonicalGap[] {
    const finalGaps: CanonicalGap[] = [];
    const projectMap = new Map<string, CanonicalGap[]>();
    const clusterMap = new Map<string, CanonicalGap[]>();
    gaps.forEach(gap => {
      if (gap.type === "skill") {
        const cluster = CLUSTER_MAPPING[gap.canonicalName.toLowerCase()];
        if (cluster) {
          if (!clusterMap.has(cluster.id)) clusterMap.set(cluster.id, []);
          clusterMap.get(cluster.id)!.push(gap);
        } else { finalGaps.push(gap); }
      } else {
        const projKey = gap.canonicalName;
        if (!projectMap.has(projKey)) projectMap.set(projKey, []);
        projectMap.get(projKey)!.push(gap);
      }
    });
    projectMap.forEach(projGaps => {
      if (projGaps.length === 1) { finalGaps.push(projGaps[0]); return; }
      finalGaps.push({ id: `project:${projGaps[0].canonicalName.toLowerCase()}:details`, type: "experience", canonicalName: projGaps[0].canonicalName, normalizedAliases: Array.from(new Set(projGaps.flatMap(g => g.normalizedAliases))), source: "resume", evidenceRefs: Array.from(new Set(projGaps.flatMap(g => g.evidenceRefs))), jdStrength: Math.max(...projGaps.map(g => g.jdStrength)), resumeCoverage: Math.round(projGaps.reduce((s, g) => s + g.resumeCoverage, 0) / projGaps.length) });
    });
    clusterMap.forEach((clusterGaps, clusterId) => {
      if (clusterGaps.length === 1) { finalGaps.push(clusterGaps[0]); return; }
      const clusterInfo = CLUSTER_MAPPING[clusterGaps[0].canonicalName.toLowerCase()];
      finalGaps.push({ id: clusterId, type: "skill", canonicalName: clusterInfo ? clusterInfo.name : clusterGaps[0].canonicalName, normalizedAliases: Array.from(new Set(clusterGaps.flatMap(g => g.normalizedAliases))), source: "jd", evidenceRefs: Array.from(new Set(clusterGaps.flatMap(g => g.evidenceRefs))), jdStrength: Math.max(...clusterGaps.map(g => g.jdStrength)), resumeCoverage: Math.round(clusterGaps.reduce((s, g) => s + g.resumeCoverage, 0) / clusterGaps.length) });
    });
    return finalGaps;
  },

  calculateAlignment(resumeGraph: EvidenceNode[], jdSkills: string[]): AlignmentResult {
    if (jdSkills.length === 0) return { score: 50, level: "Medium", directOverlapCount: 0, transferableOverlapCount: 0, primaryStrategy: "minimal_jd_targeting" };
    const candidateSkills = new Set(resumeGraph.filter(n => n.type === "skill" && n.confidence >= 80).map(n => n.name.toLowerCase().trim()));
    const candidateCaps = new Set<Capability>(resumeGraph.flatMap(n => n.inferredCapabilities));
    let direct = 0, transferable = 0;
    jdSkills.forEach(skill => {
      if (candidateSkills.has(skill.toLowerCase().trim())) { direct++; }
      else { const caps = GapEngine.getJDConceptCapabilities(skill); if (caps.some(c => candidateCaps.has(c))) transferable++; }
    });
    const score = Math.min(100, Math.round(((direct * 1.0) + (transferable * 0.5)) / jdSkills.length * 100));
    const level: "High" | "Medium" | "Low" = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
    let primaryStrategy: AlignmentStrategy = "minimal_jd_targeting";
    if (level === "High") primaryStrategy = "experience_enrichment";
    else if (level === "Medium") primaryStrategy = direct > 0 ? "skill_verification" : "transferable_exploration";
    else primaryStrategy = transferable > direct ? "transferable_exploration" : "minimal_jd_targeting";
    return { score, level, directOverlapCount: direct, transferableOverlapCount: transferable, primaryStrategy };
  },

  getJDConceptCapabilities(concept: string): Capability[] {
    const c = concept.toLowerCase();
    const caps: Capability[] = [];
    if (/python|javascript|typescript|golang|java|c\+\+|rust|node|fastapi|flask|django|backend|api|sql|postgres|mongodb|redis/i.test(c)) caps.push("backend_systems");
    if (/real-time|websocket|stream|audio|voice|chat/i.test(c)) caps.push("real_time_systems");
    if (/ml|ai|machine learning|llm|rag|nlp|gpt|transformer|pytorch|tensorflow/i.test(c)) caps.push("ml_systems");
    if (/research|paper|publication|experiment|methodology|benchmarking/i.test(c)) caps.push("research_methodology");
    if (/algorithm|data structures|tree|graph|complexity|sorting/i.test(c)) caps.push("data_structures");
    if (/network|tcp|ip|dns|http|tls|ssl|socket|proxy|packet/i.test(c)) caps.push("networking");
    if (/concurrency|async|parallel|multithread|goroutine|coroutine/i.test(c)) caps.push("concurrency");
    if (/deploy|host|cloud|aws|gcp|azure|docker|kubernetes|terraform/i.test(c)) caps.push("deployment");
    if (/observability|monitoring|logging|tracing|prometheus|grafana/i.test(c)) caps.push("observability");
    return caps;
  },

  getGapReason(gap: CanonicalGap): string {
    if (gap.type === "skill") return gap.resumeCoverage === 0 ? `The job description requires '${gap.canonicalName}', which is missing from your master resume.` : `The job description requires '${gap.canonicalName}', which is mentioned but not listed as a core skill.`;
    if (gap.type === "impact") return `The project '${gap.canonicalName}' lacks quantitative metrics or performance gains.`;
    if (gap.type === "infrastructure") return `The project '${gap.canonicalName}' lacks cloud deployment or container hosting context.`;
    if (gap.type === "experience") return gap.id.includes(":details") ? `We need to verify metrics, cloud deployment, and architectural choices for '${gap.canonicalName}'.` : `Verifying complex technical challenges solved in '${gap.canonicalName}' can enrich your resume.`;
    return `Verify additional context for '${gap.canonicalName}'.`;
  },

  getGapEvidenceMissing(gap: CanonicalGap): string {
    if (gap.type === "skill") return gap.resumeCoverage === 0 ? "Proof of training, coursework, or practical project work." : "Project contexts and depth of experience with this skill.";
    if (gap.type === "impact") return "Scalability stats, latency reductions, requests/sec, or efficiency metrics.";
    if (gap.type === "infrastructure") return "Cloud providers (e.g. AWS, GCP), containers (Docker), Nginx, or Linux details.";
    if (gap.type === "experience") return "System design tradeoffs, concurrency, data streaming, or complexity solutions.";
    return "Technical implementation details.";
  },

  getGapSeverity(gap: CanonicalGap): number {
    if (gap.type === "skill") return gap.resumeCoverage === 0 ? 90 : 60;
    if (gap.type === "infrastructure") return 80;
    if (gap.type === "impact") return 70;
    if (gap.type === "experience") return 70;
    return 50;
  },

  getGapPriority(gap: CanonicalGap, alignmentScore: number): number {
    const severity = GapEngine.getGapSeverity(gap);
    return Math.round(severity * 0.45 + (100 - alignmentScore) * 0.25 + gap.jdStrength * 0.30);
  },

  getGapTypeBadge(gap: CanonicalGap): { label: string; color: string } {
    if (gap.type === "skill" && gap.resumeCoverage === 0) return { label: "Missing Skill", color: "border-red-500/35 text-red-500 bg-red-500/5" };
    if (gap.type === "skill") return { label: "Weak Evidence", color: "border-orange-500/35 text-orange-500 bg-orange-500/5" };
    if (gap.type === "impact") return { label: "Missing Metric", color: "border-purple-500/35 text-purple-500 bg-purple-500/5" };
    if (gap.type === "infrastructure") return { label: "Infrastructure Missing", color: "border-cyan-500/35 text-cyan-500 bg-cyan-500/5" };
    if (gap.type === "experience") return { label: "Project Depth", color: "border-blue-500/35 text-blue-500 bg-blue-500/5" };
    return { label: "Enrichment", color: "border-emerald-500/35 text-emerald-500 bg-emerald-500/5" };
  },

  compileDeterministicQuestion(gap: CanonicalGap, evidenceNode: EvidenceNode | null): CopilotQuestion {
    const normKey = normalizeStableKey(gap.id);
    const name = gap.canonicalName;
    let text = "";
    let target: "metric" | "tool" | "architecture" = "tool";
    if (gap.type === "impact") {
      target = "metric";
      text = `For your project '${name}', what specific quantitative metrics, performance gains, or scale indicators did you achieve?`;
    } else if (gap.type === "infrastructure") {
      target = "tool";
      text = `What specific cloud services, container tools (e.g. Docker, Kubernetes), or hosting setups did you use to deploy '${name}'?`;
    } else if (gap.type === "experience") {
      target = "architecture";
      text = gap.id.includes(":details")
        ? `For your project '${name}', what were your metrics, cloud deployment setup, and the most challenging architectural tradeoff you made?`
        : `What was the most challenging technical tradeoff or architectural decision you made while building '${name}'?`;
    } else if (gap.type === "skill") {
      if (evidenceNode) {
        target = evidenceNode.type === "project" ? "tool" : "architecture";
        text = evidenceNode.type === "project"
          ? `Can you describe your hands-on experience using '${name}' within the context of your project '${evidenceNode.name}'?`
          : `How did you apply or leverage '${name}' during your experience as '${evidenceNode.name}'?`;
      } else {
        target = "tool";
        text = `Your resume does not mention '${name}'. Have you worked with it in academic projects, coursework, or labs?`;
      }
    }
    return { id: `comp_${normKey}`, type: gap.source === "jd" ? "job_specific" : "general", stableKey: normKey, sourceGapKey: normKey, text, answer: "", gapRef: gap, target };
  },

  compileQuestions(gaps: CanonicalGap[], alignment: AlignmentResult, resumeGraph: EvidenceNode[]): CopilotQuestion[] {
    const budget = ({ High: 6, Medium: 5, Low: 3 } as Record<string, number>)[alignment.level] ?? 4;
    const sorted = [...gaps].sort((a, b) => GapEngine.getGapPriority(b, alignment.score) - GapEngine.getGapPriority(a, alignment.score));
    return sorted.slice(0, budget).map(gap => {
      let evidenceNode: EvidenceNode | null = null;
      if (gap.evidenceRefs.length > 0) evidenceNode = resumeGraph.find(n => n.id === gap.evidenceRefs[0]) || null;
      if (!evidenceNode && gap.type === "skill") {
        evidenceNode = resumeGraph.find(n => {
          if (n.type !== "project" && n.type !== "experience") return false;
          const content = n.supportingEvidence.join(" ").toLowerCase();
          return content.includes(gap.canonicalName.toLowerCase()) || gap.normalizedAliases.some(a => content.includes(a.toLowerCase()));
        }) || null;
      }
      return GapEngine.compileDeterministicQuestion(gap, evidenceNode);
    });
  }
};

'''

# Convert the GapEngine code to CRLF line endings to match the file
GAPENGINE_CRLF = GAPENGINE_CODE.replace('\n', '\r\n')

ANCHOR5 = 'function buildFallbackGaps(resumeData: any, activeCompany: Company, evidenceGraph: EvidenceNode[]): EvidenceGap[] {\r\n'
assert ANCHOR5 in src, "PATCH 5 anchor not found"
src = src.replace(ANCHOR5, GAPENGINE_CRLF + ANCHOR5, 1)
print("✅ PATCH 5:GapEngine applied")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 6: Update evidenceGaps state type
# ─────────────────────────────────────────────────────────────────────────────
apply("6:evidenceGaps-state",
  'const [evidenceGaps, setEvidenceGaps] = useState<EvidenceGap[]>([]);',
  'const [evidenceGaps, setEvidenceGaps] = useState<CanonicalGap[]>([]);'
)

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 7: Replace generateCopilotQuestions
# Use regex to find the full function (from declaration to its closing `};`)
# followed by `\r\n\r\n  const handleSaveToVault`
# ─────────────────────────────────────────────────────────────────────────────
pattern7 = re.compile(
    r'  const generateCopilotQuestions = async \(\) => \{.+?\r\n  \};\r\n(\r\n  const handleSaveToVault)',
    re.DOTALL
)
match7 = pattern7.search(src)
if not match7:
    print("❌ PATCH 7: generateCopilotQuestions not found")
    sys.exit(1)

NEW_GEN_FN = '''  const generateCopilotQuestions = async () => {
    if (!company) return;
    setGeneratingQuestions(true);
    setErrorMsg("");
    setSuccessMsg("");
    setLocalStatusMessage("");
    setEvidenceGaps([]);
    setCopilotQuestions([]);
    setAnswers({});
    setCopilotTab("gaps");

    try {
      const resMe = await api.get("/resumes/me");
      const resumeData = resMe.data?.resume_data || masterResume || {};
      if (!resumeData || Object.keys(resumeData).length === 0) {
        throw new Error("No master resume found. Please ensure you have parsed your master resume first.");
      }

      // Stage 0: JD preprocessing — ontology-filtered, no raw token leakage
      setLocalStatusMessage("Stage 1/3: Preprocessing job description...");
      const jdSkills = GapEngine.stage0Preprocess(company.jd_text || "", company.name);

      // Stage 1: Build evidence graph deterministically from resume
      setLocalStatusMessage("Stage 2/3: Building resume evidence graph...");
      const resumeGraph = buildEvidenceGraph(resumeData);

      // Stage 2: Build canonical gaps, cluster related ones
      setLocalStatusMessage("Stage 3/3: Detecting evidence gaps...");
      const rawGaps = GapEngine.buildCanonicalGaps(jdSkills, resumeGraph);
      const clusteredGaps = GapEngine.mergeAndClusterGaps(rawGaps);

      // Stage 3: Alignment + question compilation
      const alignment = GapEngine.calculateAlignment(resumeGraph, jdSkills);
      const compiledQuestions = GapEngine.compileQuestions(clusteredGaps, alignment, resumeGraph);

      // Pre-fill from vault
      const existingVault: VaultQA[] = resumeData.context_vault || [];
      const filledQuestions = compiledQuestions.map(q => {
        const vaultMatch = existingVault.find(v => v.stableKey && normalizeStableKey(v.stableKey) === q.stableKey);
        return { ...q, answer: vaultMatch ? vaultMatch.answer : "" };
      });
      const initialAnswers: Record<string, string> = {};
      filledQuestions.forEach(q => { initialAnswers[q.id] = q.answer || ""; });

      setEvidenceGaps(clusteredGaps);
      setCopilotQuestions(filledQuestions);
      setAnswers(initialAnswers);

      if (clusteredGaps.length > 0) {
        setCopilotTab("gaps");
        showSuccess(`Found ${clusteredGaps.length} evidence gap(s). ${filledQuestions.length} targeted question(s) compiled. (Alignment: ${alignment.level} — ${alignment.score}%)`);
      } else {
        setCopilotTab("questions");
        showSuccess("No major skill gaps detected! Review the compiled questions to enrich your resume.");
      }
    } catch (err: any) {
      console.error("Failed to generate copilot questions:", err);
      setErrorMsg(err.message || "Failed to generate Copilot questions.");
    } finally {
      setGeneratingQuestions(false);
      setLocalStatusMessage("");
    }
  };

  const handleSaveToVault'''

# Convert to CRLF
NEW_GEN_FN_CRLF = NEW_GEN_FN.replace('\n', '\r\n')
src = pattern7.sub(NEW_GEN_FN_CRLF, src, count=1)
print("✅ PATCH 7:generateCopilotQuestions applied")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 8: Update JSX gaps render block to use GapEngine helpers
# ─────────────────────────────────────────────────────────────────────────────
OLD8 = (
    '                                   let badgeColor = "border-red-500/35 text-red-500 bg-red-500/5";\r\n'
    '                                   let typeDisplay = "Missing Skill";\r\n'
    '                                   if (gap.gapType === "weak_skill") {\r\n'
    '                                     badgeColor = "border-orange-500/35 text-orange-500 bg-orange-500/5";\r\n'
    '                                     typeDisplay = "Weak Evidence";\r\n'
    '                                   } else if (gap.gapType === "project_depth") {\r\n'
    '                                     badgeColor = "border-blue-500/35 text-blue-500 bg-blue-500/5";\r\n'
    '                                     typeDisplay = "Project Depth";\r\n'
    '                                   } else if (gap.gapType === "missing_metric") {\r\n'
    '                                     badgeColor = "border-purple-500/35 text-purple-500 bg-purple-500/5";\r\n'
    '                                     typeDisplay = "Missing Metric";\r\n'
    '                                   } else if (gap.gapType === "missing_infrastructure") {\r\n'
    '                                     badgeColor = "border-cyan-500/35 text-cyan-500 bg-cyan-500/5";\r\n'
    '                                     typeDisplay = "Infrastructure Missing";\r\n'
    '                                   } else if (gap.gapType === "enrichment_opportunity") {\r\n'
    '                                     badgeColor = "border-emerald-500/35 text-emerald-500 bg-emerald-500/5";\r\n'
    '                                     typeDisplay = "Enrichment";\r\n'
    '                                   }\r\n'
    '\r\n'
    '                                   return (\r\n'
    '                                     <div key={idx} className="border border-border bg-background p-4 rounded-sm space-y-3 relative flex flex-col justify-between hover:border-accent/40 transition-colors">\r\n'
    '                                       <div className="space-y-2">\r\n'
    '                                         <div className="flex justify-between items-center">\r\n'
    '                                           <span className={`px-2 py-0.5 text-[8px] font-black border uppercase tracking-wider ${badgeColor}`}>\r\n'
    '                                             {typeDisplay}\r\n'
    '                                           </span>\r\n'
    '                                           {gap.priority !== undefined && (\r\n'
    '                                             <span className="text-[9px] font-mono font-bold text-muted-foreground uppercase">\r\n'
    '                                               Priority: {Math.round(gap.priority)}\r\n'
    '                                             </span>\r\n'
    '                                           )}\r\n'
    '                                         </div>\r\n'
    '                                         <h4 className="text-xs font-black uppercase text-foreground">\r\n'
    '                                           {gap.skillOrProjectName}\r\n'
    '                                         </h4>\r\n'
    '                                         <p className="text-[11px] text-muted-foreground font-medium leading-relaxed text-justify">\r\n'
    '                                           {gap.reason}\r\n'
    '                                         </p>\r\n'
    '                                       </div>\r\n'
    '                                       \r\n'
    '                                       <div className="border-t border-border pt-2 mt-2">\r\n'
    '                                         <div className="text-[8px] font-black uppercase text-zinc-500 tracking-wider">Missing details to add:</div>\r\n'
    '                                         <p className="text-[10px] text-foreground font-mono font-bold leading-normal mt-0.5">\r\n'
    '                                           {gap.evidenceMissing}\r\n'
    '                                         </p>\r\n'
    '                                       </div>\r\n'
    '                                     </div>\r\n'
    '                                   );\r\n'
    '                                 })'
)

NEW8 = (
    '                                   const badge = GapEngine.getGapTypeBadge(gap);\r\n'
    '                                   const priority = GapEngine.getGapPriority(gap, 50);\r\n'
    '                                   return (\r\n'
    '                                     <div key={idx} className="border border-border bg-background p-4 rounded-sm space-y-3 relative flex flex-col justify-between hover:border-accent/40 transition-colors">\r\n'
    '                                       <div className="space-y-2">\r\n'
    '                                         <div className="flex justify-between items-center">\r\n'
    '                                           <span className={`px-2 py-0.5 text-[8px] font-black border uppercase tracking-wider ${badge.color}`}>\r\n'
    '                                             {badge.label}\r\n'
    '                                           </span>\r\n'
    '                                           <span className="text-[9px] font-mono font-bold text-muted-foreground uppercase">\r\n'
    '                                             Priority: {priority}\r\n'
    '                                           </span>\r\n'
    '                                         </div>\r\n'
    '                                         <h4 className="text-xs font-black uppercase text-foreground">\r\n'
    '                                           {gap.canonicalName}\r\n'
    '                                         </h4>\r\n'
    '                                         <p className="text-[11px] text-muted-foreground font-medium leading-relaxed text-justify">\r\n'
    '                                           {GapEngine.getGapReason(gap)}\r\n'
    '                                         </p>\r\n'
    '                                       </div>\r\n'
    '                                       <div className="border-t border-border pt-2 mt-2">\r\n'
    '                                         <div className="text-[8px] font-black uppercase text-zinc-500 tracking-wider">Missing details to add:</div>\r\n'
    '                                         <p className="text-[10px] text-foreground font-mono font-bold leading-normal mt-0.5">\r\n'
    '                                           {GapEngine.getGapEvidenceMissing(gap)}\r\n'
    '                                         </p>\r\n'
    '                                       </div>\r\n'
    '                                     </div>\r\n'
    '                                   );\r\n'
    '                                 })'
)

apply("8:gaps-render-jsx", OLD8, NEW8)

# ─────────────────────────────────────────────────────────────────────────────
# WRITE BACK
# ─────────────────────────────────────────────────────────────────────────────
with open(FILE, "w", encoding="utf-8", newline="") as f:
    f.write(src)

new_len = len(src)
print(f"\n✅ All patches applied successfully!")
print(f"File: {new_len} chars (was {orig_len}, delta +{new_len - orig_len})")
