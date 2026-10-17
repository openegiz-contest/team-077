#!/usr/bin/env python3
"""
Aktogay Digital Mine Simulator for OpenEgiz (Team AURA).

Simulates:
- 5 x CAT 793F haul trucks (227t payload) with realistic grade resistance,
  speed limits, fuel consumption, and tyre TKPH.
- 3 x CAT 7495 electric rope shovels (EX-01 high-grade 0.64% Cu, EX-02 ROM 0.40% Cu,
  EX-03 waste 0.08% Cu).
- Primary gyratory crusher (Metso 60-89) with real-time ore blending (шихтовка)
  targeting 0.48% +/- 0.04% Cu feed grade.
- What-If scenarios triggered dynamically via built-in HTTP REST API (port 5000):
    1. EX-01 shovel breakdown + dynamic rerouting & stockpile blending
    2. Haul ramp collapse + detour via bypass road (+1.2 km)
    3. Severe face grade dilution + adaptive blend correction
- Publishes Eclipse Ditto protocol commands to MQTT (telemetry/<thing_id>).
- Provides /api/state for real-time 3D Three.js spatial visualization.
"""

import argparse
import http.server
import json
import logging
import math
import mimetypes
import os
import random
import signal
import sys
import threading
import time
import urllib.parse

try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None

NAMESPACE = "org.openegiz.aktogay"
TOPIC_PREFIX = "telemetry"
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("aktogay_sim")

# --- Mining & Physics Constants (CAT 793F & Aktogay Pit) ---
TRUCK_CAPACITY_T = 227.0
TRUCK_EMPTY_WEIGHT_T = 159.0
TRUCK_FUEL_CAPACITY_L = 2839.0
PASS_SECONDS = 35.0
BUCKET_TONNES = 80.0
DUMP_SECONDS = 50.0

# Speeds (km/h)
SPEED_UPHILL_LOADED_KMH = 14.5
SPEED_DOWNHILL_EMPTY_KMH = 38.0
SPEED_FLAT_LOADED_KMH = 32.0
SPEED_FLAT_EMPTY_KMH = 45.0

# Fuel consumption rates (litres per hour)
FUEL_RATE_UPHILL_LOADED = 175.0
FUEL_RATE_DOWNHILL_EMPTY = 28.0
FUEL_RATE_FLAT_LOADED = 85.0
FUEL_RATE_FLAT_EMPTY = 42.0
FUEL_RATE_IDLE = 15.0

# Road Distances (km)
DIST_EX1_TO_CRUSHER = 3.6  # From Bench +280m
DIST_EX2_TO_CRUSHER = 4.2  # From Bench +220m
DIST_EX3_TO_WASTE = 2.8    # From Bench +320m to Waste Dump
DIST_DETOUR_EXTRA = 1.4    # Extra km if main ramp is blocked


class Truck:
    def __init__(self, name: str, shovel_target: str, initial_progress: float = 0.0):
        self.name = name
        self.shovel_target = shovel_target  # "excavator-01", "excavator-02", or "excavator-03"
        self.destination = "crusher-01" if shovel_target in ("excavator-01", "excavator-02") else "waste-dump-01"
        self.state = "hauling"
        self.payload_t = TRUCK_CAPACITY_T
        self.speed_kmh = SPEED_UPHILL_LOADED_KMH
        self.grade_in_box = 0.64 if shovel_target == "excavator-01" else (0.40 if shovel_target == "excavator-02" else 0.08)
        if shovel_target == "excavator-01":
            self.total_route_km = DIST_EX1_TO_CRUSHER
        elif shovel_target == "excavator-02":
            self.total_route_km = DIST_EX2_TO_CRUSHER
        else:
            self.total_route_km = DIST_EX3_TO_WASTE
        self.progress_pct = initial_progress
        self.route_position_km = (initial_progress / 100.0) * self.total_route_km
        self.fuel_tank_l = TRUCK_FUEL_CAPACITY_L * 0.92
        self.fuel_rate_lph = FUEL_RATE_UPHILL_LOADED
        self.trips_total = 0
        self.tire_tkph = 250.0
        self.timer = 0.0
        self.current_segment = "ramp_main"

    def features(self):
        return {
            "state": {"value": self.state},
            "payload": {"value": round(self.payload_t, 1), "unit": "t"},
            "speed": {"value": round(self.speed_kmh, 1), "unit": "km/h"},
            "route_position": {"value": round(self.route_position_km, 2), "unit": "km"},
            "route_progress_pct": {"value": round(self.progress_pct, 1), "unit": "%"},
            "current_segment": {"value": self.current_segment},
            "grade_in_box": {"value": round(self.grade_in_box, 3), "unit": "% Cu"},
            "fuel_level": {"value": round((self.fuel_tank_l / TRUCK_FUEL_CAPACITY_L) * 100.0, 1), "unit": "%"},
            "fuel_rate": {"value": round(self.fuel_rate_lph, 1), "unit": "l/h"},
            "trips_total": {"value": self.trips_total, "unit": "trips"},
            "tire_tkph": {"value": round(self.tire_tkph, 1), "unit": "TKPH"},
        }


