import json
from typing import Any, Dict, List, Tuple

from models import db, Nation, VehicleClass, Rank, Vehicle, VehicleEdge


def _get_or_create(model, **kwargs):
    inst = model.query.filter_by(**kwargs).first()
    if inst:
        return inst, False
    inst = model(**kwargs)
    db.session.add(inst)
    return inst, True


def _import_from_data(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Import JSON z obsługą:
    - nations: [{slug,name,flag_url?}]
    - classes: ["army", ...] lub [{name: "army"}]
    - ranks: [{id,label}]
    - vehicles: wpisy z polami:
        key, name, nation, class, rank, type('tree'|'premium'|'collector'),
        rp_cost?, ge_cost?, br_ab/br_rb/br_sb lub br:{ab,rb,sb}, image_url?, wiki_url?,
        folder_of_key?, edges:{parents:[keys...], unlock_rp?}
    - edges: [{parent_key, child_key, unlock_rp?}]
    """
    report: Dict[str, Any] = {"nations": 0, "classes": 0, "ranks": 0, "vehicles": 0, "edges": 0, "warnings": []}

    # --- nations ---
    for nd in data.get("nations", []):
        if not isinstance(nd, dict):
            report["warnings"].append(f"Unexpected nation entry: {nd!r}")
            continue
        slug = nd["slug"]
        n, _ = _get_or_create(Nation, slug=slug)
        n.name = nd.get("name", slug)
        n.flag_url = nd.get("flag_url")
        report["nations"] += 1

    # --- classes ---
    for cn in data.get("classes", []):
        name = cn["name"] if isinstance(cn, dict) else str(cn)
        _get_or_create(VehicleClass, name=name)
        report["classes"] += 1

    # --- ranks ---
    for rr in data.get("ranks", []):
        rid = int(rr["id"])
        r, _ = _get_or_create(Rank, id=rid)
        r.label = str(rr.get("label") or rid)
        report["ranks"] += 1

    db.session.flush()

    slug_to_id = {n.slug: n.id for n in Nation.query.all()}
    class_to_id = {c.name: c.id for c in VehicleClass.query.all()}

    # maps
    key_to_id: Dict[str, int] = {}
    folders: List[Tuple[str, str]] = []  # (variant_key, parent_key)
    per_vehicle_edges: List[Tuple[str, str, int | None]] = []  # (parent_key, child_key, unlock_rp)

    # --- vehicles ---
    for vd in data.get("vehicles", []):
        key = vd.get("key") or vd.get("id") or vd["name"]

        n_slug = vd["nation"]
        c_name = vd["class"]
        rank_id = int(vd.get("rank", 1))

        if n_slug not in slug_to_id:
            report["warnings"].append(f"Unknown nation slug '{n_slug}' for vehicle {key}")
            continue
        if c_name not in class_to_id:
            report["warnings"].append(f"Unknown class '{c_name}' for vehicle {key}")
            continue
        if not Rank.query.get(rank_id):
            report["warnings"].append(f"Unknown rank '{rank_id}' for vehicle {key}")
            continue

        vtype = vd.get("type", "tree")
        is_tree = (vtype == "tree")
        is_premium = (vtype == "premium")
        is_collector = (vtype == "collector")
        v = Vehicle(
            name=vd["name"],
            nation_id=slug_to_id[n_slug],
            class_id=class_to_id[c_name],
            rank_id=rank_id,
            is_tree=is_tree,
            is_premium=is_premium,
            is_collector=is_collector,
            rp_cost=vd.get("rp_cost"),
            ge_cost=vd.get("ge_cost"),
            gjn_cost=vd.get("gjn_cost"),  # <-- DODANE
            br_ab=vd.get("br_ab") or (vd.get("br") or {}).get("ab"),
            br_rb=vd.get("br_rb") or (vd.get("br") or {}).get("rb"),
            br_sb=vd.get("br_sb") or (vd.get("br") or {}).get("sb"),
            image_url=vd.get("image_url"),
            wiki_url=vd.get("wiki_url"),
        )

        db.session.add(v)
        db.session.flush()
        key_to_id[key] = v.id
        report["vehicles"] += 1

        # edges osadzone w pojeździe
        ed = vd.get("edges") or {}
        parents = ed.get("parents") or []
        urp = ed.get("unlock_rp")
        if isinstance(parents, list):
            for pk in parents:
                per_vehicle_edges.append((pk, key, urp))

        # folder_of
        folder_key = vd.get("folder_of_key")
        if folder_key:
            folders.append((key, folder_key))

    # --- folder_of po utworzeniu wszystkich ID ---
    for variant_key, parent_key in folders:
        v_id = key_to_id.get(variant_key)
        p_id = key_to_id.get(parent_key)
        if v_id and p_id:
            v = Vehicle.query.get(v_id)
            v.folder_of = p_id
        else:
            report["warnings"].append(f"Folder link unresolved: {variant_key} -> {parent_key}")

    # --- edges z pojazdów i globalne ---
    created_edges = 0

    def _create_edge(pkey: str, ckey: str, urp_val: int | None):
        nonlocal created_edges
        p = key_to_id.get(pkey)
        c = key_to_id.get(ckey)
        if not p or not c:
            report["warnings"].append(f"Edge unresolved: {pkey} -> {ckey}")
            return
        exists = VehicleEdge.query.filter_by(parent_id=p, child_id=c).first()
        if exists:
            return
        db.session.add(VehicleEdge(parent_id=p, child_id=c, unlock_rp=(int(urp_val) if urp_val else None)))
        created_edges += 1

    # a) zdefiniowane przy pojazdach
    for pk, ck, urp in per_vehicle_edges:
        _create_edge(pk, ck, urp)

    # b) globalne
    for ed in data.get("edges", []):
        _create_edge(ed.get("parent_key"), ed.get("child_key"), ed.get("unlock_rp"))

    report["edges"] = created_edges

    db.session.commit()
    return report


def import_from_json_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    """Publiczna wersja przyjmująca już sparsowany słownik JSON."""
    return _import_from_data(data)


def import_from_json_file(path: str) -> Dict[str, Any]:
    """Publiczna wersja wczytująca JSON z pliku."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return _import_from_data(data)
