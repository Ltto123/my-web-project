"""
不背单词 API 路由 — 单词集管理 + 文件上传解析 + 学习进度
"""
import threading
import time
import logging
import re as _re
from datetime import datetime, timezone, timedelta
import io
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, Depends
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session
from sqlalchemy import text, or_, and_

from backend.auth import get_current_user
from backend.vocab_ai import parse_and_complete
import backend.models as models
import backend.schemas as schemas

BLOG_OWNER = os.getenv("BLOG_OWNER_USERNAME", "").strip()


def _is_owner(user) -> bool:
    if not BLOG_OWNER or not user:
        return False
    return user.username == BLOG_OWNER

router = APIRouter(prefix="/api/v1/vocab", tags=["vocab"])

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB
MAX_BACKGROUND_JOBS = 2
JOB_LEASE_SECONDS = 120
LEASE_RENEW_INTERVAL = 30
LEGACY_JOB_TIMEOUT_SECONDS = 3600
_job_slots = threading.BoundedSemaphore(MAX_BACKGROUND_JOBS)
JOB_TIMEOUT_SECONDS = 300
logger = logging.getLogger(__name__)


def recover_expired_vocab_jobs(db: Session):
    """只回收失效租约；另一进程仍在续租的任务不会被本进程启动误伤。"""
    now = datetime.now(timezone.utc)
    stale = or_(
        models.VocabSetModel.processing_expires_at <= now,
        models.VocabSetModel.processing_deadline_at <= now,
        and_(
            models.VocabSetModel.processing_expires_at.is_(None),
            models.VocabSetModel.created_at <= now - timedelta(seconds=LEGACY_JOB_TIMEOUT_SECONDS),
        ),
    )
    changed = db.query(models.VocabSetModel).filter(
        models.VocabSetModel.status == "processing", stale,
    ).update({
        models.VocabSetModel.status: "error",
        models.VocabSetModel.error_message: "解析任务已中断或超时，请重新上传文件",
        models.VocabSetModel.description: "解析已中断",
        models.VocabSetModel.processing_expires_at: None,
        models.VocabSetModel.parse_stage: "error",
        models.VocabSetModel.processing_finished_at: now,
        models.VocabSetModel.progress_message: "任务已中断或达到 5 分钟时限，请重新上传重试",
    }, synchronize_session=False)
    db.commit()
    return changed


def _renew_job_lease(set_id: int, user_id: int, created_at: datetime) -> bool:
    now = datetime.now(timezone.utc)
    with models.SessionLocal() as db:
        changed = db.query(models.VocabSetModel).filter(
            models.VocabSetModel.id == set_id,
            models.VocabSetModel.user_id == user_id,
            models.VocabSetModel.created_at == created_at,
            models.VocabSetModel.status == "processing",
            models.VocabSetModel.processing_expires_at > now,
            or_(models.VocabSetModel.processing_deadline_at.is_(None),
                models.VocabSetModel.processing_deadline_at > now),
        ).update({
            models.VocabSetModel.processing_expires_at: now + timedelta(seconds=JOB_LEASE_SECONDS),
        }, synchronize_session=False)
        db.commit()
        return bool(changed)


def _maintain_job_lease(stop, set_id: int, user_id: int, created_at: datetime, cancel_event=None):
    while not stop.wait(LEASE_RENEW_INTERVAL):
        try:
            if not _renew_job_lease(set_id, user_id, created_at):
                if cancel_event is not None:
                    cancel_event.set()
                return
        except Exception:
            # 短暂数据库占用允许下一次续租；持续故障由过期回收处理。
            continue


def _extract_text_pdf(contents: bytes) -> str:
    """PDF 文本提取"""
    from PyPDF2 import PdfReader
    reader = PdfReader(io.BytesIO(contents))
    pages = []
    for page in reader.pages:
        t = page.extract_text()
        if t and t.strip():
            pages.append(t)
    if not pages:
        raise ValueError("PDF 中未提取到文字内容，请确认 PDF 包含文字而非扫描图片")
    return "\n\n".join(pages)


def _extract_text_docx(contents: bytes) -> str:
    """Word (.docx) 文本提取"""
    from docx import Document
    doc = Document(io.BytesIO(contents))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    if not paragraphs:
        raise ValueError("Word 文档中未提取到文字内容")
    return "\n\n".join(paragraphs)