class Excavator:
    def __init__(self, name: str, face_grade: float, ore_zone: str):
        self.name = name
        self.base_grade = face_grade
        self.face_grade = face_grade
        self.ore_zone = ore_zone
        self.state = "idle"  # "loading", "idle", "breakdown"
        self.passes_total = 0
        self.tonnes_loaded = 0.0
        self.queue = []  # List of trucks waiting

    def features(self):
        return {
            "state": {"value": self.state},
            "face_grade": {"value": round(self.face_grade, 3), "unit": "% Cu"},
            "passes_total": {"value": self.passes_total, "unit": "passes"},
            "tonnes_loaded": {"value": round(self.tonnes_loaded, 1), "unit": "t"},
            "queue_length": {"value": len(self.queue), "unit": "trucks"},
        }


class AktogayPit:
    def __init__(self, seed: int = 42):
        self.rng = random.Random(seed)
        self.sim_time_s = 0.0
        self.target_grade = 0.48

        # Excavators
        self.excavators = {
            "excavator-01": Excavator("excavator-01", 0.64, "high_grade"),
            "excavator-02": Excavator("excavator-02", 0.40, "rom_grade"),
            "excavator-03": Excavator("excavator-03", 0.08, "waste"),
        }

        # Trucks: 2 on EX-01, 2 on EX-02, 1 on EX-03
        self.trucks = [
            Truck("truck-01", "excavator-01", initial_progress=10.0),
            Truck("truck-02", "excavator-01", initial_progress=60.0),
            Truck("truck-03", "excavator-02", initial_progress=25.0),
            Truck("truck-04", "excavator-02", initial_progress=75.0),
            Truck("truck-05", "excavator-03", initial_progress=40.0),
        ]

        # Crusher & Stockpiles
        self.crusher_state = "crushing"
        self.crusher_throughput_tph = 0.0
        self.crusher_hopper_level = 45.0
        self.crusher_tonnes_total = 0.0
        self.crusher_grade_weighted_sum = 0.0
        self.crusher_current_feed_grade = 0.48
        self.recent_dumps = []  # (time, tonnes, grade)

        self.stockpile_tonnes = 45200.0
        self.stockpile_grade = 0.51
        self.waste_dump_tonnes = 0.0
        self.fuel_consumed_total_l = 0.0

        # Safety radar
        self.radar_status = "normal"
        self.displacement_rate_mm = 0.2
        self.road_status = "open"

        # What-If Flags
        self.whatif_ex1_failure = False
        self.whatif_road_blocked = False
        self.whatif_dilution = False

    def trigger_ex1_failure(self, active: bool = None) -> bool:
        if active is None:
            active = not self.whatif_ex1_failure
        if active == self.whatif_ex1_failure:
            return self.whatif_ex1_failure
        self.whatif_ex1_failure = active
        if active:
            self.excavators["excavator-01"].state = "breakdown"
            # Reroute any trucks heading to EX-01
            for truck in self.trucks:
                if truck.shovel_target == "excavator-01" and truck.state in ("returning", "queued_at_excavator"):
                    truck.shovel_target = "excavator-02"
                    truck.current_segment = "diverted_to_ex2"
        else:
            self.excavators["excavator-01"].state = "idle"
            for truck in self.trucks:
                if truck.current_segment == "diverted_to_ex2":
                    truck.current_segment = "ramp_down"
        return self.whatif_ex1_failure

    def trigger_road_block(self, active: bool = None) -> bool:
        if active is None:
            active = not self.whatif_road_blocked
        if active == self.whatif_road_blocked:
            return self.whatif_road_blocked
        self.whatif_road_blocked = active
        if active:
            self.radar_status = "alert_collapse"
            self.displacement_rate_mm = 14.8
            self.road_status = "closed_collapse"
            for truck in self.trucks:
                if truck.state in ("hauling", "returning"):
                    truck.total_route_km += DIST_DETOUR_EXTRA
                    truck.current_segment = "detour_bypass"
        else:
            self.radar_status = "normal"
            self.displacement_rate_mm = 0.2
            self.road_status = "open"
            for truck in self.trucks:
                if truck.shovel_target == "excavator-01":
                    truck.total_route_km = DIST_EX1_TO_CRUSHER
                elif truck.shovel_target == "excavator-02":
                    truck.total_route_km = DIST_EX2_TO_CRUSHER
                else:
                    truck.total_route_km = DIST_EX3_TO_WASTE
                if truck.current_segment == "detour_bypass":
                    truck.current_segment = "ramp_main" if truck.state == "hauling" else "ramp_down"
        return self.whatif_road_blocked

    def trigger_dilution(self, active: bool = None) -> bool:
        if active is None:
            active = not self.whatif_dilution
        if active == self.whatif_dilution:
            return self.whatif_dilution
        self.whatif_dilution = active
        if active:
            self.excavators["excavator-02"].face_grade = 0.22  # Sudden dilution
        else:
            self.excavators["excavator-02"].face_grade = self.excavators["excavator-02"].base_grade
        return self.whatif_dilution

    def reset_whatif(self):
        self.trigger_ex1_failure(False)
        self.trigger_road_block(False)
        self.trigger_dilution(False)

    def dispatch_decision(self, truck: Truck):
        """Dynamic dispatch & ore blending algorithm (Шихтовка)."""
        if truck.name == "truck-05":
            # Dedicated waste truck
            truck.shovel_target = "excavator-03"
            truck.destination = "waste-dump-01"
            truck.total_route_km = DIST_EX3_TO_WASTE + (DIST_DETOUR_EXTRA if self.whatif_road_blocked else 0.0)
            return

        if self.whatif_ex1_failure:
            truck.shovel_target = "excavator-02"
            truck.destination = "crusher-01"
            truck.total_route_km = DIST_EX2_TO_CRUSHER + (DIST_DETOUR_EXTRA if self.whatif_road_blocked else 0.0)
            return

        # Target grade is 0.48% Cu. EX-01 is 0.64%, EX-02 is 0.40% (or 0.22% if diluted).
        # Check current moving average grade at crusher
        current_grade = self.crusher_current_feed_grade
        ex1_queue = len(self.excavators["excavator-01"].queue)
        ex2_queue = len(self.excavators["excavator-02"].queue)

        if current_grade < self.target_grade and ex1_queue <= ex2_queue + 1:
            truck.shovel_target = "excavator-01"
            truck.destination = "crusher-01"
            truck.total_route_km = DIST_EX1_TO_CRUSHER + (DIST_DETOUR_EXTRA if self.whatif_road_blocked else 0.0)
        else:
            truck.shovel_target = "excavator-02"
            truck.destination = "crusher-01"
            truck.total_route_km = DIST_EX2_TO_CRUSHER + (DIST_DETOUR_EXTRA if self.whatif_road_blocked else 0.0)

    def step(self, dt: float):
        self.sim_time_s += dt

        # Simulate natural stochastic grade noise in faces
        for ex in self.excavators.values():
            if ex.name != "excavator-03" and not self.whatif_dilution:
                noise = self.rng.gauss(0, 0.001 * math.sqrt(dt))
                ex.face_grade = max(0.1, min(1.2, ex.face_grade + noise))

        # Update trucks
        for truck in self.trucks:
            self._step_truck(truck, dt)

        # Update crusher metrics (sliding 1-hour window for throughput)
        self.recent_dumps = [(t, w, g) for t, w, g in self.recent_dumps if self.sim_time_s - t <= 3600.0]
        window_tonnes = sum(w for _, w, _ in self.recent_dumps)
        window_seconds = min(self.sim_time_s, 3600.0) or 1.0
        self.crusher_throughput_tph = (window_tonnes * 3600.0) / window_seconds

        if self.recent_dumps:
            total_g = sum(w * g for _, w, g in self.recent_dumps)
            self.crusher_current_feed_grade = total_g / window_tonnes
        else:
            self.crusher_current_feed_grade = 0.48

    def _step_truck(self, truck: Truck, dt: float):
        ex = self.excavators.get(truck.shovel_target)

        if truck.state == "queued_at_excavator":
            truck.speed_kmh = 0.0
            truck.fuel_rate_lph = FUEL_RATE_IDLE
            if ex.state == "breakdown":
                # Emergency reroute
                self.dispatch_decision(truck)
                truck.state = "returning"
                return

            if truck not in ex.queue:
                ex.queue.append(truck)

            # If shovel is idle and this truck is first in line
            if ex.state == "idle" and ex.queue and ex.queue[0] == truck:
                ex.state = "loading"
                truck.state = "loading"
                truck.timer = 0.0
                truck.payload_t = 0.0

        elif truck.state == "loading":
            truck.speed_kmh = 0.0
            truck.fuel_rate_lph = 20.0
            truck.timer += dt
            ex.state = "loading"

            # Fill bucket passes
            while truck.timer >= PASS_SECONDS and truck.payload_t < TRUCK_CAPACITY_T:
                truck.timer -= PASS_SECONDS
                truck.payload_t = min(TRUCK_CAPACITY_T, truck.payload_t + BUCKET_TONNES)
                ex.passes_total += 1
                ex.tonnes_loaded += BUCKET_TONNES

            if truck.payload_t >= TRUCK_CAPACITY_T:
                if ex.queue and ex.queue[0] == truck:
                    ex.queue.pop(0)
                ex.state = "idle"
                truck.state = "hauling"
                truck.grade_in_box = ex.face_grade
                truck.progress_pct = 0.0
                truck.route_position_km = 0.0
                truck.current_segment = "ramp_main" if not self.whatif_road_blocked else "detour_bypass"

        elif truck.state == "hauling":
            # Loaded climbing up pit ramps
            truck.speed_kmh = SPEED_UPHILL_LOADED_KMH
            truck.fuel_rate_lph = FUEL_RATE_UPHILL_LOADED
            dist_step = (truck.speed_kmh / 3600.0) * dt
            truck.route_position_km += dist_step
            truck.progress_pct = min(100.0, (truck.route_position_km / truck.total_route_km) * 100.0)

            # Heat up tyres on heavy haul
            truck.tire_tkph = min(320.0, truck.tire_tkph + 0.1 * dt)

            if truck.route_position_km >= truck.total_route_km:
                truck.state = "dumping"
                truck.speed_kmh = 0.0
                truck.timer = 0.0
                truck.progress_pct = 100.0

        elif truck.state == "dumping":
            truck.speed_kmh = 0.0
            truck.fuel_rate_lph = FUEL_RATE_IDLE
            truck.timer += dt

            if truck.timer >= DUMP_SECONDS:
                # Record dump
                if truck.destination == "crusher-01":
                    self.crusher_tonnes_total += truck.payload_t
                    self.crusher_grade_weighted_sum += truck.payload_t * truck.grade_in_box
                    self.recent_dumps.append((self.sim_time_s, truck.payload_t, truck.grade_in_box))
                else:
                    self.waste_dump_tonnes += truck.payload_t

                truck.trips_total += 1
                truck.payload_t = 0.0
                truck.grade_in_box = 0.0
                truck.state = "returning"
                truck.route_position_km = 0.0
                truck.progress_pct = 0.0

                # Make next dispatch decision
                self.dispatch_decision(truck)
                truck.current_segment = "ramp_down"

        elif truck.state == "returning":
            # Empty descending into pit
            truck.speed_kmh = SPEED_DOWNHILL_EMPTY_KMH
            truck.fuel_rate_lph = FUEL_RATE_DOWNHILL_EMPTY
            dist_step = (truck.speed_kmh / 3600.0) * dt
            truck.route_position_km += dist_step
            truck.progress_pct = min(100.0, (truck.route_position_km / truck.total_route_km) * 100.0)

            # Cool down tyres
            truck.tire_tkph = max(200.0, truck.tire_tkph - 0.08 * dt)

            if truck.route_position_km >= truck.total_route_km:
                truck.state = "queued_at_excavator"
                truck.speed_kmh = 0.0
                truck.progress_pct = 0.0
                truck.route_position_km = 0.0

        # Burn fuel
        fuel_burned = (truck.fuel_rate_lph / 3600.0) * dt
        truck.fuel_tank_l = max(50.0, truck.fuel_tank_l - fuel_burned)
        self.fuel_consumed_total_l += fuel_burned

    def snapshot(self):
        """Assemble full state dictionary for Eclipse Ditto and 3D UI."""
        avg_grade = (self.crusher_grade_weighted_sum / self.crusher_tonnes_total) if self.crusher_tonnes_total > 0 else 0.48
        energy_intensity = (self.fuel_consumed_total_l / self.crusher_tonnes_total) if self.crusher_tonnes_total > 0 else 0.0

        state_dict = {
            "mine-01": {
                "tonnes_mined": {"value": round(self.crusher_tonnes_total, 1), "unit": "t"},
                "avg_grade": {"value": round(avg_grade, 3), "unit": "% Cu"},
                "trucks_active": {"value": len(self.trucks), "unit": "trucks"},
                "fuel_consumed_total": {"value": round(self.fuel_consumed_total_l, 1), "unit": "l"},
                "energy_intensity": {"value": round(energy_intensity, 2), "unit": "l/t"},
                "fuel_rate": {"value": round(sum(t.fuel_rate_lph for t in self.trucks), 1), "unit": "l/h"},
                "current_feed_grade": {"value": round(self.crusher_current_feed_grade, 3), "unit": "% Cu"},
            },
            "crusher-01": {
                "state": {"value": self.crusher_state},
                "throughput": {"value": round(self.crusher_throughput_tph, 1), "unit": "t/h"},
                "feed_grade": {"value": round(self.crusher_current_feed_grade, 3), "unit": "% Cu"},
                "hopper_level": {"value": round(self.crusher_hopper_level, 1), "unit": "%"},
                "tonnes_total": {"value": round(self.crusher_tonnes_total, 1), "unit": "t"},
                "power_draw_kw": {"value": round(450.0 + self.crusher_throughput_tph * 0.15, 1), "unit": "kW"},
            },
            "stockpile-01": {
                "tonnes_stored": {"value": round(self.stockpile_tonnes, 1), "unit": "t"},
                "avg_grade": {"value": round(self.stockpile_grade, 3), "unit": "% Cu"},
            },
            "waste-dump-01": {
                "tonnes_dumped": {"value": round(self.waste_dump_tonnes, 1), "unit": "t"},
            },
            "slope-radar-01": {
                "status": {"value": self.radar_status},
                "displacement_rate_mm_day": {"value": round(self.displacement_rate_mm, 2), "unit": "mm/day"},
                "road_status": {"value": self.road_status},
            },
        }

        for ex in self.excavators.values():
            state_dict[ex.name] = ex.features()

        for truck in self.trucks:
            state_dict[truck.name] = truck.features()

        return state_dict


