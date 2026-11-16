#!/usr/bin/env python3
import os
import pathlib
import plistlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent
LABEL = "local.traffic-ledger"
PLIST = pathlib.Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
DATA = pathlib.Path.home() / "Library/Application Support/LocalTrafficLedger"
TARGET = f"gui/{os.getuid()}"
SERVICE = f"{TARGET}/{LABEL}"
SERVICE_NOT_FOUND = 113


def launchctl(*args, check=True, **kwargs):
    return subprocess.run(["launchctl", *args], check=check, **kwargs)


def is_loaded():
    result = launchctl("print", SERVICE, check=False, capture_output=True, text=True)
    if result.returncode == SERVICE_NOT_FOUND:
        return False
    if result.returncode:
        raise SystemExit(
            result.stderr.strip() or f"launchctl print failed ({result.returncode})"
        )
    return True


def stop():
    if not is_loaded():
        return
    launchctl("bootout", SERVICE)
    # bootout may return before launchd finishes unloading the old job.
    for _ in range(12):
        if not is_loaded():
            return
        time.sleep(0.25)
    raise SystemExit(f"launchctl has not finished stopping {LABEL}")


def bootstrap():
    # launchd can briefly reject bootstrap just after a bootout.
    for _ in range(12):
        result = launchctl(
            "bootstrap", TARGET, str(PLIST), check=False, capture_output=True, text=True
        )
        if result.returncode == 0:
            return
        time.sleep(0.25)
    raise SystemExit(
        result.stderr.strip() or f"launchctl bootstrap failed ({result.returncode})"
    )


def install():
    DATA.mkdir(parents=True, exist_ok=True)
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    content = {
        "Label": LABEL,
        "ProgramArguments": [sys.executable, "-m", "mac_traffic_ledger.ledger"],
        "WorkingDirectory": str(ROOT),
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 10,
        "StandardOutPath": str(DATA / "service.log"),
        "StandardErrorPath": str(DATA / "error.log"),
        "EnvironmentVariables": {
            "PYTHONUNBUFFERED": "1",
            "PYTHONPATH": str(ROOT.parent),
        },
    }
    PLIST.write_bytes(plistlib.dumps(content))
    bootstrap()
    print("Installed: http://127.0.0.1:8766")


def start():
    if is_loaded():
        launchctl("kickstart", SERVICE)
    elif PLIST.exists():
        bootstrap()
    else:
        install()


def run_command(cmd):
    if cmd == "install":
        stop()
        install()
    elif cmd in ("stop", "uninstall"):
        stop()
        if cmd == "uninstall":
            PLIST.unlink(missing_ok=True)
        print("Stopped. Historical database retained at", DATA)
    elif cmd == "start":
        start()
    elif cmd == "status":
        launchctl("print", SERVICE)
    else:
        raise SystemExit("Use: install | start | stop | uninstall | status")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    try:
        run_command(cmd)
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.returncode) from None


if __name__ == "__main__":
    main()
