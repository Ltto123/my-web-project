"""
DeepSeek API 集成 — 单词解析与补全
使用 OpenAI 兼容接口调用 DeepSeek，自动解析各种格式的单词文件并补全缺失字段
大文件自动分块 + 并行处理，大幅提升解析速度
"""
import json
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from openai import OpenAI

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-pro")

# 并行处理的最大并发数（避免触发 API 限流）
MAX_CONCURRENT_CHUNKS = 5
# 每个 chunk 的字符数上限（控制每块单词量，避免 DeepSeek 输出超 token 限制）
CHUNK_SIZE = 10000
# DeepSeek API 最大输出 tokens（deepseek-chat 默认仅 4096，远不足以输出 100+ 个单词的完整 JSON）
MAX_TOKENS = 16000

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
    """获取 DeepSeek OpenAI 兼容客户端（每个线程独立创建）"""
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


def _split_into_chunks(file_content: str, chunk_size: int = CHUNK_SIZE) -> list[str]:
    """将大文件按段落边界拆分为多个 chunk"""
    if len(file_content) <= chunk_size:
        return [file_content]

    paragraphs = file_content.split("\n\n")
    chunks = []
    current = ""
    for para in paragraphs:
        if len(current) + len(para) < chunk_size:
            current += ("\n\n" if current else "") + para
        else:
            if current:
                chunks.append(current)
            current = para
    if current:
        chunks.append(current)
    return chunks


def _process_chunk(idx: int, chunk: str, total: int) -> tuple[int, list]:
    """在独立线程中处理单个 chunk：调用 DeepSeek API 解析单词"""
    client = _get_client()
    prefix = f"(第 {idx+1}/{total} 部分) " if total > 1 else ""
    try:
        response = client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"请解析以下单词文件内容{prefix}，提取并补全所有单词：\n\n{chunk}"}
            ],
            temperature=0.3,
            max_tokens=MAX_TOKENS,
            timeout=300,
        )
        raw = response.choices[0].message.content or ""
        finish = response.choices[0].finish_reason

        # 检测输出是否被截断（token 不够）
        if finish == "length" or (raw.strip() and not raw.strip().endswith("]")):
            print(f"  [WARN] Chunk {idx+1}/{total}: 输出可能被截断 (finish={finish}, ends_with_]= {raw.strip().endswith(']')})")

        words = _extract_json_from_response(raw)
        return idx, words
    except Exception as e:
        raise RuntimeError(f"第 {idx+1}/{total} 部分解析失败: {e}") from e


def parse_and_complete(file_content: str, progress_callback=None) -> list[dict]:
    """
    将原始文件内容发送给 DeepSeek，由 AI 解析格式并补全缺失字段。
    大文件自动分块 + 并行处理，大幅提升速度。

    Args:
        file_content: 原始文件文本内容
        progress_callback: 可选回调(chunk_done: int, chunk_total: int)，每完成一个chunk后调用

    Returns:
        解析并补全后的单词列表
    """
    chunks = _split_into_chunks(file_content)

    # Collect results from parallel chunk processing
    chunk_results = []  # list of (chunk_idx, word_dicts)
    seen = set()
    seen_lock = threading.Lock()

    max_workers = min(MAX_CONCURRENT_CHUNKS, len(chunks))

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_process_chunk, i, chunk, len(chunks)): i
            for i, chunk in enumerate(chunks)
        }

        done_count = 0
        chunk_errors = []
        for future in as_completed(futures):
            chunk_idx = futures[future]
            try:
                idx, words = future.result()
            except Exception as e:
                chunk_errors.append((chunk_idx, str(e)))
                done_count += 1
                if progress_callback:
                    progress_callback(done_count, len(chunks))
                continue
            done_count += 1

            # 线程安全去重
            deduped = []
            with seen_lock:
                for w in words:
                    if not isinstance(w, dict) or not w.get("word"):
                        continue
                    key = str(w.get("word", "")).strip().lower()
                    if not key or key in seen:
                        continue
                    seen.add(key)
                    deduped.append(w)
            chunk_results.append((idx, deduped))

            if progress_callback:
                progress_callback(done_count, len(chunks))

    # Report chunk failures (if any)
    if chunk_errors:
        failed_detail = "; ".join(f"chunk {i+1}: {e}" for i, e in chunk_errors)
        raise RuntimeError(f"{len(chunk_errors)}/{len(chunks)} 个分块解析失败: {failed_detail}")

    # Sort by chunk index to maintain original document order
    chunk_results.sort(key=lambda x: x[0])

    # Flatten: all words in original chunk order
    all_words = []
    for _, words in chunk_results:
        all_words.extend(words)

    # Validate and normalize
    result = []
    for i, w in enumerate(all_words):
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
