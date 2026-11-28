import os
import subprocess
import sys
import time
import urllib.request
import serial.tools.list_ports

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD_DIR = os.path.join(ROOT, ".pio", "build", "esp32dev")
MAIN_CPP = os.path.join(ROOT, "src", "main.cpp")
FIRMWARE_BIN = os.path.join(BUILD_DIR, "firmware.bin")
PARTITIONS_BIN = os.path.join(BUILD_DIR, "partitions.bin")
BOOTLOADER_BIN = os.path.join(BUILD_DIR, "bootloader.bin")
BOOT_APP0_BIN = os.path.expanduser(
    r"~\.platformio\packages\framework-arduinoespressif32\tools\partitions\boot_app0.bin"
)
ESPTOOL_DIR = os.path.expanduser(r"~\.platformio\packages\tool-esptoolpy")
ESPTOOL_PY = os.path.join(ESPTOOL_DIR, "esptool.py")


def post_local(endpoint):
    try:
        req = urllib.request.Request(f"http://localhost:3000{endpoint}", data=b"{}", method="POST")
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=2):
            pass
        return True
    except Exception:
        return False


def release_com_port():
    # Ask running localhost:3000 server to cleanly release COM4 first
    if post_local("/api/pio/disconnect"):
        time.sleep(0.5)
    # Also ensure no orphaned serial_bridge.py holds the COM port on Windows
    if os.name == "nt":
        subprocess.run(
            [
                "powershell", "-NoProfile", "-Command",
                "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'serial_bridge\\.py' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(0.4)


def find_port():
    for p in serial.tools.list_ports.comports():
        return p.device
    return "COM4"


def ensure_built():
    if not os.path.exists(FIRMWARE_BIN) or (
        os.path.exists(MAIN_CPP) and os.path.getmtime(MAIN_CPP) > os.path.getmtime(FIRMWARE_BIN)
    ):
        print("[BUILD] Compiling src/main.cpp via PlatformIO...", flush=True)
        res = subprocess.run(["pio", "run", "-e", "esp32dev"], cwd=ROOT, shell=True)
        if res.returncode != 0:
            sys.exit(res.returncode)
    else:
        print("[BUILD] firmware.bin sudah terbaru (skip compile lambat)!", flush=True)


def flash():
    ensure_built()
    release_com_port()
    port = sys.argv[1] if len(sys.argv) > 1 else find_port()
    print("================================================================", flush=True)
    print(f"[FLASH] Menyiapkan upload ke {port} (NodeMCU-32S / 38-Pin)...", flush=True)
    print(">>> TAHAN TOMBOL 'BOOT' (IO0) DI BOARD ESP32 SEKARANG SAMPAI MULAI WRITING! <<<", flush=True)
    print("================================================================", flush=True)

    cmd = [
        sys.executable,
        ESPTOOL_PY,
        "--chip", "esp32",
        "--port", port,
        "--baud", "460800",
        "--before", "default_reset",
        "--after", "hard_reset",
        "write_flash", "-z",
        "--flash_mode", "dio",
        "--flash_freq", "40m",
        "--flash_size", "4MB",
        "0x1000", BOOTLOADER_BIN,
        "0x8000", PARTITIONS_BIN,
        "0xe000", BOOT_APP0_BIN,
        "0x10000", FIRMWARE_BIN,
    ]

    if not os.path.exists(ESPTOOL_PY):
        cmd = ["pio", "run", "-e", "esp32dev", "-t", "nobuild", "-t", "upload", "--upload-port", port]

    ok = False
    for attempt in range(1, 4):
        print(f"[FLASH] Percobaan {attempt}/3 — Tahan tombol BOOT (IO0) di ESP32...", flush=True)
        res = subprocess.run(cmd, cwd=ROOT, shell=(cmd[0] == "pio"))
        if res.returncode == 0:
            ok = True
            print("[FLASH] BERHASIL! Firmware v0.4.0 (MQTT + Captive Portal WiFi + SG90) sudah ter-install!", flush=True)
            break
        time.sleep(1)

    # Reconnect localhost:3000 live bridge automatically after flashing
    time.sleep(1.0)
    post_local("/api/pio/reconnect")

    if not ok:
        print("[FLASH] GAGAL masuk mode download (0x13). Tahan tombol BOOT di ESP32 lalu jalankan ulang.", flush=True)
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    flash()
