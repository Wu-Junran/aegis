"""Abstract DeIdentifier interface — shared by Presidio v1 and the future local-LLM impl."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TypedDict


class MappingEntry(TypedDict):
    type: str
    original: str


class Mapping(TypedDict):
    entries: dict[str, MappingEntry]
    version: str


class RedactionResult(TypedDict):
    redacted: str | list[str]
    mapping: Mapping


class DeIdentifier(ABC):
    @abstractmethod
    def redact(self, text: str | list[str]) -> RedactionResult: ...

    @abstractmethod
    def restore(self, text: str, mapping: Mapping) -> str: ...
