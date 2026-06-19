import fitz

def main():
    doc = fitz.open()
    page = doc.new_page()
    
    text = """SANJAY J K
Email: sanjay.jk2023@vitstudent.ac.in
CGPA: 9.34
Skills: Python, React, Docker, SQL, TypeScript
Branch: CSE
Batch: 2027
10th: 95.0%
12th: 92.4%

Summary:
Highly motivated software engineering student with experience in web applications and cloud tools.

Education:
B.Tech Computer Science, Vellore Institute of Technology, 2023 - 2027, 9.34 CGPA

Experience:
Software Engineering Intern, Tech Solutions, Summer 2025
- Collaborated on backend APIs and optimized database queries.

Projects:
NextUp.ai, React, FastAPI, Supabase
- Built a zero-knowledge placement drive tracker with automated parsing.
"""
    # Insert text lines
    y = 72
    for line in text.split("\n"):
        page.insert_text((72, y), line)
        y += 20
        
    doc.save("test_resume.pdf")
    print("test_resume.pdf created successfully!")

if __name__ == "__main__":
    main()
