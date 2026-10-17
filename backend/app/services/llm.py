"""Groq chat client with JSON output, schema validation and one repair retry."""
from __future__ import annotations

import json
import logging
import re
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from ..config import get_settings

log = logging.getLogger("deal_rescue.llm")
T = TypeVar("T", bound=BaseModel)


class LLMError(RuntimeError):
    pass


def _extract_json(text: str) -> dict:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise LLMError("Model did not return JSON")
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError as exc:
        raise LLMError(f"Invalid JSON from model: {exc}") from exc


async def complete_json(messages: list[dict[str, str]], model_cls: type[T], max_tokens: int = 2500) -> T:
    settings = get_settings()
    if not settings.llm_enabled:
        raise LLMError("No GROQ_API_KEY configured")
    try:
        from groq import AsyncGroq
    except ImportError as exc:  # pragma: no cover
        raise LLMError("groq package not installed") from exc

    client = AsyncGroq(api_key=settings.groq_api_key, timeout=settings.llm_timeout_seconds, max_retries=2)
    convo = list(messages)
    last_err: Exception | None = None
    for attempt in range(2):
        try:
            resp = await client.chat.completions.create(
                model=settings.groq_model,
                messages=convo,
                temperature=0.2,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            )
        except Exception as exc:  # network, rate limit, bad model name …
            log.warning("LLM request failed: %s", exc)
            raise LLMError(str(exc)) from exc
        content = resp.choices[0].message.content or ""
        try:
            return model_cls.model_validate(_extract_json(content))
        except (LLMError, ValidationError) as exc:
            last_err = exc
            log.info("LLM output failed validation (attempt %d): %s", attempt + 1, str(exc)[:300])
            convo = convo + [
                {"role": "assistant", "content": content[:6000]},
                {"role": "user", "content": f"That JSON was invalid: {str(exc)[:800]}. Return corrected JSON only."},
            ]
    raise LLMError(f"Model output invalid after retry: {last_err}")
