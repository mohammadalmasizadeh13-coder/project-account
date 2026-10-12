"""Portable, loopback-only Windows launcher for Zarnegar Accounting.

PyInstaller bundles the backend and ``frontend/dist``. Mutable files always
live beside the executable, so copying the whole folder also copies accounts.
"""

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import secrets
import socket
import sys
import threading
import time
from typing import Any
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import webbrowser


DEFAULT_PORT = 8765
LOGGER = logging.getLogger("noor.portable")


@dataclass(frozen=True)
class PortablePaths:
    app_dir: Path
    data_dir: Path
    frontend_dir: Path
    log_file: Path

    @property
    def database_file(self) -> Path:
        return self.data_dir / "zarnegaar.db"

    @property
    def runtime_file(self) -> Path:
        return self.data_dir / "runtime.json"


def resolve_paths(app_dir: Path | str | None = None,
                  asset_dir: Path | str | None = None) -> PortablePaths:
    """Resolve locations without using the working directory or a fixed drive."""
    frozen = getattr(sys, "frozen", False)
    source_root = Path(__file__).resolve().parent.parent
    root = Path(app_dir).resolve() if app_dir is not None else (
        Path(sys.executable).resolve().parent if frozen else source_root
    )
    frontend = Path(asset_dir).resolve() if asset_dir is not None else (
        Path(sys._MEIPASS) / "frontend" if frozen else source_root / "frontend" / "dist"
    )
    data = root / "data"
    return PortablePaths(root, data, frontend, data / "logs" / "noor.log")


def prepare_paths(paths: PortablePaths) -> None:
    """Fail before starting if the folder is incomplete or cannot store data."""
    if not (paths.frontend_dir / "index.html").is_file():
        raise RuntimeError("The frontend is missing. Copy or extract the complete application folder.")
    try:
        paths.data_dir.mkdir(parents=True, exist_ok=True)
        (paths.data_dir / "uploads").mkdir(exist_ok=True)
        paths.log_file.parent.mkdir(exist_ok=True)
        probe = paths.data_dir / (".write-check-" + secrets.token_hex(8))
        with probe.open("xb") as handle:
            handle.write(b"ok")
        probe.unlink()
    except OSError as error:
        raise RuntimeError(
            "The application cannot save its data. Move the entire folder to a writable "
            "location such as Documents or Desktop, then run it again."
        ) from error