def _extract_text_xlsx(contents: bytes) -> str:
    """Excel (.xlsx/.xls) 文本提取 — 逐行逐列拼接"""
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(contents), read_only=True, data_only=True)
    from backend.vocab_input import MAX_SHEET_ROWS, MAX_SHEET_COLUMNS
    rows = []
    chars = 0
    try:
        for ws in wb.worksheets:
            if (ws.max_row or 0) > MAX_SHEET_ROWS or (ws.max_column or 0) > MAX_SHEET_COLUMNS:
                raise ValueError("Excel 工作表范围过大，请移除空白格式或拆分文件")
            for number, row in enumerate(ws.iter_rows(values_only=True), 1):
                if number > MAX_SHEET_ROWS or len(row) > MAX_SHEET_COLUMNS:
                    raise ValueError("Excel 工作表范围过大，请拆分文件")
                cells = [str(c).strip() for c in row if c is not None and str(c).strip()]
                if cells:
                    value = "\t".join(cells)
                    chars += len(value)
                    if chars > 1_000_000:
                        raise ValueError("Excel 文字内容过多，请拆分文件")
                    rows.append(value)
    finally:
        wb.close()
    if not rows:
        raise ValueError("Excel 文件中未提取到文字内容")
    return "\n".join(rows)


def _extract_text_html(contents: bytes) -> str:
    """HTML 文本提取 — 去标签、去脚本、去样式"""
    text = contents.decode("utf-8", errors="replace")
    # Remove script/style blocks
    text = _re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', text, flags=_re.DOTALL | _re.IGNORECASE)
    # Remove HTML tags
    text = _re.sub(r'<[^>]+>', ' ', text)
    # Collapse whitespace
    text = _re.sub(r'\s+', ' ', text).strip()
    if not text:
        raise ValueError("HTML 文件中未提取到文字内容")
    return text


def _extract_text_plain(contents: bytes) -> str:
    """纯文本文件 — 自动检测编码"""
    for encoding in ["utf-8", "gbk", "latin-1"]:
        try:
            return contents.decode(encoding)
        except (UnicodeDecodeError, UnicodeError):
            continue
    # Last resort
    return contents.decode("utf-8", errors="replace")


# ── 格式分发映射 ──
_EXTRACTORS = {
    ".pdf": _extract_text_pdf,
    ".docx": _extract_text_docx,
    ".xlsx": _extract_text_xlsx,
    ".html": _extract_text_html,
    ".htm": _extract_text_html,
}


def _extract_text(contents: bytes, filename: str) -> str:
    """从任意格式文件提取文本，自动选择合适的解析器"""
    ext = Path(filename).suffix.lower()

    extractor = _EXTRACTORS.get(ext)
    if extractor is not None:
        return extractor(contents)

    # 未识别的格式 → 尝试当成纯文本
    return _extract_text_plain(contents)


def _serialize_word(w: models.VocabWordModel) -> dict:
    return {
        "id": w.id,
        "word": w.word,
        "pos": w.pos,
        "def_en": w.def_en,
        "def_zh": w.def_zh,
        "example_en": w.example_en,
        "example_zh": w.example_zh,
        "is_phrase": w.is_phrase,
        "sort_order": w.sort_order,
    }


def _serialize_set(s: models.VocabSetModel, progress_pct: float = 0) -> dict:
    status = getattr(s, "status", "completed") or "completed"
    started = s.created_at
    finished = getattr(s, "processing_finished_at", None)
    # 旧记录没有完成时间，不能把几个月前的创建时间误报为解析耗时。
    elapsed = None
    if started and (status == "processing" or finished):
        end = finished or datetime.now(timezone.utc)
        elapsed = max(0, int((end.replace(tzinfo=timezone.utc) - started.replace(tzinfo=timezone.utc)).total_seconds()))
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "word_count": s.word_count,
        "user_id": s.user_id,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "progress_pct": progress_pct,
        "status": status,
        "parse_stage": s.parse_stage or ("queued" if status == "processing" else status),
        "parse_progress_pct": (100 if status == "completed" else s.parse_progress_pct or 0),
        "parse_stage_progress_pct": (100 if status == "completed" else s.parse_stage_progress_pct or 0),
        "processed_words": s.processed_words or (s.word_count if status == "completed" else 0),
        "total_words": s.total_words or (s.word_count if status == "completed" else 0),
        "completed_batches": s.completed_batches or 0,
        "total_batches": s.total_batches or 0,
        "elapsed_seconds": elapsed,
        "error_message": s.error_message,
        "progress_message": s.progress_message,
    }


