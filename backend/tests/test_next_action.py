"""下一步动作接口: 错题优先, 训练其次, 任务兜底."""

from datetime import date

import db as db_module


def test_next_action_prioritizes_recent_unmastered_mistake(client, helpers):
    user = helpers.register_student(client, username="next-action-mistake")

    with db_module.db() as conn:
        cur = conn.execute(
            """INSERT INTO mistakes
               (owner_user_id, subject, question_text, correct_answer, reason, knowledge_point)
               VALUES (?, '数学', '解方程', 'x=3', '移项出错', '一元一次方程')""",
            (user["id"],),
        )
        mistake_id = cur.lastrowid

    resp = client.get("/api/agent/next-action")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["exists"] is True
    assert payload["action"]["kind"] == "mistake"
    assert payload["action"]["source_mistake_id"] == mistake_id
    assert payload["action"]["cta_path"] == "/mistakes"


def test_next_action_uses_practice_when_no_open_mistake(client, helpers):
    user = helpers.register_student(client, username="next-action-practice")

    with db_module.db() as conn:
        cur = conn.execute(
            """INSERT INTO practice_sets
               (owner_user_id, source_mistake_id, title, subject, knowledge_point, status)
               VALUES (?, NULL, ?, ?, ?, 'done')""",
            (user["id"], "数学 · 一元一次方程训练", "数学", "一元一次方程"),
        )
        set_id = cur.lastrowid
        conn.execute(
            """INSERT INTO practice_items
               (set_id, question_text, is_correct, score)
               VALUES (?, '题 1', 0, 40)""",
            (set_id,),
        )
        conn.execute(
            """INSERT INTO practice_items
               (set_id, question_text, is_correct, score)
               VALUES (?, '题 2', NULL, NULL)""",
            (set_id,),
        )

    resp = client.get("/api/agent/next-action")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["exists"] is True
    assert payload["action"]["kind"] == "practice"
    assert payload["action"]["practice_set_id"] == set_id
    assert payload["action"]["cta_path"] == f"/practice?set={set_id}"


def test_next_action_falls_back_to_today_task(client, helpers):
    user = helpers.register_student(client, username="next-action-task")
    today_dow = date.today().isoweekday()

    with db_module.db() as conn:
        conn.execute("DELETE FROM tasks WHERE owner_user_id = ?", (user["id"],))
        cur = conn.execute(
            """INSERT INTO tasks
               (owner_user_id, week, day_of_week, subject, title, description, minutes)
               VALUES (?, 1, ?, '数学', '今日保分练习', '先做 15 分钟基础题', 15)""",
            (user["id"], today_dow),
        )
        task_id = cur.lastrowid

    resp = client.get("/api/agent/next-action")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["exists"] is True
    assert payload["action"]["kind"] == "task"
    assert payload["action"]["task_id"] == task_id
    assert payload["action"]["cta_path"] == "/assignments"
