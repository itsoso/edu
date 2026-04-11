"""OpenClaw gateway client — vision + text, sync httpx.

环境变量:
    EDU_LLM_BASE_URL   default: https://bot.executor.life/v1
    EDU_LLM_API_KEY    required (or .env file)
    EDU_LLM_MODEL      default: openclaw
"""
import base64
import json
import os
from pathlib import Path
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://bot.executor.life/v1"
DEFAULT_MODEL = "openclaw"
ENV_FILE = Path(__file__).parent / "data" / ".env"


def _load_env_file():
    """Minimal .env loader (no deps): KEY=value, ignores comments."""
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line and line.split("=", 1)[0] not in os.environ:
            k, v = line.split("=", 1)
            os.environ[k.strip()] = v.strip().strip('"').strip("'")


_load_env_file()


class LLMError(Exception):
    pass


class LLMClient:
    def __init__(self):
        self.base_url = os.environ.get("EDU_LLM_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
        self.api_key = os.environ.get("EDU_LLM_API_KEY")
        self.model = os.environ.get("EDU_LLM_MODEL", DEFAULT_MODEL)

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def configured(self) -> bool:
        return bool(self.api_key)

    # -------- 核心调用 --------
    def chat(
        self,
        messages: list[dict],
        temperature: float = 0.3,
        max_tokens: int = 3000,
        response_format_json: bool = False,
        timeout: float = 180.0,
    ) -> str:
        if not self.configured():
            raise LLMError("LLM not configured: set EDU_LLM_API_KEY")
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if response_format_json:
            # OpenAI 兼容: 某些网关支持
            payload["response_format"] = {"type": "json_object"}

        url = f"{self.base_url}/chat/completions"
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(url, json=payload, headers=self._headers())
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as e:
            raise LLMError(f"gateway {e.response.status_code}: {e.response.text[:200]}")
        except httpx.RequestError as e:
            raise LLMError(f"network: {e}")

        try:
            return data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError):
            raise LLMError(f"unexpected response: {json.dumps(data)[:200]}")

    # -------- 辅助: 图片转 data URL --------
    @staticmethod
    def image_to_data_url(image_path: str | Path) -> str:
        p = Path(image_path)
        ext = p.suffix.lower().lstrip(".")
        mime = {
            "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png",  "webp": "image/webp",
            "gif": "image/gif",
        }.get(ext, "image/jpeg")
        b64 = base64.b64encode(p.read_bytes()).decode("ascii")
        return f"data:{mime};base64,{b64}"

    # -------- 高层封装 --------
    def vision_chat(self, text: str, image_paths: list[str | Path], **kw) -> str:
        content: list[dict] = [{"type": "text", "text": text}]
        for p in image_paths:
            content.append({
                "type": "image_url",
                "image_url": {"url": self.image_to_data_url(p)},
            })
        return self.chat([{"role": "user", "content": content}], **kw)

    def json_chat(self, prompt: str, image_paths: list | None = None, **kw) -> Any:
        """请 LLM 返回 JSON. 容错解析 (去 markdown 代码块)."""
        if image_paths:
            raw = self.vision_chat(prompt, image_paths, response_format_json=True, **kw)
        else:
            raw = self.chat(
                [{"role": "user", "content": prompt}],
                response_format_json=True,
                **kw,
            )
        return _parse_json_loose(raw)


def _parse_json_loose(raw: str) -> Any:
    """LLM 往往把 JSON 包进 markdown. 多级 fallback.

    失败时抛 LLMError, 让调用方决定要不要走二次清洗.
    """
    s = raw.strip()
    # 1. 直接解析
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    # 2. 去掉 markdown 代码块
    if s.startswith("```"):
        s = s.strip("`")
        if s.lower().startswith("json"):
            s = s[4:]
        s = s.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    # 3. 提取首个 { 到最后一个 }
    lo = s.find("{")
    hi = s.rfind("}")
    if lo != -1 and hi > lo:
        try:
            return json.loads(s[lo : hi + 1])
        except json.JSONDecodeError:
            pass
    # 4. 提取首个 [ 到最后一个 ]
    lo = s.find("[")
    hi = s.rfind("]")
    if lo != -1 and hi > lo:
        try:
            return json.loads(s[lo : hi + 1])
        except json.JSONDecodeError:
            pass
    raise LLMError(f"could not parse JSON from LLM response: {raw[:200]}")


def parse_json_or_retry(client: "LLMClient", raw: str, max_retries: int = 1) -> Any:
    """解析 LLM 输出为 JSON. 第一次失败就回投给 LLM 让它清洗一遍.

    为什么值得做: _parse_json_loose 的 4 级 fallback 都是纯文本启发式,
    偶尔 LLM 会吐出 "这是 JSON: ..." 带前言, 或中英文混杂的标点导致 4 级都失败.
    二次清洗的成功率很高, 因为只需要 LLM 复制粘贴已经存在的数据.

    max_retries=1 就够用了, 再多调一次就成本过高.
    """
    # 第一次尝试本地解析
    try:
        return _parse_json_loose(raw)
    except LLMError:
        pass

    # 本地解析失败, 让 LLM 自己清洗一次
    for attempt in range(max_retries):
        cleanup_prompt = (
            "下面这段文本里含有 JSON 数据, 但混入了其他内容 (说明文字、代码块标记、中文标点等). "
            "请提取出**完整的 JSON**, 只返回纯 JSON, 不要任何前缀/后缀/说明/代码块.\n\n"
            f"原文本:\n{raw[:4000]}"
        )
        try:
            cleaned = client.chat(
                [{"role": "user", "content": cleanup_prompt}],
                temperature=0.0,  # 确定性输出
                max_tokens=3000,
                response_format_json=True,
            )
            return _parse_json_loose(cleaned)
        except LLMError:
            continue

    # 二次清洗还是不行, 抛最终错误
    raise LLMError(f"could not parse JSON after {max_retries} retries. raw={raw[:200]}")


