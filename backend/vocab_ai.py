"""
DeepSeek API 集成 — 单词解析与补全
使用 OpenAI 兼容接口调用 DeepSeek，自动解析各种格式的单词文件并补全缺失字段
"""
import json
import os
import re
from openai import OpenAI

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-pro")

SYSTEM_PROMPT = """你是一个英语词典编纂助手。用户会上传一个单词列表文件（可能是 TXT/CSV/JSON/PDF 提取的文本等各种格式），
你需要分析并提取每个单词/短语的信息。

对于每个条目，补全以下字段：
- word: 英文单词或短语（字符串）
- pos: 词性（字符串，如 n./v./vt./vi./a./ad./prep./conj./phr./pron./int./det./num./aux. 等）
- def_en: 英文释义（字符串，保留用户原文中的英文释义，若缺失则补全）
- def_zh: 中文释义（字符串，保留用户原文中的中文释义，若缺失则补全）
- example_en: 英文例句（字符串，自然地道、长度适中，若用户已提供则保留原文）
- example_zh: 例句中文翻译（字符串，对应英文例句的中文翻译）
- is_phrase: 是否为短语（整数，0=单词, 1=短语）

重要规则：
1. 若用户已提供某个字段的完整信息，请务必保留原文，不要改写或润色
2. 若字段缺失或不完整，请补全合理的内容
3. 英文释义要准确，中文释义要符合中国大陆的词典习惯
4. 例句要自然、地道、有语境，适合学习使用
5. 返回严格的 JSON 数组格式，不要包含任何 Markdown 代码块标记或其他文字
6. 不要遗漏任何单词，也不要编造不存在的单词

返回格式示例：
[{"word": "commencement", "pos": "n.", "def_en": "a ceremony at which students receive their diplomas", "def_zh": "毕业典礼", "example_en": "The commencement ceremony lasted about three hours.", "example_zh": "毕业典礼持续了大约三个小时。", "is_phrase": 0}]"""


def _get_client() -> OpenAI:
    """获取 DeepSeek OpenAI 兼容客户端"""
    if not DEEPSEEK_API_KEY:
        raise ValueError("DEEPSEEK_API_KEY 未配置，请在 .env 文件中设置")
    return OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)


def _extract_json_from_response(text: str) -> list:
    """从 DeepSeek 响应中提取 JSON 数组"""
    text = text.strip()

    # Strip markdown code fences first
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    # Try direct parse
    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "words" in result:
            return result["words"]
    except json.JSONDecodeError:
        pass

    # Find JSON array with non-greedy bracket matching
    json_match = re.search(r"\[.*\]", text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except json.JSONDecodeError:
            pass

    # Fix trailing commas, then retry
    cleaned = re.sub(r",\s*([}\]])", r"\1", text)
    json_match = re.search(r"\[.*\]", cleaned, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except json.JSONDecodeError:
            pass

    # Last resort: try to truncate to last complete object
    last_brace = text.rfind("}")
    if last_brace > 0:
        truncated = text[:last_brace + 1] + "\n]"
        try:
            return json.loads(truncated)
        except json.JSONDecodeError:
            pass

    raise ValueError(f"无法从 DeepSeek 响应中解析 JSON 数组。原始响应前500字符: {text[:500]}")


def parse_and_complete(file_content: str) -> list[dict]:
    """
    将原始文件内容发送给 DeepSeek，由 AI 解析格式并补全缺失字段。

    Args:
        file_content: 原始文件文本内容

    Returns:
        解析并补全后的单词列表，每个元素包含 word, pos, def_en, def_zh, example_en, example_zh, is_phrase
    """
    client = _get_client()

    # Truncate very large files
    max_chars = 80000
    if len(file_content) > max_chars:
        file_content = file_content[:max_chars] + "\n...[内容已截断]"

    response = client.chat.completions.create(
        model=DEEPSEEK_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"请解析以下单词文件内容，提取并补全所有单词：\n\n{file_content}"}
        ],
        temperature=0.3,
        max_tokens=32000,
        timeout=120,
    )

    raw = response.choices[0].message.content or ""
    words = _extract_json_from_response(raw)

    # Validate and normalize each word entry
    result = []
    for i, w in enumerate(words):
        if not isinstance(w, dict) or not w.get("word"):
            continue
        result.append({
            "word": str(w.get("word", "")).strip(),
            "pos": str(w.get("pos", "")).strip() or None,
            "def_en": str(w.get("def_en", "")).strip() or None,
            "def_zh": str(w.get("def_zh", "")).strip() or None,
            "example_en": str(w.get("example_en", "")).strip() or None,
            "example_zh": str(w.get("example_zh", "")).strip() or None,
            "is_phrase": int(w.get("is_phrase", 0)),
            "sort_order": i,
        })

    return result
