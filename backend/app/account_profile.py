"""Account identity copied into newly issued records for historical printing."""
import unicodedata

from .database import read_gallery_name


def normalize_gallery_name(value):
    # Normalize Persian forms and whitespace before applying the printed length limit.
    normalized = " ".join(unicodedata.normalize("NFKC", value).replace("ي", "ی").replace("ك", "ک").split())
    if not normalized or len(normalized) > 120 or any(unicodedata.category(char) == "Cc" for char in normalized):
        raise ValueError("نام گالری باید بین ۱ تا ۱۲۰ نویسه باشد.")
    return normalized


def stamp_gallery_names(previous, incoming, gallery_name):
    """Ignore client supplied names; an existing record keeps its original identity."""
    saved = {str(row["id"]): row for row in previous}
    result = []
    for row in incoming:
        stamped = dict(row)
        old = saved.get(str(row["id"]))
        if old is not None:
            if "galleryName" in old:
                stamped["galleryName"] = old["galleryName"]
            else:
                stamped.pop("galleryName", None)
        elif gallery_name:
            stamped["galleryName"] = gallery_name
        else:
            stamped.pop("galleryName", None)
        result.append(stamped)
    return result


def stamp_workspace_gallery(previous, incoming, connection, account_id):
    gallery_name = read_gallery_name(connection, account_id)
    previous_documents = {str(row["id"]): row for row in previous["documents"]}
    incoming["documents"] = stamp_gallery_names(previous["documents"], incoming["documents"], gallery_name)
    documents = {str(row["id"]): row for row in incoming["documents"]}
    previous_partners = {partner["id"]: partner for partner in previous["partners"]}
    for partner in incoming["partners"]:
        old_entries = previous_partners.get(partner["id"], {}).get("entries", [])
        partner["entries"] = stamp_gallery_names(old_entries, partner["entries"], gallery_name)
        old_entries_by_id = {entry["id"]: entry for entry in old_entries}
        for entry in partner["entries"]:
            old_entry = old_entries_by_id.get(entry["id"])
            if old_entry is not None:
                # A corrected supplier invoice may add new line IDs, but it is
                # still the original issued invoice under its historical name.
                historical_name = old_entry.get("galleryName") or next((
                    previous_documents[str(identifier)].get("galleryName") for identifier in old_entry.get("documentIds", [])
                    if previous_documents.get(str(identifier), {}).get("galleryName")), "")
                for identifier in entry.get("documentIds", []):
                    if str(identifier) in documents and str(identifier) not in previous_documents:
                        if historical_name:
                            documents[str(identifier)]["galleryName"] = historical_name
                        else:
                            documents[str(identifier)].pop("galleryName", None)
