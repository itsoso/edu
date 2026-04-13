"""Seed: 初始化 DB + 创建示例学生账号 + 灌入样例考试数据.

开源版本: 使用虚构的示例数据, 不含真实学生信息.
幂等: 如果 demo 已存在, 清空其相关数据后重灌.
Run: python seed.py
"""
from db import db, init_db
from auth import create_student
from plan_template import install_plan_for_student

SUBJECTS = ["科学", "英语", "数学", "语文", "社会"]
FULL_MARKS = {"科学": 150, "英语": 120, "数学": 120, "语文": 120, "社会": 100}

# 示例考试数据 (虚构, 用于演示功能)
# (sort_order, stage, exam_name, date, 科学, 英语, 数学, 语文, 社会, 总分, 班排, 年排, 备注)
DEMO_EXAMS = [
    (1,  "初一上", "第一次月考",   None,         110,   105,   95,    85,    None, 395,   10, 55,  ""),
    (2,  "初一上", "期中考试",     None,         115,   108,   110,   100,   85,   518,   6,  42,  ""),
    (3,  "初一上", "上学期期末",   "2025-01-15", 112,   112,   108,   102,   88,   522,   None, 45, ""),
    (4,  "初一下", "期中考试",     None,         108,   110,   115,   106,   86,   525,   None, 50, ""),
    (5,  "初一下", "下学期期末",   None,         114,   111,   112,   108,   87,   532,   None, 43, ""),
    (6,  "初二上", "第一次月考",   None,         138,   109,   105,   103,   88,   543,   None, 48, ""),
    (7,  "初二上", "期中考试",     None,         142,   112,   110,   105,   90,   559,   None, 38, ""),
    (8,  "初二上", "上学期期末",   None,         140,   116,   113,   104,   91,   564,   None, 35, ""),
]

# 示例学生 (虚构)
DEMO_USERNAME = "demo"
DEMO_PASSWORD = "demo1234"
DEMO_DISPLAY_NAME = "示例学生"
DEMO_STAGE = "初二下"


def seed():
    init_db()
    with db() as conn:
        # 清理同名种子账号 (幂等)
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (DEMO_USERNAME,)).fetchone()
        if existing:
            conn.execute("DELETE FROM users WHERE id = ?", (existing["id"],))
            # FK CASCADE 会自动清理 exams/tasks/mistakes

        # 创建学生账号
        info = create_student(
            conn,
            username=DEMO_USERNAME,
            password=DEMO_PASSWORD,
            display_name=DEMO_DISPLAY_NAME,
            stage=DEMO_STAGE,
        )
        student_id = info["id"]
        print(f"Created student user '{DEMO_USERNAME}' (id={student_id}) join_code={info['join_code']}")

        # 灌样例考试
        for (order, stage, name, date, kxue, eng, math, yuwen, shehui,
             total, class_rank, grade_rank, notes) in DEMO_EXAMS:
            cur = conn.execute(
                """INSERT INTO exams
                   (owner_user_id, exam_name, exam_date, stage, total,
                    class_rank, grade_rank, notes, sort_order)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (student_id, name, date, stage, total, class_rank, grade_rank, notes, order),
            )
            exam_id = cur.lastrowid
            subject_scores = {
                "科学": kxue, "英语": eng, "数学": math,
                "语文": yuwen, "社会": shehui,
            }
            for subject, score in subject_scores.items():
                if score is not None:
                    conn.execute(
                        "INSERT INTO scores (exam_id, subject, score, full_mark) VALUES (?, ?, ?, ?)",
                        (exam_id, subject, score, FULL_MARKS[subject]),
                    )

        # 灌 4 周计划
        install_plan_for_student(conn, student_id)

    print(f"Seeded {len(DEMO_EXAMS)} exams + 4-week plan tasks for {DEMO_USERNAME}.")
    print(f"Login: username={DEMO_USERNAME}  password={DEMO_PASSWORD}")


if __name__ == "__main__":
    seed()