def _active_job(db, set_id, user_id, created_at):
    """创建时间是作业身份的一部分，避免 SQLite 复用 ID 后串写。"""
    return db.query(models.VocabSetModel).filter(
        models.VocabSetModel.id == set_id,
        models.VocabSetModel.user_id == user_id,
        models.VocabSetModel.created_at == created_at,
        models.VocabSetModel.status == "processing",
    )


def _update_job_progress(set_id, user_id, created_at, event):
    now = datetime.now(timezone.utc)
    with models.SessionLocal() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        job = _active_job(db, set_id, user_id, created_at).filter(
            models.VocabSetModel.processing_expires_at > now,
            models.VocabSetModel.processing_deadline_at > now,
        ).first()
        if job is None:
            raise RuntimeError("解析任务已取消、过期或被删除")
        job.parse_stage = event['stage']
        job.parse_stage_progress_pct = min(100, max(0, int(event.get('stage_progress_percent', event.get('progress_percent', 0)))))
        job.progress_message = event.get('message', '')
        for field in ('processed_words', 'total_words', 'completed_batches', 'total_batches'):
            if field in event:
                setattr(job, field, max(0, int(event[field])))
        if 'progress_percent' in event:
            job.parse_progress_pct = max(job.parse_progress_pct or 0, min(100, max(0, int(event['progress_percent']))))
        db.commit()


def _prepare_vocab_input(contents: bytes, filename: str):
    """Excel 优先保留字段结构，其他材料进入文本识别流程。"""
    if Path(filename).suffix.lower() == '.xlsx':
        from backend.vocab_input import extract_xlsx_entries
        entries = extract_xlsx_entries(contents)
        if entries is not None:
            if not entries:
                raise ValueError("Excel 文件中没有可解析的单词")
            return entries
    content = _extract_text(contents, filename)
    if not content.strip():
        raise ValueError("文件中没有可解析的文字")
    if len(content) > 1_000_000:
        raise ValueError("材料文字过多，请拆分后上传（每份不超过 100 万字符）")
    return content


# ═══════════════ 单词集管理 ═══════════════


@router.get("/sets", response_model=schemas.HttpResponseSchema)
def list_vocab_sets(
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(models.get_db),
):
    """获取当前用户的单词集列表（只能看到自己上传的）"""
    if not current_user:
        return schemas.HttpResponseSchema(code=0, msg="success", data=[])
    recover_expired_vocab_jobs(db)
    sets = db.query(models.VocabSetModel).filter(
        models.VocabSetModel.user_id == current_user.id
    ).order_by(models.VocabSetModel.id.desc()).all()
    result = []
    for s in sets:
        pct = 0
        if s.word_count > 0:
            learned = db.query(models.VocabProgressModel).filter(
                models.VocabProgressModel.user_id == current_user.id,
                models.VocabProgressModel.word_id.in_(
                    db.query(models.VocabWordModel.id).filter(models.VocabWordModel.set_id == s.id)
                ),
                models.VocabProgressModel.stage >= 1,
            ).count()
            pct = round(learned / s.word_count * 100, 1)
        result.append(_serialize_set(s, pct))
    return schemas.HttpResponseSchema(code=0, msg="success", data=result)


@router.get("/sets/{set_id}", response_model=schemas.HttpResponseSchema)
def get_vocab_set(
    set_id: int,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(models.get_db),
):
    """获取单词集详情（仅上传者本人可查看）"""
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)

    vset = db.query(models.VocabSetModel).filter(models.VocabSetModel.id == set_id).first()
    if not vset:
        return schemas.HttpResponseSchema(code=404, msg="单词集不存在", data=None)
    if vset.user_id != current_user.id:
        return schemas.HttpResponseSchema(code=403, msg="无权查看此单词集", data=None)

    words = db.query(models.VocabWordModel).filter(
        models.VocabWordModel.set_id == set_id
    ).order_by(models.VocabWordModel.sort_order).all()

    return schemas.HttpResponseSchema(code=0, msg="success", data={
        **_serialize_set(vset),
        "words": [_serialize_word(w) for w in words],
    })


