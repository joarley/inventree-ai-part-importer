"""Thin client for Mouser's Search API (simple apiKey auth, no OAuth).

NOTE: field names below match Mouser's documented "search by part number"
response shape at the time this was written. If lookups start failing or
returning empty fields once a real API key is configured, compare this
against Mouser's current API reference and adjust `_normalize_part()`.
"""

import requests

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
        'description': part.get('Description'),
        'datasheet_url': part.get('DataSheetUrl'),
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

    return _normalize_part(parts[0])
