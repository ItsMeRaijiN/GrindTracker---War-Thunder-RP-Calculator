from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import asc

from models import Vehicle, VehicleEdge

# Współczynnik konta premium (domyślnie +100% RP)
PREMIUM_RP_MULT = 2.0


@dataclass
class ProfileParams:
    avg_rp_per_battle: int = 0
    avg_battle_minutes: int = 0
    has_premium: bool = False
    booster_percent: Optional[int] = None     # 50 -> +50%
    skill_bonus_percent: Optional[int] = None # 10 -> +10%

    @classmethod
    def from_row(cls, row) -> "ProfileParams":
        if row is None:
            return cls()
        return cls(
            avg_rp_per_battle=row.avg_rp_per_battle or 0,
            avg_battle_minutes=row.avg_battle_minutes or 0,
            has_premium=bool(row.has_premium),
            booster_percent=row.booster_percent,
            skill_bonus_percent=row.skill_bonus_percent,
        )

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "ProfileParams":
        d = d or {}
        return cls(
            avg_rp_per_battle=int(d.get("avg_rp_per_battle") or 0),
            avg_battle_minutes=int(d.get("avg_battle_minutes") or 0),
            has_premium=bool(d.get("has_premium") or False),
            booster_percent=(int(d["booster_percent"]) if d.get("booster_percent") is not None else None),
            skill_bonus_percent=(int(d["skill_bonus_percent"]) if d.get("skill_bonus_percent") is not None else None),
        )


def effective_rp_per_battle(p: ProfileParams) -> float:
    """Policzenie efektywnego RP/battle z mnożnikami premium/booster/skill."""
    mult = 1.0
    if p.has_premium:
        mult *= PREMIUM_RP_MULT
    if p.booster_percent:
        mult *= (1.0 + (p.booster_percent / 100.0))
    if p.skill_bonus_percent:
        mult *= (1.0 + (p.skill_bonus_percent / 100.0))
    return max(0.0, float(p.avg_rp_per_battle) * mult)


# ---------- Recent battles (5 ostatnich) ----------
def _normalize_base_rp(rp: float, premium: bool, booster_percent: Optional[int]) -> float:
    """Zdejmuje bonusy (premka, booster) z wyniku RP."""
    denom = 1.0
    if premium:
        denom *= PREMIUM_RP_MULT
    if booster_percent is not None:
        denom *= (1.0 + (booster_percent / 100.0))
    if denom <= 0:
        return float(rp)
    return float(rp) / denom

def summarize_recent_battles(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Zwraca bazową średnią RP/bitwę (po zdjęciu bonusów) oraz średni czas.
    rows: [{rp, minutes, premium, booster_percent}]
    """
    safe = []
    for r in rows or []:
        try:
            rp = float(r.get("rp") or 0)
            minutes = float(r.get("minutes") or 0)
            premium = bool(r.get("premium") or False)
            booster = r.get("booster_percent")
            booster = int(booster) if booster not in (None, "") else None
            safe.append((rp, minutes, premium, booster))
        except Exception:
            continue

    if not safe:
        return {"samples": 0, "avg_rp_per_battle": 0, "avg_battle_minutes": 0}

    base_sum = 0.0
    min_vals: List[float] = []
    for rp, minutes, premium, booster in safe:
        base_sum += _normalize_base_rp(rp, premium, booster)
        if minutes > 0:
            min_vals.append(minutes)

    samples = len(safe)
    avg_rp = base_sum / samples if samples else 0.0
    avg_min = (sum(min_vals) / len(min_vals)) if min_vals else 0.0

    return {
        "samples": samples,
        "avg_rp_per_battle": int(round(avg_rp)),
        "avg_battle_minutes": int(round(avg_min)),
    }


# ---------- Warianty w folderach / wymagania ----------
def list_variants_for_parent(parent_id: int) -> List[Vehicle]:
    return (
        Vehicle.query
        .filter(Vehicle.folder_of == parent_id)
        .order_by(asc(Vehicle.rank_id), asc(Vehicle.br_rb), asc(Vehicle.name))
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
    v = Vehicle.query.get(vehicle_id)
    if not v:
        return []

    req_ids: set[int] = set()

    for e in VehicleEdge.query.filter_by(child_id=vehicle_id).all():
        req_ids.add(e.parent_id)

    if getattr(v, "folder_of", None):
        req_ids.add(v.folder_of)
        pv = prev_variant_id_if_any(v)
        if pv:
            req_ids.add(pv)

    return list(req_ids)


# ---------- Estymacje ----------
def estimate_to_unlock(vehicle_id: int, current_rp: int, profile: ProfileParams) -> Dict[str, Any]:
    """
    Szacuje liczbę bitew i czas potrzebny do odblokowania pojazdu.
    Nie sprawdza, czy spełniono wymagania — to możesz odczytać przez prerequisites_for().
    """
    v = Vehicle.query.get(vehicle_id)
    if not v or not v.rp_cost:
        return {
            "vehicle_id": vehicle_id,
            "error": "Vehicle not found or rp_cost missing",
        }

    effective = effective_rp_per_battle(profile)
    remaining = max(0, int(v.rp_cost) - int(current_rp or 0))

    if remaining == 0:
        battles = 0
    elif effective <= 0.0:
        battles = None
    else:
        battles = math.ceil(remaining / effective)

    minutes = None if battles is None else (battles * int(profile.avg_battle_minutes or 0))
    hours = None if minutes is None else round(minutes / 60.0, 2)

    return {
        "vehicle": {
            "id": v.id,
            "name": v.name,
            "rank": v.rank_id,
            "type": v.type_str,
            "rp_cost": v.rp_cost,
        },
        "rp_current": int(current_rp or 0),
        "rp_remaining": remaining,
        "effective_rp_per_battle": effective,
        "battles_needed": battles,
        "minutes_needed": minutes,
        "hours_needed": hours,
        "prerequisite_ids": prerequisites_for(vehicle_id),
    }

def estimate(
    vehicle_id: int,
    current_rp: int,
    *,
    profile: ProfileParams,
    recent_battles: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Wersja przyjmująca albo średnie z profilu, albo recent_battles (z których liczymy bazę),
    a następnie nakładamy prognozę (premium/booster/skill).
    """
    base_from_recent: Optional[Dict[str, Any]] = None

    if recent_battles:
        base_from_recent = summarize_recent_battles(recent_battles)
        # jeśli mamy próbki – używamy ich jako bazowego avg
        if base_from_recent.get("samples", 0) > 0:
            profile = ProfileParams(
                avg_rp_per_battle=int(base_from_recent["avg_rp_per_battle"]),
                avg_battle_minutes=int(base_from_recent["avg_battle_minutes"]),
                has_premium=profile.has_premium,
                booster_percent=profile.booster_percent,
                skill_bonus_percent=profile.skill_bonus_percent,
            )

    result = estimate_to_unlock(vehicle_id, current_rp, profile)
    if base_from_recent:
        result["base_from_recent"] = base_from_recent
    return result
