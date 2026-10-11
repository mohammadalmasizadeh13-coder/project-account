"""A rollback must not prevent login from loading existing v4 ledgers."""
import json

import pytest
from pydantic import ValidationError
from sqlalchemy import select, update

from app.database import empty_workspace, workspaces
from app.partners import LedgerEntry, PartnerInvoice
from test_api import client, login


def historical_entry(**changes):
    return {"id": "v4-entry", "type": "mixed", "date": "2026-10-09",
        "createdAt": "2026-10-09T10:00:00Z", "calculationVersion": 4,
        "settlementUnit": "mixed", "goldDebit": 3, "goldCredit": 1,
        "tomanDebit": 500, "tomanCredit": 100, "goldBalance": 2,
        "tomanBalance": 400, "lines": [{"settlementUnit": "gold", "goldTotal": 3}],
        **changes}


def test_login_loads_v4_workspace_without_rewriting_saved_records(client):
    data = empty_workspace()
    data["partners"] = [{"id": "historical-partner", "name": "Historical partner",
        "entries": [historical_entry()], "goldBalance": 2, "tomanBalance": 400}]
    raw = json.dumps(data)
    with client.app.state.engine.begin() as connection:
        connection.execute(update(workspaces).where(workspaces.c.id == 1).values(data=raw, revision=7))

    login(client)
    assert client.get("/api/auth/session").status_code == 200
    response = client.get("/api/owner/workspace")
    assert response.status_code == 200, response.text
    assert response.json()["revision"] == 7
    partner = response.json()["data"]["partners"][0]
    for key, value in historical_entry().items():
        assert partner["entries"][0][key] == value
    assert (partner["goldBalance"], partner["tomanBalance"]) == (2, 400)
    assert client.get("/api/owner/partners").status_code == 200
    with client.app.state.engine.connect() as connection:
        assert connection.execute(select(workspaces.c.data).where(workspaces.c.id == 1)).scalar_one() == raw


def test_v4_read_support_does_not_enable_unsupported_invoice_writes():
    with pytest.raises(ValidationError):
        PartnerInvoice.model_validate({"revision": 0,
            "requestId": "d4bd2675-5cc9-444b-b1cb-8b833d2dc251", "date": "2026-10-09",
            "calculationVersion": 4, "settlementUnit": "mixed", "gold18Price": 100000,
            "lines": [{"category": "crafted"}]})


@pytest.mark.parametrize("version", [1, 2, 3])
def test_mixed_settlement_is_not_reinterpreted_as_an_older_version(version):
    with pytest.raises(ValidationError):
        LedgerEntry.model_validate(historical_entry(calculationVersion=version))
