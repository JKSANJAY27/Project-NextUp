# NextupAI (PlacementOS)

NextupAI is a full-stack, privacy-first, zero-knowledge placement management system designed to streamline and automate the college placement process for students. While initially optimized for VIT (Vellore Institute of Technology) students receiving emails from the Career Development Centre (CDC), it is architected to be extensible to any university.

---

## 🔒 Key Design Pillars & Security
- **Privacy First (Zero-Knowledge)**: Sensitive student profile details (CGPA, marks, history) are encrypted client-side in the browser using AES-256-GCM. The backend only stores ciphertext. Private encryption keys are derived from the student's credentials in-memory and are never stored on the server's disk.
- **Active Session Polling**: Gmail OAuth refresh tokens are encrypted on the database. Background sync only occurs when the user is actively logged in (by keeping the decryption key in-memory in FastAPI's session cache).
- **Clean UI/UX**: Built with Space Grotesk typography, featuring vibrant gradients, glassmorphism dashboards, drag-and-drop Kanban boards, and a modern Calendar interface.

---

## 🚀 Key Features

### Phase 1: Zero-Knowledge Foundation
- **Local AES-256 Encryption**: Client-side encryption/decryption using the WebCrypto API.
- **Dynamic Student Profiles**: Secure storage of academic metrics (CGPA, Tenth/Twelfth scores, Branch, Backlog history).
- **Custom Auth**: Email domain validation matching `@vitstudent.ac.in`. Encryption keys are derived using PBKDF2.

### Phase 2: Core Intelligence
- **Intelligent Parser Engine**: Extracts metadata (role, CTC, stipend, eligibility criteria, registration deadlines) from placement announcement emails using regex and spaCy.
- **PDF & OCR Extractor**: Parses Job Description (JD) PDFs using `pdfplumber` with an automatic fallback to `pytesseract` OCR for scanned documents.
- **Excel Shortlist Matcher**: Dynamically parses CDC shortlist spreadsheets, searching for the student's unique Neo ID (e.g., `K9B8C7D6`).
- **Match Scorer**: Compares JD requirements (CGPA, branch eligibility, skills) with the student's profile using `rapidfuzz` string matching to compute a percentage compatibility score.
- **Interactive Dashboards**:
  - **Table View**: Dynamic sorting and filtering of active placement drives.
  - **Kanban Board**: Drag-and-drop tracker for application statuses (Applied, Shortlisted, OA, Interview, Offered).
  - **Calendar**: Month-grid view displaying deadlines, OAs, and interview dates, complete with ICS export.

### Phase 3: Background Gmail Automation & Notifications
- **Google OAuth Integration**: Connect university Gmail accounts securely.
- **Automated Gmail Sync**: APScheduler background sync polls `noreply.cdcinfo@vit.ac.in` for placement updates and shortlist matches while the student's session is active.
- **Real-time Notifications**: Instant alerts inside the application when a student is shortlisted or when registration deadlines are approaching.

### Phase 4: Resume Parsing & UX Improvements
- **Zero-Knowledge Resume Engine**: Drag-and-drop standard PDF resume parser extracting metrics (Name, CGPA, Branch, Marks, Skills) on-the-fly without saving raw files.
- **Client-Side Encryption**: Resume details are encrypted using the derived client key `X-Client-Key` and stored in the database.
- **Auto-Population**: Apply extracted metrics from the resume to auto-fill the student profile with one click.
- **Onboarding Banner & Checklist**: New accounts are guided to complete their profile and connect their Gmail account.
- **Automatic Sync**: Real-time university mailbox synchronizations trigger automatically on dashboard load.
- **Detailed Announcements Modal**: Displays original email content alongside parsed CTC, Stipend, ATS Keywords, and parsed registration/shortlist links.
- **Session Logout**: Clean session termination, database cache flush, and state reset.

---

## 🛠️ Technology Stack
- **Frontend**: Next.js, React, Vanilla CSS / TailwindCSS, Zustand (State Management)
- **Backend**: FastAPI, SQLAlchemy (SQLite/PostgreSQL), APScheduler
- **AI/Parsing**: spaCy, pytesseract OCR, pdfplumber, rapidfuzz, pandas
- **Containerization**: Docker & Docker Compose

