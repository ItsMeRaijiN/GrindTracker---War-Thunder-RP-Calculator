import json
from typing import Any, Dict, List, Tuple

from flask import current_app
from sqlalchemy.exc import IntegrityError

from models import db, Nation, VehicleClass, Rank, Vehicle, VehicleEdge


class ImportReport(dict):
    """Prosty raport z importu."""
    def __init__(self):
        super().__init__(nations=0, classes=0, ranks=0, vehicles=0, edges=0, warnings=[], errors=[])


def _get_or_create_nation(slug: str, name: str | None = None, flag_url: str | None = None) -> Nation:
    obj = Nation.query.filter_by(slug=slug).first()
    if obj:
        return obj
    obj = Nation(slug=slug, name=name or slug.upper(), flag_url=flag_url)
    db.session.add(obj)
    return obj


def _get_or_create_class(name: str) -> VehicleClass:
    obj = VehicleClass.query.filter_by(name=name).first()
    if obj:
        return obj
    obj = VehicleClass(name=name)
    db.session.add(obj)
    return obj


def _get_or_create_rank(rid: int, label: str | None = None) -> Rank:
    obj = Rank.query.get(rid)
    if obj:
        return obj
    obj = Rank(id=rid, label=label or str(rid))
    db.session.add(obj)
    return obj


def import_from_json_dict(data: Dict[str, Any]) -> ImportReport:
    """
    Importuje dane z dict (już zdeserializowanego JSON-a).
    Oczekiwany kształt:
    {
      "nations":[{"slug":"usa","name":"USA"}],
      "classes":["army","helicopter","aviation","coastal","bluewater"],
      "ranks":[{"id":1,"label":"I"}, ...]  // albo [1,2,3,...]
      "vehicles":[
        {
          "key":"us_m3_lee",
          "name":"M3 Lee",
          "nation":"usa",
          "class":"army",
          "rank":2,
          "type":"tree",  // "tree" | "premium" | "collector"
          "br_rb":2.7,
          "rp_cost":12000,
          "ge_cost": null,
          "image_url": null,
          "wiki_url": null,
          "edges":{"parents":["..."],"children":["..."]}
        }
      ]
    }
    """
    rep = ImportReport()

    # 1) słowniki
    for n in data.get("nations", []):
        _get_or_create_nation(n["slug"], n.get("name"), n.get("flag_url"))
        rep["nations"] += 1

    for c in data.get("classes", []):
        _get_or_create_class(c)
        rep["classes"] += 1

    ranks = data.get("ranks", [])
    for r in ranks:
        if isinstance(r, dict):
            _get_or_create_rank(int(r["id"]), r.get("label"))
        else:
            _get_or_create_rank(int(r), None)
        rep["ranks"] += 1

    db.session.flush()  # żeby mieć ID słowników

    # 2) pojazdy
    key_to_dbid: Dict[str, int] = {}
    vehicles = data.get("vehicles", [])
    for v in vehicles:
        key = v["key"]  # wymagamy klucza do łączenia krawędzi
        nation = _get_or_create_nation(v["nation"])
        vclass = _get_or_create_class(v["class"])
        rank = _get_or_create_rank(int(v["rank"]))

        vtype = (v.get("type") or "tree").lower()
        is_tree = vtype == "tree"
        is_premium = vtype == "premium"
        is_collector = vtype == "collector"

        vehicle = Vehicle(
            name=v["name"],
            nation_id=nation.id,
            class_id=vclass.id,
            rank_id=rank.id,
            is_tree=is_tree,
            is_premium=is_premium,
            is_collector=is_collector,
            br_ab=v.get("br_ab"),
            br_rb=v.get("br_rb"),
            br_sb=v.get("br_sb"),
            rp_cost=v.get("rp_cost"),
            ge_cost=v.get("ge_cost"),
            image_url=v.get("image_url"),
            wiki_url=v.get("wiki_url"),
        )
        db.session.add(vehicle)
        db.session.flush()  # od razu mamy vehicle.id
        key_to_dbid[key] = vehicle.id
        rep["vehicles"] += 1

    db.session.flush()

    # 3) krawędzie
    edges_added = 0
    for v in vehicles:
        key = v["key"]
        vid = key_to_dbid.get(key)
        edges = v.get("edges") or {}
        for child_key in edges.get("children", []):
            cid = key_to_dbid.get(child_key)
            if cid is None:
                rep["warnings"].append(f"child '{child_key}' not found for '{key}'")
                continue
            db.session.add(VehicleEdge(parent_id=vid, child_id=cid, unlock_rp=v.get("unlock_rp")))
            edges_added += 1

        for parent_key in edges.get("parents", []):
            pid = key_to_dbid.get(parent_key)
            if pid is None:
                rep["warnings"].append(f"parent '{parent_key}' not found for '{key}'")
                continue
            db.session.add(VehicleEdge(parent_id=pid, child_id=vid, unlock_rp=v.get("unlock_rp")))
            edges_added += 1

    rep["edges"] = edges_added

    # Finish
    try:
        db.session.commit()
    except IntegrityError as e:
        db.session.rollback()
        rep["errors"].append(str(e))
        current_app.logger.exception("Import failed", exc_info=e)
        raise

    return rep


def import_from_json_file(path: str) -> ImportReport:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return import_from_json_dict(data)
