import os
import secrets
import math
from typing import Any, Dict, Optional, Callable, List, Tuple
from functools import wraps
from datetime import datetime

import click
from flask import Flask, jsonify, request, g
from flask_cors import CORS
from flasgger import Swagger
from sqlalchemy import select, func, asc
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from werkzeug.security import generate_password_hash, check_password_hash

from models import db, Nation, VehicleClass, Rank, Vehicle, VehicleEdge, User
from importer import import_from_json_file, import_from_json_dict


def create_app() -> Flask:
    app = Flask(__name__, instance_relative_config=True)
    os.makedirs(app.instance_path, exist_ok=True)

    # ---- DB URI ----
    env_uri = os.getenv("DATABASE_URL", "").strip()

    def resolve_sqlite_uri(uri: str) -> str:
        if not uri:
            db_file = os.path.join(app.instance_path, "grindtracker.db")
            return f"sqlite:///{db_file}"
        if uri.startswith("sqlite:///"):
            path = uri[len("sqlite:///") :]
            if not os.path.isabs(path):
                db_file = os.path.join(app.instance_path, path)
                return f"sqlite:///{db_file}"
            return uri
        return uri

    db_uri = resolve_sqlite_uri(env_uri)

    # ---- SECRET_KEY ----
    def load_or_create_secret() -> str:
        env_secret = os.getenv("SECRET_KEY")
        if env_secret:
            return env_secret
        secret_path = os.path.join(app.instance_path, "secret.key")
        if os.path.exists(secret_path):
            with open(secret_path, "r", encoding="utf-8") as f:
                return f.read().strip()
        secret = secrets.token_urlsafe(32)
        with open(secret_path, "w", encoding="utf-8") as f:
            f.write(secret)
        return secret

    app.config.update(
        SQLALCHEMY_DATABASE_URI=db_uri,
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SWAGGER={"title": "GrindTracker API", "uiversion": 3},
        SECRET_KEY=load_or_create_secret(),
        AUTH_TOKEN_MAX_AGE=60 * 60 * 24 * 30,  # 30 dni
    )

    CORS(app, resources={r"/api/*": {"origins": "*"}})
    Swagger(app)
    db.init_app(app)

    # ---- Auth utils ----
    signer = URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="gt-auth")

    def make_token(user: User) -> str:
        payload = {"id": user.id, "email": user.email}
        return signer.dumps(payload)

    def decode_token(token: str) -> Dict[str, Any]:
        max_age = int(app.config["AUTH_TOKEN_MAX_AGE"])
        return signer.loads(token, max_age=max_age)

    def get_bearer_token() -> Optional[str]:
        auth = request.headers.get("Authorization", "").strip()
        if not auth.lower().startswith("bearer "):
            return None
        return auth.split(" ", 1)[1].strip() or None

    def auth_required(fn: Callable):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            token = get_bearer_token()
            if not token:
                return jsonify({"error": "Missing bearer token"}), 401
            try:
                data = decode_token(token)
            except SignatureExpired:
                return jsonify({"error": "Token expired"}), 401
            except BadSignature:
                return jsonify({"error": "Invalid token"}), 401

            user = User.query.get(int(data.get("id", 0)))
            if not user:
                return jsonify({"error": "User not found"}), 401
            g.current_user = user
            return fn(*args, **kwargs)

        return wrapper

    # ---------- HELPERS ----------
    def vehicle_to_dict(v: Vehicle) -> Dict[str, Any]:
        return {
            "id": v.id,
            "name": v.name,
            "nation": v.nation.slug if v.nation else None,
            "class": v.vclass.name if v.vclass else None,
            "rank": v.rank.id if v.rank else None,
            "rank_label": v.rank.label if v.rank else None,
            "type": "premium" if v.is_premium else ("collector" if v.is_collector else "tree"),
            "br": {"ab": v.br_ab, "rb": v.br_rb, "sb": v.br_sb},
            "rp_cost": v.rp_cost,
            "ge_cost": v.ge_cost,
            "image_url": v.image_url,
            "wiki_url": v.wiki_url,
            "folder_of": getattr(v, "folder_of", None),
        }

    # ---- bonusy / wymagania ----
    PREMIUM_RP_MULT = 2.0  # jeśli chcesz inaczej — zmień tutaj

    def _coalesced_br():
        return func.coalesce(Vehicle.br_rb, Vehicle.br_ab, Vehicle.br_sb)

    def list_variants_for_parent(parent_id: int) -> List[Vehicle]:
        return (
            Vehicle.query
            .filter(Vehicle.folder_of == parent_id)
            .order_by(asc(Vehicle.rank_id), _coalesced_br().asc(), asc(Vehicle.name))
            .all()
        )

    def prev_variant_id_if_any(v: Vehicle) -> Optional[int]:
        if not getattr(v, "folder_of", None):
            return None
        siblings = list_variants_for_parent(v.folder_of)
        prev = None
        for s in siblings:
            if s.id == v.id:
                break
            prev = s
        return prev.id if prev else None

    def prerequisites_for(vehicle_id: int) -> List[int]:
        """Natychmiastowi rodzice: krawędzie + rodzic folderu + poprzedni wariant."""
        v = Vehicle.query.get(vehicle_id)
        if not v:
            return []
        req: set[int] = set()
        for e in VehicleEdge.query.filter_by(child_id=vehicle_id).all():
            req.add(e.parent_id)
        if getattr(v, "folder_of", None):
            req.add(v.folder_of)
            pv = prev_variant_id_if_any(v)
            if pv:
                req.add(pv)
        return list(req)

    def all_prerequisites_recursive(vehicle_id: int) -> List[int]:
        """Zbierz WSZYSTKIE wymagane (rekurencyjnie)."""
        visited: set[int] = set()
        stack = [vehicle_id]
        visited.add(vehicle_id)
        req_all: set[int] = set()

        while stack:
            cur = stack.pop()
            for p in prerequisites_for(cur):
                if p not in visited:
                    visited.add(p)
                    req_all.add(p)
                    stack.append(p)
        return list(req_all)

    def effective_rp_per_battle(
        avg_rp_per_battle: float,
        has_premium: bool,
        booster_percent: Optional[int],
        skill_bonus_percent: Optional[int],
    ) -> float:
        mult = 1.0
        if has_premium:
            mult *= PREMIUM_RP_MULT
        if booster_percent:
            mult *= (1.0 + booster_percent / 100.0)
        if skill_bonus_percent:
            mult *= (1.0 + skill_bonus_percent / 100.0)
        return max(0.0, float(avg_rp_per_battle) * mult)

    def averages_from_recent(data: Dict[str, Any]) -> Tuple[float, float, int]:
        """
        Zwraca (avg_base_rp_per_battle, avg_minutes_per_battle, samples)
        gdzie "base" = bez bonusów z podanych bitew.
        """
        recent = data.get("recent_battles") or []
        base_rps: List[float] = []
        mins: List[float] = []
        for it in (recent[:5] if isinstance(recent, list) else []):
            try:
                rp_val = max(0.0, float(it.get("rp", 0)))
            except Exception:
                rp_val = 0.0
            try:
                m_val = max(0.0, float(it.get("minutes", 0)))
            except Exception:
                m_val = 0.0
            prem = bool(it.get("premium") or False)
            bperc = it.get("booster_percent")
            sperc = it.get("skill_bonus_percent")
            denom = 1.0
            if prem:
                denom *= PREMIUM_RP_MULT
            if bperc is not None:
                try:
                    denom *= (1.0 + float(bperc) / 100.0)
                except Exception:
                    pass
            if sperc is not None:
                try:
                    denom *= (1.0 + float(sperc) / 100.0)
                except Exception:
                    pass
            if rp_val > 0:
                base_rps.append(rp_val / max(denom, 1e-9))
            if m_val > 0:
                mins.append(m_val)

        avg_rp = sum(base_rps) / len(base_rps) if base_rps else 0.0
        avg_min = sum(mins) / len(mins) if mins else 9.0
        return avg_rp, avg_min, len(base_rps)

    # ---------- ROUTES ----------
    @app.get("/")
    def index():
        return jsonify({"service": "GrindTracker API", "status": "ok", "docs": "/apidocs", "health": "/api/health"})

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    # --- AUTH ---
    @app.post("/api/auth/register")
    def auth_register():
        data = request.get_json(silent=True) or {}
        email = (data.get("email") or "").strip().lower()
        password = (data.get("password") or "").strip()
        if not email or not password:
            return jsonify({"error": "Email and password are required"}), 400
        if User.query.filter_by(email=email).first():
            return jsonify({"error": "Email is already in use"}), 400

        user = User(email=email, password_hash=generate_password_hash(password), created_at=datetime.utcnow())
        db.session.add(user)
        db.session.commit()

        token = make_token(user)
        return jsonify({"token": token, "user": {"id": user.id, "email": user.email}})

    @app.post("/api/auth/login")
    def auth_login():
        data = request.get_json(silent=True) or {}
        email = (data.get("email") or "").strip().lower()
        password = (data.get("password") or "").strip()
        if not email or not password:
            return jsonify({"error": "Email and password are required"}), 400

        user = User.query.filter_by(email=email).first()
        if not user or not check_password_hash(user.password_hash, password):
            return jsonify({"error": "Invalid credentials"}), 401

        token = make_token(user)
        return jsonify({"token": token, "user": {"id": user.id, "email": user.email}})

    @app.post("/api/auth/logout")
    def auth_logout():
        return jsonify({"ok": True})

    @app.get("/api/auth/me")
    @auth_required
    def auth_me():
        u: User = g.current_user  # type: ignore
        return jsonify({"user": {"id": u.id, "email": u.email}})

    # --- słowniki ---
    @app.get("/api/nations")
    def nations():
        rows = Nation.query.order_by(Nation.slug).all()
        return jsonify([{"id": n.id, "slug": n.slug, "name": n.name, "flag_url": n.flag_url} for n in rows])

    @app.get("/api/classes")
    def classes():
        rows = VehicleClass.query.order_by(VehicleClass.name).all()
        return jsonify([{"id": c.id, "name": c.name} for c in rows])

    @app.get("/api/ranks")
    def ranks():
        rows = Rank.query.order_by(Rank.id).all()
        return jsonify([{"id": r.id, "label": r.label} for r in rows])

    # --- listowanie pojazdów ---
    @app.get("/api/vehicles")
    def list_vehicles():
        qn = request.args.get("nation")
        qc = request.args.get("class")
        qr = request.args.get("rank", type=int)
        qt = request.args.get("type")
        qsearch = request.args.get("q")
        rank_min = request.args.get("rank_min", type=int)
        rank_max = request.args.get("rank_max", type=int)
        br_min = request.args.get("br_min", type=float)
        br_max = request.args.get("br_max", type=float)
        exclude_variants = request.args.get("exclude_variants", type=int) == 1

        stmt = select(Vehicle).join(Nation).join(VehicleClass).join(Rank)

        if qn:
            stmt = stmt.where(Nation.slug == qn)
        if qc:
            stmt = stmt.where(VehicleClass.name == qc)
        if qr is not None:
            stmt = stmt.where(Rank.id == qr)
        if rank_min is not None:
            stmt = stmt.where(Rank.id >= rank_min)
        if rank_max is not None:
            stmt = stmt.where(Rank.id <= rank_max)

        br_coalesce = func.coalesce(Vehicle.br_rb, Vehicle.br_ab, Vehicle.br_sb)
        if br_min is not None:
            stmt = stmt.where(br_coalesce >= br_min)
        if br_max is not None:
            stmt = stmt.where(br_coalesce <= br_max)

        if qt in ("tree", "premium", "collector"):
            if qt == "tree":
                stmt = stmt.where(Vehicle.is_tree.is_(True))
            elif qt == "premium":
                stmt = stmt.where(Vehicle.is_premium.is_(True))
            elif qt == "collector":
                stmt = stmt.where(Vehicle.is_collector.is_(True))

        if exclude_variants:
            stmt = stmt.where(
                (Vehicle.folder_of.is_(None))
                | (Vehicle.is_premium.is_(True))
                | (Vehicle.is_collector.is_(True))
            )

        if qsearch:
            like = f"%{qsearch}%"
            stmt = stmt.where(Vehicle.name.ilike(like))

        stmt = stmt.order_by(Rank.id, Vehicle.id)
        rows = db.session.execute(stmt).scalars().all()
        return jsonify([vehicle_to_dict(v) for v in rows])

    # --- drzewko ---
    @app.get("/api/tree")
    def tree():
        qn = request.args.get("nation")
        qc = request.args.get("class")
        if not qn or not qc:
            return jsonify({"error": "nation and class are required"}), 400

        nodes_stmt = select(Vehicle).join(Nation).join(VehicleClass).where(
            Nation.slug == qn, VehicleClass.name == qc
        )
        nodes = db.session.execute(nodes_stmt).scalars().all()
        node_ids = {v.id for v in nodes}

        edges_stmt = select(VehicleEdge).where(
            VehicleEdge.parent_id.in_(node_ids),
            VehicleEdge.child_id.in_(node_ids),
        )
        edges = db.session.execute(edges_stmt).scalars().all()

        return jsonify(
            {
                "nodes": [vehicle_to_dict(v) for v in nodes],
                "edges": [
                    {"parent": e.parent_id, "child": e.child_id, "unlock_rp": e.unlock_rp}
                    for e in edges
                ],
            }
        )

    # --- kalkulator (pojedynczy) ---
    @app.post("/api/calc/estimate")
    def calc_estimate():
        data = request.get_json(silent=True) or {}
        vehicle_id = int(data.get("vehicle_id") or 0)
        if not vehicle_id:
            return jsonify({"error": "vehicle_id is required"}), 400

        v = Vehicle.query.get(vehicle_id)
        if not v or not v.rp_cost:
            return jsonify({"error": "Vehicle not found or rp_cost missing"}), 400

        rp_current = int(data.get("rp_current") or 0)
        avg_rp_per_battle = data.get("avg_rp_per_battle")
        avg_battle_minutes = data.get("avg_battle_minutes")
        has_premium = bool(data.get("has_premium") or False)
        booster_percent = data.get("booster_percent")
        skill_bonus_percent = data.get("skill_bonus_percent")

        avg_recent, avg_min_recent, samples = averages_from_recent(data)
        if avg_recent > 0:
            avg_rp_per_battle = avg_recent
        if avg_min_recent > 0:
            avg_battle_minutes = avg_min_recent

        avg_rp_per_battle = float(avg_rp_per_battle or 0)
        avg_battle_minutes = float(avg_battle_minutes or 9)

        booster_percent = int(booster_percent) if booster_percent is not None else None
        skill_bonus_percent = int(skill_bonus_percent) if skill_bonus_percent is not None else None

        effective = effective_rp_per_battle(
            avg_rp_per_battle=avg_rp_per_battle,
            has_premium=has_premium,
            booster_percent=booster_percent,
            skill_bonus_percent=skill_bonus_percent,
        )

        remaining = max(0, int(v.rp_cost) - int(rp_current or 0))
        if remaining == 0:
            battles = 0
        elif effective <= 0.0:
            battles = None
        else:
            battles = math.ceil(remaining / effective)

        minutes = None if battles is None else int(round(battles * avg_battle_minutes))
        hours = None if minutes is None else round(minutes / 60.0, 2)
        ge_cost_by_rate = int(math.ceil(remaining / 45.0)) if remaining > 0 else 0

        req_ids = prerequisites_for(vehicle_id)
        req_list = []
        if req_ids:
            req_vs = Vehicle.query.filter(Vehicle.id.in_(req_ids)).all()
            req_list = [{"id": rv.id, "name": rv.name} for rv in req_vs]

        return jsonify({
            "vehicle": {
                "id": v.id,
                "name": v.name,
                "rank": v.rank_id,
                "type": "premium" if v.is_premium else ("collector" if v.is_collector else "tree"),
                "rp_cost": v.rp_cost,
                "ge_cost": v.ge_cost,
            },
            "rp_current": int(rp_current or 0),
            "rp_remaining": remaining,
            "base_from_recent": {
                "avg_rp_per_battle": round(avg_rp_per_battle, 2),
                "avg_battle_minutes": round(avg_battle_minutes, 2),
                "samples": samples,
            },
            "effective_rp_per_battle": effective,
            "battles_needed": battles,
            "minutes_needed": minutes,
            "hours_needed": hours,
            "ge_cost_by_rate": ge_cost_by_rate,
            "prerequisite_ids": req_ids,
            "prerequisites": req_list,
        })

    # --- kalkulator (KASKADOWO) ---
    @app.post("/api/calc/cascade")
    def calc_cascade():
        """
        Body JSON:
        {
          vehicle_id: int,
          has_premium?: bool,
          booster_percent?: int,
          skill_bonus_percent?: int,
          avg_rp_per_battle?: number,
          avg_battle_minutes?: number,
          recent_battles?: [{ rp, minutes, premium?, booster_percent?, skill_bonus_percent? }, ...max5],
          progress?: { "<id>": { rp_current?: int, done?: bool }, ... }
        }
        """
        data = request.get_json(silent=True) or {}
        vehicle_id = int(data.get("vehicle_id") or 0)
        if not vehicle_id:
            return jsonify({"error": "vehicle_id is required"}), 400

        target = Vehicle.query.get(vehicle_id)
        if not target:
            return jsonify({"error": "Vehicle not found"}), 400

        # średnie
        avg_rp, avg_min, samples = averages_from_recent(data)
        if not avg_rp:
            avg_rp = float(data.get("avg_rp_per_battle") or 0.0)
        if not avg_min:
            avg_min = float(data.get("avg_battle_minutes") or 9.0)

        has_premium = bool(data.get("has_premium") or False)
        booster_percent = data.get("booster_percent")
        skill_bonus_percent = data.get("skill_bonus_percent")
        booster_percent = int(booster_percent) if booster_percent is not None else None
        skill_bonus_percent = int(skill_bonus_percent) if skill_bonus_percent is not None else None

        effective = effective_rp_per_battle(
            avg_rp_per_battle=avg_rp,
            has_premium=has_premium,
            booster_percent=booster_percent,
            skill_bonus_percent=skill_bonus_percent,
        )

        # zbierz wszystkie wymagane + sam target
        required_ids = set(all_prerequisites_recursive(vehicle_id))
        required_ids.add(vehicle_id)

        # progres użytkownika (z frontu)
        raw_prog = data.get("progress") or {}
        def get_prog(vid: int) -> Tuple[int, bool]:
            p = raw_prog.get(str(vid)) or raw_prog.get(int(vid)) or {}
            rp_cur = int(p.get("rp_current") or 0)
            done = bool(p.get("done") or False)
            return rp_cur, done

        # policz per pojazd i łączną sumę
        breakdown = []
        total_remaining = 0
        id_list = list(required_ids)
        if id_list:
            rows = Vehicle.query.filter(Vehicle.id.in_(id_list)).all()
            # sortowanie "po ludzku"
            rows.sort(key=lambda r: (r.rank_id or 0, (r.br_rb or r.br_ab or r.br_sb or 0.0), r.name))
            for v in rows:
                rp_total = int(v.rp_cost or 0)
                rp_cur, done = get_prog(v.id)
                rp_rem = 0 if done else max(0, rp_total - rp_cur)
                if rp_rem > 0:
                    total_remaining += rp_rem
                breakdown.append({
                    "id": v.id,
                    "name": v.name,
                    "rank": v.rank_id,
                    "rp_cost": rp_total,
                    "rp_current": int(rp_cur),
                    "rp_remaining": int(rp_rem),
                    "done": bool(done),
                })

        if total_remaining == 0:
            battles = 0
            minutes = 0
        elif effective <= 0.0:
            battles = None
            minutes = None
        else:
            battles = math.ceil(total_remaining / effective)
            minutes = int(round(battles * avg_min)) if battles is not None else None

        hours = None if minutes is None else round(minutes / 60.0, 2)
        ge_cost_by_rate = int(math.ceil(total_remaining / 45.0)) if total_remaining > 0 else 0

        return jsonify({
            "target": {"id": target.id, "name": target.name},
            "base_from_recent": {
                "avg_rp_per_battle": round(avg_rp, 2),
                "avg_battle_minutes": round(avg_min, 2),
                "samples": samples,
            },
            "effective_rp_per_battle": effective,
            "required_ids": list(required_ids),
            "breakdown": breakdown,
            "rp_total_remaining": int(total_remaining),
            "battles_needed": battles,
            "minutes_needed": minutes,
            "hours_needed": hours,
            "ge_cost_by_rate": ge_cost_by_rate,
        })

    # --- Importer JSON ---
    @app.post("/api/import")
    def import_api():
        data = request.get_json(silent=True) or {}
        rep = import_from_json_dict(data)
        return jsonify(rep)

    # ---------- CLI ----------
    @app.cli.command("init-db")
    def init_db_command():
        with app.app_context():
            db.create_all()
        print(f"Initialized the database at: {db_uri}")

    @app.cli.command("import-json")
    @click.argument("path", required=False)
    @click.option("--path", "-p", "path_opt", help="Path to JSON file")
    def import_json_command(path: Optional[str], path_opt: Optional[str]):
        user_path = (path_opt or path or "").strip()
        if not user_path:
            user_path = click.prompt("Path to JSON", type=str)

        candidates = []
        candidates.append(os.path.abspath(os.path.normpath(os.path.expanduser(user_path))))
        candidates.append(os.path.abspath(os.path.join(app.root_path, user_path)))

        backend_prefix = "backend" + os.sep
        if user_path.startswith(backend_prefix):
            trimmed = user_path[len(backend_prefix) :]
            candidates.append(os.path.abspath(os.path.join(app.root_path, trimmed)))

        final_path = next((p for p in candidates if os.path.exists(p)), None)
        if not final_path:
            raise click.FileError(
                user_path,
                hint="File not found. Try a path relative to 'backend/', e.g., sample_data/us_tiny.json",
            )

        rep = import_from_json_file(final_path)
        print("Import done:", rep)

    return app


app = create_app()
