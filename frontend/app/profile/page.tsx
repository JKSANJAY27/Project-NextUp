"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useAppStore } from "@/lib/store";
import { decryptData, encryptData, deriveKey, exportKeyToHex } from "@/lib/crypto";
import api from "@/lib/api";
import { ShieldCheck, Unlock, Save } from "lucide-react";

async function getDeterministicSalt(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.trim().toLowerCase());
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function ProfilePage() {
  const { user, setUser, encryptionKey, setEncryptionKey } = useAppStore();
  const [unlocked, setUnlocked] = useState(false);
  
  // Unlock Form State
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlockLoading, setUnlockLoading] = useState(false);

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
      setCgpa(user.cgpa !== null && user.cgpa !== undefined ? String(user.cgpa) : "");
      setTenthMarks(user.tenth_marks !== null && user.tenth_marks !== undefined ? String(user.tenth_marks) : "");
      setTwelfthMarks(user.twelfth_marks !== null && user.twelfth_marks !== undefined ? String(user.twelfth_marks) : "");
      setHasArrears(user.has_arrears || false);

      // Decrypt sensitive Neo ID field
      const dNeoId = user.neo_id_enc && user.neo_id_enc !== "UNSET" 
        ? await decryptData(user.neo_id_enc, encryptionKey) 
        : "";

      setNeoId(dNeoId);
      setUnlocked(true);
    } catch (err) {
      console.error("Decryption error:", err);
      setError("FAILED TO DECRYPT VAULT DATA. PLEASE RE-LOGIN.");
    }
  };

  // Handle Vault Unlock if key is missing from memory
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError("");
    setUnlockLoading(true);

    if (!user) return;

    try {
      // Derive salt deterministically
      const emailSalt = await getDeterministicSalt(user.email);

      // Derive key
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

  // Save profile edits
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

      // 2. Send request to update user profile with plaintext parameters and encrypted Neo ID
      const res = await api.put("/users/me", {
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

      setUser(res.data);
      setSuccess("PROFILE SAVED & ENCRYPTED SUCCESSFULLY.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(err.response?.data?.detail || "FAILED TO SAVE PROFILE.");
    } finally {
      setSaving(false);
    }
  };

  // Calculate profile completeness
  const calculateCompleteness = () => {
    let score = 0;
    if (fullName) score += 10;
    if (branch) score += 10;
    if (batchYear) score += 10;
    if (skillsStr) score += 15;
    if (neoId) score += 15;
    if (cgpa) score += 15;
    if (tenthMarks) score += 10;
    if (twelfthMarks) score += 10;
    return score;
  };

  const completeness = calculateCompleteness();

  if (!unlocked) {
    return (
      <div className="flex flex-1 flex-col justify-center items-center bg-background p-8">
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
    <div className="flex-1 bg-background p-8 md:p-12 space-y-12">
      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between border-b-2 border-border pb-8 gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-accent uppercase">
            <ShieldCheck size={16} />
            <span>🔒 Vault Decrypted</span>
          </div>
          <h1 className="text-5xl font-extrabold tracking-tighter uppercase leading-none">
            STUDENT PROFILE
          </h1>
        </div>

        {/* Profile Completeness Meter */}
        <div className="space-y-2 md:w-64">
          <div className="flex justify-between text-xs font-bold tracking-wider uppercase">
            <span>COMPLETENESS</span>
            <span>{completeness}%</span>
          </div>
          <div className="h-4 border-2 border-border bg-muted p-0.5">
            <div 
              className="h-full bg-accent transition-all duration-500" 
              style={{ width: `${completeness}%` }}
            />
          </div>
        </div>
      </div>

      {/* Onboarding Tip / Quick Resume Upload */}
      <div className="border-2 border-dashed border-border p-6 bg-card space-y-4">
        <h3 className="text-sm font-extrabold uppercase tracking-widest text-accent">
          🚀 QUICK PROFILE SETUP VIA RESUME PARSING
        </h3>
        <p className="text-xs text-muted-foreground uppercase tracking-tight leading-snug">
          Instead of filling all academic details manually, you can upload your standard PDF resume. The system will parse metrics (Name, CGPA, Branch, Marks, Skills) in-memory on-the-fly and automatically populate them into your profile.
        </p>
        <Link 
          href="/resume" 
          className="inline-flex items-center justify-center h-12 px-6 border-2 border-border bg-foreground text-background font-extrabold text-xs tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent transition-all"
        >
          GO TO RESUME ENGINE & UPLOAD
        </Link>
      </div>

      {success && (
        <div className="border-2 border-green-600 bg-green-600/10 p-4 text-xs font-bold text-green-600 uppercase tracking-wider">
          {success}
        </div>
      )}

      {error && (
        <div className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-600 uppercase tracking-wider">
          {error}
        </div>
      )}

      {/* Profile Editor Form */}
      <form onSubmit={handleSave} className="space-y-12 max-w-4xl">
        
        {/* Section 1: Public Information */}
        <div className="space-y-8">
          <h2 className="text-2xl font-bold tracking-tighter border-b border-border pb-2 uppercase">
            PUBLIC USER INFO (Plaintext on server)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                FULL NAME
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="JOHN DOE"
                className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4 transition-colors"
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                BRANCH / MAJOR
              </label>
              <input
                type="text"
                required
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="E.G. CSE, ECE"
                className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                BATCH YEAR
              </label>
              <input
                type="number"
                required
                value={batchYear}
                onChange={(e) => setBatchYear(Number(e.target.value))}
                placeholder="2026"
                className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold focus:border-accent focus:outline-none px-4 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Academic Credentials */}
        <div className="space-y-8">
          <div className="flex items-center gap-3 border-b border-border pb-2">
            <h2 className="text-2xl font-bold tracking-tighter uppercase">
              ACADEMIC CREDENTIALS
            </h2>
          </div>

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
                placeholder="K9B8C7D6"
                className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
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
                placeholder="8.50"
                className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold focus:border-accent focus:outline-none px-4 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
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
                placeholder="95.0"
                className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold focus:border-accent focus:outline-none px-4 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
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
                placeholder="92.4"
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

        {/* Section 3: Skills */}
        <div className="space-y-8">
          <h2 className="text-2xl font-bold tracking-tighter border-b border-border pb-2 uppercase">
            SKILLS & EXPERTISE (Plaintext on server)
          </h2>
          <div className="space-y-2">
            <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              SKILLS TAGS (COMMA SEPARATED)
            </label>
            <input
              type="text"
              value={skillsStr}
              onChange={(e) => setSkillsStr(e.target.value)}
              placeholder="PYTHON, DSA, SQL, DOCKER, TYPESCRIPT"
              className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4 transition-colors"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="flex items-center justify-center gap-3 w-full md:w-64 h-16 border-2 border-border bg-foreground text-background font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
        >
          <Save size={16} />
          <span>{saving ? "ENCRYPTING & SAVING..." : "SAVE PROFILE INFO"}</span>
        </button>

      </form>
    </div>
  );
}
