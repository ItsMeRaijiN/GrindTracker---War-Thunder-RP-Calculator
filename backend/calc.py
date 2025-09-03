from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select, asc
from sqlalchemy.orm import Session

from models import db, Vehicle, VehicleEdge, Rank


# Uwaga: stała dla premium. W War Thunder premium zwykle daje +100% RP.
# Jeśli chcesz inną wartość – zmień tu na 1.5, 1.65 itd.
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


def list_variants_for_parent(parent_id: int) -> List[Vehicle]:
    """Wszystkie warianty folderowe dla danego rodzica, uporządkowane stabilnie."""
    return (
        Vehicle.query
        .filter(Vehicle.folder_of == parent_id)
        .order_by(asc(Vehicle.rank_id), asc(Vehicle.br_rb), asc(Vehicle.name))
        .all()
    )


def prev_variant_id_if_any(v: Vehicle) -> Optional[int]:
    """Zwraca ID poprzedniego wariantu w folderze (jeśli istnieje)."""
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
    """
    Zwraca listę ID wymaganych poprzedników do odblokowania:
    - wszyscy rodzice po krawędziach
    - rodzic folderu (jeśli to wariant)
    - poprzedni wariant z folderu (jeśli istnieje)
    """
    v = Vehicle.query.get(vehicle_id)
    if not v:
        return []

    req_ids: set[int] = set()

    # Krawędzie grafu
    for e in VehicleEdge.query.filter_by(child_id=vehicle_id).all():
        req_ids.add(e.parent_id)

    # Folder: rodzic i ewentualnie poprzedni wariant
    if getattr(v, "folder_of", None):
        req_ids.add(v.folder_of)
        pv = prev_variant_id_if_any(v)
        if pv:
            req_ids.add(pv)

    return list(req_ids)


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
        battles = None  # niepoliczalne bez avg_rp_per_battle
    else:
        battles = math.ceil(remaining / effective)

    minutes = None if battles is None else (battles * int(profile.avg_battle_minutes or 0))
    hours = None if minutes is None else round(minutes / 60.0, 2)

    return {
        "vehicle": {
            "id": v.id,
            "name": v.name,
            "rank": v.rank_id,
            "type": "premium" if v.is_premium else ("collector" if v.is_collector else "tree"),
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
