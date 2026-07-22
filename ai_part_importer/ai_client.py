"""Talks to whatever OpenAI-compatible /chat/completions endpoint the user has
configured (LiteLLM, or any other proxy/server speaking the same protocol).

This module only knows about the generic `/chat/completions` contract - it has
no idea which underlying model or provider actually answers the request.
"""

import base64
import json
import logging
from io import BytesIO

import requests

logger = logging.getLogger('inventree_plugins.ai_part_importer')


class AIClientError(Exception):
    """Raised when the configured AI endpoint can't be reached or replies with
    something we can't use (bad status, malformed JSON after retry, etc.)."""


SYSTEM_PROMPT = """You are identifying an electronic component from {source_desc}.

Respond with strict JSON only - no prose, no markdown code fences. Match this schema:

{{
  "candidates": [
    {{
      "confidence": 0.0-1.0,
      "manufacturer": string or null,
      "mpn": string or null,
      "name": string,
      "description": string,
      "category_guess": string or null,
      "parameters": [{{"name": string, "value": string}}]
    }}
  ]
}}

Rules:
- If you are not confident about a value, use null rather than guessing.
- Never invent a datasheet URL or a link - this schema does not ask for one.
- If more than one component seems plausible, return up to 3 candidates,
  ordered by descending confidence.
- Return valid JSON and nothing else.
"""

RETRY_PROMPT = (
    "Your previous reply was not valid JSON. Resend your answer as a single "
    "JSON object matching the schema you were given - no prose, no code fences."
)

# Keep vision requests small/cheap regardless of what the camera/phone produced.
MAX_IMAGE_DIMENSION = 1600
JPEG_QUALITY = 85


def _chat_completion(base_url: str, api_key: str, model: str, messages: list) -> str:
    """POST to {base_url}/chat/completions and return the assistant's raw text reply."""

    url = base_url.rstrip('/') + '/chat/completions'

    headers = {'Content-Type': 'application/json'}
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'

    payload = {
        'model': model,
        'messages': messages,
        'response_format': {'type': 'json_object'},
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=60)
    except requests.RequestException as exc:
        raise AIClientError(f'Could not reach AI endpoint at {url}: {exc}') from exc

    if not response.ok:
        raise AIClientError(
            f'AI endpoint returned HTTP {response.status_code}: {response.text[:500]}'
        )

    try:
        data = response.json()
        return data['choices'][0]['message']['content']
    except (ValueError, KeyError, IndexError) as exc:
        raise AIClientError(f'Unexpected response shape from AI endpoint: {exc}') from exc


def _parse_json_reply(base_url: str, api_key: str, model: str, messages: list, reply: str) -> dict:
    """Parse the model's reply as JSON, retrying once if it's malformed."""

    try:
        return json.loads(reply)
    except ValueError:
        logger.warning('AI reply was not valid JSON, retrying once')

        retry_messages = messages + [
            {'role': 'assistant', 'content': reply},
            {'role': 'user', 'content': RETRY_PROMPT},
        ]
        retry_reply = _chat_completion(base_url, api_key, model, retry_messages)

        try:
            return json.loads(retry_reply)
        except ValueError as exc:
            raise AIClientError(
                'AI endpoint did not return valid JSON, even after a retry'
            ) from exc


def identify_from_text(*, base_url: str, api_key: str, model: str, text: str) -> dict:
    """Identify a component from a free-text description / partial part number.

    Returns a dict matching the {"candidates": [...]} schema described in
    SYSTEM_PROMPT, with every candidate field still "raw" (caller tags source/verified).
    """

    if not base_url:
        raise AIClientError('AI_BASE_URL is not configured for this plugin')

    if not model:
        raise AIClientError('AI_TEXT_MODEL is not configured for this plugin')

    system_prompt = SYSTEM_PROMPT.format(
        source_desc='a user-provided text description or partial part number'
    )

    messages = [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': text},
    ]

    reply = _chat_completion(base_url, api_key, model, messages)
    return _parse_json_reply(base_url, api_key, model, messages, reply)


def _resize_and_compress(image_bytes: bytes) -> bytes:
    """Downscale/recompress an image before it gets base64-encoded, to keep
    the vision request's payload size and token cost under control."""

    from PIL import Image, UnidentifiedImageError

    try:
        image = Image.open(BytesIO(image_bytes))
        image = image.convert('RGB')
    except UnidentifiedImageError as exc:
        raise AIClientError('Uploaded file is not a valid image') from exc

    image.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION))

    buffer = BytesIO()
    image.save(buffer, format='JPEG', quality=JPEG_QUALITY)
    return buffer.getvalue()


def identify_from_image(
    *, base_url: str, api_key: str, model: str, image_bytes: bytes, text: str = ''
) -> dict:
    """Identify a component from a photo of it and/or its markings/label.

    `text` is optional accompanying context typed by the user alongside the photo.
    Returns the same {"candidates": [...]} shape as identify_from_text().
    """

    if not base_url:
        raise AIClientError('AI_BASE_URL is not configured for this plugin')

    if not model:
        raise AIClientError('AI_VISION_MODEL is not configured for this plugin')

    compressed = _resize_and_compress(image_bytes)
    data_uri = 'data:image/jpeg;base64,' + base64.b64encode(compressed).decode('ascii')

    system_prompt = SYSTEM_PROMPT.format(
        source_desc="a photo of the component and/or its markings/label"
    )

    user_content = [
        {'type': 'text', 'text': text or 'Identify the component shown in this photo.'},
        {'type': 'image_url', 'image_url': {'url': data_uri}},
    ]

    messages = [
        {'role': 'system', 'content': system_prompt},
        {'role': 'user', 'content': user_content},
    ]

    reply = _chat_completion(base_url, api_key, model, messages)
    return _parse_json_reply(base_url, api_key, model, messages, reply)
