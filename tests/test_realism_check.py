from eval.real_data_validation import reference_ranges as real_world_reference_ranges
from eval.realism_check import RealismResult, compare_to_reference, run


def test_seeded_run_reports_every_metric_honestly():
    """This deliberately does NOT assert every metric lands in range --
    doing that would mean loosening the reference ranges until the
    generator always "passes," which defeats the entire point of an honest
    sanity check. It asserts the report is well-formed and that the two
    metrics known to be realistic for this generator (pass completion %,
    possession split) are in range; shots_per_team and ppda are real,
    disclosed gaps in the current generator's calibration, not asserted
    here as pass or fail so this test doesn't silently start lying either
    way if the generator's tuning changes."""
    reference_ranges = real_world_reference_ranges()
    report = run(n_matches=6, seed=321)
    assert report["total_count"] == len(reference_ranges)
    assert report["n_matches_averaged"] == 6
    by_metric = {m["metric"]: m for m in report["metrics"]}
    assert set(by_metric) == set(reference_ranges)
    assert by_metric["pass_completion_pct"]["in_range"]
    assert by_metric["possession_pct"]["in_range"]


def test_compare_to_reference_flags_an_out_of_range_value():
    reference_ranges = real_world_reference_ranges()
    results = compare_to_reference({"ppda": 999.0, "pass_completion_pct": 80.0}, reference_ranges)
    by_metric = {r.metric: r for r in results}
    assert not by_metric["ppda"].in_range
    assert by_metric["pass_completion_pct"].in_range


def test_realism_result_in_range_boundaries():
    r = RealismResult(metric="ppda", value=6.0, reference_range=(6.0, 18.0))
    assert r.in_range
    r2 = RealismResult(metric="ppda", value=5.99, reference_range=(6.0, 18.0))
    assert not r2.in_range
