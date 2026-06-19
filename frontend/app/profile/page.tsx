"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { decryptData, encryptData, deriveKey, exportKeyToHex } from "@/lib/crypto";
import { isProfileComplete } from "@/lib/profile-utils";
import api from "@/lib/api";

interface ApiError {
  response?: {
    data?: {
      detail?: string;
    };
  };
}
import { 
  ShieldCheck, 
  Unlock, 
  Save, 
  Upload, 
  FileText, 
  AlertCircle, 
  CheckCircle2, 
  Lock
} from "lucide-react";

async function getDeterministicSalt(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.trim().toLowerCase());
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, setUser, encryptionKey, setEncryptionKey } = useAppStore();
  const [unlocked, setUnlocked] = useState(false);
  
  // Unlock Form State
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlockLoading, setUnlockLoading] = useState(false);

  // File Upload & Parser State
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [rawText, setRawText] = useState("");
  const [hasSavedResume, setHasSavedResume] = useState(false);

  // Profile Form Fields (Plaintext)
  const [fullName, setFullName] = useState("");
  const [branch, setBranch] = useState("");
  const [batchYear, setBatchYear] = useState<number>(new Date().getFullYear());
  const [skillsStr, setSkillsStr] = useState("");

  // Profile Form Fields (Sensitive/Encrypted)
  const [neoId, setNeoId] = useState("");
  const [cgpa, setCgpa] = useState("");
  const [tenthMarks, setTenthMarks] = useState("");
  const [twelfthMarks, setTwelfthMarks] = useState("");
  const [hasArrears, setHasArrears] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  // 1. Initial Load: Decrypt if key is already in memory
  useEffect(() => {
    if (user && encryptionKey) {
      decryptProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, encryptionKey]);

  const decryptProfile = async () => {
    if (!user || !encryptionKey) return;
    try {
      setFullName(user.full_name || "");
      setBranch(user.branch || "");
      setBatchYear(user.batch_year || new Date().getFullYear());
      setSkillsStr(user.skills ? user.skills.join(", ") : "");

      // Load plaintext fields
      setCgpa(user.cgpa !== null && user.cgpa !== undefined && user.cgpa !== 0 ? String(user.cgpa) : "");
      setTenthMarks(user.tenth_marks !== null && user.tenth_marks !== undefined && user.tenth_marks !== 0 ? String(user.tenth_marks) : "");
      setTwelfthMarks(user.twelfth_marks !== null && user.twelfth_marks !== undefined && user.twelfth_marks !== 0 ? String(user.twelfth_marks) : "");
      setHasArrears(user.has_arrears || false);

      // Decrypt sensitive Neo ID field
      const dNeoId = user.neo_id_enc && user.neo_id_enc !== "UNSET" 
        ? await decryptData(user.neo_id_enc, encryptionKey) 
        : "";

      setNeoId(dNeoId);
      setUnlocked(true);

      // Fetch saved resume raw text
      fetchResumeData();
    } catch (err) {
      console.error("Decryption error:", err);
      setError("FAILED TO DECRYPT VAULT DATA. PLEASE RE-LOGIN.");
    }
  };

  const fetchResumeData = async () => {
    if (!encryptionKey) return;
    try {
      const res = await api.get("/resumes/me");
      if (res.data) {
        if (res.data.raw_text_enc) {
          setHasSavedResume(true);
          try {
            const decryptedText = await decryptData(res.data.raw_text_enc, encryptionKey);
            setRawText(decryptedText);
          } catch (e) {
            console.error("Failed to decrypt raw resume text:", e);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load saved resume details:", err);
    }
  };

  // Handle Vault Unlock if key is missing from memory
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
      setUnlocked(true);
    } catch {
      setUnlockError("INCORRECT PASSWORD. DECRYPTION KEY IS INVALID.");
    } finally {
      setUnlockLoading(false);
    }
  };

  // 2. Handle PDF file selection & upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setError("");
      setSuccess("");
    }
  };

  const handleUploadResume = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setParsing(true);
    setError("");
    setSuccess("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await api.post("/resumes/parse", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      
      const data = res.data;
      setSuccess("RESUME PARSED SECURELY & ON-THE-FLY.");
      
      // Auto-populate parsed values in form state
      if (data.full_name && data.full_name !== "Student Candidate") {
        setFullName(data.full_name);
      }
      if (data.branch && data.branch !== "Unknown") {
        setBranch(data.branch);
      }
      if (data.batch_year) {
        setBatchYear(data.batch_year);
      }
      if (data.cgpa) {
        setCgpa(String(data.cgpa));
      }
      if (data.tenth_marks) {
        setTenthMarks(String(data.tenth_marks));
      }
      if (data.twelfth_marks) {
        setTwelfthMarks(String(data.twelfth_marks));
      }
      if (data.has_arrears !== undefined) {
        setHasArrears(data.has_arrears);
      }
      if (data.skills) {
        setSkillsStr(data.skills.join(", "));
      }
      if (data.raw_text) {
        setRawText(data.raw_text);
        setHasSavedResume(true);
      }

    } catch (err: unknown) {
      const apiErr = err as ApiError;
      const errorMsg = apiErr.response?.data?.detail || "FAILED TO EXTRACT TEXT FROM RESUME.";
      setError(errorMsg);
    } finally {
      setParsing(false);
      setFile(null);
    }
  };

  // Save profile & resume edits
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);

    if (!encryptionKey) {
      setError("ENCRYPTION KEY MISSING from memory. RE-UNLOCK VAULT.");
      setSaving(false);
      return;
    }

    // Neo ID validator: alternating letter/digit, length 8. E.g. K9B8C7D6
    const neoIdClean = neoId.trim().toUpperCase();
    const neoIdRegex = /^[A-Z]\d[A-Z]\d[A-Z]\d[A-Z]\d$/;
    if (neoIdClean && !neoIdRegex.test(neoIdClean)) {
      setError("INVALID NEO ID FORMAT. MUST BE 8 CHARACTERS ALTERNATING LETTER & DIGIT (E.G. K9B8C7D6).");
      setSaving(false);
      return;
    }

    try {
      // 1. Encrypt sensitive Neo ID locally
      const encNeoId = await encryptData(neoIdClean, encryptionKey);

      // Parse skills
      const skillsArray = skillsStr
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");

      // 2. Encrypt raw resume text locally if available
      let encRawText = "";
      if (rawText) {
        encRawText = await encryptData(rawText, encryptionKey);
      }

      // 3. Send request to update user profile with plaintext parameters and encrypted Neo ID
      const userRes = await api.put("/users/me", {
        full_name: fullName.trim(),
        branch: branch.trim().toUpperCase(),
        batch_year: Number(batchYear),
        skills: skillsArray,
        neo_id_enc: encNeoId,
        neo_id: neoIdClean, // plain Neo ID sent to trigger server-side PEPPER HMAC hash
        cgpa: cgpa ? parseFloat(cgpa) : 0.0,
        tenth_marks: tenthMarks ? parseFloat(tenthMarks) : 0.0,
        twelfth_marks: twelfthMarks ? parseFloat(twelfthMarks) : 0.0,
        has_arrears: hasArrears,
      });

      // 4. Save structured resume and encrypted raw text to backend
      const resume_data = {
        personal: {
          name: fullName.trim(),
          email: user?.email || "",
          phone: "",
          location: ""
        },
        education: [
          { degree: "Class X", score: tenthMarks, institution: "", year: "" },
          { degree: "Class XII", score: twelfthMarks, institution: "", year: "" },
          { degree: branch.trim().toUpperCase(), score: cgpa, institution: "", year: "" }
        ],
        skills: skillsArray
      };

      await api.put("/resumes/me", {
        template: "Classic",
        resume_data,
        raw_text_enc: encRawText || null
      });

      setUser(userRes.data);
      setSuccess("PROFILE & RESUME SAVED & ENCRYPTED SUCCESSFULLY.");
      
      if (isProfileComplete(userRes.data)) {
        setTimeout(() => {
          router.push("/dashboard");
        }, 1500);
      }
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      const errorMsg = apiErr.response?.data?.detail || "FAILED TO SAVE PROFILE & RESUME.";
      setError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  // Calculate profile completeness
  const calculateCompleteness = () => {
    let score = 0;
    if (fullName && fullName !== "New Student" && fullName !== "Student Candidate") score += 10;
    if (branch && branch !== "Unknown") score += 10;
    if (batchYear) score += 10;
    if (skillsStr) score += 15;
    if (neoId) score += 15;
    if (cgpa && parseFloat(cgpa) > 0) score += 15;
    if (tenthMarks && parseFloat(tenthMarks) > 0) score += 10;
    if (twelfthMarks && parseFloat(twelfthMarks) > 0) score += 10;
    if (hasSavedResume) score += 5; // Extra weight for attached resume
    return Math.min(score, 100);
  };

  const completeness = calculateCompleteness();

  if (!unlocked) {
    return (
      <div className="flex flex-1 flex-col justify-center items-center bg-background p-8 min-h-screen">
        <div className="max-w-md w-full border-2 border-border bg-background p-8 md:p-12 space-y-8">
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
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground flex-col md:flex-row">
      <div className="flex-1 bg-background p-8 md:p-12 space-y-12 max-w-5xl mx-auto w-full">
        
        {/* Page header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between border-b-2 border-border pb-8 gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-accent uppercase">
              <ShieldCheck size={16} className="text-accent" />
              <span>🔒 Vault Decrypted</span>
            </div>
            <h1 className="text-5xl font-extrabold tracking-tighter uppercase leading-none">
              STUDENT PROFILE
            </h1>
          </div>

          {/* Profile Completeness Meter */}
          <div className="space-y-2 md:w-64">
            <div className="flex justify-between text-xs font-bold tracking-wider uppercase">
              <span>VAULT COMPLETENESS</span>
              <span className={completeness === 100 ? "text-accent" : "text-amber-500"}>
                {completeness}% {completeness === 100 ? "✓ READY" : "✦ INCOMPLETE"}
              </span>
            </div>
            <div className="h-4 border-2 border-border bg-muted p-0.5">
              <div 
                className="h-full bg-accent transition-all duration-500" 
                style={{ width: `${completeness}%` }}
              />
            </div>
          </div>
        </div>

        {/* Global Block Notice if not complete */}
        {completeness < 100 && (
          <div className="border-2 border-amber-600 bg-amber-600/10 p-6 space-y-2">
            <div className="flex items-center gap-3 text-amber-500">
              <Lock size={20} className="animate-bounce" />
              <h4 className="text-sm font-black uppercase tracking-widest">
                ACCESS BLOCK ACTIVE (ONBOARDING INCOMPLETE)
              </h4>
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-tight leading-snug">
              To unlock placement drive matching, shortlist tracking, calendar sync, and AI analysis, please upload your resume PDF and complete all fields in this secure profile form.
            </p>
          </div>
        )}

        {/* Resume PDF Upload Zone */}
        <div className="border-2 border-dashed border-border p-6 bg-card space-y-6">
          <h3 className="text-sm font-extrabold uppercase tracking-widest text-accent flex items-center gap-2">
            <Upload size={16} />
            <span>1. Quick Profile Setup / Update Resume</span>
          </h3>
          <p className="text-xs text-muted-foreground uppercase tracking-tight leading-snug">
            Upload your standard PDF resume. The zero-knowledge extraction pipeline parses your name, cgpa, branches, scores, and skills, then auto-populates the fields below.
          </p>

          <form onSubmit={handleUploadResume} className="flex flex-col md:flex-row gap-4 items-stretch md:items-center">
            <label className="flex-1 flex items-center justify-between border-2 border-border h-14 px-4 bg-background cursor-pointer hover:border-accent transition-colors">
              <div className="flex items-center gap-3">
                <FileText size={18} className="text-muted-foreground" />
                <span className="text-xs font-bold uppercase truncate max-w-xs md:max-w-lg">
                  {file ? file.name : "SELECT PDF RESUME"}
                </span>
              </div>
              <span className="text-[10px] bg-muted px-2 py-1 text-muted-foreground font-black uppercase">
                BROWSE
              </span>
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>

            <button
              type="submit"
              disabled={!file || parsing}
              className="h-14 px-8 border-2 border-border bg-foreground text-background font-extrabold text-xs tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95 disabled:opacity-50"
            >
              {parsing ? "PARSING RESUME..." : "PARSE & AUTO-FILL"}
            </button>
          </form>

          {/* Resume status badge */}
          <div className="flex items-center gap-3 text-xs uppercase font-bold tracking-wider pt-2">
            {hasSavedResume ? (
              <span className="inline-flex items-center gap-1.5 text-accent">
                <CheckCircle2 size={14} />
                <span>Active Resume Secured (.PDF)</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-amber-500">
                <AlertCircle size={14} />
                <span>No Resume Attached. Upload to unlock eligibility checks.</span>
              </span>
            )}
          </div>
        </div>

        {success && (
          <div className="border-2 border-green-600 bg-green-600/10 p-4 text-xs font-bold text-green-600 uppercase tracking-wider flex items-center gap-2">
            <CheckCircle2 size={16} />
            <span>{success}</span>
          </div>
        )}

        {error && (
          <div className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-600 uppercase tracking-wider flex items-center gap-2">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Profile Editor Form */}
        <form onSubmit={handleSave} className="space-y-12">
          
          {/* Section 2: Public Information */}
          <div className="space-y-8">
            <h2 className="text-2xl font-bold tracking-tighter border-b border-border pb-2 uppercase text-foreground">
              2. PUBLIC USER INFO (Plaintext on server)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase block">
                  FULL NAME
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="E.G. SANJAY J K"
                  className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4 transition-colors"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase block">
                  BRANCH / MAJOR
                </label>
                <input
                  type="text"
                  required
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="E.G. CSE, ECE, MCA"
                  className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4 transition-colors"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase block">
                  BATCH YEAR
                </label>
                <input
                  type="number"
                  required
                  value={batchYear}
                  onChange={(e) => setBatchYear(Number(e.target.value))}
                  placeholder="2027"
                  className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold focus:border-accent focus:outline-none px-4 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Academic Credentials */}
          <div className="space-y-8">
            <h2 className="text-2xl font-bold tracking-tighter border-b border-border pb-2 uppercase text-foreground">
              3. ACADEMIC CREDENTIALS
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                    NEO ID (🔒 Encrypted on server)
                  </label>
                  <span className="text-[10px] text-muted-foreground">E.G. K9B8C7D6</span>
                </div>
                <input
                  type="text"
                  required
                  value={neoId}
                  onChange={(e) => setNeoId(e.target.value)}
                  placeholder="MANUAL ENTRY (ALTERNATING LETTER/DIGIT)"
                  className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4 transition-colors"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase block">
                  CGPA (Plaintext on server)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="10"
                  required
                  value={cgpa}
                  onChange={(e) => setCgpa(e.target.value)}
                  placeholder="E.G. 9.15"
                  className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold focus:border-accent focus:outline-none px-4 transition-colors"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase block">
                  10TH CLASS MARKS (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  required
                  value={tenthMarks}
                  onChange={(e) => setTenthMarks(e.target.value)}
                  placeholder="E.G. 95.0"
                  className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold focus:border-accent focus:outline-none px-4 transition-colors"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase block">
                  12TH CLASS MARKS (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  required
                  value={twelfthMarks}
                  onChange={(e) => setTwelfthMarks(e.target.value)}
                  placeholder="E.G. 92.4"
                  className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold focus:border-accent focus:outline-none px-4 transition-colors"
                />
              </div>

              <div className="md:col-span-2 flex items-center gap-4 h-14 border-2 border-border px-4 bg-muted/20">
                <input
                  type="checkbox"
                  id="arrears"
                  checked={hasArrears}
                  onChange={(e) => setHasArrears(e.target.checked)}
                  className="h-5 w-5 rounded-none border-2 border-border text-accent focus:ring-0 bg-transparent cursor-pointer"
                />
                <label htmlFor="arrears" className="text-xs font-bold uppercase tracking-wider cursor-pointer">
                  I currently have standing arrears (backlogs)
                </label>
              </div>
            </div>
          </div>

          {/* Section 4: Skills */}
          <div className="space-y-8">
            <h2 className="text-2xl font-bold tracking-tighter border-b border-border pb-2 uppercase text-foreground">
              4. SKILLS & EXPERTISE (Plaintext on server)
            </h2>
            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase block">
                SKILLS TAGS (COMMA SEPARATED)
              </label>
              <input
                type="text"
                required
                value={skillsStr}
                onChange={(e) => setSkillsStr(e.target.value)}
                placeholder="PYTHON, DSA, SQL, DOCKER, TYPESCRIPT"
                className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4 transition-colors"
              />
            </div>
          </div>

          {/* Form Submit */}
          <button
            type="submit"
            disabled={saving}
            className="flex items-center justify-center gap-3 w-full md:w-72 h-16 border-2 border-border bg-foreground text-background font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
          >
            <Save size={16} />
            <span>{saving ? "ENCRYPTING & SAVING..." : "SAVE PROFILE & RESUME"}</span>
          </button>

        </form>
      </div>
    </div>
  );
}
