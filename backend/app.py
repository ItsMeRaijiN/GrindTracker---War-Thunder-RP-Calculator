from flask import Flask, jsonify, redirect
from flask_cors import CORS
from flasgger import Swagger
from flask_sqlalchemy import SQLAlchemy
import os

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# --- DB config (SQLite) ---
app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv("DATABASE_URL", "sqlite:///grindtracker.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)  # <-- na razie nie definiujemy modeli

# --- Swagger pod /api/docs/ + redirect z "/" ---
swagger_template = {
    "swagger": "2.0",
    "info": {"title": "GrindTracker API", "version": "0.1.0"},
    "basePath": "/",
    "schemes": ["http"]
}
swagger_config = {
    "headers": [],
    "specs": [
        {"endpoint": "apispec_1", "route": "/api/spec.json",
         "rule_filter": lambda rule: True, "model_filter": lambda tag: True}
    ],
    "static_url_path": "/flasgger_static",
    "swagger_ui": True,
    "specs_route": "/api/docs/"
}
Swagger(app, template=swagger_template, config=swagger_config)

@app.get("/")
def root():
    return redirect("/api/docs/")

@app.get("/api/health")
def health():
    """Health-check
    ---
    responses: {200: {description: OK}}
    """
    return jsonify({"status": "ok"})
