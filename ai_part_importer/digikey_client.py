"""Thin client for DigiKey's Product Information API v4.

NOTE: field names below match DigiKey's v4 keyword-search response as
documented at the time this was written. DigiKey has changed this shape
across API versions before - if lookups start failing or returning empty
fields once real credentials are configured, compare this against DigiKey's
current API reference/Swagger and adjust the field names in
`_normalize_product()` accordingly.
"""

import time

import requests

TOKEN_URL = 'https://api.digikey.com/v1/oauth2/token'
SEARCH_URL = 'https://api.digikey.com/products/v4/search/keyword'

# Cache OAuth tokens in-process, keyed by client_id - avoids re-authenticating
# on every single lookup within a draft (and across drafts, until expiry).
_token_cache: dict = {}


class DigiKeyClientError(Exception):
    """Raised when DigiKey auth or search fails outright (not just "no match")."""


def _get_token(client_id: str, client_secret: str) -> str:
    cached = _token_cache.get(client_id)
    if cached and cached[1] > time.time() + 30:
        return cached[0]

    try:
        response = requests.post(
            TOKEN_URL,
            data={
                'client_id': client_id,
                'client_secret': client_secret,
                'grant_type': 'client_credentials',
            },
            timeout=30,
        )
    except requests.RequestException as exc:
        raise DigiKeyClientError(f'Could not reach DigiKey token endpoint: {exc}') from exc

    if not response.ok:
        raise DigiKeyClientError(f'DigiKey authentication failed: HTTP {response.status_code}')

    data = response.json()
    token = data['access_token']
    expiry = time.time() + data.get('expires_in', 600)
    _token_cache[client_id] = (token, expiry)
    return token


def _normalize_product(product: dict) -> dict:
    variations = product.get('ProductVariations') or []
    first_variation = variations[0] if variations else {}

    parameters = [
        {'name': p.get('ParameterText'), 'value': p.get('ValueText')}
        for p in product.get('Parameters') or []
        if p.get('ParameterText') and p.get('ValueText')
    ]

    price_breaks = [
        {'quantity': pb.get('BreakQuantity'), 'price': pb.get('UnitPrice')}
        for pb in first_variation.get('StandardPricing') or []
    ]

    return {
        'manufacturer': (product.get('Manufacturer') or {}).get('Name'),
        'description': (product.get('Description') or {}).get('ProductDescription'),
        'datasheet_url': product.get('DatasheetUrl'),
        'product_url': product.get('ProductUrl'),
        'sku': first_variation.get('DigiKeyProductNumber'),
        'parameters': parameters,
        'price_breaks': price_breaks,
    }


def lookup_by_mpn(*, client_id: str, client_secret: str, mpn: str):
    """Search DigiKey by keyword/MPN. Returns a normalized dict, or None if
    no product was found. Raises DigiKeyClientError on auth/network failure."""

    if not client_id or not client_secret or not mpn:
        return None

    token = _get_token(client_id, client_secret)

    headers = {
        'Authorization': f'Bearer {token}',
        'X-DIGIKEY-Client-Id': client_id,
        'X-DIGIKEY-Locale-Site': 'US',
        'X-DIGIKEY-Locale-Language': 'en',
        'X-DIGIKEY-Locale-Currency': 'USD',
        'Content-Type': 'application/json',
    }

    try:
        response = requests.post(
            SEARCH_URL,
            headers=headers,
            json={'Keywords': mpn, 'Limit': 1},
            timeout=30,
        )
    except requests.RequestException as exc:
        raise DigiKeyClientError(f'Could not reach DigiKey search endpoint: {exc}') from exc

    if not response.ok:
        raise DigiKeyClientError(f'DigiKey search failed: HTTP {response.status_code}')

    products = response.json().get('Products') or []

    if not products:
        return None

    return _normalize_product(products[0])
