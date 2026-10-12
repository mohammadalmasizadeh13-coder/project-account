"""Account transfer checks use synthetic SQLite databases only."""

from contextlib import closing
import sqlite3

import pytest

from portable.build import snapshot_database


def test_snapshot_includes_committed_wal_and_clears_only_copied_sessions(tmp_path):
    source = tmp_path / "running source.db"
    destination = tmp_path / "copied folder" / "data" / "zarnegaar.db"
    with closing(sqlite3.connect(source)) as live:
        assert live.execute("PRAGMA journal_mode=WAL").fetchone() == ("wal",)
        live.execute("PRAGMA wal_autocheckpoint=0")
        live.executescript("""
            CREATE TABLE noor_users (username TEXT, password_hash TEXT);
            CREATE TABLE noor_workspace (revision INTEGER, data TEXT);
            CREATE TABLE noor_sessions (token_hash TEXT);
            CREATE TABLE noor_login_attempts (key TEXT, count INTEGER);
        """)
        live.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        live.execute("INSERT INTO noor_users VALUES (?, ?)", ("test-owner", "test-hash-only"))
        live.execute("INSERT INTO noor_workspace VALUES (?, ?)", (7, '{"customers":[{"id":"test-customer"}]}'))
        live.execute("INSERT INTO noor_sessions VALUES (?)", ("test-session-only",))
        live.execute("INSERT INTO noor_login_attempts VALUES (?, ?)", ("test-attempt", 3))
        live.commit()
        assert source.with_name(source.name + "-wal").stat().st_size > 0

        snapshot_database(source, destination)

        with closing(sqlite3.connect(destination)) as copied:
            assert copied.execute("PRAGMA integrity_check").fetchone() == ("ok",)
            assert copied.execute("SELECT * FROM noor_users").fetchall() == [("test-owner", "test-hash-only")]
            assert copied.execute("SELECT * FROM noor_workspace").fetchall() == [
                (7, '{"customers":[{"id":"test-customer"}]}')]
            assert copied.execute("SELECT COUNT(*) FROM noor_sessions").fetchone() == (0,)
            assert copied.execute("SELECT COUNT(*) FROM noor_login_attempts").fetchone() == (0,)

        assert live.execute("SELECT * FROM noor_sessions").fetchall() == [("test-session-only",)]
        assert live.execute("SELECT * FROM noor_login_attempts").fetchall() == [("test-attempt", 3)]
        assert live.execute("SELECT revision FROM noor_workspace").fetchone() == (7,)
        live.execute("UPDATE noor_workspace SET revision=8")
        live.commit()

    with closing(sqlite3.connect(destination)) as copied:
        assert copied.execute("SELECT revision FROM noor_workspace").fetchone() == (7,)


@pytest.mark.parametrize("copy_over_source", [False, True])
def test_snapshot_refuses_overwriting_existing_data(tmp_path, copy_over_source):
    source = tmp_path / "source.db"
    with closing(sqlite3.connect(source)) as database:
        database.execute("CREATE TABLE saved_data (value TEXT)")
        database.execute("INSERT INTO saved_data VALUES ('keep source')")
        database.commit()
    destination = source if copy_over_source else tmp_path / "destination.db"
    if not copy_over_source:
        destination.write_bytes(b"existing destination must stay untouched")
    original = destination.read_bytes()

    with pytest.raises(FileExistsError):
        snapshot_database(source, destination)

    assert destination.read_bytes() == original
    with closing(sqlite3.connect(source)) as database:
        assert database.execute("SELECT value FROM saved_data").fetchone() == ("keep source",)
