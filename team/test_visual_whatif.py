import json
import os
import subprocess
import time
import urllib.request
import pytest

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_whatif_api_and_state_lifecycle():
    """Verify all What-If endpoints toggle states and affect pit twins accurately."""
    # Launch simulator
    proc = subprocess.Popen(
        ["python", "team/simulator.py", "--dry-run", "--api-port", "5015"],
        cwd=REPO_DIR
    )
    base_url = "http://localhost:5015"

    try:
        # Wait for simulator
        connected = False
        for _ in range(30):
            try:
                with urllib.request.urlopen(f"{base_url}/api/state", timeout=1) as resp:
                    if resp.status == 200:
                        connected = True
                        break
            except Exception:
                time.sleep(0.3)
        assert connected, "Simulator failed to start on port 5015"

        # 1. Baseline state
        with urllib.request.urlopen(f"{base_url}/api/state") as resp:
            data = json.loads(resp.read().decode())
            assert data["whatif"]["ex1_failure"] is False
            assert data["whatif"]["road_blocked"] is False
            assert data["whatif"]["dilution"] is False
            assert "truck-01" in data["twins"]
            assert "excavator-01" in data["twins"]
            assert "crusher-01" in data["twins"]

        # 2. Trigger EX-01 failure
        with urllib.request.urlopen(f"{base_url}/api/whatif/ex1-fail") as resp:
            res = json.loads(resp.read().decode())
            assert res["active"] is True
            assert res["status"] == "active"

        with urllib.request.urlopen(f"{base_url}/api/state") as resp:
            data = json.loads(resp.read().decode())
            assert data["whatif"]["ex1_failure"] is True
            assert data["twins"]["excavator-01"]["state"]["value"] == "breakdown"

        # 3. Trigger Road Blockage
        with urllib.request.urlopen(f"{base_url}/api/whatif/road-block") as resp:
            res = json.loads(resp.read().decode())
            assert res["active"] is True
            assert res["status"] == "active"

        with urllib.request.urlopen(f"{base_url}/api/state") as resp:
            data = json.loads(resp.read().decode())
            assert data["whatif"]["road_blocked"] is True
            assert data["twins"]["slope-radar-01"]["status"]["value"] == "alert_collapse"

        # 4. Trigger Face Dilution
        with urllib.request.urlopen(f"{base_url}/api/whatif/dilution") as resp:
            res = json.loads(resp.read().decode())
            assert res["active"] is True

        with urllib.request.urlopen(f"{base_url}/api/state") as resp:
            data = json.loads(resp.read().decode())
            assert data["whatif"]["dilution"] is True
            assert data["twins"]["excavator-02"]["face_grade"]["value"] == 0.22

        # 5. Reset all What-If scenarios
        with urllib.request.urlopen(f"{base_url}/api/whatif/reset") as resp:
            res = json.loads(resp.read().decode())
            assert res["status"] == "reset"
            assert res["active"] is False

        with urllib.request.urlopen(f"{base_url}/api/state") as resp:
            data = json.loads(resp.read().decode())
            assert data["whatif"]["ex1_failure"] is False
            assert data["whatif"]["road_blocked"] is False
            assert data["whatif"]["dilution"] is False
            assert data["twins"]["excavator-01"]["state"]["value"] != "breakdown"
            assert data["twins"]["slope-radar-01"]["status"]["value"] == "normal"

    finally:
        try:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
        except Exception:
            proc.terminate()
