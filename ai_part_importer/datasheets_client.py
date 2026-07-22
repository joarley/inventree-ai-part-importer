"""Thin client for Datasheets.com's product search API (AspenCore).

Used as a fallback source for the datasheet/image/specs specifically - many
parts simply aren't carried by DigiKey/Mouser (or don't have a datasheet on
file there), but datasheets.com indexes datasheets independently of any
distributor's catalog.

NOTE: field names below match the documented /api/v1/search response shape
at the time this was written (see https://www.datasheets.com/api-docs). If
lookups start failing or returning empty fields once a real API key is
configured, compare this against the current docs and adjust
`_normalize_result()` - in particular, the exact top-level key wrapping the
results array wasn't confirmed, so a few common shapes are tried defensively.
"""

import logging

import requests

logger = logging.getLogger('inventree_plugins.ai_part_importer')

SEARCH_URL = 'https://www.datasheets.com/api/v1/search'


class DatasheetsComClientError(Exception):
    """Raised when the Datasheets.com search fails outright (not just "no match")."""


def _normalize_result(result: dict) -> dict:
    specs = result.get('specs') or []

    parameters = [
        {'name': s.get('name'), 'value': s.get('value')}
        for s in specs
        if s.get('name') and s.get('value')
    ]

    return {
        'manufacturer': result.get('manufacturer'),
        'description': result.get('description') or result.get('title'),
        'datasheet_url': result.get('datasheetUrl'),
        'image_url': result.get('primaryImageUrl'),
        'parameters': parameters,
    }


def _extract_results(data) -> list:
    """The exact top-level shape of the response isn't confirmed - handle
    the plausible variants rather than assuming one."""

    if isinstance(data, list):
        return data

    if isinstance(data, dict):
        for key in ('results', 'data', 'items'):
            if isinstance(data.get(key), list):
                return data[key]

    return []


def lookup_by_mpn(*, api_key: str, mpn: str):
    """Search Datasheets.com by part number. Returns a normalized dict, or
    None if no match was found. Raises DatasheetsComClientError on auth/
    network failure."""

    if not api_key or not mpn:
        return None

    headers = {'Authorization': f'Bearer {api_key}'}

    try:
        response = requests.get(
            SEARCH_URL,
            headers=headers,
            params={'q': mpn, 'limit': 1},
            timeout=30,
        )
    except requests.RequestException as exc:
        raise DatasheetsComClientError(
            f'Could not reach Datasheets.com search endpoint: {exc}'
        ) from exc

    if not response.ok:
        raise DatasheetsComClientError(
            f'Datasheets.com search failed: HTTP {response.status_code}'
        )

    results = _extract_results(response.json())

    if not results:
        return None

    # Using .warning() (not .info()) - see digikey_client.py/mouser_client.py
    # for why: this deployment appears to filter out INFO-level records.
    logger.warning('Datasheets.com raw result for %r: %s', mpn, results[0])

    return _normalize_result(results[0])
