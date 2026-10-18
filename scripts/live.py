"""Shared helpers for the live-verification scripts.

Used by `boot.sh` (through `serve.py`), `probe.py`, `screenshot.py` and
`approval_test.py`. Nothing here imports the plugin: every script drives a real
`dsh web` instance in a real Chromium, because the two failure modes this plugin
had (a pending fiber, an empty panel takeover) are invisible to unit tests.
"""

from __future__ import annotations

import http.cookiejar
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
HARNESS = Path(os.environ.get("DSH_HARNESS", "/home/c163q/Program/fetch/deepseek-harness"))
DSH_BIN = "pnpm"
PROFILE = os.environ.get("DSH_PROFILE", "web")
STATE = PLUGIN_ROOT / ".tmp/instance.json"

# The composer is a contenteditable div, not a textarea, and its accessible name
# is localized; `[contenteditable]` is the only stable selector.
COMPOSER = "[contenteditable]"

# The panel this plugin renders while an approval is pending.
PANEL_ROOT = ".always-allow__root"
PANEL_CARD = ".always-allow__card"
PANEL_BUTTON = ".always-allow__btn"

# A prompt that reaches the approval waterfall: it asks the tool for a wider
# sandbox, which is what raises `approval/request`. A plain read never does.
#
# The command WORD is randomized per run on purpose. Once an always-allow rule
# for a command has been saved, `permission-rules` stops asking about it — which
# is the feature working, and which makes a fixed command silently stop
# producing an approval on the second run.
def fresh_command() -> str:
    """A command word no always-allow rule covers yet."""
    return f"aa{os.urandom(3).hex()}"


def escalation_prompt(command: str | None = None) -> str:
    """Build a prompt that raises an approval for a fresh command word."""
    word = command or fresh_command()
    return (
        '调用 bash 工具，参数 sandbox_permissions="danger-full-access", '
        f'justification="测试提权审批", command="{word} /root/aa-test"。只调用一次，不要解释。'
    )




def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def ok(message: str) -> None:
    print(f"ok: {message}")


def token_from_log(path: Path) -> str | None:
    """Read the launch token `dsh web` prints on startup."""
    if not path.exists():
        return None
    match = re.search(r"token=([A-Za-z0-9_-]+)", path.read_text(errors="replace"))
    return match.group(1) if match else None


def opener() -> urllib.request.OpenerDirector:
    """An opener that keeps the browser-session cookie.

    The token URL answers `303` to `/`, and `/` is served only to a client that
    replays the cookie set by that redirect. Without a cookie jar the second
    request gets `401`, so every authenticated read needs this opener.
    """
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar))


def wait_for_http(port: int, token: str, timeout: float = 120.0) -> None:
    """Block until the instance answers `200` for the menu page with its token."""
    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{port}/?token={token}"
    while time.time() < deadline:
        try:
            with opener().open(url, timeout=5) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(1.0)
    fail(f"instance on port {port} never answered its authenticated loopback URL")


def fetch_index(port: int, token: str) -> str:
    """Return the authenticated shell HTML, which carries `__DSH_BOOT__`."""
    url = f"http://127.0.0.1:{port}/?token={token}"
    with opener().open(url, timeout=20) as response:
        return response.read().decode("utf-8", "replace")


def boot_entries(html: str) -> list[dict]:
    """Parse the `__DSH_BOOT__` object out of the shell HTML."""
    marker = '__DSH_BOOT__"] = '
    at = html.find(marker)
    if at == -1:
        fail("the shell HTML carries no __DSH_BOOT__ payload")
    start = html.index("{", at)
    depth = 0
    for index in range(start, len(html)):
        depth += (html[index] == "{") - (html[index] == "}")
        if depth == 0:
            return json.loads(html[start : index + 1]).get("entries", [])
    fail("the __DSH_BOOT__ payload is truncated")


def load_state() -> dict:
    if not STATE.exists():
        fail(f"no running instance recorded; run scripts/boot.sh first ({STATE})")
    return json.loads(STATE.read_text())


def instance_url() -> str:
    return load_state()["url"]


def probe_route(port: int, path: str = "/always-allow/propose") -> int:
    """POST one path and return its status code.

    `401` means the route exists and reached the authentication gate. Anything
    served by the SPA fallback (`405`, `404`) means the route is absent: the
    fallback answers every unmatched request, so the status alone cannot say
    which, and only `401` proves a live route.
    """
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=b"{}",
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with opener().open(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0


def start_instance(port: int, extra_args: list[str] | None = None) -> dict:
    """Start `dsh web` on `port`, wait for it, and record the instance."""
    log = PLUGIN_ROOT / f".tmp/instance-{port}.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    command = [
        str(DSH_BIN), "--dir", str(HARNESS), "dsh", PROFILE,
        *(extra_args or []),
        "--port", str(port),
        "--no-open",
    ]
    handle = log.open("w")
    process = subprocess.Popen(
        command,
        stdout=handle,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    handle.close()
    deadline = time.time() + 120
    token = None
    while time.time() < deadline:
        token = token_from_log(log)
        if token is not None:
            break
        if process.poll() is not None:
            fail(f"`dsh web` exited during startup; see {log}")
        time.sleep(0.5)
    if token is None:
        stop_instance({"pid": process.pid})
        fail(f"no launch token appeared in {log}")
    state = {"port": port, "token": token, "pid": process.pid,
             "url": f"http://127.0.0.1:{port}/?token={token}", "log": str(log)}
    try:
        wait_for_http(port, token)
    except BaseException:
        stop_instance(state)
        raise
    STATE.write_text(json.dumps(state, indent=2))
    return state


def chromium_path() -> str:
    """Locate the system Chromium Playwright should drive."""
    override = os.environ.get("PLAYWRIGHT_CHROMIUM")
    if override:
        if not Path(override).is_file():
            fail("PLAYWRIGHT_CHROMIUM does not point to a file")
        return override
    for candidate in ("/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"):
        if Path(candidate).exists():
            return candidate
    fail("no system Chromium found; install chromium or set PLAYWRIGHT_CHROMIUM")


def launch_page(viewport: tuple[int, int] = (1400, 900), ignored_console_paths=()):
    """Open a fresh browser page with console and page errors collected."""
    from playwright.sync_api import sync_playwright

    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(executable_path=chromium_path())
    page = browser.new_page(viewport={"width": viewport[0], "height": viewport[1]})
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(f"pageerror: {str(error)[:500]}"))
    def console_error(message):
        if message.type != "error":
            return
        from urllib.parse import urlsplit
        source = message.location.get("url", "")
        if "404" in message.text and urlsplit(source).path in ignored_console_paths:
            return
        errors.append(f"error: {message.text[:300]} [{source.split('?')[0]}]")
    page.on("console", console_error)
    return playwright, browser, page, errors


def stop_instance(state: dict) -> None:
    import signal

    pid = state.get("pid")
    if not pid:
        return
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def free_port() -> int:
    import socket

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


if __name__ == "__main__":
    print(json.dumps({
        "plugin_root": str(PLUGIN_ROOT),
        "dsh_bin": str(DSH_BIN),
        "dsh_bin_exists": __import__("shutil").which(DSH_BIN) is not None,
        "profile": PROFILE,
        "state": str(STATE),
        "chromium": chromium_path() if Path("/usr/bin/chromium").exists() else None,
    }, indent=2))
    sys.exit(0)
