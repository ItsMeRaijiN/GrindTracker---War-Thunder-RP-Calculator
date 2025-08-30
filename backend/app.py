from flask import Flask, jsonify, redirect
from flask_cors import CORS
from flasgger import Swagger
from flask_sqlalchemy import SQLAlchemy
import os

def create_app():
    app = Flask(__name__)

    # CORS dla wszystkich endpointów /api/*
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # --- DB config (SQLite) ---
    app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv(
        "DATABASE_URL", "sqlite:///grindtracker.db"
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db = SQLAlchemy(app)  # modele dodamy w kolejnych krokach

    # --- Swagger pod /api/docs/ + spec pod /api/spec.json ---
    swagger_template = {
        "swagger": "2.0",
        "info": {"title": "GrindTracker API", "version": "0.1.0"},
        "basePath": "/",
        "schemes": ["http"],
    }
    swagger_config = {
        "headers": [],
        "specs": [
            {
                "endpoint": "apispec_1",
                "route": "/api/spec.json",
                "rule_filter": lambda rule: True,
                "model_filter": lambda tag: True,
            }
        ],
        "static_url_path": "/flasgger_static",
        "swagger_ui": True,
        "specs_route": "/api/docs/",
    }
    Swagger(app, template=swagger_template, config=swagger_config)

    @app.get("/")
    def root():
        return redirect("/api/docs/")

    @app.get("/api/health")
    def health():
        """Health-check
        ---
        responses:
          200:
            description: OK
        """
        return jsonify({"status": "ok"})

    return app, db


app, db = create_app()

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
