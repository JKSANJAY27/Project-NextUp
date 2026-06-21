import re
import json

resume_text = """Sanjay J K
Computer Science Student @ VIT — AI Systems & Full Stack Developer
+91-8122394864 | j.k.sanjay2006@gmail.com | Portfolio | LinkedIn | GitHub
SUMMARY
Focused on building scalable AI systems and real-world intelligent applications. Computer Science student at VIT (CGPA
9.34) building AI systems and scalable full-stack applications. Experience developing LLM pipelines, RAG systems,
and multi-agent architectures; filed two AI patents and selected for UKIERI-SPARC international research program.
SKILLS
Languages: Python, C++, Java, C, JavaScript
Frameworks & Web: React, Next.js, Node.js, Express.js, REST APIs, HTML, CSS, TailwindCSS
Databases: MongoDB, PostgreSQL, SQL, ChromaDB
AI / Machine Learning: PyTorch, Scikit-learn, Retrieval-Augmented Generation (RAG), Prompt Engineering
Tools: Git, GitHub, LangChain, LangGraph, Langfuse, Ollama
EXPERIENCE
Frontend Developer Intern — Valsco Technology (Remote) Jun 2024 – Sep 2024
• Developed NoteSwap, a React-based platform used by 200+ students to exchange academic resources.
• Improved frontend performance through component optimization and lazy loading, reducing page load time by 20%.
• Designed responsive UI components and improved usability across desktop and mobile interfaces.
PROJECTS
LLM Knowledge Assistant (Production RAG System) Python, LangChain, ChromaDB
• Built a Retrieval-Augmented Generation system supporting ingestion of PDFs, Markdown and web content.
• Implemented hybrid retrieval using vector search + BM25 with reciprocal rank fusion.
• Added cross-encoder reranking and evaluation pipelines with Langfuse observability.
InterviewAI — Real-Time Voice AI Interviewer FastAPI, React, WebSockets, Ollama
• Built a real-time voice AI interviewer with Deepgram ASR, Ollama LLMs, and ElevenLabs TTS, achieving sub-1.2s
end-to-end latency through an event-driven streaming architecture.
• Developed an interruption-aware conversational engine with asynchronous speech debouncing, stream cancellation,
and full-duplex WebSocket orchestration for natural interview interactions.
• Implemented session telemetry and analytics dashboards tracking ASR, LLM, and TTS latency metrics, with automated feedback generation and exportable interview reports.
Neo4j GraphReasoner — NLP Knowledge Graph Neo4j, Node.js, Ollama
• Built interactive research graph with multi-hop Cypher reasoning and physics-based visualization.
• Developed LLM-powered query system translating natural language to Cypher with reasoning traces.
• Integrated end-to-end observability (Langfuse, tracing, alerts) for queries and LLM pipelines.
SwarmIQ — Social Simulation Engine (GraphRAG + LLMs) Python, Ollama, NetworkX
• Built agent-based simulation system modeling opinion dynamics using local LLMs and GraphRAG.
• Designed cognitive simulation loop with memory, influence propagation, and emergent behavior modeling.
• Implemented knowledge graph pipeline from documents → entities → relationships → simulation world.
PATENTS
• Published (2026, Indian Patent Office): Pan-Chronological Vision–Language Transformer for Cross-Era Tamil Script
Decipherment.
• Published (2026, Indian Patent Office): Personalized AI System for Color Vision Deficiency using Perceptual Gamut
Modeling and Adaptive Recommendation.
EDUCATION
Vellore Institute of Technology (VIT) — B.Tech Computer Science 2023 – 2027
CGPA: 9.34
CBSE High School Score: 93.5%
ACHIEVEMENTS & LEADERSHIP
• GATE CSE 2026: AIR 1603 (Score: 670).
• UKIERI Research Scholar (2025) – Heriot-Watt University, UK: Selected among 9 students nationally.
• Judges’ Choice Award – Sankalp Innovation Challenge 2026 (MNNIT Allahabad): Built JanVedha AI, a civic
decision intelligence platform.
• Finalist – Google Cloud Agentic AI Hackathon 2025: Built ShikshaMitrah, an AI assistant for rural educators.
• Finalist – India Innovates 2026 (Bharat Mandapam, New Delhi): Selected among top teams at India’s largest
civic-tech hackathon.
• Finalist – DeepShiva Open Source LLM Hackathon (Healthcare): Ranked among the top 3 teams nationally.
• Board Member – Design Lead, AEE VIT Chapter & Senior Core Member – CodeChef VIT & TAM-VIT"""