def _process_vocab_async(set_id: int, contents: bytes, filename: str, user_id: int, created_at: datetime):
    """后台执行读取、整理、AI 补全、校验及一次性提交。"""
    db = models.SessionLocal()
    stop_lease = threading.Event()
    cancelled = threading.Event()
    lease_thread = None
    elapsed = max(0, (datetime.now(timezone.utc) - created_at.replace(tzinfo=timezone.utc)).total_seconds())
    deadline = time.monotonic() + max(0, JOB_TIMEOUT_SECONDS - elapsed)

    def report(event):
        if cancelled.is_set() or time.monotonic() >= deadline:
            raise TimeoutError("解析达到 5 分钟时限或任务已取消，请重新上传重试")
        _update_job_progress(set_id, user_id, created_at, event)

    try:
        if not _renew_job_lease(set_id, user_id, created_at):
            return
        lease_thread = threading.Thread(target=_maintain_job_lease,
                                        args=(stop_lease, set_id, user_id, created_at, cancelled), daemon=True)
        lease_thread.start()
        report({'stage': 'extracting', 'message': '正在读取文件内容'})
        source = _prepare_vocab_input(contents, filename)
        report({'stage': 'identifying', 'message': '正在整理词条与合并不同义项'})
        # 给最终校验和数据库提交留出时间；AI 层自行执行有界重试和取消。
        words_data = parse_and_complete(source, progress_callback=report,
                                        deadline=deadline - 5, cancel_event=cancelled)
        if not words_data:
            raise ValueError("未能从文件中解析出任何单词，请检查文件内容")
        report({'stage': 'saving', 'message': '校验通过，正在保存词集',
                'processed_words': len(words_data), 'total_words': len(words_data), 'progress_percent': 100})
        db.execute(text("BEGIN IMMEDIATE"))
        now = datetime.now(timezone.utc)
        vset = _active_job(db, set_id, user_id, created_at).filter(
            models.VocabSetModel.processing_expires_at > now,
            models.VocabSetModel.processing_deadline_at > now,
        ).first()
        if not vset:
            return
        for index, wd in enumerate(words_data):
            db.add(models.VocabWordModel(
                set_id=vset.id, word=wd['word'], pos=wd.get('pos'), def_en=wd.get('def_en'),
                def_zh=wd.get('def_zh'), example_en=wd.get('example_en'), example_zh=wd.get('example_zh'),
                is_phrase=wd.get('is_phrase', 0), sort_order=index,
            ))
        vset.word_count = len(words_data)
        vset.status = 'completed'
        vset.parse_stage = 'completed'
        vset.parse_progress_pct = 100
        vset.processed_words = len(words_data)
        vset.total_words = len(words_data)
        vset.description = f"由用户上传，共 {len(words_data)} 词"
        vset.progress_message = '词集已准备好，可以开始学习'
        vset.error_message = None
        vset.processing_expires_at = None
        vset.processing_finished_at = datetime.now(timezone.utc)
        db.commit()
        logger.info("vocab import completed set=%s words=%s", set_id, len(words_data))
    except Exception as exc:
        cancelled.set()
        # 不回传 API 密钥、请求正文或模型原始输出。
        message = str(exc)[:500]
        from backend.vocab_ai import DEEPSEEK_API_KEY
        if DEEPSEEK_API_KEY:
            message = message.replace(DEEPSEEK_API_KEY, '[redacted]')
        logger.warning("vocab import failed set=%s type=%s", set_id, type(exc).__name__)
        try:
            db.rollback()
            db.execute(text("BEGIN IMMEDIATE"))
            vset = _active_job(db, set_id, user_id, created_at).first()
            if vset:
                vset.status = 'error'
                vset.parse_stage = 'error'
                vset.error_message = message
                vset.description = '解析出错'
                vset.progress_message = message
                vset.processing_expires_at = None
                vset.processing_finished_at = datetime.now(timezone.utc)
                db.commit()
        except Exception:
            logger.exception("could not persist vocab failure set=%s", set_id)
    finally:
        stop_lease.set()
        db.close()
        if lease_thread is not None and lease_thread.is_alive():
            lease_thread.join(timeout=1)
        _job_slots.release()


