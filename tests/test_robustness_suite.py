from eval.robustness_suite import run


def test_catches_every_corruption_with_no_false_positives():
    """This is the exact number exposed live via /robustness and /stats --
    a regression here means a judge-facing claim just got weaker (or the
    checker got stricter in a way that now rejects legitimate text)."""
    result = run()
    assert result.corruptions_caught == result.corruptions_total
    assert result.false_positives == 0
