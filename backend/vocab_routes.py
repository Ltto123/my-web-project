"""
不背单词 API 路由 — 单词集管理 + 文件上传解析 + 学习进度
"""
from datetime import datetime, timezone
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

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
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "word_count": s.word_count,
        "user_id": s.user_id,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "progress_pct": progress_pct,
    }


# ═══════════════ 单词集管理 ═══════════════


@router.get("/sets", response_model=schemas.HttpResponseSchema)
def list_vocab_sets(
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(models.get_db),
):
    """获取所有单词集列表"""
    sets = db.query(models.VocabSetModel).order_by(models.VocabSetModel.id.desc()).all()
    result = []
    for s in sets:
        pct = 0
        if current_user and s.word_count > 0:
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
    db: Session = Depends(models.get_db),
):
    """获取单词集详情（含所有单词）"""
    vset = db.query(models.VocabSetModel).filter(models.VocabSetModel.id == set_id).first()
    if not vset:
        return schemas.HttpResponseSchema(code=404, msg="单词集不存在", data=None)

    words = db.query(models.VocabWordModel).filter(
        models.VocabWordModel.set_id == set_id
    ).order_by(models.VocabWordModel.sort_order).all()

    return schemas.HttpResponseSchema(code=0, msg="success", data={
        **_serialize_set(vset),
        "words": [_serialize_word(w) for w in words],
    })


@router.post("/sets/upload", response_model=schemas.HttpResponseSchema)
async def upload_vocab_set(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(models.get_db),
):
    """上传单词文件，通过 DeepSeek 解析并创建单词集"""
    # Auth check
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)

    # Validate file
    if not file.filename:
        return schemas.HttpResponseSchema(code=400, msg="请选择文件", data=None)

    contents = await file.read()
    if not contents:
        return schemas.HttpResponseSchema(code=400, msg="文件为空", data=None)

    if len(contents) > MAX_FILE_SIZE:
        return schemas.HttpResponseSchema(code=400, msg="文件大小不能超过 5MB", data=None)

    # Try to decode as text — don't reject, just pass everything to DeepSeek
    for encoding in ["utf-8", "gbk"]:
        try:
            file_text = contents.decode(encoding)
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    else:
        # Binary file (e.g. PDF) — extract readable text as best-effort
        file_text = contents.decode("utf-8", errors="replace")

    # Call DeepSeek to parse and complete
    try:
        words_data = parse_and_complete(file_text)
    except ValueError as e:
        return schemas.HttpResponseSchema(code=400, msg=str(e), data=None)
    except Exception as e:
        return schemas.HttpResponseSchema(code=500, msg=f"AI 解析失败: {e}", data=None)

    if not words_data:
        return schemas.HttpResponseSchema(code=400, msg="未能从文件中解析出任何单词，请检查文件内容", data=None)

    # Create vocab set
    set_name = name or Path(file.filename).stem
    vset = models.VocabSetModel(
        name=set_name,
        description=f"由 {current_user.username} 上传，共 {len(words_data)} 词",
        word_count=len(words_data),
        user_id=current_user.id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(vset)
    db.flush()  # get vset.id

    # Create word entries
    for wd in words_data:
        word_entry = models.VocabWordModel(
            set_id=vset.id,
            word=wd["word"],
            pos=wd.get("pos"),
            def_en=wd.get("def_en"),
            def_zh=wd.get("def_zh"),
            example_en=wd.get("example_en"),
            example_zh=wd.get("example_zh"),
            is_phrase=wd.get("is_phrase", 0),
            sort_order=wd.get("sort_order", 0),
        )
        db.add(word_entry)

    db.commit()
    db.refresh(vset)

    return schemas.HttpResponseSchema(code=0, msg="上传成功", data={
        "set": _serialize_set(vset),
        "word_count": len(words_data),
        "ai_parsed": True,
    })


@router.delete("/sets/{set_id}", response_model=schemas.HttpResponseSchema)
def delete_vocab_set(
    set_id: int,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(models.get_db),
):
    """删除单词集（仅上传者或博主）"""
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)

    vset = db.query(models.VocabSetModel).filter(models.VocabSetModel.id == set_id).first()
    if not vset:
        return schemas.HttpResponseSchema(code=404, msg="单词集不存在", data=None)

    if not _is_owner(current_user) and vset.user_id != current_user.id:
        return schemas.HttpResponseSchema(code=403, msg="无权删除此单词集", data=None)

    db.delete(vset)
    db.commit()
    return schemas.HttpResponseSchema(code=0, msg="删除成功", data=None)


# ═══════════════ 学习进度 ═══════════════


@router.get("/progress/{set_id}", response_model=schemas.HttpResponseSchema)
def get_progress(
    set_id: int,
    current_user: Optional[models.UserModel] = Depends(get_current_user),
    db: Session = Depends(models.get_db),
):
    """获取用户在指定单词集的学习进度"""
    if not current_user:
        return schemas.HttpResponseSchema(code=403, msg="请先登录", data=None)

    word_ids = db.query(models.VocabWordModel.id).filter(
        models.VocabWordModel.set_id == set_id
    ).subquery()

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

    import time
    now = int(time.time() * 1000)

    existing = db.query(models.VocabProgressModel).filter(
        models.VocabProgressModel.user_id == current_user.id,
        models.VocabProgressModel.word_id == body.word_id,
    ).first()

    if existing:
        existing.stage = body.stage
        existing.correct_count = body.correct_count
        existing.wrong_count = body.wrong_count
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

    word_ids = db.query(models.VocabWordModel.id).filter(
        models.VocabWordModel.set_id == set_id
    ).subquery()

    db.query(models.VocabProgressModel).filter(
        models.VocabProgressModel.user_id == current_user.id,
        models.VocabProgressModel.word_id.in_(word_ids),
    ).delete(synchronize_session=False)

    db.commit()
    return schemas.HttpResponseSchema(code=0, msg="进度已重置", data=None)
