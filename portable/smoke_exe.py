"""Exercise the actual Windows distribution without touching its account data.

Run with a development Python: python portable/smoke_exe.py path/to/Account.exe
Only the executable and its _internal resources enter the disposable test copy.
The executable itself receives no Python/Node executable on PATH.
"""

import argparse
from contextlib import contextmanager
from html.parser import HTMLParser
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener
from uuid import uuid4


START_TIMEOUT = 60
DEFAULT_PORT = 8765


def check(condition, message):
    if not condition:
        raise AssertionError(message)


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script" and values.get("src"):
            self.assets.append(values["src"])
        if tag == "link" and values.get("rel") in {"stylesheet", "modulepreload"}:
            if values.get("href"):
                self.assets.append(values["href"])


class Browser:
    def __init__(self, base_url):
        parsed = urlsplit(base_url)
        check(parsed.scheme == "http" and parsed.hostname == "127.0.0.1", "Runtime URL must be local HTTP")
        self.origin = f"{parsed.scheme}://{parsed.netloc}"
        self.opener = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))

    def request(self, path, method="GET", body=None, headers=None, expected=200):
        url = urljoin(self.origin + "/", path)
        check(urlsplit(url).netloc == urlsplit(self.origin).netloc, "Smoke requests must stay on this local server")
        supplied = {"Origin": self.origin, **(headers or {})}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            supplied["Content-Type"] = "application/json"
        request = Request(url, data=data, headers=supplied, method=method)
        try:
            response = self.opener.open(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            content = response.read()
            check(response.status == expected, f"{method} {path}: expected {expected}, got {response.status}: {content[:300]!r}")
            return content, response.headers

    def json(self, path, **kwargs):
        content, _ = self.request(path, **kwargs)
        return json.loads(content)


def isolated_environment():
    allowed = {
        "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "TEMP", "TMP",
        "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PATHEXT",
        "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS",
    }
    environment = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    windows = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    environment["PATH"] = os.pathsep.join((str(windows / "System32"), str(windows)))
    for executable in ("python.exe", "python3.exe", "node.exe", "npm.cmd"):
        check(shutil.which(executable, path=environment["PATH"]) is None, f"Restricted PATH unexpectedly contains {executable}")
    return environment


class RunningCopy:
    def __init__(self, executable, cwd, environment, gui=False):
        self.executable = executable
        self.cwd = cwd
        self.environment = environment
        self.gui = gui
        self.process = None
        self.runtime = None

    @property
    def runtime_path(self):
        return self.executable.parent / "data" / "runtime.json"

    def spawn(self, *arguments, headless=True):
        return subprocess.Popen(
            [str(self.executable), "--no-browser", *(["--headless"] if headless else []), *arguments],
            cwd=self.cwd, env=self.environment,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )

    def __enter__(self):
        self.process = self.spawn(headless=not self.gui)
        deadline = time.monotonic() + START_TIMEOUT
        try:
            while time.monotonic() < deadline:
                check(self.process.poll() is None, f"Executable exited during startup: {self.process.returncode}")
                try:
                    runtime = json.loads(self.runtime_path.read_text(encoding="utf-8"))
                    browser = Browser(runtime["url"])
                    check(browser.json("/api/health")["status"] == "ok", "Health endpoint failed")
                    self.runtime = runtime
                    self.browser = browser
                    if self.gui:
                        self.check_launcher_window(deadline)
                    return self
                except (OSError, URLError, ValueError, KeyError):
                    time.sleep(0.2)
            raise AssertionError("Executable did not become healthy within 60 seconds")
        except BaseException:
            self.close(strict=False)
            raise

    def close(self, strict=True):
        if self.process is None or self.process.poll() is not None:
            return
        error = None
        stopper = None
        try:
            stopper = self.spawn("--stop")
            check(stopper.wait(timeout=20) == 0, "--stop failed")
            check(self.process.wait(timeout=20) == 0, "Server exited with an error")
            check(not self.runtime_path.exists(), "Graceful stop left a stale runtime.json")
        except (AssertionError, OSError, subprocess.TimeoutExpired) as failure:
            error = failure
        finally:
            for process in (stopper, self.process):
                if process is not None and process.poll() is None:
                    process.kill()
                    process.wait(timeout=10)
        if strict and error is not None:
            raise error

    def __exit__(self, exc_type, exc_value, traceback):
        self.close(strict=exc_type is None)

    def check_duplicate_launch(self):
        duplicate = self.spawn()
        try:
            check(duplicate.wait(timeout=20) == 0, "Second launch failed")
            check(self.process.poll() is None, "Second launch stopped the original server")
            current = json.loads(self.runtime_path.read_text(encoding="utf-8"))
            check(current == self.runtime, "Second launch replaced the running instance")
            check(self.browser.json("/api/health")["status"] == "ok", "Original server became unhealthy")
        finally:
            if duplicate.poll() is None:
                duplicate.kill()
                duplicate.wait(timeout=10)

    def check_launcher_window(self, deadline):
        # A healthy API alone cannot prove that the normal desktop launcher works.
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.WinDLL("user32", use_last_error=True)
        callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
        user32.EnumWindows.restype = wintypes.BOOL
        user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        user32.GetWindowThreadProcessId.restype = wintypes.DWORD
        user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        user32.GetWindowTextW.restype = ctypes.c_int
        user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        user32.GetClassNameW.restype = ctypes.c_int
        user32.IsWindowVisible.argtypes = [wintypes.HWND]
        user32.IsWindowVisible.restype = wintypes.BOOL
        found = []

        @callback_type
        def inspect_window(handle, _):
            process_id = wintypes.DWORD()
            user32.GetWindowThreadProcessId(handle, ctypes.byref(process_id))
            if process_id.value == self.runtime["pid"] and user32.IsWindowVisible(handle):
                title = ctypes.create_unicode_buffer(256)
                class_name = ctypes.create_unicode_buffer(256)
                user32.GetWindowTextW(handle, title, len(title))
                user32.GetClassNameW(handle, class_name, len(class_name))
                # Startup errors use the same title; a message box is not proof
                # that the real application window and its widgets loaded.
                if title.value == "Zarnegar Accounting" and class_name.value.startswith("ZarnegarPortable"):
                    found.append(handle)
            return True

        while time.monotonic() < deadline:
            check(self.process.poll() is None, "Executable exited before its launcher window appeared")
            user32.EnumWindows(inspect_window, 0)
            if found:
                check(self.browser.json("/api/health")["status"] == "ok", "API failed while the GUI was open")
                return
            time.sleep(0.2)
        raise AssertionError("The normal launcher did not display its native window")


@contextmanager
def occupied_preferred_port():
    blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        blocker.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            blocker.bind(("127.0.0.1", DEFAULT_PORT))
            blocker.listen(1)
        except OSError:
            # An existing listener or reservation already requires fallback.
            blocker.close()
        yield
    finally:
        blocker.close()


def check_frontend(browser):
    html, headers = browser.request("/login")
    check(headers.get_content_type() == "text/html", "Login route did not return HTML")
    check(b'id="root"' in html or b"id='root'" in html, "Login HTML has no application root")
    parser = AssetParser()
    parser.feed(html.decode("utf-8"))
    check(any(urlsplit(asset).path.endswith(".js") for asset in parser.assets), "Built JavaScript was not referenced")
    check(any(urlsplit(asset).path.endswith(".css") for asset in parser.assets), "Built CSS was not referenced")
    for asset in parser.assets:
        body, asset_headers = browser.request(asset)
        check(body and asset_headers.get_content_type() != "text/html", f"Missing built asset: {asset}")
    browser.request("/account/partners")
    browser.request("/api/owner/workspace", expected=401)
    browser.request("/data/zarnegaar.db", expected=404)
    browser.request("/assets/missing-smoke-test.js", expected=404)


def find_executable(source):
    source = source.resolve()
    if source.is_dir():
        executables = list(source.glob("*.exe"))
        check(len(executables) == 1, "Distribution directory must contain exactly one EXE; otherwise specify the EXE path")
        source = executables[0]
    check(source.is_file() and source.suffix.lower() == ".exe", "Supply a built Windows EXE or its directory")
    check((source.parent / "_internal").is_dir(), "Distribution is missing its _internal folder")
    return source


def run_smoke(source, check_gui=False):
    check(os.name == "nt", "This smoke check runs the real Windows executable and requires Windows")
    source = find_executable(source)
    environment = isolated_environment()
    with tempfile.TemporaryDirectory(prefix="zarnegaar-exe-smoke-") as temporary:
        root = Path(temporary).resolve()
        check(root.parent == Path(tempfile.gettempdir()).resolve(), "Unexpected temporary directory location")
        first = root / "آزمایش حسابداری" / "First portable folder"
        first.mkdir(parents=True)
        executable = first / source.name
        shutil.copy2(source, executable)
        shutil.copytree(source.parent / "_internal", first / "_internal")
        check(not (first / "data").exists(), "Smoke tests must never copy user account data")
        unrelated = root / "Unrelated working directory"
        unrelated.mkdir()
        credentials = {"username": "portable-smoke-owner", "password": "synthetic-smoke-password-123"}
        customer = {"id": "portable-smoke-customer", "name": "مشتری آزمایشی", "phone": "09120000000"}
        with occupied_preferred_port(), RunningCopy(executable, unrelated, environment) as running:
            check(urlsplit(running.runtime["url"]).port != DEFAULT_PORT, "Occupied default port did not cause fallback")
            check_frontend(running.browser)
            registration = running.browser.json("/api/auth/register", method="POST",
                body={**credentials, "galleryName": "حساب آزمایشی قابل حمل"}, expected=201)
            workspace = running.browser.json("/api/owner/workspace")
            check(workspace["data"]["customers"] == [], "Disposable account was not empty")
            saved = running.browser.json("/api/owner/workspace", method="PUT",
                body={"revision": workspace["revision"], "requestId": str(uuid4()), "data": {"customers": [customer]}},
                headers={"X-CSRF-Token": registration["csrfToken"]})
            check(saved["data"]["customers"] == [customer], "Synthetic customer was not saved")
            running.check_duplicate_launch()
        check((first / "data" / "zarnegaar.db").is_file(), "Database was not created beside the executable")
        destination = root / "لپ تاپ دیگر" / "Relocated portable folder"
        destination.parent.mkdir()
        check(first.resolve().is_relative_to(root) and destination.resolve().is_relative_to(root), "Move must stay inside the test directory")
        first.rename(destination)
        with RunningCopy(destination / source.name, unrelated, environment) as running:
            check_frontend(running.browser)
            running.browser.json("/api/auth/login", method="POST", body=credentials)
            restored = running.browser.json("/api/owner/workspace")
            check(restored["revision"] == saved["revision"], "Saved revision changed after relocation")
            check(restored["data"]["customers"] == [customer], "Saved customer was lost after relocation")
            running.check_duplicate_launch()
        if check_gui:
            with RunningCopy(destination / source.name, unrelated, environment, gui=True) as running:
                running.browser.json("/api/auth/login", method="POST", body=credentials)
                check(running.browser.json("/api/owner/workspace")["data"]["customers"] == [customer],
                    "Normal GUI launch did not use the relocated account data")
        check(not (unrelated / "data").exists(), "Executable incorrectly used the working directory for data")
    print("PASS: real EXE, restricted PATH, Persian/spaced paths, frontend assets, occupied port fallback,")
    print("      account creation, saved data after relocation, duplicate launch and graceful shutdown.")
    if check_gui:
        print("PASS: normal desktop launcher displayed its native window and stopped cleanly.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("distribution", type=Path, help="Built EXE or its containing folder; its data is never copied")
    parser.add_argument("--check-gui", action="store_true", help="Also briefly open the real native launcher window")
    args = parser.parse_args()
    run_smoke(args.distribution, check_gui=args.check_gui)


if __name__ == "__main__":
    main()
