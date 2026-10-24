from eval.real_data_validation import citation, load_reference, reference_ranges


def test_load_reference_has_all_four_metrics():
    ref = load_reference()
    assert set(ref["metrics"]) == {"ppda", "pass_completion_pct", "shots_per_team", "possession_pct"}
    assert ref["n_matches"] > 0
    assert ref["n_matches"] <= ref["n_matches_available_total"]


def test_reference_ranges_are_min_max_tuples():
    ranges = reference_ranges()
    for metric, (lo, hi) in ranges.items():
        assert lo <= hi, f"{metric} range is inverted: {lo} > {hi}"


def test_citation_names_statsbomb_and_a_real_sample_size():
    c = citation()
    assert "StatsBomb" in c["source"]
    assert c["n_matches"] > 0
    assert any("Premier League" in s for s in c["seasons_sampled_from"])
