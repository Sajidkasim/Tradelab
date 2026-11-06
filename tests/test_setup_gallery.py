from tests.test_daily_journal import draft, login, picture


def test_gallery_shares_images_only_with_verified_teammates(draft, monkeypatch):
    client, _, state = draft
    monkeypatch.setenv("BULLPEN_SAJID_EMAIL", "owner@example.com")
    monkeypatch.setenv("BULLPEN_AMIR_EMAIL", "amir@example.com")
    url = "/api/learn/setup-gallery"

    login(client, state)
    response = client.post(url, data={"title": "NY reversal", "tags": "MSS, mss, FVG"},
                           files={"file": ("setup.png", picture(), "image/png")})
    assert response.status_code == 201, response.text
    setup = response.json()
    assert setup["tags"] == ["mss", "fvg"]
    image_url = f"{url}/{setup['id']}/image"

    login(client, state, "amir@example.com", "amir-sub")
    assert client.get(url).json() == [setup]
    assert client.get(image_url).headers["content-type"] == "image/webp"

    login(client, state, "other@example.com", "other-sub")
    assert client.get(url).status_code == 403
    assert client.get(image_url).status_code == 403

    login(client, state, "amir@example.com", "amir-sub")
    assert client.delete(f"{url}/{setup['id']}").status_code == 404
    login(client, state)
    assert client.delete(f"{url}/{setup['id']}").status_code == 200
    assert client.get(image_url).status_code == 404


def test_replay_drill_requires_sign_in_and_returns_bounded_nq_history(draft, monkeypatch, tmp_path):
    from webapp import replay_sessions

    client, _, state = draft
    monkeypatch.setattr(replay_sessions, "ROOT", tmp_path)
    day = "2023-09-12"
    (tmp_path / "backtesting-preview.json").write_text('{"day":"2023-09-12"}')
    bars = [{"time": index, "open": 1, "high": 2, "low": 1, "close": 2} for index in range(180)]
    monkeypatch.setattr(replay_sessions, "load_history", lambda _: (
        {"markets": {"NQ": {"contract": "NQU3", "bars": bars}}}, "test",
    ))
    url = "/api/learn/replay-drill"
    assert client.get(url).status_code == 401
    login(client, state)
    response = client.get(url)
    assert response.status_code == 200, response.text
    assert response.json() == {"day": day, "contract": "NQU3", "bars": bars[:120]}
