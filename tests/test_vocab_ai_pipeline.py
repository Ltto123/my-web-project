"""词表确定性提取、AI 覆盖率及时间预算回归。"""
import importlib.util
import io
import json
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from openpyxl import Workbook

from backend import vocab_ai


def source(word, **fields):
    return {"word": word, "def_zh": "原始释义", **fields}


def filled(item):
    return {"id": item["id"], "word": item["word"], "pos": "n.",
            "def_en": "a useful meaning", "def_zh": "AI 改写释义",
            "example_en": "This is a useful example.", "example_zh": "这是一个实用的例子。"}


def fake_client(transform=None, delay=0):
    def create(**kwargs):
        if delay:
            time.sleep(delay)
        data = json.loads(kwargs["messages"][1]["content"])
        result = [filled(item) for item in data["entries"]]
        if transform:
            result = transform(result)
        return SimpleNamespace(choices=[SimpleNamespace(
            finish_reason="stop", message=SimpleNamespace(content=json.dumps(result)))])
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=Mock(side_effect=create))),
                           close=Mock())


class WorkbookExtractionTests(unittest.TestCase):
    def extract(self, rows, other_sheet=None):
        self.assertIsNotNone(importlib.util.find_spec("backend.vocab_input"),
                             "需要独立的结构化文件提取器")
        from backend.vocab_input import extract_xlsx_entries
        book = Workbook()
        for row in rows:
            book.active.append(row)
        if other_sheet:
            sheet = book.create_sheet("第二页")
            for row in other_sheet:
                sheet.append(row)
        data = io.BytesIO()
        book.save(data)
        book.close()
        return extract_xlsx_entries(data.getvalue())

    def test_preserves_all_duplicate_senses_and_ignores_study_columns(self):
        entries = self.extract([
            ["单词", "释义", "拼写版", "正误", "随机数"],
            ["grave", "严重的；严峻的", None, False, 0.132],
            ["loyalty", "忠诚", None, False, 0.78],
            ["Grave", "墓穴", None, True, 0.9],
            ["grave", "墓穴", None, False, 0.1],
        ])
        self.assertEqual([entry["word"] for entry in entries], ["grave", "loyalty"])
        self.assertEqual(entries[0]["def_zh"], "严重的；严峻的\n墓穴")
        self.assertNotIn("0.132", json.dumps(entries))
        self.assertNotIn("False", json.dumps(entries))

    def test_named_fields_are_preserved_and_unknown_sheet_is_not_dropped(self):
        entries = self.extract([
            ["word", "def_zh", "pos", "example_en"],
            ["apple", "苹果", "n.", "An apple fell."],
        ])
        self.assertEqual(entries[0]["example_en"], "An apple fell.")
        self.assertIsNone(self.extract([["word", "meaning"], ["apple", "苹果"]],
                                       [["非表格材料"], ["banana 香蕉"]]))

    def test_unrecognized_workbook_uses_generic_path(self):
        self.assertIsNone(self.extract([["apple 苹果"], ["banana 香蕉"]]))

    def test_missing_word_with_definition_is_not_silently_discarded(self):
        with self.assertRaises(ValueError):
            self.extract([["单词", "释义"], ["apple", "苹果"], [None, "香蕉"]])

    def test_unknown_cover_sheet_does_not_skip_later_sheet_limits(self):
        with patch("backend.vocab_input.MAX_SHEET_ROWS", 2):
            with self.assertRaisesRegex(ValueError, "行数"):
                self.extract([["封面：词汇材料"]], [["word"], ["apple"], ["banana"]])

    def test_two_word_blocks_do_not_silently_drop_the_second_block(self):
        self.assertIsNone(self.extract([
            ["word", "meaning", "word", "meaning"],
            ["apple", "苹果", "banana", "香蕉"],
        ]))

    def test_neutral_definition_headers_infer_language_and_translation_means_definition(self):
        entries = self.extract([
            ["word", "definition", "translation"],
            ["apple", "a round edible fruit", "苹果"],
        ])
        self.assertEqual(entries[0]["def_en"], "a round edible fruit")
        self.assertEqual(entries[0]["def_zh"], "苹果")
        self.assertIsNone(entries[0]["example_zh"])
        chinese = self.extract([["word", "meaning"], ["banana", "香蕉"]])
        self.assertEqual(chinese[0]["def_zh"], "香蕉")

    def test_explicit_source_language_fields_are_not_reclassified(self):
        entries = self.extract([
            ["word", "def_en", "def_zh", "example_translation"],
            ["apple", "an English definition containing 苹果", "苹果", "这是一颗苹果。"],
        ])
        self.assertEqual(entries[0]["def_en"], "an English definition containing 苹果")
        self.assertEqual(entries[0]["example_zh"], "这是一颗苹果。")


