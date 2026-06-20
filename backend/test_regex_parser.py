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
        # Section headings are usually uppercase, short lines, or match exactly
        line_upper = line_strip.upper()
        if line_upper in headings:
            current_section = headings[line_upper]
            sections[current_section] = []
            continue
            
        sections[current_section].append(line_strip)
        
    # Process Summary
    summary = " ".join(sections.get('summary', []))
    
    # Process Skills (already extracted via extract_skills_from_text from entire text, but we can also get raw text)
    skills_raw = " ".join(sections.get('skills', []))
    
    # Process Education
    education_entries = []
    edu_lines = sections.get('education', [])
    current_edu = None
    
    # Simple regexes for education parsing
    for line in edu_lines:
        # Check if line indicates a new institution/degree
        # Usually contains University, College, School, Institute, VIT, CBSE, State Board, High School
        is_new_edu = any(x in line.lower() for x in ['university', 'college', 'school', 'institute', 'vit', 'cbse', 'board', 'b.tech', 'm.tech', 'degree'])
        
        # Or contains graduation year ranges
        year_match = re.search(r'\b(20\d{2})\b', line)
        
        if is_new_edu or (year_match and not current_edu):
            if current_edu:
                education_entries.append(current_edu)
            
            # Split degree and institution by separator
            parts = re.split(r'[—–\-|]', line)
            degree = "Degree / Course"
            institution = line
            
            if len(parts) >= 2:
                institution = parts[0].strip()
                degree = parts[1].strip()
            
            # Clean up year from degree/institution
            year_val = ""
            years_found = re.findall(r'\b(19\d{2}|20\d{2})\b', line)
            if years_found:
                if len(years_found) >= 2:
                    year_val = f"{years_found[0]} - {years_found[1]}"
                else:
                    year_val = years_found[0]
                    
                # Strip years from degree and institution
                degree = re.sub(r'\b(19\d{2}|20\d{2})\b', '', degree).strip()
                institution = re.sub(r'\b(19\d{2}|20\d{2})\b', '', institution).strip()
            
            # Remove trailing delimiters
            degree = re.sub(r'\s*[-–—|]\s*$', '', degree).strip()
            institution = re.sub(r'\s*[-–—|]\s*$', '', institution).strip()
            
            current_edu = {
                "degree": degree,
                "institution": institution,
                "year": year_val,
                "score": ""
            }
        elif current_edu:
            # Look for score (CGPA / Marks)
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
    
    for line in exp_lines:
        # A new experience starts if line has a company name + role indicator, or starts with a month/year range
        # Usually has: Month Year – Month Year, e.g. Jun 2024 – Sep 2024
        is_bullet = line.startswith(('•', '*', '-', 'o '))
        
        # Check if line contains a period or date format (like "Jun 2024", "Present", "2024")
        has_date = re.search(r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b|\bPresent\b', line, re.IGNORECASE)
        
        if not is_bullet and (has_date or (not current_exp and not is_bullet)):
            if current_exp:
                experience_entries.append(current_exp)
                
            parts = re.split(r'[—–\-|]', line)
            role = "Software Engineer Intern"
            company = line
            
            if len(parts) >= 2:
                role = parts[0].strip()
                company = parts[1].strip()
                
            period_val = ""
            date_matches = re.findall(r'\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b|\bPresent\b|\b20\d{2}\b', line, re.IGNORECASE)
            if date_matches:
                if len(date_matches) >= 2:
                    period_val = f"{date_matches[0]} - {date_matches[1]}"
                else:
                    period_val = date_matches[0]
                
                # Strip dates from role/company
                for d in date_matches:
                    role = re.sub(re.escape(d), '', role, flags=re.IGNORECASE).strip()
                    company = re.sub(re.escape(d), '', company, flags=re.IGNORECASE).strip()
                    
            role = re.sub(r'\s*[-–—|()]\s*$', '', role).strip()
            company = re.sub(r'\s*[-–—|()]\s*$', '', company).strip()
            # Clean up Remote/Location from company name if present
            company = re.sub(r'\s*\([^)]*\)\s*$', '', company).strip()
            
            current_exp = {
                "role": role,
                "company": company,
                "period": period_val,
                "description": ""
            }
        elif is_bullet and current_exp:
            bullet_text = re.sub(r'^[•\*\-\s]+', '', line).strip()
            if current_exp["description"]:
                current_exp["description"] += "\n• " + bullet_text
            else:
                current_exp["description"] = "• " + bullet_text
        elif current_exp:
            # Append line to description
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
        
        # A new project starts if there's a heading and no bullet
        is_header = False
        if not is_bullet and len(line) > 0 and (line[0].isupper() or line[0].isdigit()):
            has_separator = re.search(r'[\u2014\u2013|]|\s+-\s+', line)
            has_tech = any(x in line.lower() for x in ['python', 'react', 'nodejs', 'fastapi', 'javascript', 'c++', 'java', 'mongodb', 'sql', 'chromadb', 'ollama', 'websockets', 'langchain'])
            if has_separator or (has_tech and len(line) < 100):
                is_header = True
        
        if is_header:
            if current_proj:
                project_entries.append(current_proj)
                
            parts = re.split(r'\s*[\u2014\u2013|]\s*|\s+-\s+', line)
            title = line
            tech = ""
            
            if len(parts) >= 2:
                title = parts[0].strip()
                tech = " — ".join(p.strip() for p in parts[1:])
                
            # Clean up parentheses from title
            title = re.sub(r'\s*\([^)]*\)\s*$', '', title).strip()
            
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
