"""Per-locale football vocabulary, mirroring eval.grounding_check.TRIGGER_VOCAB
one-for-one so the live grounding check can do a real vocabulary check on
non-English narration too, instead of unconditionally skipping it.

Hand-seeded by translating TRIGGER_VOCAB's own terms -- small, reviewable,
not a translation pipeline or an Azure AI Translator call. Also threaded
into the Concierge/QA prompts (see personalize()/ask()) so the model is
steered toward vocabulary this glossary will actually recognize, rather
than translating freeform and then failing the restored check.
"""
from __future__ import annotations

TRIGGER_GLOSSARY: dict[str, dict[str, set[str]]] = {
    "fr": {
        "pressure_spike": {"presse", "pression", "pressing", "ligne haute", "resserré", "pressé", "pressant"},
        "chaos_shift": {"chaotique", "chaos", "confus", "contrôle", "élan", "désorganisé", "effréné", "perte de balle"},
        "rhythm_change": {"tempo", "rythme", "cadence", "ralenti", "accéléré", "plus lent", "plus rapide"},
        "xt_surge": {
            "menace", "dangereux", "danger", "occasion", "territoire", "menaçant",
            "xt_surge", "xt surge", "embrasé", "tranché",
        },
        "milestone": {"but", "marque", "marqué", "étape"},
        "referee_decision": {"arbitre", "contestable", "positionnement", "angle", "décision", "loi"},
        "tendency_match": {"anticipé", "savait", "connu", "habitude", "typique", "habituel", "conforme", "correspond"},
        "tendency_break": {
            "hors de caractère", "contre son habitude", "surprenant", "inhabituel",
            "pris", "au lieu", "dévié", "atypique",
        },
    },
    "es": {
        "pressure_spike": {"presión", "presionar", "presionando", "línea alta", "cerrando", "presionado"},
        "chaos_shift": {"caótico", "caos", "descontrolado", "control", "impulso", "desorganizado", "frenético", "pérdida de balón"},
        "rhythm_change": {"ritmo", "cadencia", "ralentizado", "acelerado", "más lento", "más rápido"},
        "xt_surge": {
            "amenaza", "peligroso", "peligro", "ocasión", "territorio", "amenazante",
            "xt_surge", "xt surge", "encendió", "cortó",
        },
        "milestone": {"gol", "marca", "marcó", "hito"},
        "referee_decision": {"árbitro", "discutible", "posicionamiento", "ángulo", "decisión", "ley"},
        "tendency_match": {"anticipado", "sabía", "conocido", "patrón", "típico", "habitual", "coincide", "consistente"},
        "tendency_break": {
            "fuera de carácter", "contra su costumbre", "sorprendente", "inusual",
            "atrapado", "en lugar", "desvió", "atípico",
        },
    },
    "de": {
        "pressure_spike": {"pressing", "druck", "bedrängt", "hohe linie", "zugemacht", "drängend"},
        "chaos_shift": {"chaotisch", "chaos", "unkontrolliert", "kontrolle", "schwung", "unstrukturiert", "hektisch", "ballverlust"},
        "rhythm_change": {"tempo", "rhythmus", "verlangsamt", "beschleunigt", "langsamer", "schneller"},
        "xt_surge": {
            "gefahr", "gefährlich", "chance", "territorium", "bedrohlich",
            "xt_surge", "xt surge", "entzündet", "aufgerissen",
        },
        "milestone": {"tor", "trifft", "getroffen", "meilenstein"},
        "referee_decision": {"schiedsrichter", "umstritten", "positionierung", "winkel", "entscheidung", "regel"},
        "tendency_match": {"erwartet", "wusste", "bekannt", "muster", "typisch", "üblich", "entspricht", "konsistent"},
        "tendency_break": {
            "untypisch", "gegen seine art", "überraschend", "ungewöhnlich",
            "erwischt", "anstatt", "abgewichen", "atypisch",
        },
    },
}


def glossary_terms_for(locale: str, trigger_type: str) -> list[str]:
    """Terms for one trigger_type in one non-English locale, for steering a
    prompt -- empty for "en" (TRIGGER_VOCAB already covers English, and the
    prompts never needed this) or an unsupported locale."""
    return sorted(TRIGGER_GLOSSARY.get(locale, {}).get(trigger_type, set()))
