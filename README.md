# AIPartImporter

Identify electronic components from text and/or a photo via an OpenAI-compatible
AI endpoint (LiteLLM, or any other server/proxy speaking the same
`/chat/completions` protocol), optionally cross-check the result against the
official DigiKey/Mouser APIs, then review and import them into InvenTree.

Nothing is written to the InvenTree database until you explicitly confirm the
draft on the review screen.

## Status

All planned phases (A-E) are implemented:

- **Text and photo identification** - a "Import via AI" dashboard widget.
- **Official DigiKey/Mouser enrichment** (optional) - when API credentials are
  configured, their data (datasheet, description, parameters, pricing,
  product link) overrides the AI's guesses, tagged and badged as such.
- **"AI Enrich" panel** on the Part detail page, to fill gaps on an existing
  part without overwriting fields it already has.
- A "Test AI connection" button and a lightweight audit trail (which fields
  came from the AI vs. an official API vs. you, stored in the Part's
  metadata).
- When DigiKey/Mouser return an official product photo, it can be downloaded
  and set as the Part's own image on commit.

**Not yet exercised against a real DigiKey/Mouser account or a real InvenTree
Attachment model** - see "Known unverified integration points" below before
relying on those two specific features.

## Installation (development / editable install)

Inside your InvenTree Docker container (or a `devcontainer` dev environment):

```bash
pip install -e /path/to/AIPartImporter
```

Then restart the InvenTree server process so the plugin is discovered, and
enable it under **Admin > Plugins**.

## Configuration

Under the plugin's settings (**Admin > Plugins > AI Part Importer**):

- **AI Base URL** - base URL of an OpenAI-compatible `/chat/completions`
  endpoint, e.g. `http://litellm:4000/v1` if you run LiteLLM in the same
  Docker network as InvenTree.
- **AI API Key** - API key for that endpoint, if it requires one.
- **AI Text Model** / **AI Vision Model** - model names to request for
  text-only / photo-based identification (vision model must accept image
  input).
- **Minimum candidate confidence** - candidates below this confidence (0-1)
  are discarded before you ever see them.
- **DigiKey Client ID / Client Secret** (optional) - OAuth2 client-credentials
  for the DigiKey Product Information API v4.
- **Mouser API Key** (optional) - key for the Mouser Search API.
- **Prefer official supplier data** (default on) - when DigiKey/Mouser
  credentials are set, let their data override the AI's guesses for
  description/manufacturer/datasheet.

## Usage

- **New part**: open the InvenTree dashboard - there's an **"Import via AI"**
  widget. Type a free-text description/partial part number and/or attach a
  photo (max 8MB, resized/recompressed server-side - this photo is only used
  to identify the component, it is not itself saved anywhere), click
  **Identify**, review/edit every field (each is badged by source: AI /
  DigiKey / Mouser / Edited), pick or search a category, choose which
  supplier links to create, what to do with the datasheet, and whether to use
  the official product photo (when DigiKey/Mouser returned one) as the Part's
  image, and confirm.
- **Existing part**: open any Part's detail page, find the **"AI Enrich"**
  panel, optionally add extra context text, click **Analyze with AI**. Fields
  the part already has are pre-filled with their *current* value (badged
  "Current") rather than silently replaced - you decide whether to keep or
  overwrite them before saving.

## Known unverified integration points

These were written from documentation/general knowledge, not tested against
live services (no API credentials / no reachable InvenTree instance were
available while building this) - double-check them against your real
InvenTree instance:

- `digikey_client.py` / `mouser_client.py` - the exact JSON field names in
  DigiKey's Product Information API v4 and Mouser's Search API response
  (including the product image field - `PhotoUrl` for DigiKey, `ImagePath`
  for Mouser). If enrichment silently returns no data (or no image) once you
  add real credentials, compare `_normalize_product()` / `_normalize_part()`
  against the actual response bodies and adjust the field names.
- `importer.py: _download_and_attach_datasheet()` - assumes InvenTree 1.x's
  generic `common.models.Attachment` model (`model_type='manufacturerpart'`,
  `model_id=...`). If your instance uses a different attachment model shape,
  this falls back to just storing the datasheet link instead of failing the
  whole commit - but won't actually attach the file until fixed.
- `importer.py: _record_audit_trail()` - assumes `Part.set_metadata(key, data)`
  exists (InvenTree's generic model-metadata mixin). Wrapped so a mismatch
  only skips the audit trail, not the commit.

## Frontend development

```bash
cd frontend
npm install
npm run dev   # live-reload against a running InvenTree instance
npm run build # production build, output lands in ai_part_importer/static/
```
