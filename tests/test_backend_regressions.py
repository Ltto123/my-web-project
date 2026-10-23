"""后端回归：所有数据库均位于临时目录，AI 和模型推理使用替身。"""
import atexit
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["JWT_SECRET_KEY"] = "isolated-regression-test-key-not-for-production"
TEMP = tempfile.TemporaryDirectory(prefix="blog_backend_regressions_")
os.environ["DATABASE_URL"] = "sqlite:///" + Path(TEMP.name, "blog.db").as_posix()
previous_cwd = Path.cwd()
os.chdir(TEMP.name)
try:
    from backend import main, models, schemas, vocab_ai, vocab_routes, herb_routes, herb_model
    from backend.auth import create_access_token
finally:
    os.chdir(previous_cwd)

from fastapi.testclient import TestClient
from sqlalchemy import event, create_engine, inspect, text
from starlette.applications import Starlette
from starlette.routing import Mount


def _cleanup():
    models.engine.dispose()
    TEMP.cleanup()


atexit.register(_cleanup)


class BackendRegressions(unittest.TestCase):
    def setUp(self):
        models.Base.metadata.drop_all(models.engine)
        models.Base.metadata.create_all(models.engine)
        self.db = models.SessionLocal()
        self.alice = models.UserModel(username="alice", email="alice@local", password_hash=main.hash_password("password"))
        self.bob = models.UserModel(username="bob", email="bob@local", password_hash=main.hash_password("password"))
        self.db.add_all([self.alice, self.bob])
        self.db.commit()
        self.headers = {"Authorization": f"Bearer {create_access_token(self.alice.id)}"}
        self.bob_headers = {"Authorization": f"Bearer {create_access_token(self.bob.id)}"}
        self.client = TestClient(main.app, raise_server_exceptions=False)

    def tearDown(self):
        self.client.close()
        self.db.close()

    def make_word(self, owner):
        vset = models.VocabSetModel(name="private", user_id=owner.id, word_count=1, status="completed")
        self.db.add(vset)
        self.db.commit()
        word = models.VocabWordModel(set_id=vset.id, word="private")
        self.db.add(word)
        self.db.commit()
        return vset, word

    def queued_upload(self):
        thread = Mock()
        with patch.object(vocab_routes, "threading", SimpleNamespace(Thread=thread)):
            response = self.client.post("/api/v1/vocab/sets/upload", headers=self.headers,
                                        files={"file": ("words.txt", b"private definition", "text/plain")})
        self.assertEqual(response.json()["code"], 0)
        return response.json()["data"]["set_id"], thread.call_args.kwargs

    def test_post_requires_login(self):
        response = self.client.post("/api/v1/posts", json={"title": "fake", "content": "fake", "author": "Ltto123"})
        self.assertEqual(response.json()["code"], 403)
        self.assertEqual(self.db.query(models.PostModel).count(), 0)

    def test_post_uses_authenticated_author(self):
        response = self.client.post("/api/v1/posts", headers=self.headers,
                                    json={"title": "real", "content": "real", "author": "Ltto123"})
        self.assertEqual(response.json()["code"], 0)
        self.assertEqual(self.db.query(models.PostModel).one().author, "alice")

    def test_password_over_bcrypt_byte_limit_is_validation_error(self):
        for path, username in [("register", "longpassword"), ("login", "alice")]:
            for password in ["x" * 73, "密" * 25]:
                response = self.client.post(f"/api/v1/auth/{path}", json={"username": username, "password": password})
                self.assertEqual(response.status_code, 422)

    def test_foreign_vocab_progress_is_forbidden(self):
        vset, word = self.make_word(self.bob)
        calls = [
            ("post", "/api/v1/vocab/progress", {"word_id": word.id, "stage": 1}),
            ("post", "/api/v1/vocab/progress/spell", {"word_id": word.id}),
            ("get", f"/api/v1/vocab/progress/{vset.id}", None),
            ("post", f"/api/v1/vocab/progress/reset/{vset.id}", None),
        ]
        for method, path, body in calls:
            kwargs = {"headers": self.headers}
            if body is not None:
                kwargs["json"] = body
            response = getattr(self.client, method)(path, **kwargs)
            self.assertEqual(response.json()["code"], 403, path)
        self.assertEqual(self.db.query(models.VocabProgressModel).count(), 0)

    def test_missing_word_is_not_server_error(self):
        for path in ["/api/v1/vocab/progress", "/api/v1/vocab/progress/spell"]:
            response = self.client.post(path, headers=self.headers, json={"word_id": 999999})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["code"], 404)

    def test_progress_rejects_invalid_counters(self):
        _, word = self.make_word(self.alice)
        for invalid in [{"stage": 2}, {"correct_count": -1}, {"wrong_count": -1}]:
            response = self.client.post("/api/v1/vocab/progress", headers=self.headers,
                                        json={"word_id": word.id, **invalid})
            self.assertEqual(response.status_code, 422)

    def test_own_progress_and_cascade_delete(self):
        vset, word = self.make_word(self.alice)
        response = self.client.post("/api/v1/vocab/progress", headers=self.headers,
                                    json={"word_id": word.id, "stage": 1, "correct_count": 2})
        self.assertEqual(response.json()["code"], 0)
        result = self.client.get(f"/api/v1/vocab/progress/{vset.id}", headers=self.headers).json()
        self.assertEqual(result["data"][str(word.id)]["correct_count"], 2)
        self.client.delete(f"/api/v1/vocab/sets/{vset.id}", headers=self.headers)
        self.assertEqual(self.db.query(models.VocabWordModel).count(), 0)
        self.assertEqual(self.db.query(models.VocabProgressModel).count(), 0)

    def test_deleted_job_cannot_write_into_reused_set_id(self):
        set_id, job = self.queued_upload()

        def finish_old_job(_, **kwargs):
            self.db.query(models.VocabSetModel).filter_by(id=set_id).delete()
            self.db.commit()
            self.db.add(models.VocabSetModel(name="bob-new", user_id=self.bob.id, status="processing"))
            self.db.commit()
            self.assertEqual(self.db.query(models.VocabSetModel).one().id, set_id)
            return [{"word": "ALICE_PRIVATE_WORD"}]

        with patch.object(vocab_routes, "parse_and_complete", side_effect=finish_old_job):
            job["target"](*job["args"])
        self.db.expire_all()
        self.assertEqual(self.db.query(models.VocabWordModel).count(), 0)
        self.assertEqual(self.db.query(models.VocabSetModel).one().status, "processing")

    def test_failed_old_job_cannot_change_replacement_set(self):
        set_id, job = self.queued_upload()
        self.db.query(models.VocabSetModel).filter_by(id=set_id).delete()
        self.db.commit()
        self.db.add(models.VocabSetModel(name="alice-new", user_id=self.alice.id, status="processing",
                                         created_at=datetime.now() + timedelta(seconds=1)))
        self.db.commit()
        with patch.object(vocab_routes, "parse_and_complete", side_effect=RuntimeError("old job failed")):
            job["target"](*job["args"])
        self.db.expire_all()
        self.assertEqual(self.db.query(models.VocabSetModel).one().status, "processing")

    def test_single_newline_documents_respect_chunk_bound(self):
        source = "word definition\n" * 2000
        chunks = vocab_ai._split_into_chunks(source)
        self.assertGreater(len(chunks), 1)
        self.assertLessEqual(max(map(len, chunks)), vocab_ai.CHUNK_SIZE)
        self.assertEqual("".join(chunks), source)

    def test_long_single_line_respects_chunk_bound(self):
        source = "x" * 25001
        chunks = vocab_ai._split_into_chunks(source)
        self.assertLessEqual(max(map(len, chunks)), vocab_ai.CHUNK_SIZE)
        self.assertEqual("".join(chunks), source)

    def test_truncated_json_is_rejected(self):
        with self.assertRaises(ValueError):
            vocab_ai._extract_json_from_response('[{"word":"first"},{"word":"sec')

    def test_length_finish_reason_is_not_success(self):
        fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(
            create=lambda **kwargs: SimpleNamespace(choices=[SimpleNamespace(
                message=SimpleNamespace(content='[{"word":"first"}]'), finish_reason="length")]))))
        with patch.object(vocab_ai, "_get_client", return_value=fake):
            with self.assertRaises(RuntimeError):
                vocab_ai._process_chunk(0, "one\ntwo", 1)

    def test_predict_does_not_block_event_loop(self):
        async def run():
            calls = []

            class Upload:
                content_type = "image/png"

                async def read(self, size=-1):
                    return b"image"

            def prediction(*args, **kwargs):
                time.sleep(0.12)
                calls.append("prediction")
                return {"prediction": "test"}

            async def heartbeat():
                await asyncio.sleep(0.02)
                calls.append("heartbeat")

            with patch.object(herb_routes, "predict", side_effect=prediction):
                await asyncio.gather(herb_routes.predict_herb(Upload(), "MobileNetV3-Large", None), heartbeat())
            return calls

        self.assertEqual(asyncio.run(run())[0], "heartbeat")

    def test_image_upload_reads_at_most_limit_plus_one(self):
        sizes = []

        class Upload:
            content_type = "image/png"

            async def read(self, size=-1):
                sizes.append(size)
                return b"x" * (herb_routes.MAX_FILE_SIZE + 1)

        result = asyncio.run(herb_routes.predict_herb(Upload(), "MobileNetV3-Large", None))
        self.assertEqual(result.code, 400)
        self.assertEqual(sizes, [herb_routes.MAX_FILE_SIZE + 1])

    def test_auth_refuses_missing_or_public_default_secret(self):
        for value in ["", "blog-dev-secret-key-change-in-production"]:
            env = os.environ.copy()
            env["JWT_SECRET_KEY"] = value
            result = subprocess.run([sys.executable, "-B", "-c", "import backend.auth"],
                                    cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("JWT_SECRET_KEY", result.stderr)

    def test_general_upload_is_chunked_and_cleans_oversize_partial_file(self):
        class TrackingBuffer(io.BytesIO):
            def read(self, size=-1):
                self.sizes.append(size)
                return super().read(size)

        buffer = TrackingBuffer(b"123456789")
        buffer.sizes = []
        upload = SimpleNamespace(filename="data.bin", file=buffer)
        # 旧实现直接 await read()；保留接口以便明确复现不受限读取。
        async def read(size=-1):
            return buffer.read(size)
        upload.read = read
        with tempfile.TemporaryDirectory(prefix="blog_upload_test_") as directory:
            with patch.object(main, "UPLOADS_DIR", Path(directory)), patch.object(main, "MAX_UPLOAD_SIZE", 8, create=True):
                result = asyncio.run(main.upload_file(upload, SimpleNamespace(username=main.BLOG_OWNER_USERNAME), None))
            self.assertEqual(result.code, 400)
            self.assertNotIn(-1, buffer.sizes)
            self.assertEqual([p for p in Path(directory).rglob("*") if p.is_file()], [])

    def test_parallel_lazy_model_load_builds_only_once(self):
        with tempfile.TemporaryDirectory(prefix="blog_model_test_") as directory:
            Path(directory, "MobileNetV3-Large.pth").write_bytes(b"fixture")
            def build(*args):
                time.sleep(0.06)
                return Mock()
            with patch.object(herb_model, "MODEL_DIR", Path(directory)), \
                 patch.object(herb_model, "_models_cache", {}), \
                 patch.object(herb_model, "get_class_names", return_value=["test"]), \
                 patch.object(herb_model, "_build_model_architecture", side_effect=build) as builder, \
                 patch.object(herb_model.torch, "load", return_value={}):
                with ThreadPoolExecutor(max_workers=2) as pool:
                    results = list(pool.map(lambda _: herb_model.load_model(), range(2)))
                self.assertEqual(builder.call_count, 1)
                self.assertIs(results[0], results[1])

    def test_valid_upload_preserves_bytes(self):
        upload = SimpleNamespace(filename="data.bin", file=io.BytesIO(b"12345678"))
        with tempfile.TemporaryDirectory(prefix="blog_upload_test_") as directory:
            with patch.object(main, "UPLOADS_DIR", Path(directory)), patch.object(main, "MAX_UPLOAD_SIZE", 8):
                result = asyncio.run(main.upload_file(upload, SimpleNamespace(username=main.BLOG_OWNER_USERNAME), None))
            self.assertEqual(result.code, 0)
            stored = [p for p in Path(directory).rglob("*") if p.is_file()]
            self.assertEqual(len(stored), 1)
            self.assertEqual(stored[0].read_bytes(), b"12345678")

    def test_successful_background_job_writes_complete_set(self):
        set_id, job = self.queued_upload()
        with patch.object(vocab_routes, "parse_and_complete", return_value=[{"word": "one"}, {"word": "two"}]):
            job["target"](*job["args"])
        self.db.expire_all()
        vset = self.db.query(models.VocabSetModel).filter_by(id=set_id).one()
        self.assertEqual(vset.status, "completed")
        self.assertEqual(vset.word_count, 2)
        self.assertEqual(self.db.query(models.VocabWordModel).filter_by(set_id=set_id).count(), 2)

    def test_hot_flag_matches_detail_after_like(self):
        post = models.PostModel(title="hot", content="hot", author="alice")
        self.db.add(post)
        self.db.commit()
        changed = self.client.post(f"/api/v1/posts/{post.id}/like", headers=self.headers).json()
        detail = self.client.get(f"/api/v1/posts/{post.id}", headers=self.headers).json()
        self.assertEqual(changed["data"]["is_hot"], detail["data"]["is_hot"])

    def parallel_requests(self, calls, table):
        barrier = threading.Barrier(len(calls))

        def slow_lookup(conn, cursor, statement, parameters, context, executemany):
            # 延长真实查询与写入之间的窗口，稳定复现先查后写的竞争。
            if f"FROM {table}" in statement and "LIMIT" in statement:
                time.sleep(0.025)

        def perform(call):
            path, payload = call
            barrier.wait(timeout=3)
            return self.client.post(path, headers=self.headers, json=payload)

        event.listen(models.engine, "after_cursor_execute", slow_lookup)
        try:
            with ThreadPoolExecutor(max_workers=len(calls)) as pool:
                return list(pool.map(perform, calls))
        finally:
            event.remove(models.engine, "after_cursor_execute", slow_lookup)

    def test_concurrent_toggles_never_violate_unique_constraints(self):
        post = models.PostModel(title="post", content="post", author="alice")
        personal = models.PersonalPostModel(content="personal", author="alice")
        resource = models.ResourceModel(title="resource", file_url="/file", file_name="file", category="其他", author="alice")
        self.db.add_all([post, personal, resource])
        self.db.commit()
        cases = [(f"/api/v1/posts/{post.id}/like", models.LikeModel),
                 (f"/api/v1/personal/{personal.id}/like", models.PersonalLikeModel),
                 (f"/api/v1/resources/{resource.id}/star", models.ResourceStarModel)]
        for path, model in cases:
            with self.subTest(path=path):
                responses = self.parallel_requests([(path, {})] * 6, model.__tablename__)
                self.assertEqual([r.status_code for r in responses], [200] * 6)
                self.assertEqual([r.json()["code"] for r in responses], [0] * 6)
                self.db.expire_all()
                self.assertEqual(self.db.query(model).count(), 0)

    def test_concurrent_progress_and_spell_share_one_row(self):
        _, word = self.make_word(self.alice)
        calls = [("/api/v1/vocab/progress", {"word_id": word.id, "correct_count": i, "wrong_count": i + 1}) for i in [1, 4, 2]]
        calls += [("/api/v1/vocab/progress/spell", {"word_id": word.id})] * 3
        responses = self.parallel_requests(calls, "vocab_progress")
        self.assertEqual([r.status_code for r in responses], [200] * len(calls))
        self.assertEqual([r.json()["code"] for r in responses], [0] * len(calls))
        row = self.db.query(models.VocabProgressModel).one()
        self.assertEqual((row.correct_count, row.wrong_count, row.spelling_passed), (4, 5, 1))

    def test_stale_tab_cannot_lower_review_counters(self):
        _, word = self.make_word(self.alice)
        for correct, wrong in [(8, 6), (1, 2)]:
            response = self.client.post("/api/v1/vocab/progress", headers=self.headers,
                                        json={"word_id": word.id, "stage": 1, "correct_count": correct, "wrong_count": wrong})
            self.assertEqual(response.json()["code"], 0)
        row = self.db.query(models.VocabProgressModel).one()
        self.assertEqual((row.correct_count, row.wrong_count), (8, 6))

    def test_background_job_capacity_rejects_without_creating_set(self):
        slots = threading.BoundedSemaphore(2)
        fake_thread = Mock()
        with patch.object(vocab_routes, "_job_slots", slots, create=True), \
             patch.object(vocab_routes, "threading", SimpleNamespace(Thread=fake_thread)):
            responses = [self.client.post("/api/v1/vocab/sets/upload", headers=self.headers,
                                          files={"file": ("words.txt", b"word definition", "text/plain")}).json()
                         for _ in range(3)]
        self.assertEqual([r["code"] for r in responses], [0, 0, 429])
        self.assertEqual(fake_thread.call_count, 2)
        self.assertEqual(self.db.query(models.VocabSetModel).count(), 2)

    def test_expired_processing_job_is_recovered_without_touching_live_worker(self):
        now = datetime.now(timezone.utc)
        expired = models.VocabSetModel(name="expired", user_id=self.alice.id, status="processing", created_at=now - timedelta(hours=2))
        live = models.VocabSetModel(name="other-worker", user_id=self.alice.id, status="processing", created_at=now - timedelta(hours=2))
        expired.processing_expires_at = now - timedelta(seconds=1)
        live.processing_expires_at = now + timedelta(minutes=5)
        self.db.add_all([expired, live])
        self.db.commit()
        response = self.client.get("/api/v1/vocab/sets", headers=self.headers).json()
        states = {row["name"]: row["status"] for row in response["data"]}
        self.assertEqual(states, {"expired": "error", "other-worker": "processing"})
        detail = self.client.get(f"/api/v1/vocab/sets/{expired.id}/status", headers=self.headers).json()
        self.assertTrue(detail["data"]["error_message"])

    def test_configured_database_url_is_used(self):
        env = os.environ.copy()
        target = Path(TEMP.name, "configured.db")
        env["DATABASE_URL"] = "sqlite:///" + target.as_posix()
        result = subprocess.run([sys.executable, "-B", "-c", "from backend.models import engine; print(engine.url.database)"],
                                cwd=TEMP.name, env={**env, "PYTHONPATH": str(ROOT)}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(result.stdout.strip()), target)

    def test_lease_maintenance_extends_live_job_and_stops_after_completion(self):
        now = datetime.now(timezone.utc)
        vset = models.VocabSetModel(name="lease", user_id=self.alice.id, status="processing", created_at=now,
                                    processing_expires_at=now + timedelta(seconds=2))
        self.db.add(vset)
        self.db.commit()
        identity = (vset.id, self.alice.id, vset.created_at)
        stop = Mock()
        stop.wait.side_effect = [False, True]
        vocab_routes._maintain_job_lease(stop, *identity)
        self.db.expire_all()
        remaining = vset.processing_expires_at.replace(tzinfo=timezone.utc) - now
        self.assertGreater(remaining.total_seconds(), 60)
        vset.status = "completed"
        vset.processing_expires_at = None
        self.db.commit()
        self.assertFalse(vocab_routes._renew_job_lease(*identity))

    def test_worker_failure_releases_capacity(self):
        slots = threading.BoundedSemaphore(1)
        with patch.object(vocab_routes, "_job_slots", slots):
            set_id, job = self.queued_upload()
            self.assertFalse(slots.acquire(blocking=False))
            with patch.object(vocab_routes, "parse_and_complete", side_effect=RuntimeError("test failure")):
                job["target"](*job["args"])
            self.assertTrue(slots.acquire(blocking=False))
        self.db.expire_all()
        vset = self.db.query(models.VocabSetModel).filter_by(id=set_id).one()
        self.assertEqual(vset.status, "error")
        self.assertIsNone(vset.processing_expires_at)

    def test_thread_start_failure_releases_capacity_and_marks_error(self):
        slots = threading.BoundedSemaphore(1)
        fake_thread = Mock()
        fake_thread.return_value.start.side_effect = RuntimeError("thread unavailable")
        with patch.object(vocab_routes, "_job_slots", slots), \
             patch.object(vocab_routes, "threading", SimpleNamespace(Thread=fake_thread)):
            response = self.client.post("/api/v1/vocab/sets/upload", headers=self.headers,
                                        files={"file": ("words.txt", b"word definition", "text/plain")}).json()
        self.assertEqual(response["code"], 503)
        self.assertTrue(slots.acquire(blocking=False))
        self.assertEqual(self.db.query(models.VocabSetModel).one().status, "error")

    def test_parallel_workers_apply_lease_migration_once(self):
        with tempfile.TemporaryDirectory(prefix="blog_migration_test_") as directory:
            engine = create_engine("sqlite:///" + Path(directory, "migration.db").as_posix())
            try:
                with engine.begin() as conn:
                    conn.execute(text("CREATE TABLE vocab_sets (id INTEGER PRIMARY KEY, status VARCHAR(20), error_message TEXT)"))

                def slow_schema_read(conn, cursor, statement, parameters, context, executemany):
                    if "table_xinfo" in statement:
                        time.sleep(0.04)

                event.listen(engine, "after_cursor_execute", slow_schema_read)
                with patch.object(main, "engine", engine):
                    with ThreadPoolExecutor(max_workers=2) as pool:
                        results = list(pool.map(lambda _: main._ensure_vocab_set_status_columns(), range(2)))
                self.assertEqual(results, [None, None])
                self.assertIn("processing_expires_at", {c["name"] for c in inspect(engine).get_columns("vocab_sets")})
            finally:
                engine.dispose()

    @contextmanager
    def uploaded_fixture_client(self):
        upload_mount = next(route for route in main.app.routes if getattr(route, "name", None) == "uploads")
        with tempfile.TemporaryDirectory(prefix="blog_upload_headers_") as directory:
            fixture_dir = Path(directory)
            fixtures = {
                "fixture.html": b'<!doctype html><script>window.reviewExecuted=true</script>',
                "fixture.svg": b'<svg xmlns="http://www.w3.org/2000/svg"><script>window.reviewExecuted=true</script></svg>',
                "fixture.png": b'\x89PNG\r\n\x1a\nimage fixture',
                "fixture.pdf": b'%PDF-1.7\nPDF range fixture\n%%EOF',
            }
            for filename, contents in fixtures.items():
                (fixture_dir / filename).write_bytes(contents)
            app = Starlette(routes=[Mount("/uploads", app=type(upload_mount.app)(directory=directory))])
            with TestClient(app) as client:
                yield client, fixtures

    def assert_upload_security_headers(self, response):
        self.assertEqual(response.headers.get("content-security-policy"), "sandbox")
        self.assertEqual(response.headers.get("x-content-type-options"), "nosniff")

    def test_direct_uploaded_documents_and_images_have_sandbox_headers(self):
        with self.uploaded_fixture_client() as (client, fixtures):
            for filename, contents in fixtures.items():
                with self.subTest(filename=filename):
                    response = client.get(f"/uploads/{filename}")
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.content, contents)
                    self.assert_upload_security_headers(response)
            self.assertTrue(client.get("/uploads/fixture.png").headers["content-type"].startswith("image/png"))
            self.assertTrue(client.get("/uploads/fixture.pdf").headers["content-type"].startswith("application/pdf"))

    def test_cached_uploads_keep_sandbox_on_not_modified(self):
        with self.uploaded_fixture_client() as (client, fixtures):
            original = client.get("/uploads/fixture.html")
            cached = client.get("/uploads/fixture.html", headers={"If-None-Match": original.headers["etag"]})
            self.assertEqual(cached.status_code, 304)
            self.assert_upload_security_headers(cached)

    def test_pdf_range_responses_preserve_bytes_and_security_headers(self):
        with self.uploaded_fixture_client() as (client, fixtures):
            response = client.get("/uploads/fixture.pdf", headers={"Range": "bytes=0-7"})
            self.assertEqual(response.status_code, 206)
            self.assertEqual(response.content, fixtures["fixture.pdf"][:8])
            self.assertTrue(response.headers["content-range"].startswith("bytes 0-7/"))
            self.assert_upload_security_headers(response)


if __name__ == "__main__":
    unittest.main()
