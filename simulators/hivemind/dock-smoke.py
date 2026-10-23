#!/usr/bin/env python3
"""Opt-in Dock registration E2E acceptance against disposable lab-only RPC mock.

The simulator must be offline and the lab must be ready, read-only, and
unconnected to production. No real drone credentials or hardware are used.
"""
from __future__ import annotations

import re
import sys
import time

from smoke import (SIM, SKYHUB, POLL_SECONDS, SmokeFailure, assert_lab,
                   await_lab_ready, local_token, request, require, strictly_new)


def run() -> None:
    token = local_token()
    before = await_lab_ready()
    require(isinstance(before, dict), "Unexpected SkyHub health response")
    prior = request(SKYHUB, "/api/devices", token=token)
    require(isinstance(prior, list), "Unexpected SkyHub devices response")

    info = request(SIM, "/api/device-info")
    require(isinstance(info, dict) and "dockSn" in info and "droneSn" in info,
            "Not the pinned HiveMind simulator")
    state = request(SIM, "/api/connection")
    require(isinstance(state, dict) and state.get("online") is False,
            "Simulator already online: refusing to reset another test")
    opened = False
    try:
        config = request(SIM, "/api/connect", method="POST", body={
            "mqtt_host": "hivemind-broker", "mqtt_port": 1884,
            "device_mode": "DOCK", "dock_type": "DOCK3",
            "organization_id": "skyhub-lab-org",
            "device_binding_code": "skyhub-lab-code",
            "app_license": ""
        })
        require(isinstance(config, dict) and config.get("success") is True and
                config.get("mqtt_connected") is True, "Mock Dock MQTT connection failed")
        opened = True

        identity = request(SIM, "/api/device-info")
        require(isinstance(identity, dict) and identity.get("deviceMode") == "DOCK",
                "Simulator is not in Dock mode")
        dock_sn = identity.get("dockSn")
        aircraft_sn = identity.get("droneSn")
        require(isinstance(dock_sn, str) and
                re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", dock_sn) is not None,
                "Invalid test Dock identity")
        require(isinstance(aircraft_sn, str) and aircraft_sn != dock_sn and
                re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", aircraft_sn) is not None,
                "Invalid test aircraft identity")

        # The mock insists on the four ordered DJI requests and the matching
        # lab-only organization/code. This path never sets skip_register=true.
        online = request(SIM, "/api/online", method="POST", body={"skip_register": False})
        require(isinstance(online, dict) and online.get("success") is True
                and online.get("online") is True,
                "Full Dock config/bind/organization registration failed")

        end = time.monotonic() + POLL_SECONDS
        while time.monotonic() < end:
            health = request(SKYHUB, "/api/health")
            require(isinstance(health, dict), "Unexpected SkyHub health after Dock registration")
            assert_lab(health)
            devices = request(SKYHUB, "/api/devices", token=token)
            require(isinstance(devices, list), "Unexpected SkyHub devices response")
            dock = next((d for d in devices if isinstance(d, dict)
                         and d.get("sn") == dock_sn), None)
            if dock and dock.get("role") == "gateway" and dock.get("lastTopologyAt") and (
                strictly_new(health.get("mqttObservedOsdPackets"),
                             before.get("mqttObservedOsdPackets")) and
                strictly_new(health.get("mqttOsdMessages"),
                             before.get("mqttOsdMessages"))):
                print("PASS: four ordered Dock RPC replies, topology and new Dock OSD confirmed")
                print("All identities and simulated organization data suppressed")
                return
            time.sleep(1)
        raise SmokeFailure("Dock registered, but topology/OSD was not confirmed in SkyHub")
    finally:
        if opened:
            try:
                request(SIM, "/api/offline", method="POST", body={})
            except SmokeFailure:
                print("WARNING: Dock shutdown request unsuccessful; stop lab manually",
                      file=sys.stderr)


if __name__ == "__main__":
    try:
        run()
    except SmokeFailure as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
