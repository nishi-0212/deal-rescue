# Deal Rescue Agent

Finds stalled sales deals, explains **why** they stalled with links to the exact emails, calls and CRM
fields behind each finding, builds a prioritised recovery plan, and drafts follow-up emails you approve
before anything is sent. When new activity is uploaded, it re-checks the affected deals and tells you what
changed and why.

- **Backend:** Python · FastAPI · MongoDB (PyMongo async) · Groq (structured JSON output)
- **Frontend:** React · TypeScript · Tailwind CSS · Vite (light / dark / match-system themes)
- **Background jobs:** in-process asyncio queue with progress stored in MongoDB (no Redis needed)

---

## 1. Quick start (VS Code, no virtual environment)

You need **Python 3.11+**, **Node 18+** and a **MongoDB** connection string (MongoDB Atlas free tier works).

### Backend

```bash
cd backend
python -m pip install -r requirements.txt
copy .env.example .env        # Windows   (macOS/Linux: cp .env.example .env)
```

Open `backend/.env` and set at least:

| Variable | What to put |
|---|---|
| `MONGODB_URI` | Your Atlas connection string |
| `JWT_SECRET` | Any long random string: `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `GROQ_API_KEY` | Your Groq key. **Optional**: leave empty and the app uses its built-in rule-based analysis |

Run the API:

```bash
python -m uvicorn app.main:app --reload --port 8000
```

Interactive API docs: <http://localhost:8000/docs> · health check: <http://localhost:8000/api/health>

### Frontend

In a second terminal:

```bash
cd frontend
npm install
copy .env.example .env        # Windows   (macOS/Linux: cp .env.example .env)
npm run dev
```

Open <http://localhost:5173>.

### Tests

```bash
cd backend
python -m pytest -q
```

The API tests use an in-memory MongoDB (`mongomock`) and no LLM, so they need no network or keys.

---

## 2. Try the full workflow with the sample data (acceptance walkthrough)

1. Open the app → **Create account** (the password field has a Show/Hide toggle).
2. On the empty pipeline, click **Load sample pipeline**. It imports 12 deals (`crm_deals.csv`), 47 activity
   rows (`activities.csv`), an email thread (`.txt`), a call transcript (`.txt`) and meeting notes (`.docx`), then
   analyzes every deal in the background. The sidebar shows progress.
3. **Dashboard:** total pipeline, stalled value, high-risk deals, days silent, recovery progress, pipeline by
   stage, why deals stall, live activity. Filter by risk, owner, stage, stall reason, value, stalled only, or search.
4. Open **Northwind Logistics**:
   - **Diagnosis:** summary, root causes with confidence, missing people, open objections, last meaningful
     interaction, and every signal behind the risk score. Click any `EML-…`, `CALL-…` or `CRM` chip to see the
     exact record.
   - **Recovery plan:** prioritised actions with owner, due date, expected outcome and the reason. Tick
     “Complete and send back the security questionnaire”. Nothing re-runs on its own: the deal gets a
     *changed* badge and a banner. Click **Re-check now** (or **Re-check N changed** on the overview) and
     the risk drops, with **What changed** explaining why.
   - **Drafts:** pick a type (follow-up, objection handling, meeting request, procurement escalation,
     decision-maker outreach) → **Write draft** → edit → **Approve** → *Open in mail app*, *Mark as sent*, or
     *Send* (SMTP, with an extra confirmation). Nothing is ever sent without approval.
   - **History:** every analysis version, what triggered it and what changed.
5. Go to **Uploads & data** → **2. Add a week of new activity**. This uploads new emails and call notes:
   - Kestrel Retail: revised pricing was sent and approved → risk falls from Medium to Low.
   - Harbor Mutual: the customer replied and the CFO wants a call → High to Medium, with a new approval signal.
   - Northwind: call notes reveal a spending freeze from November → new “Hard deadline approaching” signal.
   - Pacific Crest: the customer finally replied → High to Low.

   Each deal page shows the old and new risk and the reason it moved.
6. **Recovery actions** lists every action across deals; changing a status re-checks that deal.

Upload your own files the same way (templates can be downloaded on the Uploads page).

---

## 3. App flow

The sidebar follows the work in order, and each step shows a tick once it's done:

1. **Upload data**: CRM export first, then emails, transcripts and notes (or load the sample).
2. **Pipeline overview**: while analysis runs you see it live, deal by deal, and can stop it. Then KPIs, charts and the full deal table.
3. **Stalled deals**: one card per stuck deal: why it's stuck, the next move, and a one-click follow-up draft.
4. **Recovery plan**: a summary, a progress flow (stalled → planned → in progress → done → improving) and the to-do list.
5. **Drafts & outreach**: every draft in one outbox: edit, approve, send.

**Recents** lists your pipelines like chats. Use **New pipeline** to start fresh, and delete one or clear all from there.
A new pipeline only appears in Recents once you add data to it, and clicking **New pipeline** again reuses the empty one.

## 4. Features delivered

| Requirement | Where |
|---|---|
| CSV/Excel CRM upload with column-name mapping and row-level validation | `services/ingest.py`, Uploads page |
| Emails, transcripts, meeting notes, follow-ups (CSV/XLSX/TXT/MD/DOCX/PDF/EML) | `ingest.parse_activity_rows`, `ingest.parse_document` |
| Unified timeline per deal, with gap markers | Deal page → Timeline |
| Unanswered emails, missed follow-ups, unresolved objections, delayed approvals, pricing, security, procurement, legal, competitor, deadlines | `services/detection.py` |
| Missing decision-makers / technical evaluators / procurement, quiet stakeholders | `detection._stakeholders` + stage rules |
| Silence and stage-duration detection, CRM forecast vs engagement contradictions, passed close dates | `detection.detect` |
| Stall reason, evidence, confidence and severity on every flagged deal | `signals[]`, `stall_reason`, `confidence`, `risk_level` |
| Structured AI diagnosis (summary, value at risk, root causes, objections, missing people, last interaction, evidence, next action) | `services/prompts.py`, `ai_schemas.Diagnosis` |
| Grounding: invented evidence IDs are removed and unsupported findings dropped | `ai_schemas.ground` |
| Prioritised recovery plan with owner, deadline, expected outcome and reason | `recovery_plan` → `actions` collection |
| Five email types, editable, approve-before-send, never automatic | `routers/drafts.py`, Drafts tab |
| Dashboard with KPIs, trends, stage chart, stall reasons, filters | `routers/dashboard.py`, Dashboard page |
| Continuous monitoring: re-analysis on upload; action and email changes flag the deal for a re-check you start yourself; a daily check flags deals whose risk changed with time (no automatic re-analysis); versioned analyses, explained changes | `services/analysis.py`, `services/monitor.py`, `services/diff.py`, `services/jobs.py` |
| Auth (JWT, bcrypt, login throttling), per-user data isolation, secure upload handling, request logging | `security.py`, `deps.py`, `routers/uploads.py`, `main.py` |
| Works fully offline from an LLM (rule-based fallback) | `services/fallback.py` |

---

## 5. How the analysis works

```
 upload ─► ingest (validate, map columns, match to deals) ─► activities + deals (MongoDB)
                                                                  │
                         background job queue (asyncio) ◄─────────┘ (deals touched by the upload)
                                    │
                                    ▼
        detection.py  ── rule signals, each with evidence IDs and a weight ──► risk score 0–100
                                    │
                                    ▼
        Groq LLM (JSON mode) ── diagnosis + recovery plan ──► Pydantic validation ──► grounding check
                 │ (no key / error / nothing grounded)
                 └──► fallback.py rule-based diagnosis (same schema)
                                    │
                                    ▼
        analyses (new version) · actions (new, de-duplicated) · deal.latest · events · snapshots
                                    │
                                    ▼
        diff.py ── "Risk moved from Medium to Low. Resolved: Pricing concern unresolved."
