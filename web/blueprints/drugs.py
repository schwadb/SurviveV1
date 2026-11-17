"""
Offline drug reference: search openFDA labels by drug name or symptom.

The index is built offline by scripts/build_drug_index.py; this blueprint only
reads it (see search_index). A not-medical-advice disclaimer is accepted once
per session and gates both the pages and the API.
"""

from flask import Blueprint, jsonify, redirect, render_template, request, session

from search_index import _drug_by_id, _query_drug_index

bp = Blueprint("drugs", __name__)


def _drug_disclaimer_ok() -> bool:
    return bool(session.get("drug_disclaimer"))


@bp.route("/drugs/disclaimer", methods=["POST"])
def drugs_accept_disclaimer():
    """Record acceptance of the not-medical-advice notice in the session, so it
    also gates the API and works inside the iOS captive mini-browser."""
    session["drug_disclaimer"] = True
    dest = request.form.get("next", "/drugs")
    if not dest.startswith("/") or dest.startswith("//"):
        dest = "/drugs"
    return redirect(dest)


@bp.route("/drugs")
def drugs_page():
    """Search the offline drug reference by drug name or by symptom."""
    if not _drug_disclaimer_ok():
        return render_template("drug_disclaimer.html", next="/drugs")
    query = request.args.get("q", "").strip()[:100]
    mode = "symptom" if request.args.get("mode") == "symptom" else "drug"
    results = _query_drug_index(query, mode=mode) if query else []
    return render_template(
        "drugs.html", query=query, mode=mode, results=results,
        index_missing=(results is None),
        results_list=(results or []),
    )


@bp.route("/drugs/<int:drug_id>")
def drug_detail(drug_id):
    if not _drug_disclaimer_ok():
        return render_template("drug_disclaimer.html", next=f"/drugs/{drug_id}")
    drug = _drug_by_id(drug_id)
    if drug is None:
        return render_template("error.html", code=404, message="Drug not found"), 404
    return render_template("drug_detail.html", drug=drug)


@bp.route("/api/drugs/interactions")
def api_drug_interactions():
    """Honest label-text interaction check: search drug A's interaction/warning
    text for drug B's name and vice versa. This is a TEXT MATCH against FDA
    labels, NOT a clinical interaction database — the UI says so plainly."""
    if not _drug_disclaimer_ok():
        return jsonify({"error": "Accept the disclaimer first"}), 403
    try:
        a_id = int(request.args.get("a", ""))
    except (TypeError, ValueError):
        return jsonify({"error": "Missing drug id 'a'"}), 400
    b_name = request.args.get("b", "").strip()[:100]
    if not b_name:
        return jsonify({"error": "Missing drug name 'b'"}), 400
    drug_a = _drug_by_id(a_id)
    if drug_a is None:
        return jsonify({"error": "Drug not found"}), 404

    b_lower = b_name.lower()
    haystack = " ".join(str(drug_a.get(f, "")) for f in
                        ("interactions", "warnings", "contraindications")).lower()
    a_mentions_b = b_lower in haystack
    # And the reverse: does any label for drug B mention drug A's generic?
    b_mentions_a = False
    a_generic = (drug_a.get("generic_name") or "").lower()
    if a_generic:
        b_hits = _query_drug_index(b_name, mode="drug", limit=5) or []
        for hit in b_hits:
            rec = _drug_by_id(hit["id"])
            if rec and a_generic in " ".join(
                    str(rec.get(f, "")) for f in
                    ("interactions", "warnings", "contraindications")).lower():
                b_mentions_a = True
                break
    return jsonify({
        "a": {"id": a_id, "name": drug_a.get("brand_name") or drug_a.get("generic_name")},
        "b": b_name,
        "a_label_mentions_b": a_mentions_b,
        "b_label_mentions_a": b_mentions_a,
        "note": "Label-text match only — not a clinical interaction checker. "
                "Consult a pharmacist or doctor.",
    })
