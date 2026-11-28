"""
Lyrics & Alignment Validation Service.
Validates both normalized LyricsDocument (camelCase) and CanonicalSongAlignment (snake_case).
"""

from __future__ import annotations

from typing import Any, Dict

from ..core.validation_rules import (
    LyricsValidationReport,
    from_aligned_lyrics_document_dict,
    to_aligned_lyrics_document_dict,
    to_canonical_song_alignment_dict,
    validate_aligned_lyrics_document_dict,
    validate_canonical_song_alignment_dict,
    validate_lyrics_document_dict,
)


class ValidationService:
    def validate_document(self, doc: Dict[str, Any]) -> LyricsValidationReport:
        return validate_lyrics_document_dict(doc)

    def validate_canonical_song(self, canonical_doc: Dict[str, Any]) -> LyricsValidationReport:
        return validate_canonical_song_alignment_dict(canonical_doc)

    def validate_aligned_lyrics(self, aligned_doc: Dict[str, Any]) -> LyricsValidationReport:
        return validate_aligned_lyrics_document_dict(aligned_doc)

    def to_canonical_song(
        self,
        doc: Dict[str, Any],
        alignment_version: str = "v1",
    ) -> Dict[str, Any]:
        return to_canonical_song_alignment_dict(doc, alignment_version=alignment_version)

    def to_aligned_lyrics(
        self,
        doc: Dict[str, Any],
        version: int | None = None,
    ) -> Dict[str, Any]:
        return to_aligned_lyrics_document_dict(doc, version=version)

    def from_aligned_lyrics(
        self,
        aligned_doc: Dict[str, Any],
        document_id: str | None = None,
    ) -> Dict[str, Any]:
        return from_aligned_lyrics_document_dict(aligned_doc, document_id=document_id)