```

**Risk score.** Each signal has a weight (e.g. silence 18–30, customer waiting on us 13–28, security blocker 16,
missing budget owner 15, forecast mismatch 15, recent engagement −10). The score is
`100 × (1 − e^(−sum/60))`, so more problems keep raising it without hitting a hard cap.
High ≥ 70, Medium ≥ 40, Low < 40. A deal is *stalled* when the score is ≥ 40, it has been silent for 21+ days,
or it has sat in its stage for more than 1.5× the usual time.

**Value at risk** = deal value × risk score ÷ 100. This is an estimate, labelled as such.

**Completed actions** cut the weight of the signals they address by 60%, so finishing the plan lowers risk
right away. New customer activity then confirms or reverses it.

**The recovery plan doesn't grow on re-checks.** A re-check matches each suggested step to the problems
(signals) it addresses, not to its wording. It adds a step only for a problem that is new since the last
analysis, or when a finished step's problem is still there after the customer did something new or after
14 days. When every step is done, the deal shows **Waiting on the customer** instead of new to-dos.

**Daily check.** Once a day (`MONITOR_ENABLED`, `MONITOR_INTERVAL_MINUTES`) the rule-based detection runs
over open deals without saving anything. If a deal's risk level changed, a new problem appeared, or a deal
waiting on the customer had no reply for 14 days, it gets the *changed* flag so you can re-check it.

**Re-analysis is skipped** when nothing that affects the result has changed (fingerprint of deal fields,
activity IDs, action statuses and the date), which saves LLM calls. *Re-analyze* always forces a fresh run.

**LLM:** Groq with `GROQ_MODEL` (default `openai/gpt-oss-120b`, not a Llama model). Output must match the
Pydantic schema; one automatic repair retry is made if it doesn't.

---

## 6. Environment variables (`backend/.env`)

| Name | Default | Purpose |
|---|---|---|
| `MONGODB_URI` | `mongodb://localhost:27017` | MongoDB connection |
| `MONGODB_DB` | `deal_rescue` | Database name |
| `JWT_SECRET` | dev value | Token signing key. **Change it.** |
| `JWT_EXPIRE_MINUTES` | `10080` | Session length (7 days) |
| `GROQ_API_KEY` | empty | Enables AI diagnosis and drafts |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Any Groq chat model that supports JSON mode |
| `LLM_TIMEOUT_SECONDS` | `60` | Per request |
| `FRONTEND_ORIGINS` | `http://localhost:5173,…` | CORS allow-list (comma separated) |
| `MAX_UPLOAD_MB` | `10` | Per file |
| `SILENCE_DAYS` | `14` | Days without customer contact before a deal counts as quiet |
| `ANALYSIS_CONCURRENCY` | `3` | Deals analyzed in parallel |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | empty | Optional: send approved drafts by email |

