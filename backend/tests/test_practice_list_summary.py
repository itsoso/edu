"""训练列表接口应返回轻量摘要, 不携带全部题目明细."""

import db as db_module


def test_list_practice_sets_returns_summary_counts_without_items(client, helpers):
    user = helpers.register_student(client, username="alice")

    with db_module.db() as conn:
      cur = conn.execute(
          """INSERT INTO practice_sets
             (owner_user_id, source_mistake_id, title, subject, knowledge_point, status)
             VALUES (?, NULL, ?, ?, ?, 'done')""",
          (user["id"], "数学 · 一元一次方程", "数学", "一元一次方程"),
      )
      set_id = cur.lastrowid
      conn.execute(
          """INSERT INTO practice_items
             (set_id, question_text, is_correct, score)
             VALUES (?, '题 1', 1, 100)""",
          (set_id,),
      )
      conn.execute(
          """INSERT INTO practice_items
             (set_id, question_text, is_correct, score)
             VALUES (?, '题 2', 0, 40)""",
          (set_id,),
      )
      conn.execute(
          """INSERT INTO practice_items
             (set_id, question_text, is_correct, score)
             VALUES (?, '题 3', NULL, NULL)""",
          (set_id,),
      )

    resp = client.get("/api/practice")
    assert resp.status_code == 200
    payload = resp.get_json()
    assert len(payload) == 1
    item = payload[0]
    assert item["id"] == set_id
    assert item["items"] == []
    assert item["item_count"] == 3
    assert item["graded_count"] == 2
    assert item["correct_count"] == 1
