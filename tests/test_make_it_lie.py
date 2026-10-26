"""'Try to make it lie': tamper with a verified narration and watch the live
grounding check reject it and the deterministic fallback ship instead, plus
the judge-facing verification headline computed from the robustness suite.

Offline and deterministic: no LLM, no network. The router is mounted on a
bare FastAPI app here so these tests don't depend on service/main.py wiring.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents.narrator.fallback import fallback_narration
from agents.shared.handoff_log import InMemoryHandoffLog
from agents.shared.models import InsightCandidate
from eval import make_it_lie as mil
from eval import robustness_suite
from eval.grounding_check import check_grounding

MATCH = "M-LIE"
ROSTER = {
    "home_1": "Oscar Reyes", "home_2": "Dante Marsh",
    "away_1": "Leon Okonkwo", "away_4": "Marco Dellapiane",
}


def _insight(**overrides) -> InsightCandidate:
    base = dict(
        match_id=MATCH, window_start_min=10.0, window_end_min=13.0,
        trigger_type="pressure_spike", metric_name="ppda_home", metric_value=4.2,
        baseline_value=7.1, delta_pct=-40.8, related_players=["home_1"],
        window_summary={"team": "home"},
    )
    base.update(overrides)
    return InsightCandidate(**base)


GROUNDED = "At 10 minutes, Oscar Reyes led the press as ppda_home dropped to 4.2 from 7.1."


# ---------------------------------------------------------------- core logic

def test_grounded_original_passes_the_live_checker():
    # Sanity: the fixture narration itself is genuinely grounded, so any
    # rejection below is caused by the tamper, not by the setup.
    assert check_grounding(GROUNDED, _insight(), ROSTER).passed


@pytest.mark.parametrize("attack, reason_key", [
    ("fake_number", "unmatched_numbers"),
    ("wrong_player", "unmatched_entities"),
    ("real_club_leak", "real_world_leaks"),
])
def test_each_built_in_attack_is_rejected_and_the_fallback_ships(attack, reason_key):
    insight = _insight()
    trace = mil.run_tamper(insight, GROUNDED, attack, ROSTER)

    assert trace["attack"] == attack
    assert trace["original_text"] == GROUNDED
    assert trace["tampered_text"] != GROUNDED
    assert trace["original_verdict"] == "passed"
    assert trace["verdict"] == "rejected"
    assert trace["reasons"][reason_key], trace["reasons"]
    assert trace["corrected_text"] == fallback_narration(insight)
    assert trace["corrected_verdict"] == "passed"
    assert trace["shipped"] == "corrected"
    # The tampered text must fail the exact production checker, not a copy.
    assert not check_grounding(trace["tampered_text"], insight, ROSTER).passed


def test_fake_number_alters_a_number_that_was_in_the_original():
    trace = mil.run_tamper(_insight(), GROUNDED, "fake_number", ROSTER)
    fake = trace["reasons"]["unmatched_numbers"]
    assert len(fake) == 1
    assert fake[0] not in GROUNDED
    # Only the one number changed -- everything else is preserved verbatim.
    assert trace["tampered_text"].startswith("At 10 minutes, Oscar Reyes")


@pytest.mark.parametrize("metric_value, text", [
    (0.18, "A notably dangerous sequence: xt delta reached 0.18 against a baseline of 0.04."),
    (73.0, "Possession tempo surged to 73 in minute 22."),
    (4.2, "A pressing shift with no numbers at all."),
])
def test_fake_number_is_always_outside_the_checkers_tolerance(metric_value, text):
    insight = _insight(metric_value=metric_value, baseline_value=0.04, window_start_min=22.0, window_end_min=22.0)
    trace = mil.run_tamper(insight, text, "fake_number", ROSTER)
    assert trace["verdict"] == "rejected"
    assert trace["reasons"]["unmatched_numbers"]


def test_wrong_player_swaps_in_a_real_roster_name_not_related_to_the_insight():
    trace = mil.run_tamper(_insight(), GROUNDED, "wrong_player", ROSTER)
    wrong = trace["reasons"]["unmatched_entities"]
    assert len(wrong) == 1 and wrong[0] in ROSTER.values() and wrong[0] != "Oscar Reyes"
    assert "Oscar Reyes" not in trace["tampered_text"]  # swapped, not appended


def test_wrong_player_without_an_unrelated_roster_player_is_a_clear_error():
    with pytest.raises(mil.TamperUnavailable):
        mil.run_tamper(_insight(), GROUNDED, "wrong_player", {"home_1": "Oscar Reyes"})


def test_custom_text_that_is_off_topic_is_rejected_on_vocabulary():
    trace = mil.run_tamper(_insight(), GROUNDED, "custom", ROSTER, custom_text="Lovely weather for it.")
    assert trace["verdict"] == "rejected"
    assert trace["reasons"]["off_topic"] is True


def test_custom_text_that_is_grounded_honestly_passes_and_ships_as_written():
    custom = "The press tightened: ppda_home fell to 4.2."
    trace = mil.run_tamper(_insight(), GROUNDED, "custom", ROSTER, custom_text=custom)
    assert trace["verdict"] == "passed"
    assert trace["shipped"] == "tampered"
    assert trace["corrected_text"] is None
    assert trace["corrected_verdict"] is None


@pytest.mark.parametrize("custom", [None, "", "   "])
def test_custom_attack_requires_text(custom):
    with pytest.raises(mil.TamperUnavailable):
        mil.run_tamper(_insight(), GROUNDED, "custom", ROSTER, custom_text=custom)


def test_run_tamper_is_deterministic():
    insight = _insight()
    a = mil.run_tamper(insight, GROUNDED, "real_club_leak", ROSTER)
    b = mil.run_tamper(insight, GROUNDED, "real_club_leak", ROSTER)
    assert a == b


def test_headline_agrees_with_the_robustness_suite_it_reuses():
    h = mil.compute_headline()
    r = robustness_suite.run()
    assert h["planted"] == r.corruptions_total
    assert h["caught"] == r.corruptions_caught
    assert h["false_positives"] == r.false_positives
    assert h["clean_tested"] == r.legitimate_total
    assert h["reached_air"] == 0
    assert sum(a["planted"] for a in h["by_attack"]) == h["planted"]
    assert sum(a["caught"] for a in h["by_attack"]) == h["caught"]
    assert {a["attack"] for a in h["by_attack"]} >= {"wrong_player", "real_world_leak"}
    assert h["recall"] == round(h["caught"] / h["planted"], 3)
    assert 0.0 <= h["precision"] <= 1.0
    assert h["elapsed_ms"] >= 0


# ---------------------------------------------------------------- HTTP router

@pytest.fixture
def api(STATE):
    from service.routers.make_it_lie import router

    STATE["handoff_log"] = InMemoryHandoffLog()
    STATE["player_names_by_match"] = {MATCH: dict(ROSTER)}
    STATE.pop("verification_headline_cache", None)
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as c:
        yield c


def _seed(STATE, insight: InsightCandidate, text: str, fact_checked: bool = True) -> None:
    STATE["handoff_log"].record("insight", insight.match_id, {
        **insight.model_dump(), "narrative_text": text, "fact_checked": fact_checked,
    })


def test_tamper_endpoint_uses_the_latest_verified_insight_by_default(api, STATE):
    older = _insight()
    newest_verified = _insight(metric_value=5.0)
    unverified = _insight(metric_value=6.0)
    _seed(STATE, older, GROUNDED)
    _seed(STATE, newest_verified, "Pressing: ppda_home hit 5.0 at minute 10.")
    _seed(STATE, unverified, fallback_narration(unverified), fact_checked=False)

    resp = api.post(f"/matches/{MATCH}/tamper", json={"attack": "fake_number"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["insight_id"] == newest_verified.insight_id
    assert body["verdict"] == "rejected" and body["shipped"] == "corrected"


def test_tamper_endpoint_honours_an_explicit_insight_id(api, STATE):
    target = _insight()
    _seed(STATE, target, GROUNDED)
    _seed(STATE, _insight(metric_value=5.0), "Pressing: ppda_home hit 5.0.")
    resp = api.post(f"/matches/{MATCH}/tamper", json={"attack": "wrong_player", "insight_id": target.insight_id})
    assert resp.status_code == 200, resp.text
    assert resp.json()["original_text"] == GROUNDED


@pytest.mark.parametrize("path, body", [
    ("/matches/NOPE/tamper", {"attack": "fake_number"}),
    (f"/matches/{MATCH}/tamper", {"attack": "fake_number", "insight_id": "missing"}),
])
def test_tamper_endpoint_404s_for_unknown_match_or_insight(api, STATE, path, body):
    _seed(STATE, _insight(), GROUNDED)
    assert api.post(path, json=body).status_code == 404


@pytest.mark.parametrize("body", [
    {"attack": "nonsense"},
    {"attack": "custom", "custom_text": "x" * 301},
    {"attack": "custom"},
])
def test_tamper_endpoint_rejects_bad_input(api, STATE, body):
    _seed(STATE, _insight(), GROUNDED)
    resp = api.post(f"/matches/{MATCH}/tamper", json=body)
    assert 400 <= resp.status_code < 500, resp.text


def test_headline_endpoint_is_cached_in_state(api, STATE, monkeypatch):
    first = api.get("/verification/headline")
    assert first.status_code == 200
    assert first.json()["reached_air"] == 0
    assert "verification_headline_cache" in STATE

    def boom():
        raise AssertionError("should have been served from cache")

    monkeypatch.setattr(mil, "compute_headline", boom)
    second = api.get("/verification/headline")
    assert second.status_code == 200
    assert second.json()["planted"] == first.json()["planted"]