@router.post("/sets/upload", response_model=schemas.HttpResponseSchema)
async def upload_vocab_set(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(models.get_db),
):
    """上传单词文件，立即返回，AI 在后台线程异步解析"""
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)

    if not file.filename:
        return schemas.HttpResponseSchema(code=400, msg="请选择文件", data=None)

    contents = await file.read(MAX_FILE_SIZE + 1)
    if not contents:
        return schemas.HttpResponseSchema(code=400, msg="文件为空", data=None)

    if len(contents) > MAX_FILE_SIZE:
        return schemas.HttpResponseSchema(code=400, msg="文件大小不能超过 5MB", data=None)

    if not _job_slots.acquire(blocking=False):
        return schemas.HttpResponseSchema(code=429, msg="解析任务繁忙，请等待当前任务完成后再上传", data=None)

    # Create vocab set immediately with "processing" status
    set_name = name or Path(file.filename).stem
    vset = models.VocabSetModel(
        name=set_name,
        description="已接收文件，等待读取",
        word_count=0,
        user_id=current_user.id,
        created_at=datetime.now(timezone.utc),
        status="processing",
        processing_expires_at=datetime.now(timezone.utc) + timedelta(seconds=JOB_LEASE_SECONDS),
        processing_deadline_at=datetime.now(timezone.utc) + timedelta(seconds=JOB_TIMEOUT_SECONDS),
        parse_stage="queued",
        progress_message="已接收文件，等待读取",
    )
    try:
        db.add(vset)
        db.commit()
        db.refresh(vset)
        thread = threading.Thread(
            target=_process_vocab_async,
            args=(vset.id, contents, file.filename, current_user.id, vset.created_at),
            daemon=True,
        )
        thread.start()
    except Exception:
        _job_slots.release()
        db.rollback()
        if vset.id is not None:
            db.query(models.VocabSetModel).filter(
                models.VocabSetModel.id == vset.id,
                models.VocabSetModel.created_at == vset.created_at,
            ).update({
                models.VocabSetModel.status: "error",
                models.VocabSetModel.error_message: "无法启动解析任务，请稍后重新上传",
                models.VocabSetModel.parse_stage: "error",
                models.VocabSetModel.processing_finished_at: datetime.now(timezone.utc),
                models.VocabSetModel.processing_expires_at: None,
            }, synchronize_session=False)
            db.commit()
        return schemas.HttpResponseSchema(code=503, msg="无法启动解析任务，请稍后重试", data=None)

    return schemas.HttpResponseSchema(code=0, msg="上传成功，AI 正在后台解析", data={
        **_serialize_set(vset),
        "set_id": vset.id,
    })


@router.get("/sets/{set_id}/status", response_model=schemas.HttpResponseSchema)
def get_set_status(
    set_id: int,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(models.get_db),
):
    """轮询单词集的 AI 解析状态（仅上传者本人可查询）"""
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)

    recover_expired_vocab_jobs(db)
    vset = db.query(models.VocabSetModel).filter(models.VocabSetModel.id == set_id).first()
    if not vset:
        return schemas.HttpResponseSchema(code=404, msg="单词集不存在", data=None)
    if vset.user_id != current_user.id:
        return schemas.HttpResponseSchema(code=403, msg="无权查看此单词集", data=None)

    return schemas.HttpResponseSchema(code=0, msg="success", data=_serialize_set(vset))


@router.delete("/sets/{set_id}", response_model=schemas.HttpResponseSchema)
def delete_vocab_set(
    set_id: int,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(models.get_db),
):
    """删除单词集（仅上传者或博主）"""
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)

    models.begin_serialized_write(db)
    vset = db.query(models.VocabSetModel).filter(models.VocabSetModel.id == set_id).first()
    if not vset:
        return schemas.HttpResponseSchema(code=404, msg="单词集不存在", data=None)

    if not _is_owner(current_user) and vset.user_id != current_user.id:
        return schemas.HttpResponseSchema(code=403, msg="无权删除此单词集", data=None)

    db.delete(vset)
    db.commit()
    return schemas.HttpResponseSchema(code=0, msg="删除成功", data=None)


# ═══════════════ 学习进度 ═══════════════


