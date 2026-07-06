// Supabase Edge Function: ingest-email
// Runtime: Deno (TypeScript)
//
// INGEST-ONLY by design. This function used to run a duplicate regex "fast
// path" that created companies/events directly (taking the FIRST LINE of the
// email body as the company name, with no update-vs-announcement routing and
// a fingerprint format the Python worker could never match). That produced
// junk drives like "*Visteon next round of selection process is scheduled...*".
//
// All parsing, company matching, update routing, shortlist processing and
// guard rails live in the Python worker, which is triggered immediately via
// PYTHON_WORKER_TRIGGER_URL and also drains the queue on a 5-minute cron.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // 3. Dedup: the Apps Script tracker only remembers the last ~100 message
    // IDs, so re-ingestion is possible — skip if this message is already queued.
    const { data: existing } = await supabaseClient
      .from("raw_ingestion_jobs")
      .select("id")
      .eq("payload->>message_id", message_id)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ status: "duplicate", message: "Message already ingested.", job_id: existing.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Save raw payload to the ingestion queue (the Python worker parses it)
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
      .select("id")
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

    // 6. Fire webhook to trigger the Python parsing worker asynchronously.
    // The backend requires the shared INGEST_AUTH_TOKEN on its trigger
    // endpoints (they start multi-minute LLM parses).
    const workerTriggerUrl = Deno.env.get("PYTHON_WORKER_TRIGGER_URL");
    if (workerTriggerUrl) {
      fetch(workerTriggerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${systemAuthToken}`,
        },
        body: JSON.stringify({ job_id: job.id })
      }).catch(err => console.warn("Failed to fire async worker trigger webhook:", err));
    }

    return new Response(
      JSON.stringify({ status: "success", message: "Email queued for parsing.", job_id: job.id }),
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
