"""Seed: 初始化 DB + 创建种子学生账号 (立言) + 灌入她的历史成绩.

幂等: 如果 liyan 已存在, 清空其相关数据后重灌.
Run: python seed.py
"""
from db import db, init_db
from auth import create_student
from plan_template import install_plan_for_student

SUBJECTS = ["科学", "英语", "数学", "语文", "社会"]
FULL_MARKS = {"科学": 150, "英语": 120, "数学": 120, "语文": 120, "社会": 100}

# (sort_order, stage, exam_name, date, 科学, 英语, 数学, 语文, 社会, 总分, 班排, 年排, 备注)
LIYAN_EXAMS = [
    (1,  "初一上", "第一次月考",   None,         115,   111.5, 100,   88,    None, 414.5, 7,  41,  "少社会"),
    (2,  "初一上", "期中考试",     None,         118,   107.5, 118,   104,   87,   534.5, 5,  51,  ""),
    (3,  "初一上", "12月月考",     None,         105,   103.5, 105,   102,   86,   501.5, 15, 100, "低谷"),
    (4,  "初一上", "上学期期末",   "2025-01-16", 113,   113,   117,   105,   87.5, 535.5, None, 68, ""),
    (5,  "初一下", "3月月考",      "2025-03-21", 114,   110,   117,   106,   80,   527,   None, 67, ""),
    (6,  "初一下", "期中考试",     None,         109,   111,   117,   108.5, 89,   534.5, None, 59, ""),
    (7,  "初一下", "6月月考",      None,         None,  None,  None,  None,  None, 516.5, None, 89, "仅总分"),
    (8,  "初一下", "下学期期末",   None,         115,   113,   116.5, 110,   85.5, 540,   None, 65, ""),
    (9,  "初二上", "第一次月考",   None,         142,   110,   101,   105,   89,   547,   None, 57, "科学跳升"),
    (10, "初二上", "期中考试",     None,         140,   111,   111,   105.5, 92,   559.5, None, 72, ""),
    (11, "初二上", "12月月考",     None,         146,   109.5, 104,   101.5, 93,   554,   None, 64, ""),
    (12, "初二上", "上学期期末",   None,         143,   119,   116,   103.5, 88.5, 570,   None, 51, "历史最高"),
    (13, "初二下", "4月月考",      "2026-04-01", 143,   111,   106,   103.5, 95,   558.5, None, 48, "最新"),
]


def seed():
    init_db()
    with db() as conn:
        # 清理同名种子账号 (幂等)
        existing = conn.execute("SELECT id FROM users WHERE username = ?", ("liyan",)).fetchone()
        if existing:
            conn.execute("DELETE FROM users WHERE id = ?", (existing["id"],))
            # FK CASCADE 会自动清理 exams/tasks/mistakes

        # 创建学生账号: liyan / liyan123
        info = create_student(
            conn,
            username="liyan",
            password="liyan123",
            display_name="潘立言",
            stage="初二下",
        )
        student_id = info["id"]
        print(f"Created student user 'liyan' (id={student_id}) join_code={info['join_code']}")

        # 灌历史考试
        for (order, stage, name, date, kxue, eng, math, yuwen, shehui,
             total, class_rank, grade_rank, notes) in LIYAN_EXAMS:
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

    print(f"Seeded {len(LIYAN_EXAMS)} exams + 4-week plan tasks for liyan.")
    print("Login: username=liyan  password=liyan123")


if __name__ == "__main__":
    seed()
