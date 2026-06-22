FILE = "app/ai-toolkit/page.tsx"

with open(FILE, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Fix idx defined but never used in projects loop
content = content.replace("projects.forEach((p, idx) => {", "projects.forEach((p) => {")

# 2. Fix modelType in structureAnswer
# In callers:
content = content.replace("structureAnswer(q, answers[q.id] || \"\", atsModel)", "structureAnswer(q, answers[q.id] || \"\")")
# In definition:
content = content.replace(
    "async function structureAnswer(question: EvidenceQuestion, rawAnswer: string, modelType: BrowserModelType): Promise<{ evidence: UserEvidence; verification: CapabilityVerification }> {",
    "async function structureAnswer(question: EvidenceQuestion, rawAnswer: string): Promise<{ evidence: UserEvidence; verification: CapabilityVerification }> {"
)

# 3. Fix unused 'e' in catch block
content = content.replace("} catch (e) { /* skip this project */ }", "} catch { /* skip this project */ }")

# 4. Remove unused JDConcept interface
jd_concept_block = """interface JDConcept {
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
}"""

content = content.replace(jd_concept_block.replace("\r\n", "\n"), "")

# 5. Fix unused setLocalDownloadProgress state setter
content = content.replace(
    "const [localDownloadProgress, setLocalDownloadProgress] = useState<number | null>(null);",
    "const [localDownloadProgress, _setLocalDownloadProgress] = useState<number | null>(null);"
)

with open(FILE, "w", encoding="utf-8", newline="\n") as f:
    f.write(content)

print("ESLint fixes applied successfully!")