def ditto_modify_features(name: str, features: dict) -> dict:
    """Format single twin update as Eclipse Ditto protocol modify command."""
    return {
        "topic": f"{NAMESPACE}/{name}/things/twin/commands/modify",
        "path": "/features",
        "value": {feat: {"properties": props} for feat, props in features.items()},
    }


# --- REST API Server for What-If and 3D Visualization ---
class WhatIfHandler(http.server.BaseHTTPRequestHandler):
    pit: AktogayPit = None

    def log_message(self, format, *args):
        pass  # Suppress default noisy access logs

    def _send_json(self, status_code: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(200, {"status": "ok"})

    def do_HEAD(self):
        self.do_GET()

    def _parse_active_param(self, path: str):
        if "?" in path:
            query = path.split("?", 1)[1]
            params = urllib.parse.parse_qs(query)
            if "active" in params:
                val = params["active"][0].lower()
                if val in ("true", "1", "yes", "on"):
                    return True
                elif val in ("false", "0", "no", "off"):
                    return False
        cl = self.headers.get("Content-Length")
        if cl and cl.isdigit():
            length = int(cl)
            if 0 < length < 65536:
                try:
                    body = self.rfile.read(length)
                    data = json.loads(body.decode("utf-8"))
                    if isinstance(data, dict) and "active" in data:
                        return bool(data["active"])
                except Exception:
                    pass
        return None

    def _handle_whatif(self, path: str):
        endpoint = path.split("?")[0].rstrip("/")
        active_target = self._parse_active_param(path)

        if endpoint == "/api/whatif/ex1-fail":
            new_state = self.pit.trigger_ex1_failure(active_target)
            if new_state:
                msg = "[Симуляция] Активирована авария экскаватора EX-01. Подача богатой руды остановлена, самосвалы перенаправлены на Склад-01."
                status = "active"
            else:
                msg = "[Штатный режим] Экскаватор EX-01 возвращен в строй. Подача руды восстановлена."
                status = "inactive"
            self._send_json(200, {"scenario": "ex1_failure", "status": status, "active": new_state, "message": msg})
        elif endpoint == "/api/whatif/road-block":
            new_state = self.pit.trigger_road_block(active_target)
            if new_state:
                msg = "[Симуляция] Активирован обвал на горизонте +240м. Основной съезд закрыт, самосвалы направлены по объездной трассе (+1.4 км)."
                status = "active"
            else:
                msg = "[Штатный режим] Завал на съезде расчищен. Движение по основной трассе открыто."
                status = "inactive"
            self._send_json(200, {"scenario": "road_blocked", "status": status, "active": new_state, "message": msg})
        elif endpoint == "/api/whatif/dilution":
            new_state = self.pit.trigger_dilution(active_target)
            if new_state:
                msg = "[Симуляция] Активировано разубоживание в забое EX-02 (содержание упало до 0.22% Cu). Диспетчер адаптирует шихтовку."
                status = "active"
            else:
                msg = "[Штатный режим] Содержание руды в забое EX-02 нормализовано (0.40% Cu)."
                status = "inactive"
            self._send_json(200, {"scenario": "dilution", "status": status, "active": new_state, "message": msg})
        elif endpoint == "/api/whatif/reset":
            self.pit.reset_whatif()
            msg = "[Штатный режим] Все сценарии «Что-Если» сброшены в исходное состояние."
            self._send_json(200, {"scenario": "all", "status": "reset", "active": False, "message": msg})
        else:
            self._send_json(404, {"error": "unknown scenario endpoint"})

    def _serve_static(self, rel_path: str):
        if rel_path in ("", "/", "/index.html"):
            rel_path = "index.html"
        clean_rel = rel_path.lstrip("/").split("?")[0]
        full_path = os.path.normpath(os.path.join(WEB_DIR, clean_rel))
        if not full_path.startswith(WEB_DIR) or not os.path.isfile(full_path):
            self._send_json(404, {"error": f"file {clean_rel} not found"})
            return

        ctype, _ = mimetypes.guess_type(full_path)
        if not ctype:
            ctype = "application/octet-stream"
        try:
            with open(full_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(content)
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})

    def do_GET(self):
        if self.path == "/api/state":
            snap = self.pit.snapshot()
            meta = {
                "whatif": {
                    "ex1_failure": self.pit.whatif_ex1_failure,
                    "road_blocked": self.pit.whatif_road_blocked,
                    "dilution": self.pit.whatif_dilution,
                },
                "sim_time_min": round(self.pit.sim_time_s / 60.0, 1),
                "twins": snap,
            }
            self._send_json(200, meta)
        elif self.path.startswith("/api/whatif/"):
            self._handle_whatif(self.path)
        else:
            self._serve_static(self.path)

    def do_POST(self):
        if self.path.startswith("/api/whatif/"):
            self._handle_whatif(self.path)
        else:
            self._send_json(404, {"error": "unknown scenario endpoint"})