@contextmanager
def _isolated_backend_environment(paths: PortablePaths):
    # app.main exposes an eagerly created ASGI app. Pin its initial settings too,
    # so even importing it cannot load another installation's database/credentials.
    values = {
        "DATABASE_URL": f"sqlite:///{paths.database_file.as_posix()}",
        "NOOR_UPLOAD_DIR": str(paths.data_dir / "uploads"),
        "NOOR_OWNER_USERNAME": "", "NOOR_OWNER_PASSWORD_HASH": "",
        "FRONTEND_ORIGINS": "", "NOOR_COOKIE_SECURE": "false",
        "GOLD_RATE_URL": "", "GOLD_RATE_TOKEN": "", "GOLD_RATE_STALE_SECONDS": "300",
    }
    previous = {key: os.environ.get(key) for key in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def create_portable_app(paths: PortablePaths, port: int = DEFAULT_PORT,
                        instance_token: str | None = None,
                        stop_event: threading.Event | None = None):
    """Build the API and static frontend with isolated local persistence."""
    if not getattr(sys, "frozen", False):
        backend = str(Path(__file__).resolve().parent.parent / "backend")
        if backend not in sys.path:
            sys.path.insert(0, backend)
    with _isolated_backend_environment(paths):
        from app.main import create_app
        from app.settings import Settings
    from fastapi import HTTPException, Request
    from starlette.exceptions import HTTPException as StarletteHTTPException
    from starlette.responses import FileResponse
    from starlette.staticfiles import StaticFiles

    settings = Settings(
        database_url=f"sqlite:///{paths.database_file.as_posix()}",
        upload_dir=paths.data_dir / "uploads",
        origins=(f"http://127.0.0.1:{port}", f"http://localhost:{port}"),
        cookie_secure=False,
        owner_username="", owner_password_hash="",
        rate_url="", rate_token="", rate_stale_seconds=300,
    )
    application = create_app(settings)
    if instance_token is not None:
        identity = hashlib.sha256(instance_token.encode("ascii")).hexdigest()

        @application.get("/_portable/health")
        def portable_health():
            return {"status": "ok", "instance": identity}

        @application.post("/_portable/shutdown")
        def portable_shutdown(request: Request):
            supplied = request.headers.get("X-Noor-Instance", "")
            if not secrets.compare_digest(supplied, instance_token):
                raise HTTPException(status_code=403, detail="Invalid launcher token")
            if stop_event is not None:
                stop_event.set()
            return {"status": "stopping"}

    class FrontendFiles(StaticFiles):
        async def get_response(self, path: str, scope):
            # Do not convert unknown API calls into successful HTML responses.
            # StaticFiles itself rejects traversal and symlinks outside its root.
            normalized = path.replace("\\", "/").strip("/")
            if normalized.split("/", 1)[0] in {"api", "_portable", "data"}:
                raise StarletteHTTPException(status_code=404)
            try:
                response = await super().get_response(path, scope)
                if response.status_code != 404:
                    return response
            except StarletteHTTPException as error:
                if error.status_code != 404:
                    raise
            route = "/" + normalized
            if (route in {"/", "/login", "/register", "/account", "/owner", "/accounting", "/dashboard"}
                    or route.startswith(("/account/", "/owner/", "/accounting/", "/dashboard/"))):
                if scope["method"] not in {"GET", "HEAD"}:
                    raise StarletteHTTPException(status_code=405)
                return FileResponse(paths.frontend_dir / "index.html")
            raise StarletteHTTPException(status_code=404)

    application.mount("/", FrontendFiles(directory=paths.frontend_dir, html=True))
    return application


class InstanceLock:
    """A kernel-released file lock also works across Windows login sessions."""

    def __init__(self, path: Path):
        self.path = path
        self.handle = None

    def acquire(self) -> bool:
        handle = self.path.open("a+b")
        if handle.seek(0, os.SEEK_END) == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return False
        self.handle = handle
        return True

    def release(self) -> None:
        if self.handle is not None:
            if os.name == "nt":
                import msvcrt
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            self.handle.close()
            self.handle = None


def bind_local_socket(preferred_port: int = DEFAULT_PORT) -> socket.socket:
    """Reserve the port before configuring the API, avoiding a probe/bind race."""
    candidates = [0] if preferred_port == 0 else list(range(preferred_port, min(preferred_port + 20, 65536))) + [0]
    for port in candidates:
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            listener.bind(("127.0.0.1", port))
            listener.listen(128)
            listener.setblocking(False)
            return listener
        except OSError:
            listener.close()
    raise RuntimeError("No local port is available to start the application.")


def _request_json(url: str, token: str | None = None) -> dict[str, Any]:
    headers = {"X-Noor-Instance": token} if token is not None else {}
    request = urllib.request.Request(url, headers=headers, method="POST" if token is not None else "GET")
    # Corporate/browser proxy settings must never redirect the local launcher.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=1.0) as response:
        return json.load(response)


def running_instance(paths: PortablePaths, timeout: float = 0) -> dict[str, Any] | None:
    deadline = time.monotonic() + timeout
    while True:
        try:
            state = json.loads(paths.runtime_file.read_text(encoding="utf-8"))
            url = state["url"]
            parsed = urlsplit(url)
            if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
                    or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment
                    or parsed.port is None or not isinstance(state["token"], str)):
                raise ValueError("Invalid launcher state")
            health = _request_json(url + "/_portable/health")
            identity = hashlib.sha256(state["token"].encode("ascii")).hexdigest()
            if health.get("status") == "ok" and health.get("instance") == identity:
                return state
        except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError):
            pass
        if time.monotonic() >= deadline:
            return None
        time.sleep(0.15)


def _configure_logging(paths: PortablePaths) -> None:
    handler = RotatingFileHandler(paths.log_file, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)


def _open_browser(url: str) -> None:
    try:
        if not webbrowser.open(url):
            LOGGER.warning("No default browser accepted %s; open this address manually.", url)
    except Exception:
        LOGGER.exception("Could not open the default browser: %s", url)


def _show_error(message: str, paths: PortablePaths, headless: bool) -> None:
    text = f"{message}\n\nLog: {paths.log_file}"
    LOGGER.error(text)
    if sys.stderr is not None:
        print(text, file=sys.stderr)
    if not headless and os.name == "nt":
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, "Zarnegar Accounting", 0x10)


