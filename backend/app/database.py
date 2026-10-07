import json

from sqlalchemy import Boolean, Column, Float, Index, Integer, MetaData, String, Table, Text, create_engine, event, inspect, select
from sqlalchemy.pool import StaticPool


metadata = MetaData()
LEGACY_ACCOUNT_ID = "legacy-account"


def account_column(**kwargs):
    return Column("account_id", String(64), nullable=False, server_default=LEGACY_ACCOUNT_ID, **kwargs)


users = Table("noor_users", metadata,
    Column("id", String(64), primary_key=True), Column("username", String(200), nullable=False),
    account_column(),
    Column("normalized_username", String(200), nullable=False, unique=True), Column("role", String(20), nullable=False),
    Column("password_hash", String(300), nullable=False), Column("permissions", Text, nullable=False),
    Column("active", Boolean, nullable=False), Column("version", Integer, nullable=False))
imports = Table("noor_workspace_imports", metadata,
    Column("id", String(64), primary_key=True), Column("source_username", String(200), nullable=False),
    account_column(),
    Column("actor_id", String(64), nullable=False), Column("created_at", Float, nullable=False), Column("revision", Integer, nullable=False))
workspaces = Table("noor_workspace", metadata,
    Column("id", Integer, primary_key=True), account_column(),
    Column("revision", Integer, nullable=False), Column("data", Text, nullable=False))
Index("noor_workspace_account", workspaces.c.account_id, unique=True)
workspace_requests = Table("noor_workspace_requests", metadata,
    Column("request_id", String(64), primary_key=True), account_column(), Column("actor_id", String(64), nullable=False),
    Column("body_hash", String(64), nullable=False), Column("revision", Integer, nullable=False),
    Column("created_at", Float, nullable=False))
sessions = Table("noor_sessions", metadata,
    Column("token_hash", String(64), primary_key=True), Column("csrf", String(128), nullable=False),
    Column("username", String(200), nullable=False), Column("credential_version", String(64), nullable=False),
    Column("expires_at", Float, nullable=False))
attempts = Table("noor_login_attempts", metadata,
    Column("key", String(64), primary_key=True), Column("count", Integer, nullable=False), Column("expires_at", Float, nullable=False))
products = Table("noor_products", metadata,
    Column("id", String(200), primary_key=True), Column("data", Text, nullable=False), Column("updated_at", Float, nullable=False))
images = Table("noor_images", metadata,
    Column("id", String(64), primary_key=True), Column("product_id", String(200), nullable=False), Column("created_at", Float, nullable=False))
rates = Table("noor_rates", metadata,
    Column("id", String(20), primary_key=True), Column("value", String(100)), Column("updated_at", String(100)),
    Column("checked_at", Float, nullable=False), Column("source", String(200), nullable=False))


def empty_workspace():
    return {"documents": [], "customers": [], "partners": [], "prices": {}, "openingSetup": {}, "goldPurchases": [], "cheques": []}


def make_engine(url):
    kwargs = {}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 20}
        if ":memory:" in url:
            kwargs["poolclass"] = StaticPool
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def sqlite_pragmas(connection, _):
            connection.execute("PRAGMA journal_mode=WAL")
            # A successful commit must flush its WAL record before acknowledging a document.
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA busy_timeout=20000")
    return engine


def initialize(engine):
    # Additive migration: old ledgers and their users remain together in the
    # legacy account. Do this before create_all creates account-based indexes.
    with engine.begin() as connection:
        if engine.dialect.name == "sqlite":
            # Serialize schema migration and first ledger creation across workers.
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        existing = inspect(connection)
        for table in metadata.sorted_tables:
            if "account_id" not in table.c or not existing.has_table(table.name):
                continue
            if "account_id" not in {column["name"] for column in existing.get_columns(table.name)}:
                connection.exec_driver_sql(f"ALTER TABLE {table.name} ADD COLUMN account_id VARCHAR(64) NOT NULL DEFAULT '{LEGACY_ACCOUNT_ID}'")
        metadata.create_all(connection)
        for table in metadata.sorted_tables:
            for index in table.indexes:
                index.create(connection, checkfirst=True)
        ensure_workspace(connection, LEGACY_ACCOUNT_ID)


def ensure_workspace(connection, account_id):
    from sqlalchemy import literal
    connection.execute(workspaces.insert().from_select(
        ["account_id", "revision", "data"],
        select(literal(account_id), literal(0), literal(json.dumps(empty_workspace()))).where(
            ~select(workspaces.c.id).where(workspaces.c.account_id == account_id).exists())))


def read_workspace(connection, account_id=LEGACY_ACCOUNT_ID):
    row = connection.execute(select(workspaces).where(workspaces.c.account_id == account_id)).mappings().one()
    data = json.loads(row["data"])
    data.setdefault("partners", [])
    if data["partners"]:
        from .partners import canonical_partner_records
        data["partners"] = canonical_partner_records(data["partners"])
    return {"revision": row["revision"], "data": data}
