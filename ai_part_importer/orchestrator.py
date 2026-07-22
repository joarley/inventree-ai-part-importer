"""Builds a "draft" (see README/plan for the JSON shape) from a text or photo
identification request: calls the AI, tags every field with its source, runs
official DigiKey/Mouser enrichment if configured, and looks up whether
something similar already exists in InvenTree.
"""

from . import ai_client, official_enrichment
from .duplicates import search_existing


def _tag(value, source='ai', **extra):
    if value in (None, ''):
        return None
    return {'value': value, 'source': source, **extra}


def _build_candidate(raw: dict) -> dict:
    """Normalize one raw AI candidate into the tagged draft candidate shape."""

    manufacturer = raw.get('manufacturer') or ''
    mpn = raw.get('mpn') or ''
    name = raw.get('name') or ''

    parameters = [
        {'name': p.get('name'), 'value': p.get('value'), 'source': 'ai'}
        for p in raw.get('parameters') or []
        if p.get('name') and p.get('value')
    ]

    candidate = {
        'confidence': raw.get('confidence', 0.0),
        'manufacturer': _tag(manufacturer),
        'mpn': _tag(mpn),
        'name': _tag(name),
        'description': _tag(raw.get('description') or ''),
        'category_guess': (
            {'path': raw.get('category_guess'), 'source': 'ai'}
            if raw.get('category_guess') else None
        ),
        'datasheet_url': None,
        'image_url': None,
        'parameters': parameters,
        'supplier_links': [],
        'existing_matches': search_existing(mpn=mpn, manufacturer=manufacturer, name=name),
    }

    return candidate


def _has_official_credentials(settings) -> bool:
    return bool(
        (settings.get('DIGIKEY_CLIENT_ID') and settings.get('DIGIKEY_CLIENT_SECRET'))
        or settings.get('MOUSER_API_KEY')
        or settings.get('DATASHEETS_COM_API_KEY')
    )


def _candidates_from_raw(raw: dict, settings: dict) -> list:
    raw_candidates = raw.get('candidates') or []
    min_confidence = settings.get('MIN_CONFIDENCE', 0.0)

    candidates = [
        _build_candidate(c) for c in raw_candidates
        if c.get('confidence', 0.0) >= min_confidence
    ]

    if _has_official_credentials(settings):
        candidates = [
            official_enrichment.enrich_candidate(c, settings=settings) for c in candidates
        ]

    return candidates


def build_draft_from_text(*, settings, text: str) -> dict:
    """Run the text-identification flow and return a draft dict."""

    raw = ai_client.identify_from_text(
        base_url=settings.get('AI_BASE_URL'),
        api_key=settings.get('AI_API_KEY'),
        model=settings.get('AI_TEXT_MODEL'),
        text=text,
    )

    return {
        'source': {'kind': 'text', 'raw_text': text, 'had_image': False},
        'candidates': _candidates_from_raw(raw, settings),
    }


def build_draft_from_photo(*, settings, image_bytes: bytes, text: str = '') -> dict:
    """Run the photo-identification flow and return a draft dict."""

    raw = ai_client.identify_from_image(
        base_url=settings.get('AI_BASE_URL'),
        api_key=settings.get('AI_API_KEY'),
        model=settings.get('AI_VISION_MODEL'),
        image_bytes=image_bytes,
        text=text,
    )

    return {
        'source': {'kind': 'photo', 'raw_text': text or None, 'had_image': True},
        'candidates': _candidates_from_raw(raw, settings),
    }


def build_enrichment_draft(*, settings, part, text: str = '') -> dict:
    """Seed identification with an existing Part's own name/description (plus
    optional extra text), then flag which fields already have a value on that
    Part - the frontend uses this to pre-fill with the *existing* value rather
    than silently replacing it with the AI's suggestion.
    """

    from company.models import ManufacturerPart

    seed_text = text or f'{part.name} - {part.description}'.strip(' -')

    raw = ai_client.identify_from_text(
        base_url=settings.get('AI_BASE_URL'),
        api_key=settings.get('AI_API_KEY'),
        model=settings.get('AI_TEXT_MODEL'),
        text=seed_text,
    )

    candidates = _candidates_from_raw(raw, settings)

    existing_manufacturer_part = ManufacturerPart.objects.filter(part=part).first()

    already_set = {
        'name': bool(part.name),
        'description': bool(part.description),
        'manufacturer': bool(existing_manufacturer_part and existing_manufacturer_part.manufacturer_id),
        'mpn': bool(existing_manufacturer_part and existing_manufacturer_part.MPN),
    }

    for candidate in candidates:
        candidate['already_set'] = already_set

        if already_set['name']:
            candidate['name'] = {'value': part.name, 'source': 'existing'}
        if already_set['description']:
            candidate['description'] = {'value': part.description, 'source': 'existing'}
        if already_set['manufacturer']:
            candidate['manufacturer'] = {
                'value': existing_manufacturer_part.manufacturer.name,
                'source': 'existing',
            }
        if already_set['mpn']:
            candidate['mpn'] = {'value': existing_manufacturer_part.MPN, 'source': 'existing'}

    return {
        'source': {'kind': 'enrich', 'raw_text': text or None, 'had_image': False},
        'part_pk': part.pk,
        'existing_category': (
            {'pk': part.category_id, 'pathstring': str(part.category)}
            if part.category_id else None
        ),
        'candidates': candidates,
    }
