"""Thin client for Mouser's Search API (simple apiKey auth, no OAuth).

NOTE: field names below match Mouser's documented "search by part number"
response shape at the time this was written. If lookups start failing or
returning empty fields once a real API key is configured, compare this
against Mouser's current API reference and adjust `_normalize_part()`.
"""

import logging

import requests

logger = logging.getLogger('inventree_plugins.ai_part_importer')

SEARCH_URL = 'https://api.mouser.com/api/v1/search/partnumber'


class MouserClientError(Exception):
    """Raised when the Mouser search fails outright (not just "no match")."""


def _normalize_part(part: dict) -> dict:
    parameters = [
        {'name': a.get('AttributeName'), 'value': a.get('AttributeValue')}
        for a in part.get('ProductAttributes') or []
        if a.get('AttributeName') and a.get('AttributeValue')
    ]

    price_breaks = [
        {'quantity': pb.get('Quantity'), 'price': pb.get('Price')}
        for pb in part.get('PriceBreaks') or []
    ]

    return {
        'manufacturer': part.get('Manufacturer'),
        # Mouser's Search API doesn't appear to expose a separate "detailed"
        # description field the way DigiKey does (ProductDescription vs.
        # DetailedDescription) - check the raw part logged below if you find
        # one and want a fuller write-up here too.
        'description': part.get('Description'),
        'datasheet_url': part.get('DataSheetUrl'),
        'image_url': part.get('ImagePath'),
        'product_url': part.get('ProductDetailUrl'),
        'sku': part.get('MouserPartNumber'),
        'parameters': parameters,
        'price_breaks': price_breaks,
    }


def lookup_by_mpn(*, api_key: str, mpn: str):
    """Search Mouser by part number. Returns a normalized dict, or None if no
    part was found. Raises MouserClientError on auth/network failure."""

    if not api_key or not mpn:
        return None

    try:
        response = requests.post(
            SEARCH_URL,
            params={'apiKey': api_key},
            json={
                'SearchByPartRequest': {
                    'mouserPartNumber': mpn,
                    'partSearchOptions': 'string',
                }
            },
            timeout=30,
        )
    except requests.RequestException as exc:
        raise MouserClientError(f'Could not reach Mouser search endpoint: {exc}') from exc

    if not response.ok:
        raise MouserClientError(f'Mouser search failed: HTTP {response.status_code}')

    data = response.json()

    errors = data.get('Errors') or []
    if errors:
        raise MouserClientError(f'Mouser search returned errors: {errors}')

    parts = (data.get('SearchResults') or {}).get('Parts') or []

    if not parts:
        return None

    # Field names in _normalize_part() are best-effort/unverified (see module
    # docstring) - log the raw part so a mismatch (e.g. an empty image_url)
    # can be root-caused from the container logs instead of guessing blind.
    # Using .warning() here, not .info() - this deployment's logging appears
    # to filter out INFO-level records, so anything meant to be inspectable
    # via `docker compose logs` needs to be at WARNING or above.
    logger.warning('Mouser raw part for %r: %s', mpn, parts[0])

    return _normalize_part(parts[0])
