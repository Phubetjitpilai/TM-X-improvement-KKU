# TM-X_simulation/tm-x.py
# Simulates KEYENCE TM-X 5065 coordinate measurement controller.
# How to run:
#   cd TM-X_simulation
#   pip install -r requirements.txt
#   python tm-x.py

import asyncio
import glob
import json
import logging
import os
import random
import shutil
import threading
from datetime import datetime

from dotenv import load_dotenv
from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler
from pyftpdlib.servers import FTPServer

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

# ── Config ────────────────────────────────────────────────────────────────────
TMX_HOST       = os.getenv("TMX_HOST",       "127.0.0.1")
TMX_PORT       = int(os.getenv("TMX_PORT",       5000))
TMX_FTP_HOST   = os.getenv("TMX_FTP_HOST",   "127.0.0.1")
TMX_FTP_PORT   = int(os.getenv("TMX_FTP_PORT",   2121))
TMX_FTP_USER   = os.getenv("TMX_FTP_USER",   "admin")
TMX_FTP_PASS   = os.getenv("TMX_FTP_PASS",   "password")
TEMP_IMAGE_DIR = os.getenv("TEMP_IMAGE_DIR", "./Store_image_temporary")
IMAGE_SOURCE_DIR = os.getenv("IMAGE_SOURCE_DIR", "./image_ALPL")

# Resolve relative paths from project root (parent of TM-X_simulation/)
_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if not os.path.isabs(TEMP_IMAGE_DIR):
    TEMP_IMAGE_DIR = os.path.join(_root, TEMP_IMAGE_DIR.lstrip("./"))
if not os.path.isabs(IMAGE_SOURCE_DIR):
    IMAGE_SOURCE_DIR = os.path.join(_root, IMAGE_SOURCE_DIR.lstrip("./"))

os.makedirs(TEMP_IMAGE_DIR,   exist_ok=True)
os.makedirs(IMAGE_SOURCE_DIR, exist_ok=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [TM-X] %(message)s")
log = logging.getLogger(__name__)


# ── Async image copy (triggered after each measurement) ──────────────────────
async def copy_image_after_delay() -> None:
    await asyncio.sleep(1)                              # simulate post-measurement delay
    images = glob.glob(os.path.join(IMAGE_SOURCE_DIR, "*.jpg"))
    if not images:
        log.warning("Image copy: no source images found in %s", IMAGE_SOURCE_DIR)
        return
    src = random.choice(images)
    ts  = datetime.now().strftime("%Y%m%d_%H%M%S")
    dst = os.path.join(TEMP_IMAGE_DIR, f"image_{ts}.jpg")
    shutil.copy2(src, dst)
    log.info("Image copy: %s → %s", os.path.basename(src), dst)


# ── TCP server — one connection at a time from Agent ─────────────────────────
async def handle_tcp_client(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
) -> None:
    addr = writer.get_extra_info("peername")
    log.info("TCP: Agent connected from %s", addr)
    try:
        while True:
            raw = await reader.readline()
            if not raw:
                break
            cmd = raw.decode("utf-8", errors="ignore").strip()
            log.info("TCP <<<: %r", cmd)

            if cmd.startswith("LOAD_TEMPLATE"):
                name = cmd.split(" ", 1)[1] if " " in cmd else "DEFAULT"
                log.info("TCP: Loading template %r …", name)
                writer.write(b"TEMPLATE_OK\n")
                await writer.drain()
                log.info("TCP >>>: TEMPLATE_OK")

            elif cmd == "MEASURE_CMD":
                log.info("TCP: Measuring …")
                await asyncio.sleep(0.5)                # simulate measurement time

                value_x = round(random.uniform(9.0, 11.0), 2)
                value_y = round(random.uniform(9.0, 11.0), 2)
                payload = json.dumps({"value_x": value_x, "value_y": value_y}) + "\n"
                writer.write(payload.encode())
                await writer.drain()
                log.info("TCP >>>: value_x=%.2f, value_y=%.2f", value_x, value_y)

                asyncio.create_task(copy_image_after_delay())

            else:
                log.warning("TCP: Unknown command %r", cmd)

    except Exception as exc:
        log.error("TCP: Client error: %s", exc)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        log.info("TCP: Agent disconnected from %s", addr)


# ── FTP server (blocking — runs in a daemon thread) ──────────────────────────
def _run_ftp_server() -> None:
    authorizer = DummyAuthorizer()
    authorizer.add_user(
        TMX_FTP_USER,
        TMX_FTP_PASS,
        TEMP_IMAGE_DIR,
        perm="elradfmwMT",      # full permissions (list, read, write, …)
    )

    handler = FTPHandler
    handler.authorizer    = authorizer
    handler.passive_ports = range(60000, 60100)
    handler.banner        = "TM-X FTP simulation server ready."

    server = FTPServer((TMX_FTP_HOST, TMX_FTP_PORT), handler)
    log.info("FTP: Server listening on %s:%d (root=%s)", TMX_FTP_HOST, TMX_FTP_PORT, TEMP_IMAGE_DIR)
    server.serve_forever()


# ── Entry point ───────────────────────────────────────────────────────────────
async def main() -> None:
    # FTP server runs in its own daemon thread (pyftpdlib is synchronous)
    ftp_thread = threading.Thread(target=_run_ftp_server, daemon=True)
    ftp_thread.start()

    tcp_server = await asyncio.start_server(handle_tcp_client, TMX_HOST, TMX_PORT)
    log.info("TCP: Server listening on %s:%d", TMX_HOST, TMX_PORT)

    async with tcp_server:
        await tcp_server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
