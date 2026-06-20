function normalizeLLMResponseText(text) {
  let s = text.trim();

  // 1. Remove markdown json code block wraps inside the text
  s = s.replace(/```json/gi, "");
  s = s.replace(/```/g, "");

  // 2. Replace common Chinese keys and abbreviations with standard English keys (quoted, unquoted, and mixed)
  s = s.replace(/"(?:optimized技能|optimized技能培训|优化技能|优化技能培训|optimized_skills_zh|skills_zh|优化_skills|技能|优化skills)"/gi, '"optimized_skills"');
  s = s.replace(/'(?:optimized技能|optimized技能培训|优化技能|优化技能培训|optimized_skills_zh|skills_zh|优化_skills|技能|优化skills)'/gi, '"optimized_skills"');
  s = s.replace(/\b(?:optimized技能|optimized技能培训|优化技能|优化技能培训|optimized_skills_zh|skills_zh|优化_skills|技能|优化skills)\b/gi, '"optimized_skills"');

  s = s.replace(/"(?:optimized项目|优化项目|optimized_projects_zh|projects_zh|优化_projects|项目|优化projects)"/gi, '"optimized_projects"');
  s = s.replace(/'(?:optimized项目|优化项目|optimized_projects_zh|projects_zh|优化_projects|项目|优化projects)'/gi, '"optimized_projects"');
  s = s.replace(/\b(?:optimized项目|优化项目|optimized_projects_zh|projects_zh|优化_projects|项目|优化projects)\b/gi, '"optimized_projects"');

  s = s.replace(/"(?:optimized摘要|优化摘要|optimized_summary_zh|summary_zh|优化_summary|摘要|优化summary)"/gi, '"optimized_summary"');
  s = s.replace(/'(?:optimized摘要|优化摘要|optimized_summary_zh|summary_zh|优化_summary|摘要|优化summary)'/gi, '"optimized_summary"');
  s = s.replace(/\b(?:optimized摘要|优化摘要|optimized_summary_zh|summary_zh|优化_summary|摘要|优化summary)\b/gi, '"optimized_summary"');

  // Map other variations like desc, description, title, etc. (both quoted and unquoted)
  s = s.replace(/'?desc(?:ription)?'?\s*:/gi, '"description":');
  s = s.replace(/\bdesc(?:ription)?\b\s*:/gi, '"description":');
  s = s.replace(/'?title'?\s*:/gi, '"title":');
  s = s.replace(/\btitle\b\s*:/gi, '"title":');
  s = s.replace(/'?skills?'?\s*:/gi, '"optimized_skills":');
  s = s.replace(/\bskills?\b\s*:/gi, '"optimized_skills":');
  s = s.replace(/'?projects?'?\s*:/gi, '"optimized_projects":');
  s = s.replace(/\bprojects?\b\s*:/gi, '"optimized_projects":');
  s = s.replace(/'?summary'?\s*:/gi, '"optimized_summary":');
  s = s.replace(/\bsummary\b\s*:/gi, '"optimized_summary":');

  // Fix Chinese characters in keys inside quotes like '技能' or 'desc' or 'title'
  s = s.replace(/"技能"\s*:/g, '"optimized_skills":');
  s = s.replace(/'技能'\s*:/g, '"optimized_skills":');
  s = s.replace(/\b技能\s*:/g, '"optimized_skills":');

  // 3. Fix unquoted words in flat arrays only (no nested objects or arrays)
  s = s.replace(/:\s*\[([^{}[\]]*?)\]/g, (match, arrayContent) => {
    const items = arrayContent.split(",");
    const quotedItems = items.map((item) => {
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

const rawText = `{
"optimized_skills": ["Python", Java], 
"优化_projects":

\`\`\`json

[
{ title : 'LLM Knowledge Assistant', 
'desc : 'Built a Retrieval Augmented Generation system supporting ingestion of PDFs Markdown web content.', 
'技能': ['Python', 'Java'], },
{ title : 'InterviewAI', 
'desc : 'Built real-time voice AI interviewer using Deepgram ASR Ollama LMs十一Labs TTS achieving sub-1.' }
]
\`\`\`,
"optimized_summary": "Tailored professional profile summary matching the role requirements."
}`;

console.log("=== ORIGINAL ===");
console.log(rawText);
console.log("\n=== NORMALIZED ===");
const norm = normalizeLLMResponseText(rawText);
console.log(norm);

try {
  const parsed = JSON.parse(norm);
  console.log("\nParsed successfully!");
  console.log(JSON.stringify(parsed, null, 2));
} catch (e) {
  console.log("\nParsing failed:", e.message);
}