def start_api_server(pit: AktogayPit, port: int = 5000):
    WhatIfHandler.pit = pit
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), WhatIfHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    log.info(f"What-If REST API & 3D state server listening on http://0.0.0.0:{port}")
    return server


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--mqtt-host", default=os.environ.get("MQTT_HOST", "localhost"))
    p.add_argument("--mqtt-port", type=int, default=int(os.environ.get("MQTT_PORT", "1883")))
    p.add_argument("--api-port", type=int, default=int(os.environ.get("API_PORT", "5000")))
    p.add_argument("--interval", type=float, default=float(os.environ.get("SIM_INTERVAL", "1.0")),
                   help="Real seconds between updates")
    p.add_argument("--speedup", type=float, default=float(os.environ.get("SIM_SPEEDUP", "5.0")),
                   help="Simulated seconds per real second")
    p.add_argument("--dry-run", action="store_true", help="Run without MQTT")
    args = p.parse_args()

    pit = AktogayPit()
    start_api_server(pit, port=args.api_port)

    client = None
    if not args.dry_run and mqtt is not None:
        try:
            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"aktogay-sim-{os.getpid()}")
            client.connect(args.mqtt_host, args.mqtt_port, keepalive=30)
            client.loop_start()
            log.info(f"Connected to MQTT broker at {args.mqtt_host}:{args.mqtt_port}")
        except Exception as exc:
            log.warning(f"MQTT not available ({exc}). Running simulator in standalone/API mode.")
            client = None
    else:
        log.info("Running in dry-run mode (MQTT publishing disabled)")

    stop = False

    def on_signal(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)

    step_count = 0
    log.info(f"Aktogay simulation loop started. Interval: {args.interval}s, Speedup: {args.speedup}x")

    while not stop:
        dt = args.interval * args.speedup
        pit.step(dt)
        snap = pit.snapshot()

        if client:
            for name, features in snap.items():
                msg = json.dumps(ditto_modify_features(name, features))
                client.publish(f"{TOPIC_PREFIX}/{name}", msg, qos=0)

        step_count += 1
        if step_count % 10 == 0:
            m = snap["mine-01"]
            cr = snap["crusher-01"]
            log.info(
                f"Sim {pit.sim_time_s/60.0:5.1f} min | Mined: {m['tonnes_mined']['value']:7.1f} t | "
                f"Feed Grade: {cr['feed_grade']['value']:.3f} % Cu | Fuel: {m['fuel_consumed_total']['value']:6.1f} L | "
                f"Trucks: {', '.join(f'{t.name}:{t.state[:4]}' for t in pit.trucks)}"
            )

        time.sleep(args.interval)

    if client:
        client.loop_stop()
        client.disconnect()
    log.info("Simulator stopped cleanly.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
