// Supabase Edge Function: ingest-email
// Runtime: Deno (TypeScript)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to calculate SHA-256 hash
async function sha256(text: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

serve(async (req) => {
  // Handle CORS Preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", // Service role bypasses RLS for system ingestion
      { auth: { persistSession: false } }
    );

    const body = await req.json();
    const { message_id, sender, subject, body: emailBody, timestamp, attachments, auth_token } = body;

    // 1. Verify custom webhook authorization token
    const systemAuthToken = Deno.env.get("INGEST_AUTH_TOKEN");
    if (!systemAuthToken || auth_token !== systemAuthToken) {
      return new Response(
        JSON.stringify({ error: "Unauthorized ingestion token verification failed." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!message_id || !sender || !emailBody) {
      return new Response(
        JSON.stringify({ error: "Missing required payload parameters (message_id, sender, body)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Identify the Ingestion Source matching the sender
    const emailMatch = sender.match(/<([^>]+)>/) || [null, sender];
    const senderEmail = (emailMatch[1] || sender).trim().toLowerCase();

    const { data: source, error: sourceError } = await supabaseClient
      .from("ingestion_sources")
      .select("id")
      .eq("email", senderEmail)
      .eq("is_active", true)
      .maybeSingle();

    if (sourceError) {
      console.error("Failed to query ingestion_sources:", sourceError);
    }

    const sourceId = source ? source.id : null;

    // 3. Immediately parse email body to insert/update Company, Event, and Attachments
    // This makes sure data is stored and visible on the dashboard even if local python worker is offline.
    
    // Exact same extraction logic as Python Regex

    // Generic company name guard — must match Python is_generic_company_name()
    const GENERIC_COMPANY_NAMES = new Set([
      "unknown company", "unknown", "",
      "super dream", "dream", "regular", "mass recruiter", "internship",
      "super dream internship", "dream internship", "dream placement",
      "regular internship", "summer intern", "summer internship",
      "super dream placement", "dream offer",
      "congratulations", "congrats", "dear students", "dear student",
      "kind attention", "kind attn", "hi", "hello",
      "placement", "hiring", "recruitment drive", "campus recruitment",
      "campus drive", "selection process", "next round", "next round of selection process",
      "vit", "vellore", "vit vellore", "cdc", "training and placement",
      "vit placement", "vit bhopal", "vit ap", "vit chennai",
      "registration open", "registration", "apply now", "apply",
      "2025 batch", "2026 batch", "2027 batch", "2028 batch",
      "n/a", "na", "nil", "-",
    ]);

    function isGenericCompanyName(name: string): boolean {
      if (!name) return true;
      const cleaned = name.replace(/[*#_\-–—\s]+/g, " ").trim().toLowerCase();
      if (GENERIC_COMPANY_NAMES.has(cleaned)) return true;
      if (/^\d+$/.test(cleaned)) return true;
      if (/^(?:super\s+dream|dream|regular|mass\s+recruiter|internship)/.test(cleaned)) return true;
      if (cleaned.length < 2) return true;
      return false;
    }

    let companyName = "Unknown Company";
    const compMatch = emailBody.match(/(?:Name of the Company|Company Name|Company|Name of the Organisation|Organisation):\s*([^\n\r]+)/i);
    if (compMatch) {
      companyName = compMatch[1].trim();
    } else {
      const lines = emailBody.split("\n").map(l => l.trim()).filter(l => l);
      if (lines.length > 0) {
        companyName = lines[0].replace(/\*\*/g, "").trim();
      }
    }
    companyName = companyName.substring(0, 255);


    let role = "Software Engineer";
    const roleMatch = emailBody.match(/(?:Designation|Role|Job Title|Profile):\s*([^\n\r]+)/i);
    if (roleMatch) {
      role = roleMatch[1].trim().substring(0, 255);
    }

    let category = "Dream";
    const catMatch = emailBody.match(/(Dream\s*Internship|Super\s*Dream|Mass\s*Recruiter|Dream\s*Offer|Dream|Regular)/i);
    if (catMatch) {
      const cat = catMatch[1].toLowerCase();
      if (cat.includes("super")) category = "Super Dream";
      else if (cat.includes("mass")) category = "Mass Recruiter";
      else if (cat.includes("internship")) category = "Internship";
      else category = "Dream";
    }

    let ctc = null;
    const ctcMatch = emailBody.match(/(?:CTC|Salary|Package):\s*([^\n\r]+)/i);
    if (ctcMatch) {
      ctc = ctcMatch[1].trim().substring(0, 100);
    } else {
      const ctcNumMatch = emailBody.match(/(\d+(?:\.\d+)?\s*(?:LPA|Lakhs|Lakh|INR|Rs\.?))/i);
      if (ctcNumMatch) {
        ctc = ctcNumMatch[1].trim().substring(0, 100);
      }
    }

    let stipend = null;
    const stipendMatch = emailBody.match(/(?:Stipend|Internship stipend):\s*([^\n\r]+)/i);
    if (stipendMatch) {
      stipend = stipendMatch[1].trim().substring(0, 100);
    } else {
      const stipendNumMatch = emailBody.match(/(?:Rs\.?|INR|₹)?\s*(\d+(?:\.\d+)?\s*(?:pm|K|k|thousand|per month))/i);
      if (stipendNumMatch) {
        stipend = stipendNumMatch[1].trim().substring(0, 100);
      }
    }

    let location = null;
    const locMatch = emailBody.match(/(?:Job Location|Location|Work Location):\s*([^\n\r]+)/i);
    if (locMatch) {
      location = locMatch[1].trim().substring(0, 255);
    }

    let minCgpa = null;
    const cgpaMatch = emailBody.match(/(?:min(?:imum)?\s*CGPA\s*(?:of)?\s*(\d+(?:\.\d+)?))|(\d+(?:\.\d+)?)\s*(?:CGPA|or above CGPA|or higher CGPA)/i);
    if (cgpaMatch) {
      const cgpaStr = cgpaMatch[1] || cgpaMatch[2];
      const parsedVal = parseFloat(cgpaStr);
      if (!isNaN(parsedVal)) {
        minCgpa = parsedVal;
      }
    }

    const arrearsMatch = emailBody.match(/(No\s+Standing\s+Arrears|No\s+active\s+backlogs|No\s+backlogs|No\s+standing\s+backlogs)/i);
    const requiresNoArrears = arrearsMatch ? true : false;

    let deadline = null;
    const deadlineMatch = emailBody.match(/(?:Last date for Registration|Last Date to Apply|Registration Deadline|Last Date|Deadline):\s*([^\n\r]+)/i);
    if (deadlineMatch) {
      const rawDate = deadlineMatch[1].trim();
      const parsedTime = Date.parse(rawDate);
      if (!isNaN(parsedTime)) {
        deadline = new Date(parsedTime).toISOString();
      }
    }

    let regLink = null;
    const linkMatch = emailBody.match(/(?:Register|Apply|Registration Link):\s*(https?:\/\/[^\s\)]+)/i);
    if (linkMatch) {
      regLink = linkMatch[1].trim();
    } else {
      const urls = emailBody.match(/(https?:\/\/[^\s\)]+)/g);
      if (urls) {
        for (const url of urls) {
          const lUrl = url.toLowerCase();
          if (lUrl.includes("register") || lUrl.includes("apply") || lUrl.includes("form") || lUrl.includes("google") || lUrl.includes("cdc") || lUrl.includes("vtop")) {
            regLink = url;
            break;
          }
        }
      }
    }

    let eligibleBranches: string[] = [];
    const branchesMatch = emailBody.match(/(?:Eligible Branches|Eligibility Branches|Branches):\s*([^\n\r]+)/i);
    if (branchesMatch) {
      const rawB = branchesMatch[1];
      const found = rawB.match(/(CSE|IT|ECE|EEE|MECH|CIVIL|SWE|MCA|MTECH)/gi);
      if (found) {
        eligibleBranches = Array.from(new Set(found.map(b => b.toUpperCase())));
      }
    }

    // Determine Batch Year
    let batchYear = new Date().getFullYear();
    const yearMatch = (subject + " " + emailBody).match(/\b(202\d)\b/);
    if (yearMatch) {
      batchYear = parseInt(yearMatch[1], 10);
    }

    // Determine recruitment cycle
    let recruitmentCycle = "Default";
    const cycleMatch = (subject + " " + emailBody).match(/\b(Internship|Full-Time|Placement|Summer Intern)\b/i);
    if (cycleMatch) {
      recruitmentCycle = cycleMatch[1];
    }

    // Only create/update company workspace if we have a valid company name
    let company: { id: string } | null = null;
    let event: { id: string } | null = null;

    if (!isGenericCompanyName(companyName)) {
      // Calculate Fingerprint
      const fingerprintInput = `${companyName.toUpperCase()}|${role.toUpperCase()}|${category.toUpperCase()}|${batchYear}|${recruitmentCycle.toUpperCase()}`;
      const encoder = new TextEncoder();
      const data = encoder.encode(fingerprintInput);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const fingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Create or find Company
      const { data: existingCompany } = await supabaseClient
        .from("companies")
        .select("id")
        .eq("fingerprint", fingerprint)
        .maybeSingle();

      const eligibilityRules = {
        min_cgpa: minCgpa,
        min_tenth_marks: null,
        min_twelfth_marks: null,
        requires_no_arrears: requiresNoArrears
      };

      const companyData = {
        name: companyName,
        role: role,
        category: category,
        ctc: ctc,
        stipend: stipend,
        job_location: location,
        eligible_branches: eligibleBranches,
        eligibility_rules: eligibilityRules,
        registration_deadline: deadline,
        registration_link: regLink,
        recruitment_cycle: recruitmentCycle,
        fingerprint: fingerprint
      };

      if (existingCompany) {
        company = existingCompany;
        const { error: updateError } = await supabaseClient
          .from("companies")
          .update(companyData)
          .eq("id", company.id);
        if (updateError) {
          console.error("Failed to update company:", updateError);
        }
      } else {
        const { data: newCompany, error: insertError } = await supabaseClient
          .from("companies")
          .insert(companyData)
          .select()
          .single();
        if (insertError) {
          console.error("Failed to insert company:", insertError);
        } else {
          company = newCompany;
        }
      }

      if (company) {
        // Determine Event Type
        const lSubject = subject.toLowerCase();
        const lBody = emailBody.toLowerCase();
        let eventType = "REGISTRATION";
        if (lSubject.includes("shortlist") || lBody.includes("shortlist")) {
          eventType = "SHORTLIST";
        } else if (lSubject.includes("online test") || lSubject.includes("assessment") || lSubject.includes(" oa ")) {
          eventType = "OA";
        } else if (lSubject.includes("interview") || lSubject.includes("schedule")) {
          eventType = "INTERVIEW";
        } else if (lSubject.includes("offer") || lSubject.includes("congratulations")) {
          eventType = "OFFER";
        }

        const eventTimestamp = new Date(timestamp).toISOString();

        const { data: existingEvent } = await supabaseClient
          .from("company_events")
          .select("id")
          .eq("company_id", company.id)
          .eq("event_type", eventType)
          .eq("subject", subject)
          .eq("timestamp", eventTimestamp)
          .maybeSingle();

        if (!existingEvent) {
          const { data: newEvent, error: insertEventError } = await supabaseClient
            .from("company_events")
            .insert({
              company_id: company.id,
              event_type: eventType,
              subject: subject,
              sender: sender,
              body: emailBody,
              timestamp: eventTimestamp
            })
            .select()
            .single();
          if (insertEventError) {
            console.error("Failed to insert event:", insertEventError);
          } else {
            event = newEvent;
          }
        } else {
          event = existingEvent;
        }
      }
    } else {
      console.log(`Skipping company/event workspace for generic name: "${companyName}". Python worker will resolve.`);
    }

    // Upload and record attachments metadata (only if we have a valid event)
    if (event) {
      for (const att of (attachments || [])) {
        const { data: existingAtt } = await supabaseClient
          .from("attachments_metadata")
          .select("id")
          .eq("company_event_id", event.id)
          .eq("file_name", att.filename)
          .maybeSingle();

        if (!existingAtt) {
          const storagePath = `attachments/${event.id}/${att.filename}`;
          let uploadSuccess = false;
          try {
            const binaryString = atob(att.base64_data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }

            const { error: uploadError } = await supabaseClient
              .storage
              .from("attachments")
              .upload(storagePath, bytes, {
                contentType: att.content_type,
                upsert: true
              });

            if (!uploadError) {
              uploadSuccess = true;
            } else {
              console.warn("Storage upload error:", uploadError.message);
            }
          } catch (storageErr) {
            console.warn("Failed to upload binary to storage:", storageErr);
          }

          const fileType = att.filename.toLowerCase().endsWith(".pdf") ? "JD_PDF" : "SHORTLIST_EXCEL";
          await supabaseClient
            .from("attachments_metadata")
            .insert({
              company_event_id: event.id,
              file_name: att.filename,
              file_type: fileType,
              storage_path: uploadSuccess ? storagePath : null,
              parsed_meta: {}
            });
        }
      }
    }

    // 4. Save raw payload to Ingestion Job buffer for background parsing/enriching (worker pulls this)
    const { data: job, error: jobError } = await supabaseClient
      .from("raw_ingestion_jobs")
      .insert({
        source_id: sourceId,
        status: "pending",
        payload: {
          message_id,
          sender,
          sender_email: senderEmail,
          subject,
          body: emailBody,
          timestamp,
          attachments: attachments || []
        }
      })
      .select()
      .single();

    if (jobError) {
      throw new Error(`Database queue insertion failed: ${jobError.message}`);
    }

    // 5. Update the Sync Timestamp on the Source
    if (sourceId) {
      await supabaseClient
        .from("ingestion_sources")
        .update({ last_sync: new Date().toISOString() })
        .eq("id", sourceId);
    }

    // 6. Fire webhook to trigger external Python parsing worker asynchronously (if available)
    const workerTriggerUrl = Deno.env.get("PYTHON_WORKER_TRIGGER_URL");
    if (workerTriggerUrl) {
      fetch(workerTriggerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: job.id })
      }).catch(err => console.warn("Failed to fire async worker trigger webhook:", err));
    }

    return new Response(
      JSON.stringify({ status: "success", message: "Email payload ingested and companies populated.", job_id: job.id }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("Ingestion webhook error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error occurred." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