def _check_set_access(db: Session, set_id: int, user_id: int):
    vset = db.query(models.VocabSetModel).filter(models.VocabSetModel.id == set_id).first()
    if not vset:
        return schemas.HttpResponseSchema(code=404, msg="单词集不存在", data=None)
    if vset.user_id != user_id:
        return schemas.HttpResponseSchema(code=403, msg="无权访问此单词集", data=None)
    return None


def _check_word_access(db: Session, word_id: int, user_id: int):
    word = db.query(models.VocabWordModel).filter(models.VocabWordModel.id == word_id).first()
    if not word:
        return schemas.HttpResponseSchema(code=404, msg="单词不存在", data=None)
    return _check_set_access(db, word.set_id, user_id)


@router.get("/progress/{set_id}", response_model=schemas.HttpResponseSchema)
def get_progress(
    set_id: int,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(models.get_db),
):
    """获取用户在指定单词集的学习进度"""
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)

    error = _check_set_access(db, set_id, current_user.id)
    if error:
        return error

    word_ids = db.query(models.VocabWordModel.id).filter(
        models.VocabWordModel.set_id == set_id
    )

    rows = db.query(models.VocabProgressModel).filter(
        models.VocabProgressModel.user_id == current_user.id,
        models.VocabProgressModel.word_id.in_(word_ids),
    ).all()

    progress_map = {}
    for r in rows:
        progress_map[r.word_id] = {
            "word_id": r.word_id,
            "stage": r.stage,
            "correct_count": r.correct_count,
            "wrong_count": r.wrong_count,
            "spelling_passed": bool(r.spelling_passed),
            "last_reviewed": r.last_reviewed,
        }

    return schemas.HttpResponseSchema(code=0, msg="success", data=progress_map)


@router.post("/progress", response_model=schemas.HttpResponseSchema)
def update_progress(
    body: schemas.VocabProgressUpdate,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(models.get_db),
):
    """更新单个单词的学习进度"""
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)

    models.begin_serialized_write(db)
    error = _check_word_access(db, body.word_id, current_user.id)
    if error:
        return error

    import time
    now = int(time.time() * 1000)

    existing = db.query(models.VocabProgressModel).filter(
        models.VocabProgressModel.user_id == current_user.id,
        models.VocabProgressModel.word_id == body.word_id,
    ).first()

    if existing:
        existing.stage = body.stage
        existing.correct_count = max(existing.correct_count, body.correct_count)
        existing.wrong_count = max(existing.wrong_count, body.wrong_count)
        existing.last_reviewed = now
    else:
        db.add(models.VocabProgressModel(
            user_id=current_user.id,
            word_id=body.word_id,
            stage=body.stage,
            correct_count=body.correct_count,
            wrong_count=body.wrong_count,
            last_reviewed=now,
        ))

    db.commit()
    return schemas.HttpResponseSchema(code=0, msg="success", data=None)


@router.post("/progress/spell", response_model=schemas.HttpResponseSchema)
def mark_spelling(
    body: schemas.VocabSpellUpdate,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(models.get_db),
):
    """标记单词拼写通过"""
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)

    models.begin_serialized_write(db)
    error = _check_word_access(db, body.word_id, current_user.id)
    if error:
        return error

    existing = db.query(models.VocabProgressModel).filter(
        models.VocabProgressModel.user_id == current_user.id,
        models.VocabProgressModel.word_id == body.word_id,
    ).first()

    if existing:
        existing.spelling_passed = 1
    else:
        db.add(models.VocabProgressModel(
            user_id=current_user.id,
            word_id=body.word_id,
            spelling_passed=1,
        ))

    db.commit()
    return schemas.HttpResponseSchema(code=0, msg="success", data=None)


@router.post("/progress/reset/{set_id}", response_model=schemas.HttpResponseSchema)
def reset_progress(
    set_id: int,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(models.get_db),
):
    """重置用户在指定单词集的所有学习进度"""
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)

    models.begin_serialized_write(db)
    error = _check_set_access(db, set_id, current_user.id)
    if error:
        return error

    word_ids = db.query(models.VocabWordModel.id).filter(
        models.VocabWordModel.set_id == set_id
    )

    db.query(models.VocabProgressModel).filter(
        models.VocabProgressModel.user_id == current_user.id,
        models.VocabProgressModel.word_id.in_(word_ids),
    ).delete(synchronize_session=False)

    db.commit()
    return schemas.HttpResponseSchema(code=0, msg="进度已重置", data=None)
