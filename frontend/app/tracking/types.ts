export interface ImportantLink {
  label: string;
  url: string;
}

export interface AdditionalInfo {
  subject?: string;
  sender?: string;
  important_links?: ImportantLink[];
}

export interface Company {
  id: string;
  name: string;
  category: string;
  role: string;
  ctc: string;
  stipend: string;
  job_location: string;
  eligible_branches: string[] | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eligibility_rules: any | null;
  registration_deadline: string | null;
  website: string | null;
  registration_link: string | null;
  jd_text: string | null;
  jd_required_skills: string[] | null;
  jd_ats_keywords: string[] | null;
  source_email_body: string | null;
  additional_info: AdditionalInfo | null;
  requires_review?: boolean;
}

export interface Application {
  id: string;
  record_type: "application";
  company_id: string;
  status: string;
  current_round: string;
  notes_enc: string | null;
  match_score: number;
  user_decision: string;
  recruitment_state: string;
  last_user_activity_at: string;
  workspace_priority_override: string | null;
  snoozed_until: string | null;
  priority_score: number;
  is_stale: boolean;
}

export interface CompanyEvent {
  id: string;
  company_id: string;
  event_type: string;
  subject: string | null;
  sender: string | null;
  body: string | null;
  timestamp: string | null;
  confidence_scores: Record<string, number>;
  user_notification_msg: string | null;
}
