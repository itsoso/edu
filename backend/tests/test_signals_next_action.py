"""下一步动作埋点: 展示 / 点击 / 完成后衔接."""

import json

import db as db_module


def test_next_action_signal_events_are_accepted_and_stored(client, helpers):
    user = helpers.register_student(client, username="signals-next-action")

    resp = client.post(
        "/api/signals",
        json={
            "events": [
                {
                    "event_type": "next_action.shown",
                    "session_id": "s_1",
                    "client": "web",
                    "related_table": "mistakes",
                    "related_id": 12,
                    "payload": {
                        "kind": "mistake",
                        "cta_path": "/mistakes",
                    },
                },
                {
                    "event_type": "next_action.clicked",
                    "session_id": "s_1",
                    "client": "web",
                    "payload": {
                        "kind": "mistake",
                        "cta_path": "/mistakes",
                    },
                },
                {
                    "event_type": "next_action.completed",
                    "session_id": "s_1",
                    "client": "web",
                    "payload": {
                        "source_kind": "practice",
                        "target_kind": "task",
                    },
                },
            ]
        },
    )

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["ok"] is True
    assert payload["accepted"] == 3
    assert payload["dropped"] == 0

    with db_module.db() as conn:
        rows = conn.execute(
            """SELECT event_type, related_table, related_id, payload_json
               FROM interaction_signals
               WHERE owner_user_id = ?
               ORDER BY id""",
            (user["id"],),
        ).fetchall()

    assert [row["event_type"] for row in rows] == [
        "next_action.shown",
        "next_action.clicked",
        "next_action.completed",
    ]
    assert rows[0]["related_table"] == "mistakes"
    assert rows[0]["related_id"] == 12
    assert json.loads(rows[2]["payload_json"]) == {
        "source_kind": "practice",
        "target_kind": "task",
    }
