from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import UniqueConstraint, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime

db = SQLAlchemy()


# Słowniki
class Nation(db.Model):
    __tablename__ = "nations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(unique=True, nullable=False)  # np. "usa", "germany"
    name: Mapped[str] = mapped_column(nullable=False)               # np. "USA"
    flag_url: Mapped[str | None] = mapped_column(nullable=True)

    def __repr__(self) -> str:
        return f"<Nation {self.slug}>"


class VehicleClass(db.Model):
    __tablename__ = "vehicle_classes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(unique=True, nullable=False)  # army|helicopter|aviation|coastal|bluewater

    def __repr__(self) -> str:
        return f"<VehicleClass {self.name}>"


class Rank(db.Model):
    __tablename__ = "ranks"

    id: Mapped[int] = mapped_column(primary_key=True)  # 1..8
    label: Mapped[str] = mapped_column(nullable=False)

    def __repr__(self) -> str:
        return f"<Rank {self.id}:{self.label}>"


# Pojazd
class Vehicle(db.Model):
    __tablename__ = "vehicles"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(nullable=False, index=True)

    nation_id: Mapped[int] = mapped_column(ForeignKey("nations.id"), nullable=False, index=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("vehicle_classes.id"), nullable=False, index=True)
    rank_id: Mapped[int] = mapped_column(ForeignKey("ranks.id"), nullable=False, index=True)

    # typy: drzewkowy/premium/kolekcjonerski
    is_tree: Mapped[bool] = mapped_column(default=True, nullable=False)
    is_premium: Mapped[bool] = mapped_column(default=False, nullable=False)
    is_collector: Mapped[bool] = mapped_column(default=False, nullable=False)

    # BR i koszty (opcjonalne, bo nie zawsze je od razu mamy)
    br_ab: Mapped[float | None] = mapped_column(nullable=True)
    br_rb: Mapped[float | None] = mapped_column(nullable=True)
    br_sb: Mapped[float | None] = mapped_column(nullable=True)

    rp_cost: Mapped[int | None] = mapped_column(nullable=True)
    ge_cost: Mapped[int | None] = mapped_column(nullable=True)

    image_url: Mapped[str | None] = mapped_column(nullable=True)
    wiki_url: Mapped[str | None] = mapped_column(nullable=True)

    # relacje (opcjonalne, przydadzą się później)
    nation = relationship("Nation")
    vclass = relationship("VehicleClass")
    rank = relationship("Rank")

    def __repr__(self) -> str:
        return f"<Vehicle {self.id}:{self.name}>"


# Relacje drzewka: poprzednik -> następca
class VehicleEdge(db.Model):
    __tablename__ = "vehicle_edges"
    __table_args__ = (UniqueConstraint("parent_id", "child_id", name="uq_edge_parent_child"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    parent_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), nullable=False, index=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), nullable=False, index=True)

    # jeżeli koszt RP odblokowania różni się od rp_cost dziecka (opcjonalnie)
    unlock_rp: Mapped[int | None] = mapped_column(nullable=True)

    parent = relationship("Vehicle", foreign_keys=[parent_id])
    child = relationship("Vehicle", foreign_keys=[child_id])

    def __repr__(self) -> str:
        return f"<Edge {self.parent_id}->{self.child_id}>"


# Użytkownik i progres
class User(db.Model):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, nullable=False)

    profile = relationship("UserProfile", back_populates="user", uselist=False)

    def __repr__(self) -> str:
        return f"<User {self.email}>"


class UserProfile(db.Model):
    __tablename__ = "user_profiles"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    avg_rp_per_battle: Mapped[int | None] = mapped_column(nullable=True)
    avg_battle_minutes: Mapped[int | None] = mapped_column(nullable=True)
    has_premium: Mapped[bool] = mapped_column(default=False, nullable=False)
    booster_percent: Mapped[int | None] = mapped_column(nullable=True)      # np. 50 = +50%
    skill_bonus_percent: Mapped[int | None] = mapped_column(nullable=True)  # ewentualny mnożnik własny

    user = relationship("User", back_populates="profile")


class UserVehicleProgress(db.Model):
    __tablename__ = "user_vehicle_progress"
    __table_args__ = (UniqueConstraint("user_id", "vehicle_id", name="uq_user_vehicle"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), nullable=False, index=True)

    # locked | researching | unlocked | purchased
    status: Mapped[str] = mapped_column(default="locked", nullable=False)
    rp_earned: Mapped[int] = mapped_column(default=0, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(nullable=True)

    user = relationship("User")
    vehicle = relationship("Vehicle")
