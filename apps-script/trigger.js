/**
 * Project Nextup: Google Apps Script Mailbox Sync Trigger
 * 
 * Instructions:
 * 1. Open Google Sheets / Google Drive under the Department Representative Gmail account.
 * 2. Create a new Google Apps Script.
 * 3. Copy this code into the editor.
 * 4. Configure Script Properties (Project Settings > Script Properties):
 *    - SUPABASE_URL: Your Supabase project API URL (e.g. https://your-project.supabase.co)
 *    - SUPABASE_ANON_KEY: Your Supabase anon public API key
 *    - INGEST_AUTH_TOKEN: A custom secret token shared between this script and Supabase Edge Function to prevent abuse.
 * 5. Set up a Time-driven trigger (Triggers icon > Add Trigger):
 *    - Choose function: checkPlacementsMail
 *    - Select event source: Time-driven
 *    - Select type of time based trigger: Minutes timer
 *    - Select minute interval: Every 5 minutes
 */

function checkPlacementsMail() {
  var properties = PropertiesService.getScriptProperties();
  var supabaseUrl = properties.getProperty("SUPABASE_URL");
  var anonKey = properties.getProperty("SUPABASE_ANON_KEY");
  var authToken = properties.getProperty("INGEST_AUTH_TOKEN");

  if (!supabaseUrl || !anonKey) {
    Logger.log("Missing Supabase configuration script properties.");
    return;
  }

  // 1. Retrieve rolling tracking properties
  var lastProcessedTimestamp = parseInt(properties.getProperty("LAST_PROCESSED_TIMESTAMP") || "0", 10);
  var processedIdsJson = properties.getProperty("LAST_PROCESSED_MESSAGE_IDS") || "[]";
  var processedIds = JSON.parse(processedIdsJson);

  // Keep the processed IDs sliding array capped at the 100 most recent items
  if (!Array.isArray(processedIds)) {
    processedIds = [];
  }

  // 2. Query Gmail for placement cell emails (last 48 hours to save search overhead)
  var searchFilter = 'from:(noreply.cdcinfo@vit.ac.in OR cdc@vit.ac.in) subject:(Dream OR "Super Dream" OR Shortlisted OR "Online Test" OR "Interview Schedule" OR "Offer")';
  var threads = GmailApp.search(searchFilter, 0, 20);

  var newMessagesToProcess = [];
  var maxTimestampFound = lastProcessedTimestamp;

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j++) {
      var msg = messages[j];
      var msgId = msg.getId();
      var msgTime = msg.getDate().getTime();

      // Filter out messages already processed by timestamp and ID
      if (msgTime >= lastProcessedTimestamp && processedIds.indexOf(msgId) === -1) {
        newMessagesToProcess.push({
          messageObject: msg,
          timestamp: msgTime,
          id: msgId
        });
      }
    }
  }

  // Sort messages oldest first to maintain correct timeline insertion order
  newMessagesToProcess.sort(function(a, b) {
    return a.timestamp - b.timestamp;
  });

  Logger.log("Found " + newMessagesToProcess.length + " new placement announcements to ingest.");

  // 3. Process and forward each new message
  for (var k = 0; k < newMessagesToProcess.length; k++) {
    var item = newMessagesToProcess[k];
    var currentMsg = item.messageObject;

    try {
      // Extract attachments
      var attachments = currentMsg.getAttachments();
      var processedAttachments = [];

      for (var a = 0; a < attachments.length; a++) {
        var att = attachments[a];
        processedAttachments.push({
          filename: att.getName(),
          content_type: att.getContentType(),
          base64_data: Utilities.base64Encode(att.getBytes())
        });
      }

      var payload = {
        message_id: item.id,
        sender: currentMsg.getFrom(),
        subject: currentMsg.getSubject(),
        body: currentMsg.getPlainBody(),
        timestamp: currentMsg.getDate().toISOString(),
        attachments: processedAttachments,
        auth_token: authToken
      };

      // Post to Supabase Edge Function Webhook
      var options = {
        method: "post",
        contentType: "application/json",
        headers: {
          "apikey": anonKey,
          "Authorization": "Bearer " + anonKey
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };

      var endpointUrl = supabaseUrl.replace(/\/$/, "") + "/functions/v1/ingest-email";
      var response = UrlFetchApp.fetch(endpointUrl, options);
      var responseCode = response.getResponseCode();

      if (responseCode === 200 || responseCode === 201) {
        Logger.log("Successfully ingested message ID: " + item.id);

        // Update sliding window arrays and timestamps on success
        processedIds.push(item.id);
        if (processedIds.length > 100) {
          processedIds.shift(); // Keep only the last 100 IDs
        }

        if (item.timestamp > maxTimestampFound) {
          maxTimestampFound = item.timestamp;
        }
      } else {
        Logger.log("Supabase ingestion failed for message " + item.id + " with status: " + responseCode + " - " + response.getContentText());
      }

    } catch (err) {
      Logger.log("Failed to process message " + item.id + ": " + err.toString());
    }
  }

  // 4. Save state back to script properties
  properties.setProperty("LAST_PROCESSED_TIMESTAMP", maxTimestampFound.toString());
  properties.setProperty("LAST_PROCESSED_MESSAGE_IDS", JSON.stringify(processedIds));
}
