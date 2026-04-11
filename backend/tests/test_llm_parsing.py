"""JSON 解析 + 二次清洗 retry 的单元测试.

不碰真实 LLM, 只测 _parse_json_loose 的 4 级 fallback,
以及 parse_json_or_retry 在本地解析失败时会把 raw 回投给 (mock) LLM.
"""
import pytest

from llm import _parse_json_loose, parse_json_or_retry, LLMError


# ---------------- _parse_json_loose 的 4 级 fallback ----------------
def test_pure_json():
    assert _parse_json_loose('{"a": 1}') == {"a": 1}


def test_markdown_code_block():
    assert _parse_json_loose('```json\n{"a": 1}\n```') == {"a": 1}


def test_markdown_code_block_no_lang():
    assert _parse_json_loose('```\n{"a": 1}\n```') == {"a": 1}


def test_json_with_surrounding_text():
    raw = "这是答案:\n{\"a\": 1}\n以上就是全部"
    assert _parse_json_loose(raw) == {"a": 1}


def test_json_array_extraction():
    raw = "数组: [1, 2, 3] 结束"
    assert _parse_json_loose(raw) == [1, 2, 3]


def test_unparseable_raises():
    with pytest.raises(LLMError):
        _parse_json_loose("完全是普通中文, 没有 JSON 任何痕迹")


# ---------------- parse_json_or_retry 路径 ----------------
def test_retry_succeeds_locally_without_llm():
    """本地解析能通过的, 根本不调 LLM."""
    # 传 None 作为 client, 如果调了就会 AttributeError
    assert parse_json_or_retry(None, '{"a": 1}') == {"a": 1}


def test_retry_uses_llm_when_local_fails():
    """本地解析失败 → 回投给 mock LLM."""
    calls = []

    class MockLLM:
        def chat(self, messages, **kwargs):
            calls.append(messages)
            return '{"rescued": true}'

    result = parse_json_or_retry(MockLLM(), "完全是中文没有 JSON")
    assert result == {"rescued": True}
    assert len(calls) == 1
    # 确认 prompt 里包含了原始 raw
    prompt_text = calls[0][0]["content"]
    assert "完全是中文" in prompt_text


def test_retry_raises_if_llm_also_fails():
    """本地 + LLM 二次清洗都失败, 最终抛错."""
    class MockLLM:
        def chat(self, messages, **kwargs):
            return "还是不是 JSON"

    with pytest.raises(LLMError):
        parse_json_or_retry(MockLLM(), "根本不是 JSON")
