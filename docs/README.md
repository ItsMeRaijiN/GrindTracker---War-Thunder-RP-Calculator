# GrindTracker — War Thunder RP Calculator

GrindTracker is a lightweight web app for War Thunder players. It estimates how many battles and how much time you need to unlock a chosen vehicle (tank, aircraft, helicopter, or ship) and shows an approximate Golden Eagles (GE) alternative (1 GE ≈ 45 RP). It includes a tech tree view with search, a calculator with cascade mode (adds all prerequisites), and per-user profiles with saved progress.

 ## Quick start
### Backend (Python 3.11):

cd backend

python -m venv .venv

Activate venv: . .venv/bin/activate (Windows: .venv\Scripts\activate)

pip install -r requirements.txt

flask --app app init-db

(optional) flask --app app import-json path/to/vehicles.json

flask --app app run -p 5000

### Frontend (Node 20+):

cd frontend (or cd ../frontend if you’re in backend)

Create .env with:

VITE_API_BASE_URL=http://localhost:5000

VITE_ENABLE_GUEST=true

npm install

npm run dev

Open http://localhost:5173

## How to use

Pick Nation and Vehicle Type, optionally use “Search vehicle”. In Calculator, select a researchable vehicle. Either enter up to 5 recent battles (RP and minutes) or provide your own averages. Set forecast options (Premium account, Booster %, Skill %) and, if needed, enable cascade to include all prerequisites. Click “Calculate” to see remaining RP, battles needed, time [h], and an estimated GE alternative; cascade also shows a breakdown of required vehicles. Log in via the header to save your profile and progress; as a guest, progress is temporary. API docs are available at /apidocs.

## Backend (at a glance)
Flask + SQLAlchemy with Swagger (flasgger) and CORS for /api/. Models cover nations, classes, ranks, vehicles, edges, users, profiles, and progress. Key endpoints: GET /api/nations, /api/classes, /api/ranks, /api/vehicles, /api/tree; POST /api/calc/estimate, /api/calc/cascade; auth (/api/auth/), profile (/api/profile), and import (/api/import). CLI: “flask --app app init-db” and “flask --app app import-json <file.json>”. Default DB: SQLite at instance/grindtracker.db (override via DATABASE_URL).

## Frontend (at a glance)
React + Vite + Tailwind. Dev server proxies /api to the backend. Features: calculator, tech tree, search, login, per-user progress. Configure via .env (VITE_API_BASE_URL, VITE_ENABLE_GUEST).

## CI/CD and production
CI (.github/workflows/ci.yml) builds backend (smoke + tests if present) and frontend. GitHub Pages deployment (.github/workflows/deploy-pages.yml) publishes frontend/dist; set repo Actions Variable API_BASE_URL to your public backend URL. Host the backend on VPS/PAAS; you can swap SQLite for another DB via DATABASE_URL.