def is_tech_only_line(line: str) -> bool:
    line_clean = re.sub(r'[\s,;|•\*\-\(\)▪\d–—]', ' ', line.lower())
    words = [w.strip() for w in line_clean.split() if w.strip()]
    if not words:
        return False
    tech_words = {
        'python', 'react', 'fastapi', 'supabase', 'nodejs', 'javascript', 'c++', 'java', 'mongodb', 'sql', 'chromadb', 'ollama', 'websockets', 'langchain', 'html', 'css', 'tailwind', 'typescript', 'langgraph', 'langfuse', 'pytorch', 'scikit-learn', 'c', 'git', 'github', 'nlp', 'ai', 'ml', 'docker', 'kubernetes', 'aws', 'gcp', 'azure', 'vue', 'angular', 'svelte', 'express', 'flask', 'django', 'networkx', 'rest', 'api', 'apis', 'graphql', 'grpc', 'web', 'full-stack', 'frontend', 'backend'
    }
    tech_count = sum(1 for w in words if w in tech_words)
    return (tech_count / len(words)) >= 0.7

def parse_sections(text: str):
    # Normalize line endings
    text = text.replace('\r\n', '\n')
    lines = text.split('\n')
    
    # 1. Basic details (First few lines)
    full_name = "Student Candidate"
    email = ""
    phone = ""
    location = ""
    
    for line in lines[:5]:
        line_strip = line.strip()
        if not line_strip:
            continue
        # Extract email
        email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', line_strip)
        if email_match:
            email = email_match.group(0)
        # Extract phone
        phone_match = re.search(r'\+?\d[\d\s\(\)-]{8,14}\d', line_strip)
        if phone_match:
            phone = phone_match.group(0)
        # Try to find name (usually first line with letters only)
        if full_name == "Student Candidate" and re.match(r'^[A-Za-z\s\.]+$', line_strip) and len(line_strip) > 2 and len(line_strip) < 30:
            full_name = line_strip
            
    # 2. Section Segmentation
    sections = {}
    current_section = "personal"
    sections[current_section] = []
    
    # Standard Headings
    headings = {
        'SUMMARY': 'summary',
        'PROFESSIONAL SUMMARY': 'summary',
        'PROFILE': 'summary',
        'SKILLS': 'skills',
        'TECHNICAL SKILLS': 'skills',
        'CORE SKILLS': 'skills',
        'EXPERIENCE': 'experience',
        'WORK EXPERIENCE': 'experience',
        'PROFESSIONAL EXPERIENCE': 'experience',
        'PROJECTS': 'projects',
        'ACADEMIC PROJECTS': 'projects',
        'KEY PROJECTS': 'projects',
        'EDUCATION': 'education',
        'EDUCATION BACKGROUND': 'education',
        'ACADEMIC BACKGROUND': 'education',
        'PATENTS': 'patents',
        'ACHIEVEMENTS': 'achievements',
        'ACHIEVEMENTS & LEADERSHIP': 'achievements',
        'AWARDS': 'achievements',
    }
    
    for line in lines:
        line_strip = line.strip()
        if not line_strip:
            continue
        
        # Check if line is a section heading
        line_upper = line_strip.upper()
        if line_upper in headings:
            current_section = headings[line_upper]
            sections[current_section] = []
            continue
            
        sections[current_section].append(line_strip)
        
    # Process Summary
    summary = " ".join(sections.get('summary', []))
    
    # Process Skills
    skills_raw = " ".join(sections.get('skills', []))
    
    # Process Education
    education_entries = []
    edu_lines = sections.get('education', [])
    current_edu = None
    
    for line in edu_lines:
        is_new_edu = any(x in line.lower() for x in ['university', 'college', 'school', 'institute', 'vit', 'cbse', 'board', 'b.tech', 'm.tech', 'degree'])
        year_match = re.search(r'\b(20\d{2})\b', line)
        
        if is_new_edu or (year_match and not current_edu):
            if current_edu:
                education_entries.append(current_edu)
            
            parts = re.split(r'[—–\-|]', line)
            degree = "Degree / Course"
            institution = line
            
            if len(parts) >= 2:
                institution = parts[0].strip()
                degree = parts[1].strip()
            
            year_val = ""
            years_found = re.findall(r'\b(19\d{2}|20\d{2})\b', line)
            if years_found:
                if len(years_found) >= 2:
                    year_val = f"{years_found[0]} - {years_found[1]}"
                else:
                    year_val = years_found[0]
                    
                degree = re.sub(r'\b(19\d{2}|20\d{2})\b', '', degree).strip()
                institution = re.sub(r'\b(19\d{2}|20\d{2})\b', '', institution).strip()
            
            degree = re.sub(r'\s*[-–—|]\s*$', '', degree).strip()
            institution = re.sub(r'\s*[-–—|]\s*$', '', institution).strip()
            
            current_edu = {
                "degree": degree,
                "institution": institution,
                "year": year_val,
                "score": ""
            }
        elif current_edu:
            score_match = re.search(r'(?:cgpa|gpa|score|percentage|marks|%)\s*[:\-–\s]*\s*(\d+(?:\.\d+)?%?|\d+\.\d+)', line, re.IGNORECASE)
            if score_match:
                current_edu["score"] = score_match.group(0).strip()
            elif not current_edu["score"] and any(x in line.lower() for x in ['cgpa', 'gpa', '%', 'marks']):
                current_edu["score"] = line
                
    if current_edu:
        education_entries.append(current_edu)
        
    # Process Experience
    experience_entries = []
    exp_lines = sections.get('experience', [])
    current_exp = None
    
    role_keywords = ['intern', 'developer', 'engineer', 'consultant', 'analyst', 'lead', 'manager', 'specialist', 'designer', 'programmer', 'architect', 'member', 'officer', 'scholar', 'student', 'founder', 'co-founder', 'head', 'president', 'vice', 'director']
    comp_keywords = ['solutions', 'technologies', 'technology', 'inc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'labs', 'systems', 'valsco', 'university', 'institute']

    for line in exp_lines:
        is_bullet = line.startswith(('•', '*', '-', 'o '))
        has_date = re.search(r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b|\bPresent\b', line, re.IGNORECASE)
        
        is_date_only = False
        if has_date and not is_bullet:
            has_role = any(re.search(rf"\b{re.escape(x)}\b", line.lower()) for x in role_keywords)
            if not has_role:
                is_date_only = True
                
        if is_date_only:
            if current_exp:
                period_match = re.search(r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*[-–—to]+\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\bPresent\b)\b', line, re.IGNORECASE)
                if period_match:
                    current_exp["period"] = period_match.group(0)
                else:
                    current_exp["period"] = line.strip(' ,-–—|()')
            continue
            
        is_new_exp = False
        if not is_bullet:
            has_role = any(re.search(rf"\b{re.escape(x)}\b", line.lower()) for x in role_keywords)
            if has_role:
                has_comp = any(re.search(rf"\b{re.escape(x)}\b", line.lower()) for x in comp_keywords)
                has_sep = bool(re.search(r'[—–\-|]|\s+-\s+', line))
                if has_date or has_comp or has_sep or not current_exp:
                    is_new_exp = True
                    
        if is_new_exp:
            if current_exp:
                experience_entries.append(current_exp)
                
            period_val = ""
            date_matches = re.findall(r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b|\bPresent\b|\b20\d{2}\b', line, re.IGNORECASE)
            if date_matches:
                if len(date_matches) >= 2:
                    period_val = f"{date_matches[0]} - {date_matches[1]}"
                else:
                    period_val = date_matches[0]
                
                clean_line = line
                for d in date_matches:
                    clean_line = re.sub(re.escape(d), '', clean_line, flags=re.IGNORECASE).strip()
            else:
                clean_line = line
                
            clean_line = re.sub(r'\s+', ' ', clean_line)
            clean_line = re.sub(r',\s*,', ',', clean_line).strip(' ,-–—|()')
            
            parts = [p.strip() for p in re.split(r'\s*[\u2014\u2013|,\t]\s*|\s+-\s+', clean_line) if p.strip()]
            role = "Software Engineer Intern"
            company = clean_line
            
            if len(parts) >= 2:
                p0, p1 = parts[0], parts[1]
                p0_has_role = any(re.search(rf"\b{re.escape(x)}\b", p0.lower()) for x in role_keywords)
                p1_has_comp = any(re.search(rf"\b{re.escape(x)}\b", p1.lower()) for x in comp_keywords)
                p0_has_comp = any(re.search(rf"\b{re.escape(x)}\b", p0.lower()) for x in comp_keywords)
                p1_has_role = any(re.search(rf"\b{re.escape(x)}\b", p1.lower()) for x in role_keywords)

                if p0_has_role or p1_has_comp:
                    role = p0
                    company = p1
                elif p0_has_comp or p1_has_role:
                    company = p0
                    role = p1
                else:
                    role = p0
                    company = p1
                    
            role = re.sub(r'\s*[-–—|()]\s*$', '', role).strip()
            company = re.sub(r'\s*[-–—|()]\s*$', '', company).strip()
            company = re.sub(r'\s*\([^)]*\)\s*$', '', company).strip()
            
            current_exp = {
                "role": role,
                "company": company,
                "period": period_val,
                "description": ""
            }
        elif is_bullet and current_exp:
            bullet_text = re.sub(r'^[•\*\-\s▪]+', '', line).strip()
            if current_exp["description"]:
                current_exp["description"] += "\n• " + bullet_text
            else:
                current_exp["description"] = "• " + bullet_text
        elif current_exp:
            if current_exp["description"]:
                current_exp["description"] += "\n" + line
            else:
                current_exp["description"] = line
                
    if current_exp:
        experience_entries.append(current_exp)
        
    # Process Projects
    project_entries = []
    proj_lines = sections.get('projects', [])
    current_proj = None
    
    for line in proj_lines:
        is_bullet = line.startswith(('•', '*', '-', 'o ', '▪'))
        
        is_tech_only = False
        if not is_bullet:
            if is_tech_only_line(line):
                is_tech_only = True
                
        if is_tech_only:
            if current_proj:
                cleaned_tech = line.strip(' ,-–—|()')
                if current_proj["tech"]:
                    existing = [x.strip().lower() for x in current_proj["tech"].split(',')]
                    new_skills = [x.strip() for x in cleaned_tech.split(',') if x.strip().lower() not in existing]
                    if new_skills:
                        current_proj["tech"] += ", " + ", ".join(new_skills)
                else:
                    current_proj["tech"] = cleaned_tech
            continue
            
        is_header = False
        if not is_bullet and len(line) > 0 and (line[0].isupper() or line[0].isdigit()):
            if not is_tech_only_line(line):
                has_separator = re.search(r'[\u2014\u2013|]|\s+-\s+', line)
                has_tech = any(x in line.lower() for x in ['python', 'react', 'nodejs', 'fastapi', 'javascript', 'c++', 'java', 'mongodb', 'sql', 'chromadb', 'ollama', 'websockets', 'langchain'])
                if has_separator or (has_tech and len(line) < 100) or not current_proj:
                    is_header = True
        
        if is_header:
            if current_proj:
                project_entries.append(current_proj)
                
            parts = re.split(r'\s*[\u2014\u2013|]\s*|\s+-\s+', line)
            title = line
            tech = ""
            
            if len(parts) >= 2:
                title = parts[0].strip()
                tech = ", ".join(p.strip() for p in parts[1:])
            else:
                comma_parts = [p.strip() for p in line.split(',') if p.strip()]
                if len(comma_parts) >= 2:
                    tech_words = ['python', 'react', 'fastapi', 'supabase', 'nodejs', 'javascript', 'c++', 'java', 'mongodb', 'sql', 'chromadb', 'ollama', 'websockets', 'langchain', 'html', 'css', 'tailwind', 'typescript', 'langgraph', 'langfuse']
                    p1_has_tech = any(x in comma_parts[1].lower() for x in tech_words)
                    if p1_has_tech:
                        title = comma_parts[0]
                        tech = ", ".join(comma_parts[1:])
            
            title = re.sub(r'\s*[-–—|()]\s*$', '', title).strip()
            title = re.sub(r'\s*\([^)]*\)\s*$', '', title).strip()
            tech = re.sub(r'\s*[-–—|()]\s*$', '', tech).strip()
            
            current_proj = {
                "title": title,
                "tech": tech,
                "description": ""
            }
        elif is_bullet and current_proj:
            bullet_text = re.sub(r'^[•\*\-\s▪]+', '', line).strip()
            if current_proj["description"]:
                current_proj["description"] += "\n• " + bullet_text
            else:
                current_proj["description"] = "• " + bullet_text
        elif current_proj:
            if current_proj["description"]:
                current_proj["description"] += "\n" + line
            else:
                current_proj["description"] = line
                
    if current_proj:
        project_entries.append(current_proj)
        
    # Process Patents
    patents = []
    patent_lines = sections.get('patents', [])
    for line in patent_lines:
        if line.strip():
            patents.append(re.sub(r'^[•\*\-\s]+', '', line).strip())
            
    # Process Achievements
    achievements = []
    ach_lines = sections.get('achievements', [])
    for line in ach_lines:
        if line.strip():
            achievements.append(re.sub(r'^[•\*\-\s]+', '', line).strip())
            
    return {
        "full_name": full_name,
        "email": email,
        "phone": phone,
        "location": location,
        "summary": summary,
        "education": education_entries,
        "experience": experience_entries,
        "projects": project_entries,
        "patents": patents,
        "achievements": achievements
    }

parsed = parse_sections(resume_text)
print(json.dumps(parsed, indent=2))
