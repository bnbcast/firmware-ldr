import json
import queue
import sys
import threading
import time
import serial
import serial.tools.list_ports


def find_port():
    ports = list(serial.tools.list_ports.comports())
    for p in ports:
        desc = (p.description or "") + " " + (p.hwid or "")
        if any(k in desc.upper() for k in ("CP210", "CH340", "CH910", "UART", "USB")):
            return p.device
    return ports[0].device if ports else None


def stdin_worker(tx_queue):
    while True:
        line = sys.stdin.readline()
        if not line:
            tx_queue.put(None)
            break
        cmd = line.strip()
        if cmd:
            tx_queue.put(cmd)


def main():
    port = sys.argv[1] if (len(sys.argv) > 1 and sys.argv[1] != "AUTO") else find_port()
    baud = int(sys.argv[2]) if len(sys.argv) > 2 else 115200
    if not port:
        print(json.dumps({"type": "error", "error": "Tidak ada port COM USB ESP32 yang terdeteksi."}), flush=True)
        sys.exit(1)

    try:
        ser = serial.Serial()
        ser.port = port
        ser.baudrate = baud
        ser.timeout = 0.05
        ser.write_timeout = 0.5
        ser.dtr = False
        ser.rts = False
        ser.open()
        # Clean normal-run reset pulse (EN low -> high while IO0 stays high)
        ser.dtr = False
        ser.rts = True
        time.sleep(0.1)
        ser.rts = False
        time.sleep(0.1)
        print(json.dumps({"type": "connected", "port": port, "baud": baud}), flush=True)
    except Exception as exc:
        print(json.dumps({"type": "error", "error": str(exc)}), flush=True)
        sys.exit(1)

    tx_queue = queue.Queue()
    t = threading.Thread(target=stdin_worker, args=(tx_queue,), daemon=True)
    t.start()

    rx_buf = bytearray()
    while True:
        try:
            # 1. Drain any pending TX commands on the SAME thread that owns `ser`
            while True:
                try:
                    cmd = tx_queue.get_nowait()
                except queue.Empty:
                    break
                if cmd is None:
                    ser.close()
                    return
                ser.write((cmd + "\n").encode("utf-8"))
                ser.flush()

            # 2. Read available bytes non-blocking
            n = ser.in_waiting
            chunk = ser.read(n if n > 0 else 1)
            if chunk:
                rx_buf.extend(chunk)
                while b"\n" in rx_buf:
                    idx = rx_buf.index(b"\n")
                    raw_line = bytes(rx_buf[:idx])
                    del rx_buf[: idx + 1]
                    line = raw_line.decode("utf-8", errors="replace").rstrip("\r")
                    if line:
                        print(json.dumps({"type": "line", "line": line}), flush=True)
        except Exception as exc:
            print(json.dumps({"type": "error", "error": str(exc)}), flush=True)
            break


if __name__ == "__main__":
    main()
