# AttendFR — Face Recognition Attendance System

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![Django](https://img.shields.io/badge/Django-6-092E20?logo=django&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TiDB](https://img.shields.io/badge/TiDB_Cloud-MySQL_compatible-E30C34)
![Tests](https://img.shields.io/badge/tests-262_backend_%7C_103_frontend-brightgreen)

AttendFR is a web-based class attendance system for colleges. The instructor opens
attendance for the class that is in session, points a webcam or phone camera at the students,
and each student is marked **Present** or **Late** by face — no roll call, no sign-in sheet,
no ID cards.

Photos and phone screens of a classmate's face are rejected, so attendance cannot be faked
for someone who is absent.

---

## What it does

- **Takes attendance by face.** Recognizes enrolled students one at a time in about 1–3
  seconds and marks them Present, or Late after 15 minutes.
- **Only for the right class.** Sessions can be started only by the assigned instructor, on
  the class's meeting day, within its scheduled time. Only students enrolled in that class are
  matched.
- **Knows block and irregular students.** A student can be enrolled in a whole section or
  only in one of its subjects; attendance follows exactly what each student takes.
- **Catches wrong-section scans.** A student who scans in the wrong class is told which
  section they belong to.
- **Stops spoofing.** Every frame is checked for quality and liveness, and a student is marked
  only after several consecutive live matches.
- **One face per student.** A face that is already enrolled to another student cannot be
  enrolled again.
- **Keeps records correctable and auditable.** Instructors can mark students manually and
  reopen a closed session with a written reason that is logged.
- **Reports for everyone.** Dashboards, section attendance reports, session logs, and a
  personal attendance calendar for each student.
- **Stays up to date.** Open screens refresh by themselves when data changes.

## Who uses it

| Role | What they do |
|---|---|
| **Administrator** | Sets up programs, courses, sections, subjects and schedules; manages accounts; admits students and enrolls their faces; views all reports. |
| **Instructor** | Starts attendance for their own classes, runs the live scanner, corrects records, views reports for their sections. |
| **Student** | Views their schedule, attendance per subject and a day-by-day calendar. |

Everyone signs in with their **Student ID**, **Faculty ID**, username or email.

## How attendance works

```mermaid
flowchart LR
    A[Instructor starts<br/>today's class] --> B[Camera frame]
    B --> C{Good quality?<br/>facing camera,<br/>eyes open, sharp, lit}
    C -- no --> G[Guidance shown,<br/>frame skipped]
    C -- yes --> D{Matches a student<br/>in this class?}
    D -- no --> W[Wrong section<br/>or unknown]
    D -- yes --> E{Real person?<br/>liveness check}
    E -- no --> R[Rejected:<br/>photo or screen]
    E -- yes --> F{3 matching<br/>frames in a row?}
    F -- not yet --> B
    F -- yes --> M[Marked Present / Late]
```

**Face enrollment** is done once per student with a guided, hands-free camera capture. The
system checks position, lighting, sharpness, head angle and liveness, combines three good
frames into one face identity, and refuses duplicates.

## Architecture

```mermaid
flowchart LR
    U[Browser<br/>React app + camera] --> CF[Cloudflare Pages<br/>web app + sign-in proxy]
    U --> API[Django REST API<br/>on Render<br/>face engine]
    CF --> API
    API --> DB[(TiDB Cloud<br/>database)]
    API --> CL[(Cloudinary<br/>photos)]
```

| Part | Technology |
|---|---|
| Web app | React 19, React Router, Vite — hosted on Cloudflare Pages |
| API | Django 6, Django REST Framework, SimpleJWT — hosted on Render |
| Face engine | dlib 128-D face embeddings, OpenCV, NumPy, MiniFASNetV2 anti-spoofing model |
| Database | TiDB Cloud (MySQL-compatible), normalized to 3NF |
| Photo storage | Cloudinary (face photos private, served through expiring signed links) |
| Quality | 262 backend tests, 110 frontend tests, GitHub Actions CI |

### Tools used, and what each one is for

| Tool | What it does in this project |
|---|---|
| **dlib** (via the `face_recognition` library) | Finds faces and turns each face into 128 numbers (the "face code"). Two photos of the same person give nearby codes |
| **OpenCV** | Reads and resizes images, measures sharpness and brightness, works out head angle, and runs the anti-spoofing model |
| **MiniFASNetV2** (ONNX model) | Tells a real face from a printed photo or a phone screen (liveness / anti-spoofing) |
| **NumPy** | Compares a face with the whole class in about 2 ms |
| **face-api.js** (self-hosted, runs in the browser) | Coaching only: draws the box and says "Move closer" / "Hold still". It never identifies anyone; the server decides |
| **Django + Django REST Framework** | The server, the database layer and the JSON API |
| **SimpleJWT, pyotp, cryptography** | Sign-in tokens; authenticator-app codes; encrypted two-step secrets |
| **React + Vite + React Router** | The website, its build tool and its page routing |
| **TiDB Cloud / Cloudinary / Render / Cloudflare Pages** | Database / private photo storage / API hosting / website hosting |
| **Django test runner, Vitest, oxlint, GitHub Actions** | Backend tests, frontend tests, linting, automatic checks on every push |

### Project map

```text
attendance_fr/     Django project: settings, security, and the API (views → serializers → services)
accounts/          users, profiles, sign-in, two-step sign-in, deploy tasks, admin commands
core/              school structure (programs, courses, sections, schedules) and attendance
face_app/          the face engine: detect, quality check, liveness, face code, matching
frontend/          the React website (views, components, scanner, face capture) + Cloudflare functions
```

The views are not in a single `views.py`: they are split into the package
`attendance_fr/api/views/`, one file per feature. A file-by-file guide, the list of classes,
functions and endpoints, the flows and the questions a panel may ask are in
[DOCUMENTATION.md, section 14](DOCUMENTATION.md#14-technical-guide-tools-folders-files-classes-and-flows).

## Security and privacy

- **Admin-created accounts only.** There is no public registration: the administrator creates
  every student and instructor account. A wrong password never reveals whether an account exists.
- **Required face enrollment for students.** Every student must enroll a face before they can use any part of the app. The gate is enforced on the server
  (403 `face_enrollment_required`). No admin review of the face is needed; the duplicate-face
  check at enrollment mitigates the risk of trolling (if a student enrolls someone else's face,
  they cannot take attendance for them because the face is already enrolled).
- Short-lived sign-in tokens; the long-lived token is kept in a secure cookie that page
  scripts cannot read.
- Account lockout after repeated wrong passwords, and rate limits on sign-in and face endpoints.
- Strong passwords required for every account; there are no default passwords.
- Optional two-step sign-in for everyone: a 6-digit code from an authenticator app on your
  phone, plus one-time backup codes.
- Every action is checked against the user's role, and instructors and students can only see
  their own classes and records.
- Face data is stored separately from personal data. Face photos are private and only shown
  through links that expire after 5 minutes.
- No personal data is sent to third-party avatar or analytics services.

## Project status

The system is deployed and in active development as a capstone project.

**Latest additions (Sprint 7, Oct 2026)**

- Faster face enrollment and shorter on-camera prompts
- More precise live matching on phones, with hard safety limits on how loose matching can be
- The scanner stops re-checking a student who is already marked while they stay in front
- A per-frame timing log and a `face_diagnose` command for tuning speed and accuracy
- Clicking a subject in the sections table shows that subject's schedule
- Public registration and Turnstile CAPTCHA removed (admin creates every account)
- Required student face enrollment (no skip, no admin review)
- Optional two-step sign-in (2FA) with authenticator apps for all roles
- Change password on the Profile page
- Tabbed Profile pages (Personal, Security, Academic, etc.)
- Empty-state UI consistency across all tables
- Scrollable sidebar so Sign Out is always reachable

**Planned next**

- Fast server-side student search for large rosters
- Report export (CSV/PDF)
- Attendance analytics and trends

---

<sub>Built as a 4th-year capstone project.</sub>
