-- Project Nextup Database Schema (Supabase / PostgreSQL)

-- 1. Core Users (Integrates with Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) DEFAULT 'student' CHECK (role IN ('student', 'coordinator', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trigger to automatically copy new users from auth.users to public.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, role, created_at)
  VALUES (new.id, new.email, 'student', COALESCE(new.created_at, CURRENT_TIMESTAMP));
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Ingestion Sources Registry
CREATE TABLE IF NOT EXISTS ingestion_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_name VARCHAR(100) NOT NULL,
    department VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    expected_sync_interval_minutes INT DEFAULT 1440, -- default 24 hours
    last_sync TIMESTAMP WITH TIME ZONE,
    error_log TEXT
);

-- 3. Raw Ingestion Queue Buffer
CREATE TABLE IF NOT EXISTS raw_ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES ingestion_sources(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
    payload JSONB NOT NULL,
    retry_count INT DEFAULT 0,
    locked_at TIMESTAMP WITH TIME ZONE,
    locked_by VARCHAR(255),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE
);

-- 4. Student Profiles (Hybrid Privacy Model)
CREATE TABLE IF NOT EXISTS student_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    branch VARCHAR(100) NOT NULL,
    batch_year INT NOT NULL,
    neo_id_enc TEXT NOT NULL,
    neo_id_hash VARCHAR(64) UNIQUE NOT NULL, -- HMAC-SHA256 blind index
    cgpa NUMERIC(4,2) NOT NULL,
    tenth_marks NUMERIC(5,2) NOT NULL,
    twelfth_marks NUMERIC(5,2) NOT NULL,
    has_arrears BOOLEAN DEFAULT FALSE,
    skills TEXT[] DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Resumes Data
CREATE TABLE IF NOT EXISTS resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    latex_template VARCHAR(100) DEFAULT 'Classic',
    resume_json_enc TEXT NOT NULL, -- Encrypted client-side standard layout JSON
    skills TEXT[] DEFAULT '{}',
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Shared Companies Registry
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    role VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    ctc VARCHAR(100),
    stipend VARCHAR(100),
    job_location VARCHAR(255),
    eligible_branches VARCHAR(100)[] DEFAULT '{}',
    eligibility_rules JSONB DEFAULT '{
      "min_cgpa": null,
      "min_tenth_marks": null,
      "min_twelfth_marks": null,
      "requires_no_arrears": true
    }'::jsonb,
    registration_deadline TIMESTAMP WITH TIME ZONE,
    registration_link TEXT,
    website TEXT,
    jd_text TEXT,
    jd_required_skills TEXT[] DEFAULT '{}',
    jd_ats_keywords TEXT[] DEFAULT '{}',
    recruitment_cycle VARCHAR(100) DEFAULT 'Default',
    fingerprint VARCHAR(64) UNIQUE NOT NULL, -- SHA256 of Company|Role|Category|Batch|Cycle
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Company Version Change Logs
CREATE TABLE IF NOT EXISTS company_change_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Company Milestones & Events
CREATE TABLE IF NOT EXISTS company_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL, -- 'REGISTRATION', 'SHORTLIST', 'OA', 'INTERVIEW', 'OFFER'
    subject TEXT,
    sender TEXT,
    body TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Student Applications
CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    status VARCHAR(100) DEFAULT 'Applied' CHECK (
        status IN ('Applied', 'Shortlisted', 'OA', 'Interview', 'Offer', 'Rejected', 'Declined', 'Ignored')
    ),
    current_round VARCHAR(255) DEFAULT 'Applied',
    notes_enc TEXT,
    match_score INT DEFAULT 0,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, company_id)
);

-- 10. Attachments Metadata
CREATE TABLE IF NOT EXISTS attachments_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_event_id UUID REFERENCES company_events(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL, -- 'JD_PDF', 'SHORTLIST_EXCEL'
    storage_path TEXT,
    parsed_meta JSONB,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. Ingestion Audit Logs
CREATE TABLE IF NOT EXISTS ingestion_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_event_id UUID REFERENCES company_events(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL,
    original_text TEXT,
    parsed_value TEXT,
    confidence_score NUMERIC(5,2),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'corrected'))
);

-- 12. Asynchronous Notification Jobs Queue
CREATE TABLE IF NOT EXISTS notification_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_event_id UUID REFERENCES company_events(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE
);

-- 13. Direct User Notifications (Deduplicated)
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    company_event_id UUID REFERENCES company_events(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    notification_type VARCHAR(100) DEFAULT 'company_update' CHECK (
        notification_type IN ('company_update', 'deadline', 'shortlist', 'offer', 'system')
    ),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, company_event_id)
);

-- 14. Performance Indexing
CREATE INDEX IF NOT EXISTS idx_companies_fingerprint ON companies(fingerprint);
CREATE INDEX IF NOT EXISTS idx_profiles_neo_hash ON student_profiles(neo_id_hash);
CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_events_company_id ON company_events(company_id);
CREATE INDEX IF NOT EXISTS idx_raw_ingestion_status ON raw_ingestion_jobs(status);
CREATE INDEX IF NOT EXISTS idx_notification_jobs_status ON notification_jobs(status);

-- 15. PostgreSQL Materialized Views for Performance Analytics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_branch_offer_counts AS
SELECT 
    p.branch,
    COUNT(a.id) as offer_count,
    CURRENT_TIMESTAMP as generated_at
FROM applications a
JOIN student_profiles p ON a.user_id = p.user_id
WHERE a.status = 'Offer'
GROUP BY p.branch;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_application_stages_ratio AS
SELECT 
    a.status,
    COUNT(a.id) as status_count,
    CURRENT_TIMESTAMP as generated_at
FROM applications a
GROUP BY a.status;

-- Unique indexes on materialized views for concurrent refreshes
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_branch_offers ON mv_branch_offer_counts(branch);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_app_stages ON mv_application_stages_ratio(status);

-- 16. Supabase Row-Level Security (RLS) Configuration
ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_events ENABLE ROW LEVEL SECURITY;

-- student_profiles Security Policies
CREATE POLICY "Users can only read their own profile" 
    ON student_profiles FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own profile" 
    ON student_profiles FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only update their own profile" 
    ON student_profiles FOR UPDATE 
    USING (auth.uid() = user_id);

-- resumes Security Policies
CREATE POLICY "Users can only manage their own resumes" 
    ON resumes FOR ALL 
    USING (auth.uid() = user_id);

-- applications Security Policies
CREATE POLICY "Users can only manage their own applications" 
    ON applications FOR ALL 
    USING (auth.uid() = user_id);

-- notifications Security Policies
CREATE POLICY "Users can only read their own notifications" 
    ON notifications FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can only update their own notifications" 
    ON notifications FOR UPDATE 
    USING (auth.uid() = user_id);

-- companies & events Policies (Read by authenticated, write by admin/coordinator role)
CREATE POLICY "Authenticated users can read companies" 
    ON companies FOR SELECT 
    USING (auth.role() = 'authenticated');

CREATE POLICY "Admin/Coordinators can manage companies" 
    ON companies FOR ALL 
    USING (auth.jwt() ->> 'role' IN ('admin', 'coordinator'));

CREATE POLICY "Authenticated users can read company events" 
    ON company_events FOR SELECT 
    USING (auth.role() = 'authenticated');

CREATE POLICY "Admin/Coordinators can manage company events" 
    ON company_events FOR ALL 
    USING (auth.jwt() ->> 'role' IN ('admin', 'coordinator'));
