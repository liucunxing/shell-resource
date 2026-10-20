from app.services.dealer_history import scoped_dealer_histories


def test_history_uses_the_allocating_initiative_sector() -> None:
    records = [
        {"id": "D1", "sector": "PCMO", "history": {"yield": 8}},
        {"id": "D1", "sector": "CRTO", "history": {"yield": 4}},
    ]
    items = [{"sector": "PCMO", "rows": [{"dealerId": "D1"}]}]
    assert scoped_dealer_histories(records, items)["D1"]["history"]["yield"] == 8
    items.append({"sector": "CRTO", "rows": [{"dealerId": "D1"}]})
    assert "D1" not in scoped_dealer_histories(records, items)
