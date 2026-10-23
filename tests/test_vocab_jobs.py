"""导入任务阶段、真实进度与截止时间；所有数据在临时库内。"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import threading
import unittest
from unittest.mock import Mock, patch

import test_backend_regressions as regression
from test_backend_regressions import models, vocab_routes


class VocabJobTests(unittest.TestCase):
    setUp = regression.BackendRegressions.setUp
    tearDown = regression.BackendRegressions.tearDown
    queued_upload = regression.BackendRegressions.queued_upload

    def test_upload_returns_before_document_extraction(self):
        slots = threading.BoundedSemaphore(1)
        with patch.object(vocab_routes, '_job_slots', slots), patch.object(vocab_routes, '_extract_text') as extract:
            set_id, job = self.queued_upload()
            extract.assert_not_called()
            state = self.client.get(f'/api/v1/vocab/sets/{set_id}/status', headers=self.headers).json()['data']
            self.assertEqual(state['parse_stage'], 'queued')
            self.assertEqual(state['parse_progress_pct'], 0)
            self.assertEqual(state['total_words'], 0)
            self.assertEqual(state['status'], 'processing')
            slots.release()

    def test_progress_is_persisted_and_available_on_list_and_status(self):
        slots = threading.BoundedSemaphore(1)
        with patch.object(vocab_routes, '_job_slots', slots):
            set_id, job = self.queued_upload()
            def parse(source, progress_callback=None, **kwargs):
                progress_callback(dict(stage='enriching', processed_words=1, total_words=2,
                                       completed_batches=1, total_batches=2, progress_percent=50,
                                       message='AI 已完成 1/2 词'))
                for endpoint in ['/api/v1/vocab/sets', f'/api/v1/vocab/sets/{set_id}/status']:
                    data = self.client.get(endpoint, headers=self.headers).json()['data']
                    state = data[0] if isinstance(data, list) else data
                    self.assertEqual(state['parse_stage'], 'enriching')
                    self.assertEqual(state['parse_progress_pct'], 50)
                    self.assertEqual(state['processed_words'], 1)
                    self.assertEqual(state['word_count'], 0)
                    self.assertEqual(state['total_words'], 2)
                return [{'word': 'one'}, {'word': 'two'}]
            with patch.object(vocab_routes, 'parse_and_complete', side_effect=parse):
                job['target'](*job['args'])
            self.db.expire_all()
            result = self.client.get(f'/api/v1/vocab/sets/{set_id}/status', headers=self.headers).json()['data']
            self.assertEqual(result['parse_stage'], 'completed')
            self.assertEqual(result['parse_progress_pct'], 100)
            self.assertEqual(result['processed_words'], 2)
            self.assertEqual(result['word_count'], 2)
            self.assertTrue(slots.acquire(blocking=False))

    def test_deadline_expires_even_with_live_lease(self):
        now = datetime.now(timezone.utc)
        job = models.VocabSetModel(name='timeout', user_id=self.alice.id, status='processing',
                                  created_at=now - timedelta(minutes=6),
                                  processing_deadline_at=now - timedelta(seconds=1),
                                  processing_expires_at=now + timedelta(minutes=2),
                                  parse_stage='enriching', processed_words=12, total_words=100,
                                  parse_progress_pct=12)
        self.db.add(job)
        self.db.commit()
        data = self.client.get(f'/api/v1/vocab/sets/{job.id}/status', headers=self.headers).json()['data']
        self.assertEqual(data['status'], 'error')
        self.assertEqual(data['parse_stage'], 'error')
        self.assertEqual(data['parse_progress_pct'], 12)
        self.assertIn('超时', data['error_message'])
        self.assertEqual(self.db.query(models.VocabWordModel).count(), 0)

    def test_progress_cannot_update_deleted_reused_id(self):
        slots = threading.BoundedSemaphore(1)
        with patch.object(vocab_routes, '_job_slots', slots):
            set_id, job = self.queued_upload()
            def parse(source, progress_callback=None, **kwargs):
                self.db.query(models.VocabSetModel).filter_by(id=set_id).delete()
                self.db.commit()
                self.db.add(models.VocabSetModel(name='replacement', user_id=self.bob.id, status='processing',
                                                created_at=datetime.now(timezone.utc), parse_stage='queued'))
                self.db.commit()
                progress_callback(dict(stage='enriching', processed_words=1, total_words=2,
                                       completed_batches=1,total_batches=2,progress_percent=50,message='private'))
                return [{'word': 'private'}]
            with patch.object(vocab_routes, 'parse_and_complete', side_effect=parse):
                job['target'](*job['args'])
            self.db.expire_all()
            replacement = self.db.query(models.VocabSetModel).one()
            self.assertEqual(replacement.name, 'replacement')
            self.assertEqual(replacement.parse_stage, 'queued')
            self.assertEqual(self.db.query(models.VocabWordModel).count(), 0)

    def test_background_extraction_error_is_visible_and_releases_capacity(self):
        slots = threading.BoundedSemaphore(1)
        with patch.object(vocab_routes, '_job_slots', slots):
            set_id, job = self.queued_upload()
            with patch.object(vocab_routes, '_extract_text', side_effect=ValueError('文件内容无法读取')):
                job['target'](*job['args'])
            data = self.client.get(f'/api/v1/vocab/sets/{set_id}/status', headers=self.headers).json()['data']
            self.assertEqual(data['status'], 'error')
            self.assertIn('文件内容无法读取', data['error_message'])
            self.assertTrue(slots.acquire(blocking=False))


if __name__ == '__main__':
    unittest.main()
