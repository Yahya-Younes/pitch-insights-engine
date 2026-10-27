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
    "it": {
        "pressure_spike": {"pressing", "pressione", "pressato", "pressando", "linea alta", "stretto", "pressa"},
        "chaos_shift": {"caotico", "caos", "confuso", "controllo", "slancio", "disorganizzato", "frenetico", "perdita di palla"},
        "rhythm_change": {"tempo", "ritmo", "rallentato", "accelerato", "più lento", "più veloce"},
        "xt_surge": {
            "minaccia", "pericoloso", "pericolo", "occasione", "territorio", "minaccioso",
            "xt_surge", "xt surge", "acceso", "aperto",
        },
        "milestone": {"gol", "segna", "segnato", "pietra miliare"},
        "referee_decision": {"arbitro", "discutibile", "posizionamento", "angolo", "decisione", "legge"},
        "tendency_match": {"anticipato", "sapeva", "noto", "schema", "tipico", "abituale", "corrisponde", "coerente"},
        "tendency_break": {
            "fuori carattere", "contro la sua abitudine", "sorprendente", "insolito",
            "colto", "invece", "deviato", "atipico",
        },
    },
    "pt": {
        "pressure_spike": {"pressão", "pressionar", "pressionando", "linha alta", "apertado", "pressionado"},
        "chaos_shift": {"caótico", "caos", "descontrolado", "controlo", "ímpeto", "desorganizado", "frenético", "perda de bola"},
        "rhythm_change": {"ritmo", "cadência", "desacelerado", "acelerado", "mais lento", "mais rápido"},
        "xt_surge": {
            "ameaça", "perigoso", "perigo", "oportunidade", "território", "ameaçador",
            "xt_surge", "xt surge", "acendeu", "cortou",
        },
        "milestone": {"golo", "marca", "marcou", "marco"},
        "referee_decision": {"árbitro", "discutível", "posicionamento", "ângulo", "decisão", "lei"},
        "tendency_match": {"antecipado", "sabia", "conhecido", "padrão", "típico", "habitual", "corresponde", "consistente"},
        "tendency_break": {
            "fora de carácter", "contra o seu hábito", "surpreendente", "invulgar",
            "apanhado", "em vez", "desviou", "atípico",
        },
    },
}


# Patterns the vocabulary check accepts but that make bad prompt words:
# internal labels, a bare stem ("deviat" matches deviated/deviation), and
# "knew", which the Narrator is told never to claim.
_NOT_FOR_PROMPTS = {"xt surge", "deviat", "knew"}


def glossary_terms_for(locale: str, trigger_type: str) -> list[str]:
    """Words the live vocabulary check (eval.grounding_check) accepts for one
    trigger_type in one locale, to hand the model in its prompt. English
    included: without them the model wrote "finds the net" for a goal, and
    the check -- which wants "goal"/"scored" -- rejected it (live, ~1 in 4
    narrations and half the recaps fell back to templates). Empty for an
    unsupported locale."""
    if locale == "en":
        # Lazy: eval.grounding_check imports this module.
        from eval.grounding_check import TRIGGER_VOCAB
        terms = TRIGGER_VOCAB.get(trigger_type, set())
    else:
        terms = TRIGGER_GLOSSARY.get(locale, {}).get(trigger_type, set())
    return sorted(t for t in terms if "_" not in t and t not in _NOT_FOR_PROMPTS)
