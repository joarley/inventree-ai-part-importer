"""Optional second stage of draft-building: if the user has configured DigiKey
and/or Mouser API credentials, look up the AI-identified MPN against those
official APIs and use their data in place of the AI's guesses.

Never called with an empty MPN - the AI is only useful here as a way to
narrow down *what* to search for; this module is the "source of truth" half
of the hybrid strategy.
"""

import logging
import time

from . import datasheets_client, digikey_client, mouser_client

logger = logging.getLogger('inventree_plugins.ai_part_importer')

# Short in-process cache so re-rendering/re-running an identify request for
# the same MPN within a few minutes doesn't burn extra calls against DigiKey's
# and Mouser's (often low) free-tier rate limits.
_CACHE_TTL_SECONDS = 300
_lookup_cache: dict = {}


def _cached_lookup(cache_key, fetch_fn):
    cached = _lookup_cache.get(cache_key)
    if cached and cached[1] > time.time():
        return cached[0]

    result = fetch_fn()
    _lookup_cache[cache_key] = (result, time.time() + _CACHE_TTL_SECONDS)
    return result


def _lookup_digikey(settings, mpn):
    client_id = settings.get('DIGIKEY_CLIENT_ID')
    client_secret = settings.get('DIGIKEY_CLIENT_SECRET')

    if not client_id or not client_secret:
        return None

    try:
        return _cached_lookup(
            ('digikey', mpn),
            lambda: digikey_client.lookup_by_mpn(
                client_id=client_id, client_secret=client_secret, mpn=mpn
            ),
        )
    except digikey_client.DigiKeyClientError as exc:
        logger.warning('DigiKey lookup failed for %s: %s', mpn, exc)
        return None


def _lookup_mouser(settings, mpn):
    api_key = settings.get('MOUSER_API_KEY')

    if not api_key:
        return None

    try:
        return _cached_lookup(
            ('mouser', mpn),
            lambda: mouser_client.lookup_by_mpn(api_key=api_key, mpn=mpn),
        )
    except mouser_client.MouserClientError as exc:
        logger.warning('Mouser lookup failed for %s: %s', mpn, exc)
        return None


def _lookup_datasheets_com(settings, mpn):
    api_key = settings.get('DATASHEETS_COM_API_KEY')

    if not api_key:
        return None

    try:
        return _cached_lookup(
            ('datasheets.com', mpn),
            lambda: datasheets_client.lookup_by_mpn(api_key=api_key, mpn=mpn),
        )
    except datasheets_client.DatasheetsComClientError as exc:
        logger.warning('Datasheets.com lookup failed for %s: %s', mpn, exc)
        return None


def _merge_parameters(candidate_parameters, official_parameters, source):
    """Official parameters win over an AI-guessed parameter of the same name."""

    by_name = {p['name']: p for p in candidate_parameters}

    for p in official_parameters:
        by_name[p['name']] = {'name': p['name'], 'value': p['value'], 'source': source}

    return list(by_name.values())


def enrich_candidate(candidate: dict, *, settings: dict) -> dict:
    """Mutate-and-return `candidate` with official DigiKey/Mouser data, if any
    is configured and a match is found. No-op if no MPN or no credentials."""

    mpn = candidate['mpn']['value'] if candidate.get('mpn') else None

    if not mpn:
        return candidate

    prefer_official = settings.get('PREFER_OFFICIAL_DATA', True)

    digikey_result = _lookup_digikey(settings, mpn)
    mouser_result = _lookup_mouser(settings, mpn)

    supplier_links = []

    if digikey_result:
        supplier_links.append({
            'supplier': 'digikey',
            'sku': digikey_result.get('sku'),
            'url': digikey_result.get('product_url'),
            'price_breaks': digikey_result.get('price_breaks') or [],
        })

    if mouser_result:
        supplier_links.append({
            'supplier': 'mouser',
            'sku': mouser_result.get('sku'),
            'url': mouser_result.get('product_url'),
            'price_breaks': mouser_result.get('price_breaks') or [],
        })

    candidate['supplier_links'] = supplier_links

    if not prefer_official:
        return candidate

    # DigiKey preferred for canonical description/datasheet when both agree.
    primary, primary_source = (
        (digikey_result, 'official:digikey') if digikey_result
        else (mouser_result, 'official:mouser') if mouser_result
        else (None, None)
    )

    if primary:
        if primary.get('manufacturer'):
            candidate['manufacturer'] = {'value': primary['manufacturer'], 'source': primary_source}

        if primary.get('description'):
            candidate['description'] = {'value': primary['description'], 'source': primary_source}

        if primary.get('datasheet_url'):
            candidate['datasheet_url'] = {
                'value': primary['datasheet_url'],
                'source': primary_source,
                'verified': True,
            }

        if primary.get('image_url'):
            candidate['image_url'] = {
                'value': primary['image_url'],
                'source': primary_source,
                'verified': True,
            }

        candidate['parameters'] = _merge_parameters(
            candidate['parameters'], primary.get('parameters') or [], primary_source
        )

    # If the non-primary supplier also returned parameters, merge those too
    # (still official, just the "other" one) without overriding primary's.
    secondary = mouser_result if primary is digikey_result else digikey_result
    secondary_source = 'official:mouser' if primary is digikey_result else 'official:digikey'

    if secondary and secondary.get('parameters'):
        existing_names = {p['name'] for p in candidate['parameters']}
        for p in secondary['parameters']:
            if p['name'] not in existing_names:
                candidate['parameters'].append(
                    {'name': p['name'], 'value': p['value'], 'source': secondary_source}
                )

    # Datasheets.com isn't a distributor (no SKU/pricing/supplier_links), so
    # it's only ever used as a fallback to fill in whatever DigiKey/Mouser
    # didn't have - most commonly the datasheet itself, since plenty of
    # parts simply aren't carried by those distributors at all.
    needs_datasheets_com_fallback = (
        not candidate.get('datasheet_url')
        or not candidate.get('image_url')
        or primary is None
    )

    if needs_datasheets_com_fallback:
        datasheets_result = _lookup_datasheets_com(settings, mpn)

        if datasheets_result:
            fallback_source = 'official:datasheets.com'

            if not candidate.get('datasheet_url') and datasheets_result.get('datasheet_url'):
                candidate['datasheet_url'] = {
                    'value': datasheets_result['datasheet_url'],
                    'source': fallback_source,
                    'verified': True,
                }

            if not candidate.get('image_url') and datasheets_result.get('image_url'):
                candidate['image_url'] = {
                    'value': datasheets_result['image_url'],
                    'source': fallback_source,
                    'verified': True,
                }

            # Only used for manufacturer/description when DigiKey/Mouser had
            # nothing at all - otherwise their data is trusted over this.
            if primary is None:
                if datasheets_result.get('manufacturer'):
                    candidate['manufacturer'] = {
                        'value': datasheets_result['manufacturer'],
                        'source': fallback_source,
                    }

                if datasheets_result.get('description'):
                    candidate['description'] = {
                        'value': datasheets_result['description'],
                        'source': fallback_source,
                    }

            existing_names = {p['name'] for p in candidate['parameters']}
            for p in datasheets_result.get('parameters') or []:
                if p['name'] not in existing_names:
                    candidate['parameters'].append(
                        {'name': p['name'], 'value': p['value'], 'source': fallback_source}
                    )

    return candidate
