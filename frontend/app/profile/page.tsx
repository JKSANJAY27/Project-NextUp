"use client";

import React, { useState, useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { decryptData, encryptData, deriveKey, exportKeyToHex } from "@/lib/crypto";
import api from "@/lib/api";
import { ShieldCheck, Unlock, Save } from "lucide-react";

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

  // Gmail Integration State
  const [gmailConnected, setGmailConnected] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // 1. Initial Load: Decrypt if key is already in memory
  useEffect(() => {
    if (user && encryptionKey) {
      decryptProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, encryptionKey]);

  useEffect(() => {
    if (unlocked) {
      fetchGmailStatus();
    }
  }, [unlocked]);

  const fetchGmailStatus = async () => {
    try {
      const res = await api.get("/gmail/status");
      setGmailConnected(res.data.connected);
      setLastSynced(res.data.last_synced);
    } catch (err) {
      console.error("Failed to fetch Gmail status:", err);
    }
  };

  const decryptProfile = async () => {
    if (!user || !encryptionKey) return;
    try {
      setFullName(user.full_name || "");
      setBranch(user.branch || "");
      setBatchYear(user.batch_year || new Date().getFullYear());
      setSkillsStr(user.skills ? user.skills.join(", ") : "");

      // Decrypt sensitive fields
      const dNeoId = user.neo_id_enc ? await decryptData(user.neo_id_enc, encryptionKey) : "";
      const dCgpa = user.cgpa_enc ? await decryptData(user.cgpa_enc, encryptionKey) : "";
      const dTenth = user.tenth_marks_enc ? await decryptData(user.tenth_marks_enc, encryptionKey) : "";
      const dTwelfth = user.twelfth_marks_enc ? await decryptData(user.twelfth_marks_enc, encryptionKey) : "";
      const dArrears = user.has_arrears_enc ? await decryptData(user.has_arrears_enc, encryptionKey) : "false";

      setNeoId(dNeoId);
      setCgpa(dCgpa);
      setTenthMarks(dTenth);
      setTwelfthMarks(dTwelfth);
      setHasArrears(dArrears === "true");
      setUnlocked(true);
    } catch {
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
      // Fetch salt
      const saltRes = await api.get(`/auth/salt?email=${encodeURIComponent(user.email)}`);
      const { email_salt } = saltRes.data;

      // Derive key
      const key = await deriveKey(unlockPassword, email_salt);
      const keyHex = await exportKeyToHex(key);

      // Verify key is correct by attempting to decrypt neo_id_enc (if it exists)
      if (user.neo_id_enc) {
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

  // Connect Gmail Auth
  const handleConnectGmail = async () => {
    setError("");
    setSuccess("");
    try {
      const res = await api.get("/gmail/auth-url");
      const { auth_url } = res.data;
      if (auth_url === "mock-oauth-flow") {
        await api.post("/gmail/mock-connect");
        setSuccess("MOCK COLLEGE GMAIL CONNECTED SUCCESSFULLY.");
        fetchGmailStatus();
      } else {
        window.location.href = auth_url;
      }
    } catch {
      setError("FAILED TO RETRIEVE GOOGLE AUTHORIZATION ENDPOINT.");
    }
  };

  // Manual Gmail Sync
  const handleSyncNow = async () => {
    setSyncing(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.post("/gmail/sync");
      setSuccess(res.data.message || "GMAIL SYNC SUCCESSFUL.");
      fetchGmailStatus();
    } catch (err) {
      let message = "GMAIL SYNCHRONIZATION FAILED.";
      if (err && typeof err === "object" && "response" in err) {
        const resObj = (err as { response?: { data?: { detail?: string } } }).response;
        if (resObj?.data?.detail) {
          message = resObj.data.detail;
        }
      }
      setError(message);
    } finally {
      setSyncing(false);
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

    // Neo ID validator
    // Alternating letter/digit, length 8. E.g. F4O0V3W3
    const neoIdClean = neoId.trim().toUpperCase();
    const neoIdRegex = /^[A-Z]\d[A-Z]\d[A-Z]\d[A-Z]\d$/;
    if (neoIdClean && !neoIdRegex.test(neoIdClean)) {
      setError("INVALID NEO ID FORMAT. MUST BE 8 CHARACTERS ALTERNATING LETTER & DIGIT (E.G. F4O0V3W3).");
      setSaving(false);
      return;
    }

    try {
      // 1. Encrypt sensitive fields
      const encNeoId = await encryptData(neoIdClean, encryptionKey);
      const encCgpa = await encryptData(cgpa.trim(), encryptionKey);
      const encTenth = await encryptData(tenthMarks.trim(), encryptionKey);
      const encTwelfth = await encryptData(twelfthMarks.trim(), encryptionKey);
      const encArrears = await encryptData(hasArrears ? "true" : "false", encryptionKey);

      // Parse skills
      const skillsArray = skillsStr
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");

      // 2. Send request to update user profile
      const res = await api.put("/users/me", {
        full_name: fullName.trim(),
        branch: branch.trim().toUpperCase(),
        batch_year: Number(batchYear),
        skills: skillsArray,
        neo_id_enc: encNeoId,
        cgpa_enc: encCgpa,
        tenth_marks_enc: encTenth,
        twelfth_marks_enc: encTwelfth,
        has_arrears_enc: encArrears,
      });

      setUser(res.data);
      setSuccess("PROFILE SAVED & ENCRYPTED SUCCESSFULLY.");
    } catch (err) {
      let message = "FAILED TO SAVE PROFILE.";
      if (err && typeof err === "object" && "response" in err) {
        const resObj = (err as { response?: { data?: { detail?: string } } }).response;
        if (resObj?.data?.detail) {
          message = resObj.data.detail;
        }
      }
      setError(message);
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
              Your placement information is stored as ciphertext on the database. Enter your password to derive the decryption key in-memory.
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
              <span>{unlockLoading ? "UNLOCKING..." : "UNLOCK VAULT"}
              </span>
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

        {/* Section 2: Encrypted Information */}
        <div className="space-y-8">
          <div className="flex items-center gap-3 border-b border-border pb-2">
            <h2 className="text-2xl font-bold tracking-tighter uppercase">
              ACADEMIC CREDENTIALS
            </h2>
            <span className="bg-muted px-2 py-1 text-[10px] font-extrabold tracking-widest border border-border text-accent uppercase">
              🔒 CLIENT ENCRYPTED
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex justify-between">
                <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                  NEO ID
                </label>
                <span className="text-[10px] text-muted-foreground">E.G. F4O0V3W3</span>
              </div>
              <input
                type="text"
                required
                value={neoId}
                onChange={(e) => setNeoId(e.target.value)}
                placeholder="F4O0V3W3"
                className="w-full h-14 border-2 border-border bg-transparent text-sm font-bold uppercase focus:border-accent focus:outline-none px-4 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                CGPA
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

        {/* Section 4: Gmail Integration */}
        <div className="space-y-8">
          <h2 className="text-2xl font-bold tracking-tighter border-b border-border pb-2 uppercase">
            COLLEGE GMAIL SYNC AUTOMATION
          </h2>
          <div className="border-2 border-border p-6 bg-card space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">CONNECTION STATUS</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`h-2.5 w-2.5 rounded-none ${gmailConnected ? "bg-green-600" : "bg-red-600"}`} />
                  <span className="text-sm font-black uppercase">
                    {gmailConnected ? "CONNECTED" : "NOT CONNECTED"}
                  </span>
                </div>
                {lastSynced && (
                  <p className="text-[10px] text-muted-foreground uppercase font-mono mt-1">
                    LAST SYNCED: {new Date(lastSynced).toLocaleString("en-IN")}
                  </p>
                )}
              </div>

              <div className="flex gap-4">
                {!gmailConnected ? (
                  <button
                    type="button"
                    onClick={handleConnectGmail}
                    className="h-12 px-6 border-2 border-accent bg-accent text-black font-extrabold text-xs tracking-widest uppercase hover:bg-transparent hover:text-accent transition-colors"
                  >
                    CONNECT VIT GMAIL
                  </button>
                ) : (
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={handleSyncNow}
                      disabled={syncing}
                      className="h-12 px-6 border-2 border-border bg-foreground text-background font-extrabold text-xs tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95 disabled:opacity-50"
                    >
                      {syncing ? "SYNCING..." : "SYNC NOW"}
                    </button>
                    <button
                      type="button"
                      onClick={handleConnectGmail}
                      className="h-12 px-6 border-2 border-border bg-transparent text-foreground font-extrabold text-xs tracking-widest uppercase hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors"
                    >
                      RECONNECT
                    </button>
                  </div>
                )}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-tight leading-snug">
              Securely polls your VIT Gmail box in the background for placement announcements from <code className="text-foreground">noreply.cdcinfo@vit.ac.in</code>. Syncing only runs while you are actively logged in.
            </p>
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
