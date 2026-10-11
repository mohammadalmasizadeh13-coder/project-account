"""Identify the server sources loaded at startup without exposing local paths."""

from hashlib import sha256
from pathlib import Path


def source_revision(directory=None):
    root = Path(directory) if directory is not None else Path(__file__).resolve().parent
    digest = sha256()
    for path in sorted(root.rglob("*.py"), key=lambda item: item.relative_to(root).as_posix()):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


if __name__ == "__main__":
    print(source_revision())