Frontend (`frontend/.env`): `VITE_API_URL` = backend URL, e.g. `http://localhost:8000`.

---

## 7. API

All endpoints except `/api/health`, register and login need `Authorization: Bearer <token>`.
Data endpoints also need `X-Pipeline-Id: <pipeline id>`: every query is scoped to that user's pipeline.
Full schemas at `/docs`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Status, whether AI and email sending are enabled |
| POST | `/api/auth/register` | `{name, email, password}` → `{token, user}` |
| POST | `/api/auth/login` | `{email, password}` → `{token, user}` (5 failed attempts / 15 min limit) |
| GET | `/api/auth/me` | Current user |
| GET | `/api/pipelines` | Recents: your pipelines with stats (creates the first one on first visit) |
| POST | `/api/pipelines` | New pipeline `{name?}`; reuses an existing empty pipeline |
| PATCH | `/api/pipelines/{id}` | Rename |
| DELETE | `/api/pipelines/{id}` | Delete a pipeline and its data (stops its running analysis first) |
| DELETE | `/api/pipelines` | Clear all pipelines |
| POST | `/api/uploads` | Multipart `file` (+ optional `kind`: `deals` / `activities`) → upload report + analysis job |
| GET | `/api/uploads` · `/api/uploads/{id}` | Upload history with row-level errors |
| GET | `/api/dashboard` | KPIs, trend, stages, stall reasons, live feed, active jobs |
| GET | `/api/deals` | Filters: `owner, stage, risk, reason, stalled, min_value, max_value, q, sort, status, limit, offset` |
| GET | `/api/deals/{deal_id}` | Deal, latest analysis, timeline, actions, drafts, analysis history |
| GET | `/api/deals/{deal_id}/analyses/{version}` | A specific analysis version |
| POST | `/api/deals/reanalyze` | `{deal_ids?: [...], pending_only?: false, force: true}` → job. `pending_only` re-checks only flagged deals |
| GET | `/api/actions` | Filters: `status` (`open, in_progress, done, dismissed, active`), `deal_id`, `owner` |
| PATCH | `/api/actions/{id}` | `{status?, owner?, due_date?, note?}`; status changes flag the deal `needs_recheck` (no automatic run) |
| POST | `/api/deals/{deal_id}/drafts` | `{type, contact_email?}` → new draft |
| GET | `/api/drafts` | Filters: `deal_id`, `status` |
| PATCH | `/api/drafts/{id}` | Edit (an approved draft goes back to draft) |
| POST | `/api/drafts/{id}/approve` | Approve |
| POST | `/api/drafts/{id}/send` | `{confirm: true}`; approved drafts only, via SMTP |
| POST | `/api/drafts/{id}/mark-sent` | Record that you sent it yourself |
| DELETE | `/api/drafts/{id}` | Delete |
| GET | `/api/jobs` · `/api/jobs/{id}` | Run progress, including each deal's live stage (reading → detecting → diagnosing → planning → done) |
| POST | `/api/jobs/{id}/cancel` | Force-stop a running analysis |
| POST | `/api/demo/sample` | Load the sample pipeline |
| POST | `/api/demo/update` | Load the follow-up batch of new activity |
| DELETE | `/api/demo/data` | Clear the current pipeline |

