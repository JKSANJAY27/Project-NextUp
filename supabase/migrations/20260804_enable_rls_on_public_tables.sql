-- Security hardening: prevent public Data API access to application tables.
--
-- NextUp's browser uses Supabase only for Auth; all application data is read
-- and written through the authenticated FastAPI backend. Enabling RLS without
-- permissive client policies is therefore intentional: anon/authenticated
-- Data API requests are denied unless an explicit policy is added later.
--
-- This covers every current and future base table in the exposed `public`
-- schema, including tables introduced after the original RLS migration.
-- Existing restrictive policies remain unchanged.
DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$$;

-- Verify after applying: this query must return zero rows.
-- SELECT tablename
-- FROM pg_tables
-- WHERE schemaname = 'public' AND NOT rowsecurity;