# 单例
_client: LLMClient | None = None


def get_llm() -> LLMClient:
    global _client
    if _client is None:
        _client = LLMClient()
    return _client


# -------- Prompts --------
SYSTEM_ROLE = (
    "你是一位资深的初中学科老师, 善于分析学生的试卷, 识别错题、诊断学习问题、"
    "并出题训练。所有回答使用简体中文, 对学生友善。"
)

EXTRACT_MISTAKES_PROMPT = """请仔细看这张试卷照片, 找出其中**被标记为错误**(扣分/打叉/老师批注错误)的所有题目。

对于每道错题, 输出以下信息, 严格返回 JSON 格式:

{
  "subject": "数学|科学|英语|语文|社会 (根据试卷判断, 未知填'其他')",
  "mistakes": [
    {
      "question_number": "题号或定位(如'1'、'选择3'、'大题二(1)')",
      "question_text": "完整题目文字, 用简体中文",
      "wrong_answer": "学生写的错答案",
      "correct_answer": "正确答案, 如果试卷上没标注, 填'待确认'",
      "reason_guess": "计算错|审题漏|不会做|步骤乱|知识遗忘|其他",
      "knowledge_point": "涉及的知识点, 简短(如: 一元二次方程判别式)",
      "confidence": 0.0~1.0
    }
  ]
}

规则:
- 如果图片模糊看不清某题, 在 question_text 里写 '模糊' 并 confidence < 0.4
- 没标扣分的对题不要包含
- 如果没有任何错题, 返回 { "subject": "...", "mistakes": [] }
- 直接返回 JSON, 不要任何解释文字或 markdown 代码块
"""

FULL_ANALYSIS_PROMPT = """请从整份试卷的角度, 分析这位学生的答题情况, 不只是看错题。

严格返回 JSON:

{
  "subject": "科目",
  "exam_estimate": "估计试卷类型(月考/期中/练习等)",
  "estimated_score": "估分 (如'110/120')",
  "strengths": ["这份卷子做得好的 2-3 个方面"],
  "weaknesses": ["暴露的 2-4 个薄弱点, 具体到知识点或题型"],
  "knowledge_gaps": ["需要补的具体知识点 3-5 个"],
  "advice": "给学生的针对性建议, 150-300 字, 具体可执行",
  "priority_focus": "如果只能专攻一点, 应该是什么"
}

直接返回 JSON, 不要任何解释文字或 markdown 代码块。
"""

GENERATE_PRACTICE_PROMPT = """基于下面这道错题, 出 {count} 道类似难度/考察同一知识点的训练题, 用来帮学生巩固。

原错题:
科目: {subject}
知识点: {knowledge_point}
题目: {question_text}
错在哪: {reason}

严格返回 JSON:

{{
  "items": [
    {{
      "question_text": "题目全文",
      "expected_answer": "标准答案",
      "solution_steps": "解题思路(3-5 步, 简明)",
      "difficulty": "easy|medium|hard"
    }}
  ]
}}

要求:
- 难度与原题相当或略高
- 题面与原题不同 (换数字/换情境/换问法), 但本质考同一知识点
- 每题的 expected_answer 必须明确、简短、可对照
- 直接返回 JSON, 不要任何解释文字或 markdown 代码块
"""

MONTHLY_REPORT_PROMPT = """你是一位资深的初中老师, 正在为学生写月度学习复盘报告。

这是 {student_name} 在 {month} 的学习数据:

【考试情况】
{exams_summary}

【错题情况】
- 本月新增错题: {new_mistakes_count} 道
- 失分归因分布: {reason_distribution}
- 涉及科目分布: {subject_distribution}
- 典型错题节选:
{top_mistakes_excerpt}

【打卡情况】
- 应打卡天数: {plan_days}
- 实际打卡任务数: {checkin_count}
- 打卡完成率估算: {completion_rate}
- 训练题集: {practice_set_count} 份, 共 {practice_item_count} 题, 正确率 {practice_correct_rate}

请写一份 **Markdown 格式** 的月度复盘报告, 结构如下:

# {month} 月度复盘 — {student_name}

## 一、本月亮点
(2-4 条, 具体到数据或事件)

## 二、需要关注的问题
(2-4 条, 指向具体的失分归因、薄弱知识点、或执行力问题)

## 三、数据背后的学习状态解读
(1 段, 150-300 字, 把冷冰冰的数据翻译成"这孩子当下在想什么/遇到什么")

## 四、下个月的三个行动
1. **xxx** — 具体做什么, 为什么
2. **xxx**
3. **xxx**

## 五、给家长的一句话
(1 句, 告诉家长怎么帮她, 或者怎么不越界)

---
要求:
- 语气温暖但不浮夸, 说人话
- 关键结论附上数据 (如 "数学错题占 48%")
- 行动要可执行, 不要空话
- 直接输出 Markdown, 不要代码块包裹, 不要加任何前后缀
"""

GRADE_PRACTICE_PROMPT = """请判断学生的作答是否正确, 并给出简明点评。

题目: {question_text}
标准答案: {expected_answer}
学生作答: {student_answer}

严格返回 JSON:

{{
  "correct": true|false,
  "score": 0~100,
  "feedback": "1-3 句点评, 指出对在哪或错在哪, 以及改进方向"
}}

规则:
- 数值题允许小数点/四舍五入的合理差异
- 文字题看关键点是否覆盖, 不必一字不差
- 直接返回 JSON
"""
