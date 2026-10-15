#!/usr/bin/env python3
"""
Initialize or update the Aktogay Digital Mine twins in Eclipse Ditto.
Performs idempotent PUT requests for all twins defined in twins.json.
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

DITTO_URL = os.environ.get("DITTO_URL", "http://localhost:8080").rstrip("/")
DITTO_USER = os.environ.get("DITTO_USER", "ditto")
DITTO_PASSWORD = os.environ.get("DITTO_PASSWORD", "")
TWINS_FILE = os.environ.get(
    "TWINS_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "twins.json"),
)

# If DITTO_PASSWORD is empty, check deploy/compose/.env
if not DITTO_PASSWORD:
    env_file = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "deploy", "compose", ".env"
    )
    if os.path.exists(env_file):
        for line in open(env_file):
            if line.startswith("DITTO_PASSWORD="):
                DITTO_PASSWORD = line.strip().split("=", 1)[1]
                break

if not DITTO_PASSWORD:
    # default fallback for local dev if not yet set
    DITTO_PASSWORD = "ditto"

AUTH = "Basic " + base64.b64encode(f"{DITTO_USER}:{DITTO_PASSWORD}".encode()).decode()


def put_thing(thing_id: str, body: dict) -> int:
    req = urllib.request.Request(
        f"{DITTO_URL}/api/2/things/{thing_id}",
        data=json.dumps(body).encode("utf-8"),
        method="PUT",
        headers={"Authorization": AUTH, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status


def main():
    if not os.path.exists(TWINS_FILE):
        print(f"Error: twins file not found at {TWINS_FILE}", file=sys.stderr)
        return 1

    twins = json.load(open(TWINS_FILE, encoding="utf-8"))
    print(f"Starting registration of {len(twins)} twins in {DITTO_URL}...")

    # Parents must exist before children reference them via _parents
    success_count = 0
    for thing_id, body in twins.items():
        registered = False
        for attempt in range(15):
            try:
                status = put_thing(thing_id, body)
                status_label = "created" if status == 201 else "updated"
                print(f"[{status_label}] {thing_id}")
                success_count += 1
                registered = True
                break
            except (urllib.error.URLError, TimeoutError) as exc:
                time.sleep(2)
        if not registered:
            print(f"[FAILED]  {thing_id}", file=sys.stderr)
            return 1

    print(f"All {success_count} Aktogay twins are successfully active in Eclipse Ditto!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
