import json
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from .database import rates, read_workspace


TRANSLATION = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩٫", "01234567890123456789.")
DEFAULT_CRAFTED_PROFIT_PERCENT = 7


def crafted_profit_or_default(value):
    """Only an absent/blank profit uses the default; zero is an explicit choice."""
    return DEFAULT_CRAFTED_PROFIT_PERCENT if value is None or isinstance(value, str) and not value.strip() else value


def number(value, fallback="0"):
    try:
        clean = "".join(str(value).translate(TRANSLATION).replace(",", "").replace("٬", "").split())
        result = Decimal(clean)
        if result.is_finite() and abs(result) <= Decimal("1e18"):
            return result
    except (InvalidOperation, ValueError, TypeError):
        pass
    return Decimal(fallback)


def base_price_breakdown(base, wage_percent, wage_fixed, profit_percent, tax_percent, profit_fixed=0):
    with localcontext() as context:
        context.prec = 80
        gold = number(base)
        wage = gold * number(wage_percent) / 100 + number(wage_fixed)
        profit = (gold + wage) * number(profit_percent) / 100 + number(profit_fixed)
        tax = (wage + profit) * number(tax_percent) / 100
        # Round each displayed component, then sum them so the invoice is reproducible.
        parts = {name: int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)) for name, value in {"gold": gold, "wage": wage, "profit": profit, "tax": tax}.items()}
    return {**parts, "total": sum(parts.values())}


def price_breakdown(weight, purity, wage_percent, wage_fixed, profit_percent, tax_percent, rate, profit_fixed=0):
    with localcontext() as context:
        context.prec = 80
        base = number(weight) * number(purity) / Decimal(750) * number(rate)
        return base_price_breakdown(base, wage_percent, wage_fixed, profit_percent, tax_percent, profit_fixed)


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def parse_timestamp(value):
    timestamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        raise ValueError("A timezone is required")
    if timestamp.timestamp() > time.time() + 60:
        raise ValueError("Future rate timestamp")
    return timestamp


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class RateService:
    def __init__(self, engine, settings):
        self.engine, self.settings = engine, settings
        self.lock = threading.Lock()

    def save(self, key, value, updated_at, source):
        with self.engine.begin() as connection:
            fields = {"value": str(value), "updated_at": updated_at, "source": source, "checked_at": time.time()}
            result = connection.execute(update(rates).where(rates.c.id == key).values(**fields))
            if not result.rowcount:
                try:
                    with connection.begin_nested():
                        connection.execute(rates.insert().values(id=key, **fields))
                except IntegrityError:
                    connection.execute(update(rates).where(rates.c.id == key).values(**fields))

    def _row(self, key):
        with self.engine.connect() as connection:
            row = connection.execute(select(rates).where(rates.c.id == key)).mappings().first()
            return dict(row) if row else None

    def _refresh_live(self):
        settings = self.settings
        url = urlparse(settings.rate_url)
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            raise ValueError("GOLD_RATE_URL must be HTTPS")
        headers = {"Accept": "application/json"}
        if settings.rate_token:
            headers["Authorization"] = f"Bearer {settings.rate_token}"
        with build_opener(NoRedirect()).open(Request(settings.rate_url, headers=headers), timeout=4) as response:
            raw = response.read(65537)
            if len(raw) > 65536:
                raise ValueError("Rate response too large")
            payload = json.loads(raw)
        value = number(payload["price"])
        if value <= 0 or value > Decimal("1e12") or payload.get("unit") not in {"toman", "rial"}:
            raise ValueError("Invalid rate")
        if payload["unit"] == "rial":
            value /= 10
        timestamp = parse_timestamp(payload["updatedAt"])
        self.save("live", value, timestamp.isoformat(), url.hostname)

    def _manual_rate(self):
        stored = self._row("manual")
        with self.engine.connect() as connection:
            prices = read_workspace(connection)["data"].get("prices", {})
        candidates = [stored, {"value": prices.get("goldGramPrice"), "updated_at": prices.get("updatedAt"), "source": "نرخ ثبت‌شده حسابداری"}]
        valid = []
        for candidate in candidates:
            if not candidate or not 0 < number(candidate.get("value")) <= Decimal("1e12"):
                continue
            try:
                timestamp = parse_timestamp(candidate.get("updated_at"))
            except (ValueError, TypeError, OverflowError):
                continue
            valid.append((timestamp.timestamp(), candidate))
        return max(valid, key=lambda candidate: candidate[0])[1] if valid else None

    def get(self):
        key = "live" if self.settings.rate_url else "manual"
        row = self._row(key) if key == "live" else self._manual_rate()
        if key == "live" and (not row or time.time() - row["checked_at"] >= self.settings.rate_cache_seconds):
            with self.lock:
                row = self._row(key)
                if not row or time.time() - row["checked_at"] >= self.settings.rate_cache_seconds:
                    try:
                        self._refresh_live()
                    except Exception:
                        # Keep the provider's last real timestamp; errors never make a rate fresh.
                        with self.engine.begin() as connection:
                            if row:
                                connection.execute(update(rates).where(rates.c.id == key).values(checked_at=time.time()))
                            else:
                                try:
                                    with connection.begin_nested():
                                        connection.execute(rates.insert().values(id=key, value=None, updated_at=None, checked_at=time.time(), source=""))
                                except IntegrityError:
                                    pass
                    row = self._row(key)
        if not row or row["value"] is None:
            return {"value": None, "source": "نرخ ثبت نشده", "updatedAt": None, "stale": True, "mode": "unavailable"}
        age = time.time() - parse_timestamp(row["updated_at"]).timestamp()
        return {"value": float(number(row["value"])), "source": row["source"], "updatedAt": row["updated_at"], "stale": age > self.settings.rate_stale_seconds, "mode": key}
