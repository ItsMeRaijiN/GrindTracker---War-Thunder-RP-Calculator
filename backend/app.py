import os
import secrets
from typing import Any, Dict, Optional, Tuple, Callable
from functools import wraps
from datetime import datetime

import click
from flask import Flask, jsonify, request, g
from flask_cors import CORS
from flasgger import Swagger
from sqlalchemy import select
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from werkzeug.security import generate_password_hash, check_password_hash

from models import db, Nation, VehicleClass, Rank, Vehicle, VehicleEdge, User
from importer import import_from_json_file, import_from_json_dict


def create_app() -> Flask:
    app = Flask(__name__, instance_relative_config=True)
    os.makedirs(app.instance_path, exist_ok=True)

    # ---- DB URI (sqlite w backend/instance/) ----
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

    # ---- SECRET_KEY (ENV -> plik -> generacja) ----
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
            # kluczowe dla folderów
            "folder_of": getattr(v, "folder_of", None),
        }

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
        # Token jest stateless; klient usuwa go po swojej stronie.
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

    # --- listowanie pojazdów z filtrami ---
    @app.get("/api/vehicles")
    def list_vehicles():
        """
        List vehicles with filters.
        ---
        tags:
          - vehicles
        parameters:
          - in: query
            name: nation
            schema: {type: string}
          - in: query
            name: class
            schema: {type: string}
          - in: query
            name: rank
            schema: {type: integer}
          - in: query
            name: type
            schema: {type: string, enum: [tree,premium,collector]}
          - in: query
            name: q
            schema: {type: string}
        responses:
          200:
            description: OK
        """
        qn = request.args.get("nation")
        qc = request.args.get("class")
        qr = request.args.get("rank", type=int)
        qt = request.args.get("type")
        qsearch = request.args.get("q")

        stmt = select(Vehicle).join(Nation).join(VehicleClass).join(Rank)

        if qn:
            stmt = stmt.where(Nation.slug == qn)
        if qc:
            stmt = stmt.where(VehicleClass.name == qc)
        if qr is not None:
            stmt = stmt.where(Rank.id == qr)
        if qt in ("tree", "premium", "collector"):
            if qt == "tree":
                stmt = stmt.where(Vehicle.is_tree.is_(True))
            elif qt == "premium":
                stmt = stmt.where(Vehicle.is_premium.is_(True))
            elif qt == "collector":
                stmt = stmt.where(Vehicle.is_collector.is_(True))
        if qsearch:
            like = f"%{qsearch}%"
            stmt = stmt.where(Vehicle.name.ilike(like))

        stmt = stmt.order_by(Rank.id, Vehicle.id)
        rows = db.session.execute(stmt).scalars().all()
        return jsonify([vehicle_to_dict(v) for v in rows])

    # --- drzewko dla nacji i klasy ---
    @app.get("/api/tree")
    def tree():
        """
        Returns DAG for given nation & class.
        ---
        tags:
          - tree
        parameters:
          - in: query
            name: nation
            required: true
            schema: {type: string}
          - in: query
            name: class
            required: true
            schema: {type: string}
        responses:
          200:
            description: OK
        """
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

    # --- Importer JSON (HTTP) ---
    @app.post("/api/import")
    def import_api():
        """
        Import data from JSON payload.
        ---
        tags:
          - import
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
        responses:
          200:
            description: Import report
        """
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
        """
        Import data from JSON file.

        Przykłady:
            flask import-json sample_data/us_tiny.json
            flask import-json backend/sample_data/us_tiny.json
            flask import-json -p backend/sample_data/us_tiny.json
            flask import-json "C:\\pełna\\ścieżka\\us_tiny.json"
        """
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
