"""下一步动作优先级: 重复漏洞、未稳训练、任务兜底."""

import db as db_module


def test_next_action_prefers_repeated_knowledge_point_mistake(client, helpers):
    user = helpers.register_student(client, username="next-priority-repeat")

    with db_module.db() as conn:
        conn.execute(
            """INSERT INTO mistakes
               (owner_user_id, subject, question_text, correct_answer, reason, knowledge_point)
               VALUES (?, '数学', '旧题', 'x=1', '粗心', '分式方程')""",
            (user["id"],),
        )
        cur = conn.execute(
            """INSERT INTO mistakes
               (owner_user_id, subject, question_text, correct_answer, reason, knowledge_point)
               VALUES (?, '数学', '新题', 'x=2', '移项错', '分式方程')""",
            (user["id"],),
        )
        repeated_id = cur.lastrowid
        conn.execute(
            """INSERT INTO mistakes
               (owner_user_id, subject, question_text, correct_answer, reason, knowledge_point)
               VALUES (?, '数学', '更新但孤立', 'x=3', '符号错', '一次函数')""",
            (user["id"],),
        )

    resp = client.get("/api/agent/next-action")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["action"]["kind"] == "mistake"
    assert payload["action"]["source_mistake_id"] == repeated_id


def test_next_action_prefers_lower_accuracy_practice_over_plain_task(client, helpers):
    user = helpers.register_student(client, username="next-priority-practice")

    with db_module.db() as conn:
        conn.execute("DELETE FROM tasks WHERE owner_user_id = ?", (user["id"],))
        conn.execute(
            """INSERT INTO tasks
               (owner_user_id, week, day_of_week, subject, title, description, minutes)
               VALUES (?, 1, 6, '数学', '今日任务', '做 15 分钟', 15)""",
            (user["id"],),
        )

        cur = conn.execute(
            """INSERT INTO practice_sets
               (owner_user_id, source_mistake_id, title, subject, knowledge_point, status)
               VALUES (?, NULL, ?, ?, ?, 'done')""",
            (user["id"], "数学 · 易错专项", "数学", "一元二次方程"),
        )
        weaker_set_id = cur.lastrowid
        conn.execute(
            """INSERT INTO practice_items
               (set_id, question_text, is_correct, score)
               VALUES (?, '错题 1', 0, 30)""",
            (weaker_set_id,),
        )
        conn.execute(
            """INSERT INTO practice_items
               (set_id, question_text, is_correct, score)
               VALUES (?, '错题 2', 0, 20)""",
            (weaker_set_id,),
        )

        cur = conn.execute(
            """INSERT INTO practice_sets
               (owner_user_id, source_mistake_id, title, subject, knowledge_point, status)
               VALUES (?, NULL, ?, ?, ?, 'done')""",
            (user["id"], "数学 · 普通训练", "数学", "一元一次方程"),
        )
        stronger_set_id = cur.lastrowid
        conn.execute(
            """INSERT INTO practice_items
               (set_id, question_text, is_correct, score)
               VALUES (?, '对题 1', 1, 100)""",
            (stronger_set_id,),
        )
        conn.execute(
            """INSERT INTO practice_items
               (set_id, question_text, is_correct, score)
               VALUES (?, '未做 1', NULL, NULL)""",
            (stronger_set_id,),
        )

    resp = client.get("/api/agent/next-action")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["action"]["kind"] == "practice"
    assert payload["action"]["practice_set_id"] == weaker_set_id
