"""Tiny helper for correlating handoff-log entries with OpenTelemetry
traces. With no Application Insights configured (APPLICATIONINSIGHTS_
CONNECTION_STRING unset, e.g. running locally), there's no active span and
this always returns None -- callers already treat it as optional."""
from __future__ import annotations

from opentelemetry import trace


def current_trace_id() -> str | None:
    span_context = trace.get_current_span().get_span_context()
    if not span_context.is_valid:
        return None
    return format(span_context.trace_id, "032x")