def _desktop_window(url: str, paths: PortablePaths, server, thread: threading.Thread,
                    stop_event: threading.Event, visible: bool = True) -> None:
    """Use native Windows controls, requiring no separately installed GUI toolkit."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
    result_type = ctypes.c_ssize_t
    window_proc_type = ctypes.WINFUNCTYPE(result_type, wintypes.HWND, wintypes.UINT,
                                         wintypes.WPARAM, wintypes.LPARAM)

    class WindowClass(ctypes.Structure):
        _fields_ = [
            ("style", wintypes.UINT), ("lpfnWndProc", window_proc_type),
            ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int),
            ("hInstance", wintypes.HINSTANCE), ("hIcon", wintypes.HICON),
            ("hCursor", wintypes.HANDLE), ("hbrBackground", wintypes.HBRUSH),
            ("lpszMenuName", wintypes.LPCWSTR), ("lpszClassName", wintypes.LPCWSTR),
        ]

    kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetModuleHandleW.restype = wintypes.HMODULE
    user32.RegisterClassW.argtypes = [ctypes.POINTER(WindowClass)]
    user32.RegisterClassW.restype = wintypes.WORD
    user32.UnregisterClassW.argtypes = [wintypes.LPCWSTR, wintypes.HINSTANCE]
    user32.UnregisterClassW.restype = wintypes.BOOL
    user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR,
        wintypes.DWORD, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID]
    user32.CreateWindowExW.restype = wintypes.HWND
    user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.DefWindowProcW.restype = result_type
    user32.LoadCursorW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR]
    user32.LoadCursorW.restype = wintypes.HANDLE
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.SendMessageW.restype = result_type
    user32.SetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPCWSTR]
    user32.EnableWindow.argtypes = [wintypes.HWND, wintypes.BOOL]
    user32.DestroyWindow.argtypes = [wintypes.HWND]
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.UpdateWindow.argtypes = [wintypes.HWND]
    user32.SetTimer.argtypes = [wintypes.HWND, ctypes.c_size_t, wintypes.UINT, wintypes.LPVOID]
    user32.SetTimer.restype = ctypes.c_size_t
    user32.KillTimer.argtypes = [wintypes.HWND, ctypes.c_size_t]
    user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
    user32.GetMessageW.restype = wintypes.BOOL
    user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
    user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
    user32.DispatchMessageW.restype = result_type
    user32.IsDialogMessageW.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.MSG)]
    user32.IsDialogMessageW.restype = wintypes.BOOL
    gdi32.CreateFontW.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        ctypes.c_int, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
        wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.LPCWSTR]
    gdi32.CreateFontW.restype = wintypes.HANDLE
    gdi32.DeleteObject.argtypes = [wintypes.HANDLE]

    module = kernel32.GetModuleHandleW(None)
    class_name = "ZarnegarPortable" + secrets.token_hex(8)
    controls = {}
    unexpected_stop = False

    def stop():
        stop_event.set()
        server.should_exit = True
        user32.SetWindowTextW(controls["status"], "در حال ذخیره و بستن برنامه…")
        user32.EnableWindow(controls["open"], False)
        user32.EnableWindow(controls["stop"], False)

    @window_proc_type
    def window_proc(window, message, wparam, lparam):
        nonlocal unexpected_stop
        if message == 0x0010:  # WM_CLOSE: finish pending requests before destroying.
            stop()
            return 0
        if message == 0x0111:  # WM_COMMAND
            identifier = wparam & 0xFFFF
            if identifier == 101:
                _open_browser(url)
                return 0
            if identifier == 102:
                stop()
                return 0
        if message == 0x0113:  # WM_TIMER
            if stop_event.is_set():
                server.should_exit = True
            if not thread.is_alive():
                unexpected_stop = not stop_event.is_set()
                user32.DestroyWindow(window)
            return 0
        if message == 0x0002:  # WM_DESTROY
            user32.KillTimer(window, 1)
            user32.PostQuitMessage(0)
            return 0
        return user32.DefWindowProcW(window, message, wparam, lparam)

    window_class = WindowClass()
    window_class.lpfnWndProc = window_proc
    window_class.hInstance = module
    window_class.hCursor = user32.LoadCursorW(None, ctypes.cast(ctypes.c_void_p(32512), wintypes.LPCWSTR))
    window_class.hbrBackground = 6  # COLOR_WINDOW + 1
    window_class.lpszClassName = class_name
    if not user32.RegisterClassW(ctypes.byref(window_class)):
        raise ctypes.WinError(ctypes.get_last_error())
    font = gdi32.CreateFontW(-20, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, "Segoe UI")
    window = None
    try:
        width, height = 590, 310
        left = max(0, (user32.GetSystemMetrics(0) - width) // 2)
        top = max(0, (user32.GetSystemMetrics(1) - height) // 2)
        window = user32.CreateWindowExW(0, class_name, "Zarnegar Accounting", 0x00CA0000,
            left, top, width, height, None, None, module, None)
        if not window:
            raise ctypes.WinError(ctypes.get_last_error())

        def control(kind, label, x, y, w, h, style=0, identifier=0):
            handle = user32.CreateWindowExW(0, kind, label, 0x50000000 | style,
                x, y, w, h, window, identifier, module, None)
            if not handle:
                raise ctypes.WinError(ctypes.get_last_error())
            if font:
                user32.SendMessageW(handle, 0x0030, font, 1)  # WM_SETFONT
            return handle

        control("STATIC", "حسابداری زرنگار فعال است", 22, 18, 530, 30, 2)
        controls["status"] = control("STATIC", "تا پایان کار این پنجره را باز نگه دارید.", 22, 57, 530, 28, 2)
        control("EDIT", url, 22, 96, 530, 30, 0x00810801)  # Border, read-only, centered, tab stop.
        control("STATIC", "اطلاعات در پوشهٔ data کنار برنامه ذخیره می‌شود.", 22, 139, 530, 28, 2)
        controls["open"] = control("BUTTON", "باز کردن حسابداری", 335, 193, 217, 40, 0x10000, 101)
        controls["stop"] = control("BUTTON", "بستن برنامه", 112, 193, 207, 40, 0x10000, 102)
        if not user32.SetTimer(window, 1, 150, None):
            raise ctypes.WinError(ctypes.get_last_error())
        if visible:
            user32.ShowWindow(window, 5)
            user32.UpdateWindow(window)
        message = wintypes.MSG()
        while True:
            result = user32.GetMessageW(ctypes.byref(message), None, 0, 0)
            if result == 0:
                break
            if result == -1:
                raise ctypes.WinError(ctypes.get_last_error())
            if not user32.IsDialogMessageW(window, ctypes.byref(message)):
                user32.TranslateMessage(ctypes.byref(message))
                user32.DispatchMessageW(ctypes.byref(message))
    finally:
        if window:
            user32.DestroyWindow(window)
        if font:
            gdi32.DeleteObject(font)
        user32.UnregisterClassW(class_name, module)
    if unexpected_stop:
        raise RuntimeError("The local server stopped unexpectedly. Restart the application.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the portable Zarnegar Accounting application.")
    parser.add_argument("--no-browser", action="store_true", help="Do not automatically open a browser")
    parser.add_argument("--headless", action="store_true", help="Run without the launcher window")
    parser.add_argument("--stop", action="store_true", help="Stop this folder's running application")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Preferred local port (default: 8765)")
    args = parser.parse_args(argv)
    paths = resolve_paths()
    lock = InstanceLock(paths.data_dir / ".launcher.lock")
    server = None
    thread = None
    listener = None
    try:
        if not 0 <= args.port <= 65535:
            raise ValueError("The port must be between 0 and 65535.")
        if args.stop:
            state = running_instance(paths)
            if state is not None:
                _request_json(state["url"] + "/_portable/shutdown", state["token"])
            return 0
        prepare_paths(paths)
        if not lock.acquire():
            state = running_instance(paths, timeout=40)
            if state is None:
                raise RuntimeError("Another copy is starting or stopping. Wait a moment and try again.")
            if not args.no_browser:
                _open_browser(state["url"])
            return 0
        _configure_logging(paths)
        listener = bind_local_socket(args.port)
        port = listener.getsockname()[1]
        url = f"http://127.0.0.1:{port}"
        token = secrets.token_hex(32)
        stop_event = threading.Event()
        application = create_portable_app(paths, port, token, stop_event)
        import uvicorn
        config = uvicorn.Config(application, host="127.0.0.1", port=port,
                                loop="asyncio", http="h11", ws="none", lifespan="on",
                                log_config=None, access_log=False, timeout_graceful_shutdown=30)
        server = uvicorn.Server(config)

        def serve():
            try:
                server.run(sockets=[listener])
            except BaseException:
                LOGGER.exception("The local server failed")

        thread = threading.Thread(target=serve, name="noor-server", daemon=False)
        thread.start()
        deadline = time.monotonic() + 45
        while not server.started:
            if not thread.is_alive() or time.monotonic() >= deadline:
                raise RuntimeError("The local server could not start. See the log for details.")
            time.sleep(0.1)
        state = {"url": url, "token": token, "pid": os.getpid()}
        paths.runtime_file.write_text(json.dumps(state), encoding="utf-8")
        LOGGER.info("Zarnegar Accounting is ready at %s", url)
        if not args.no_browser:
            _open_browser(url)
        if args.headless:
            while thread.is_alive() and not stop_event.wait(0.2):
                pass
            if not stop_event.is_set() and not server.should_exit:
                raise RuntimeError("The local server stopped unexpectedly.")
        else:
            _desktop_window(url, paths, server, thread, stop_event)
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        LOGGER.exception("Launcher failed")
        _show_error(str(error), paths, args.headless)
        return 1
    finally:
        if server is not None:
            server.should_exit = True
        if thread is not None:
            thread.join()
        if listener is not None:
            listener.close()
        if lock.handle is not None:
            paths.runtime_file.unlink(missing_ok=True)
            lock.release()


if __name__ == "__main__":
    raise SystemExit(main())
