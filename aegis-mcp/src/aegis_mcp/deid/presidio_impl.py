"""Rule-based de-id via Microsoft Presidio. v1 of the safety story."""
from __future__ import annotations

from importlib.metadata import version as _pkg_version

from presidio_analyzer import AnalyzerEngine

from aegis_mcp.deid.base import DeIdentifier, Mapping, MappingEntry, RedactionResult

PRESIDIO_VERSION = _pkg_version("presidio-analyzer")


# Presidio entity types we surface through the spec's PhiEntityType union.
# Anything Presidio returns outside this list is mapped to 'ID' so the TS side
# stays exhaustive on the union. MRN has no Presidio recognizer; MRN values
# flow through the default 'ID' fallback in redact(). ADDRESS is surfaced as
# 'LOCATION' since Presidio's LOCATION covers street addresses too.
_TYPE_MAP = {
    "PERSON": "PERSON",
    "DATE_TIME": "DATE",
    "PHONE_NUMBER": "PHONE",
    "EMAIL_ADDRESS": "EMAIL",
    "LOCATION": "LOCATION",
    "US_SSN": "ID",
    "MEDICAL_LICENSE": "ID",
    "US_DRIVER_LICENSE": "ID",
    "US_PASSPORT": "ID",
    "ORGANIZATION": "ORGANIZATION",
    "URL": "ID",
    "IP_ADDRESS": "ID",
    "CREDIT_CARD": "ID",
}


def _placeholder(entity_type: str, n: int) -> str:
    return f"<{entity_type}_{n}>"


class PresidioDeIdentifier(DeIdentifier):
    """Deterministic, mapping-shared, in-process Presidio de-id engine."""

    def __init__(self) -> None:
        self._analyzer = AnalyzerEngine()
        self._version = f"presidio-{PRESIDIO_VERSION}"

    def redact(self, text: str | list[str]) -> RedactionResult:
        # Normalize input
        is_batch = isinstance(text, list)
        blobs: list[str] = list(text) if is_batch else [text]  # type: ignore[arg-type]

        entries: dict[str, MappingEntry] = {}
        original_to_placeholder: dict[tuple[str, str], str] = {}
        type_counters: dict[str, int] = {}

        redacted_blobs: list[str] = []
        for blob in blobs:
            results = self._analyzer.analyze(text=blob, language="en")
            # Drop overlapping spans — keep highest-score per character range so
            # right-to-left replacement doesn't corrupt indices when Presidio
            # tags the same substring under multiple entity types. E.g. Presidio
            # may tag "12345678" as both US_BANK_NUMBER and US_DRIVER_LICENSE
            # over the same span; without dedup, the second replacement would
            # corrupt the just-inserted placeholder.
            results.sort(key=lambda r: (-r.score, r.start))
            kept: list = []
            taken: list[tuple[int, int]] = []
            for r in results:
                if any(not (r.end <= s or r.start >= e) for s, e in taken):
                    continue
                kept.append(r)
                taken.append((r.start, r.end))
            # Sort right-to-left so substring replacement preserves indices
            kept.sort(key=lambda r: r.start, reverse=True)
            results = kept
            redacted = blob
            for r in results:
                phi_type = _TYPE_MAP.get(r.entity_type, "ID")
                original = blob[r.start : r.end]
                key = (phi_type, original)
                placeholder = original_to_placeholder.get(key)
                if placeholder is None:
                    type_counters[phi_type] = type_counters.get(phi_type, 0) + 1
                    placeholder = _placeholder(phi_type, type_counters[phi_type])
                    original_to_placeholder[key] = placeholder
                    entries[placeholder] = {"type": phi_type, "original": original}
                redacted = redacted[: r.start] + placeholder + redacted[r.end :]
            redacted_blobs.append(redacted)

        mapping: Mapping = {"entries": entries, "version": self._version}
        return {
            "redacted": redacted_blobs if is_batch else redacted_blobs[0],
            "mapping": mapping,
        }

    def restore(self, text: str, mapping: Mapping) -> str:
        # Longest-key-first to avoid `<PERSON_1>` partially matching `<PERSON_10>`.
        for placeholder in sorted(mapping["entries"], key=len, reverse=True):
            text = text.replace(placeholder, mapping["entries"][placeholder]["original"])
        return text
