import { createClient } from "@supabase/supabase-js";

// Use placeholders during build time if environment variables are not provided to prevent prerender crash.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE1OTg4NzQ5OTksImV4cCI6MTkwNDQ1MDk5OX0.dummy";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