class PipelineTests(unittest.TestCase):
    def test_numbered_bilingual_word_list_has_deterministic_coverage(self):
        client = fake_client()
        with patch.object(vocab_ai, "_get_client", return_value=client):
            result = vocab_ai.parse_and_complete("1) apple —— 苹果\n2) banana —— 香蕉")
        self.assertEqual([r["word"] for r in result], ["apple", "banana"])
        self.assertEqual([r["def_zh"] for r in result], ["苹果", "香蕉"])
        self.assertEqual(client.chat.completions.create.call_count, 1)

    def test_numbered_simple_word_list_has_deterministic_coverage(self):
        client = fake_client()
        with patch.object(vocab_ai, "_get_client", return_value=client):
            result = vocab_ai.parse_and_complete("1. apple\n2) banana")
        self.assertEqual([r["word"] for r in result], ["apple", "banana"])

    def test_identification_cannot_discard_obvious_word_line_in_mixed_document(self):
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=Mock(
            return_value=SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop",
                message=SimpleNamespace(content=json.dumps([
                    {"source_id": 0, "entries": []},
                    {"source_id": 1, "entries": []},
                    {"source_id": 2, "entries": [{"word": "banana", "def_zh": "香蕉"}]},
                ])))])))), close=Mock())
        with patch.object(vocab_ai, "_get_client", return_value=client):
            with self.assertRaisesRegex(ValueError, "遗漏"):
                vocab_ai.parse_and_complete("词汇材料 第三课\n1) apple —— 苹果\n2) banana —— 香蕉")

    def test_identification_preserves_obvious_source_meaning_if_ai_omits_that_field(self):
        def create(**kwargs):
            payload = json.loads(kwargs["messages"][1]["content"])
            if "sources" in payload:
                rows = [{"source_id": 0, "entries": []},
                        {"source_id": 1, "entries": [{"word": "apple"}]}]
            else:
                rows = [filled(item) for item in payload["entries"]]
            return SimpleNamespace(choices=[SimpleNamespace(
                finish_reason="stop", message=SimpleNamespace(content=json.dumps(rows)))])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)), close=Mock())
        with patch.object(vocab_ai, "_get_client", return_value=client):
            result = vocab_ai.parse_and_complete("词汇材料 第三课\n1) apple —— 苹果")
        self.assertEqual(result[0]["def_zh"], "苹果")

    def test_multiblock_delimited_line_preserves_both_ai_identified_meanings(self):
        def create(**kwargs):
            payload = json.loads(kwargs["messages"][1]["content"])
            if "sources" in payload:
                rows = [{"source_id": 0, "entries": [
                    {"word": "apple", "def_zh": "苹果"},
                    {"word": "banana", "def_zh": "香蕉"},
                ]}]
            else:
                rows = [filled(item) for item in payload["entries"]]
            return SimpleNamespace(choices=[SimpleNamespace(
                finish_reason="stop", message=SimpleNamespace(content=json.dumps(rows)))])
        for delimiter in ("\t", ",", ";"):
            with self.subTest(delimiter=delimiter):
                client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)),
                                         close=Mock())
                with patch.object(vocab_ai, "_get_client", return_value=client):
                    result = vocab_ai.parse_and_complete(delimiter.join(["apple", "苹果", "banana", "香蕉"]))
                self.assertEqual([row["word"] for row in result], ["apple", "banana"])
                self.assertEqual([row["def_zh"] for row in result], ["苹果", "香蕉"])

    def test_identification_reports_real_batch_percentage_separately_from_word_percentage(self):
        def create(**kwargs):
            payload = json.loads(kwargs["messages"][1]["content"])
            if "sources" in payload:
                rows = [{"source_id": row["source_id"], "entries": [{
                    "word": row["text"].split(" ")[1], "def_zh": "原文",
                }]} for row in payload["sources"]]
            else:
                rows = [filled(item) for item in payload["entries"]]
            return SimpleNamespace(choices=[SimpleNamespace(
                finish_reason="stop", message=SimpleNamespace(content=json.dumps(rows)))])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)), close=Mock())
        events = []
        with patch.object(vocab_ai, "_get_client", return_value=client):
            vocab_ai.parse_and_complete("\n".join(f"条目 word{i} 原文" for i in range(30)), events.append)
        identified = [e for e in events if e["stage"] == "identifying"]
        self.assertEqual([e["stage_progress_percent"] for e in identified], [0, 50, 100])
        self.assertTrue(all(e["progress_percent"] == 0 for e in identified))
        self.assertTrue(all(e["total_words"] == 0 for e in identified))

    def test_preserves_source_fields_and_validates_every_identifier(self):
        client = fake_client(lambda rows: list(reversed(rows)))
        events = []
        with patch.object(vocab_ai, "_get_client", return_value=client):
            result = vocab_ai.parse_and_complete([
                source("grave", def_zh="严肃的\n墓穴", pos="a./n."), source("loyalty")], events.append)
        self.assertEqual([r["word"] for r in result], ["grave", "loyalty"])
        self.assertEqual(result[0]["def_zh"], "严肃的\n墓穴")
        self.assertEqual(result[0]["pos"], "a./n.")
        self.assertEqual([r["sort_order"] for r in result], [0, 1])
        self.assertEqual(events[-1]["processed_words"], 2)
        self.assertEqual(events[-1]["progress_percent"], 100)
        self.assertTrue(all(e["progress_percent"] == e["processed_words"] * 100 // e["total_words"]
                            for e in events if e["total_words"]))
        self.assertEqual(client.close.call_count, client.chat.completions.create.call_count)

    def test_missing_extra_duplicate_and_empty_field_responses_never_succeed(self):
        transforms = [lambda r: r[:-1], lambda r: r + [{**r[0], "id": 999}],
                      lambda r: [r[0], r[0]], lambda r: [{**x, "example_en": ""} for x in r]]
        for transform in transforms:
            with self.subTest(transform=transform):
                client = fake_client(transform)
                events = []
                with patch.object(vocab_ai, "_get_client", return_value=client):
                    with self.assertRaises((ValueError, RuntimeError)):
                        vocab_ai.parse_and_complete([source("one"), source("two")], events.append)
                self.assertLessEqual(client.chat.completions.create.call_count, 2)
                self.assertFalse(any(e["progress_percent"] == 100 for e in events))

    def test_unknown_text_requires_every_source_line_identifier(self):
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=Mock(
            return_value=SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop",
                message=SimpleNamespace(content='[{"source_id":0,"entries":[]}]'))])))), close=Mock())
        with patch.object(vocab_ai, "_get_client", return_value=client):
            with self.assertRaises((ValueError, RuntimeError)):
                vocab_ai.parse_and_complete("This document has a complex layout:\nword: apple; meaning: 苹果")

    def test_batches_progress_only_after_validation_and_keep_source_order(self):
        client = fake_client()
        events = []
        with patch.object(vocab_ai, "_get_client", return_value=client):
            result = vocab_ai.parse_and_complete([source(f"word{i}") for i in range(61)], events.append)
        self.assertEqual([r["word"] for r in result], [f"word{i}" for i in range(61)])
        self.assertGreater(client.chat.completions.create.call_count, 1)
        validated = [e["processed_words"] for e in events if e["stage"] == "enriching"]
        self.assertEqual(validated, sorted(validated))
        self.assertEqual(events[-1]["total_words"], 61)

    def test_timeout_returns_without_waiting_for_stalled_api_thread(self):
        client = fake_client(delay=0.4)
        started = time.monotonic()
        with patch.object(vocab_ai, "_get_client", return_value=client):
            with self.assertRaises(TimeoutError):
                vocab_ai.parse_and_complete([source("word")], deadline=started + 0.06)
        self.assertLess(time.monotonic() - started, 0.3)

    def test_cancelled_job_makes_no_request(self):
        cancelled = threading.Event()
        cancelled.set()
        with patch.object(vocab_ai, "_get_client") as client:
            with self.assertRaises(RuntimeError):
                vocab_ai.parse_and_complete([source("word")], cancel_event=cancelled)
        client.assert_not_called()

    def test_cancel_while_request_running_returns_promptly_without_completion(self):
        client = fake_client(delay=0.3)
        cancelled = threading.Event()
        timer = threading.Timer(0.04, cancelled.set)
        events = []
        started = time.monotonic()
        timer.start()
        try:
            with patch.object(vocab_ai, "_get_client", return_value=client):
                with self.assertRaises(RuntimeError):
                    vocab_ai.parse_and_complete([source("word")], events.append, cancel_event=cancelled)
        finally:
            timer.cancel()
        self.assertLess(time.monotonic() - started, 0.25)
        self.assertFalse(any(e["progress_percent"] == 100 for e in events))

    def test_complete_source_needs_no_api_request(self):
        entry = filled({"id": 0, "word": "apple"})
        events = []
        with patch.object(vocab_ai, "_get_client") as client:
            result = vocab_ai.parse_and_complete([entry], events.append)
        client.assert_not_called()
        self.assertEqual(result[0]["word"], "apple")
        self.assertEqual(events[-1]["progress_percent"], 100)

    def test_unknown_text_identification_cannot_fabricate_source_fields(self):
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=Mock(
            return_value=SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop",
                message=SimpleNamespace(content=json.dumps([
                    {"source_id": 0, "entries": []},
                    {"source_id": 1, "entries": [{"word": "apple", "def_zh": "模型编造释义"}]},
                ])))])))), close=Mock())
        with patch.object(vocab_ai, "_get_client", return_value=client):
            with self.assertRaisesRegex(ValueError, "原文"):
                vocab_ai.parse_and_complete("Vocabulary document:\n1) apple —— 苹果")

    def test_identification_cannot_accept_word_substring_inside_other_word(self):
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=Mock(
            return_value=SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop",
                message=SimpleNamespace(content=json.dumps([
                    {"source_id": 0, "entries": []},
                    {"source_id": 1, "entries": [{"word": "app"}]},
                ])))])))), close=Mock())
        with patch.object(vocab_ai, "_get_client", return_value=client):
            with self.assertRaisesRegex(ValueError, "不存在"):
                vocab_ai.parse_and_complete("Vocabulary document:\n1) apple —— 苹果")

    def test_requests_disable_sdk_retry_and_thinking_with_explicit_limits(self):
        with patch.object(vocab_ai, "DEEPSEEK_API_KEY", "test-key"), patch.object(vocab_ai, "OpenAI") as sdk:
            vocab_ai._get_client()
            self.assertEqual(sdk.call_args.kwargs.get("max_retries"), 0)
            self.assertIn("timeout", sdk.call_args.kwargs)
        client = fake_client()
        with patch.object(vocab_ai, "_get_client", return_value=client):
            vocab_ai.parse_and_complete([source("word")])
        kwargs = client.chat.completions.create.call_args.kwargs
        self.assertEqual(kwargs["extra_body"], {"thinking": {"type": "disabled"}})
        self.assertLessEqual(kwargs["timeout"].read, 60)
        self.assertLessEqual(kwargs["timeout"].connect, 5)
        self.assertLessEqual(kwargs["timeout"].write, 10)
        self.assertLessEqual(kwargs["timeout"].pool, 5)
        self.assertIn("max_tokens", kwargs)
        self.assertIn("temperature", kwargs)

    def test_overlapping_cancelled_jobs_share_global_request_concurrency_limit(self):
        lock = threading.Lock()
        release = threading.Event()
        active = 0
        peak = 0
        def enrich(entries, deadline, cancel_event, aborted):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            try:
                release.wait(1)
                return entries
            finally:
                with lock:
                    active -= 1
        try:
            with patch.object(vocab_ai, "_enrich_batch", side_effect=enrich):
                for job in range(3):
                    with self.assertRaises(TimeoutError):
                        vocab_ai.parse_and_complete([source(f"word{i}") for i in range(8 * 24)],
                                                   deadline=time.monotonic() + 0.03)
            self.assertLessEqual(peak, 8)
        finally:
            release.set()


if __name__ == "__main__":
    unittest.main()