---

## 8. Data model (MongoDB collections)

| Collection | Key fields |
|---|---|
| `users` | `email` (unique), `name`, `password_hash` |
| `pipelines` | `user_id, name, created_at, updated_at`. All other collections store `user_id` as `"<user>:<pipeline>"` |
| `deals` | `user_id + deal_id` (unique), `name, account, value, currency, stage, owner, expected_close, probability, forecast_category, status, stage_entered, contacts[]`, `latest{risk_score, risk_level, stalled, stall_reason, days_silent, value_at_risk, recovery…}` |
| `activities` | `activity_id` (EML-0001 …), `deal_id, type, date, direction, from_, to, subject, body, outcome, due_date, source_file, fingerprint` (unique per user, prevents duplicates) |
| `analyses` | `deal_id, version, trigger, source (ai/rules), signals[], stakeholders[], engagement[], diagnosis{…}, changes[], change_summary, grounding_notes[]` |
| `actions` | `deal_id, title, action_type, why, owner, priority, due_date, expected_outcome, evidence_ids[], addresses[], status, history[]` |
| `drafts` | `deal_id, type, status (draft/approved/sent), to_name, to_email, subject, body, evidence_ids[]` |
| `uploads` | `filename, kind, status, rows_total/imported/skipped, duplicates, errors[], deals_affected[], job_id` |
| `jobs` | `status, total, done, failed, deal_ids[], trigger` |
| `events`, `snapshots`, `counters` | Live feed, KPI trend points, readable activity ID sequences |

---

## 9. Project structure

```
deal-rescue/
├── backend/
│   ├── app/
│   │   ├── main.py            FastAPI app, CORS, logging middleware, routers
│   │   ├── config.py db.py security.py deps.py schemas.py serialize.py
│   │   ├── routers/           auth, uploads, deals, actions, drafts, dashboard, jobs, demo
│   │   ├── services/          ingest, detection, prompts, llm, ai_schemas, fallback,
│   │   │                      analysis, diff, importer, jobs, drafting, mailer, utils
│   │   └── sample_data/       CRM export, activities, email thread, transcript, .docx notes, update/ batch
│   ├── tests/                 unit tests + API integration tests
│   ├── requirements.txt  .env.example  pytest.ini
├── frontend/
│   ├── src/pages/             Home, Auth, Dashboard, DealPage, Actions, Drafts, Uploads
│   ├── src/components/        AppShell, Evidence drawer, ui (badges, sparkline, theme switch…), Icon
│   ├── src/lib/               api client, auth, theme, jobs polling, toasts, hooks, types
│   └── tailwind.config.js  index.html  vercel.json  .env.example
└── render.yaml
```

---

## 10. Deploying (Render + Vercel)

- **Backend on Render:** New → Blueprint → pick the repo (uses `render.yaml`), or a Web Service with root
  `backend`, build `python -m pip install -r requirements.txt`, start
  `python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Set `MONGODB_URI`, `JWT_SECRET`,
  `GROQ_API_KEY` and `FRONTEND_ORIGINS=https://<your-app>.vercel.app`. In Atlas, allow Render's IPs
  (or 0.0.0.0/0 for a demo).
- **Frontend on Vercel:** root directory `frontend`, framework Vite, env `VITE_API_URL=https://<your-api>.onrender.com`.
  `vercel.json` already rewrites routes to the SPA.
- Run **one** backend instance: the job queue lives in the API process.

---

## 11. Known limitations

- The job queue is in-process. Fine for one instance; for horizontal scaling move it to a shared queue
  (e.g. Redis + RQ/Arq) — `services/jobs.py` is the only file to change.
- CRM and email integrations (HubSpot, Salesforce, Gmail) are not connected yet. Uploads are the MVP data source;
  the importer works on parsed records, so a connector only needs to produce the same records.
- Keyword rules decide which topics are blockers, so unusual wording can be missed or over-flagged. The AI step
  explains and prioritises, but cannot add signals without evidence.
- Dashboard aggregation runs in Python over the user's deals; for very large pipelines (10k+ deals) move it to
  MongoDB aggregation pipelines.
- Email sending needs SMTP settings; otherwise use *Open in mail app* or *Copy* and then *Mark as sent*.
- Scanned PDFs (images without text) can't be read.
