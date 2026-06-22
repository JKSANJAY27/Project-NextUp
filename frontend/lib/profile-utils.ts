export interface UserProfile {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  branch: string | null;
  batch_year: number | null;
  neo_id_enc: string | null;
  neo_id_hash: string | null;
  cgpa: number | null;
  tenth_marks: number | null;
  twelfth_marks: number | null;
  has_arrears: boolean | null;
  skills: string[] | null;
  degree_type: string | null;
  specialization: string | null;
  ug_cgpa: number | null;
  created_at: string;
}

export function isProfileComplete(user: UserProfile | null): boolean {
  if (!user) return false;
  
  const hasName = user.full_name && user.full_name.trim() !== "" && user.full_name !== "New Student" && user.full_name !== "Student Candidate";
  const hasBranch = user.branch && user.branch.trim() !== "" && user.branch !== "Unknown";
  const hasBatch = user.batch_year && Number(user.batch_year) > 0;
  const hasNeoId = user.neo_id_enc && user.neo_id_enc !== "UNSET";
  const hasCgpa = user.cgpa !== null && user.cgpa !== undefined && Number(user.cgpa) > 0;
  const hasTenth = user.tenth_marks !== null && user.tenth_marks !== undefined && Number(user.tenth_marks) > 0;
  const hasTwelfth = user.twelfth_marks !== null && user.twelfth_marks !== undefined && Number(user.twelfth_marks) > 0;
  const hasSkills = user.skills && Array.isArray(user.skills) && user.skills.length > 0;

  return !!(hasName && hasBranch && hasBatch && hasNeoId && hasCgpa && hasTenth && hasTwelfth && hasSkills);
}
