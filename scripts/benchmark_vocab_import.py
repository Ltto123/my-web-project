"""用真实材料验证导入耗时、进度和词条覆盖率；临时库自动清理。

运行：python scripts/benchmark_vocab_import.py path/to/words.xlsx
使用 .env 的 DeepSeek 配置，会实际调用付费 API。
"""
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def run(source: Path, report_path: Path):
    from dotenv import load_dotenv
    load_dotenv(ROOT / '.env')
    scratch = ROOT / '.tmp'
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='vocab_benchmark_', dir=scratch) as temp:
        os.environ['DATABASE_URL'] = 'sqlite:///' + Path(temp, 'benchmark.db').as_posix()
        os.environ['JWT_SECRET_KEY'] = 'isolated-vocab-benchmark-not-production'
        from backend import main, models
        from backend.vocab_input import extract_xlsx_entries
        from fastapi.testclient import TestClient
        expected = extract_xlsx_entries(source.read_bytes())
        assert expected is not None, '此覆盖率基准需要带单词表头的 XLSX'
        client = TestClient(main.app)
        set_id = None
        samples = []
        result = None
        try:
            credentials = {'username': 'test_vocab_runner', 'password': 'benchmark-local-only-123'}
            registration = client.post('/api/v1/auth/register', json=credentials).json()
            assert registration.get('code') == 0, registration
            login = client.post('/api/v1/auth/login', json=credentials).json()
            token = login['data'].get('access_token') or login['data'].get('token')
            assert token, '登录未返回令牌'
            headers = {'Authorization': 'Bearer ' + token}
            start = time.monotonic()
            with source.open('rb') as stream:
                response = client.post('/api/v1/vocab/sets/upload', headers=headers,
                                       files={'file': (source.name, stream,
                                               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}).json()
            assert response['code'] == 0, response
            set_id = response['data']['set_id']
            last = None
            last_print = 0
            while time.monotonic() - start < 315:
                response = client.get(f'/api/v1/vocab/sets/{set_id}/status', headers=headers).json()
                assert response['code'] == 0, response
                state = response['data']
                elapsed = round(time.monotonic() - start, 2)
                sample = {key: state.get(key) for key in ['status', 'parse_stage', 'parse_progress_pct',
                        'processed_words', 'total_words', 'completed_batches', 'total_batches', 'error_message']}
                sample['elapsed'] = elapsed
                marker = (sample['status'], sample['parse_stage'], sample['parse_progress_pct'])
                if marker != last or elapsed - last_print >= 10:
                    print(json.dumps(sample, ensure_ascii=False), flush=True)
                    samples.append(sample)
                    last, last_print = marker, elapsed
                if state['status'] in ('completed', 'error'):
                    break
                time.sleep(1)
            assert state['status'] == 'completed', state.get('error_message') or '任务未按时完成'
            words = client.get(f'/api/v1/vocab/sets/{set_id}', headers=headers).json()['data']['words']
            by_word = {word['word'].casefold(): word for word in words}
            assert len(by_word) == len(words) == len(expected), '词条总数/去重/覆盖率不一致'
            for original in expected:
                word = by_word[original['word'].casefold()]
                assert word['def_zh'] == original['def_zh'], f"原始释义改变: {original['word']}"
                for key in ['pos', 'def_en', 'def_zh', 'example_en', 'example_zh']:
                    assert isinstance(word.get(key), str) and word[key].strip(), f'{key} 未补全'
            assert elapsed < 300, f'超过 5 分钟: {elapsed}s'
            result = {'success': True, 'unique_words': len(words), 'elapsed_seconds': elapsed,
                      'source_definitions_preserved': True, 'coverage_percent': 100, 'progress_samples': samples}
        except Exception as exc:
            result = {'success': False, 'error': str(exc), 'progress_samples': samples}
            raise
        finally:
            if set_id is not None:
                deleted = client.delete(f'/api/v1/vocab/sets/{set_id}', headers=headers).json()
                assert deleted['code'] == 0, deleted
            with models.SessionLocal() as db:
                assert db.query(models.VocabWordModel).count() == 0, '级联删除未清理测试词条'
                db.query(models.UserModel).filter_by(username='test_vocab_runner').delete()
                db.commit()
                assert db.query(models.UserModel).count() == 0
            client.close()
            models.engine.dispose()
            if result is not None:
                report_path.parent.mkdir(parents=True, exist_ok=True)
                report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            print('临时测试词集、词条、用户已清理。', flush=True)
        print(json.dumps({key: value for key, value in result.items() if key != 'progress_samples'}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--report', type=Path, default=ROOT / '.tmp' / 'vocab-benchmark.json')
    args = parser.parse_args()
    run(args.source.resolve(), args.report.resolve())
