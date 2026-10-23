"""容器入口与显式 SQLite 备份工具；来源不明的旧库禁止自动迁移。"""
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import time


def migrate_legacy_database(source: Path, target: Path) -> bool:
    """将包含已提交 WAL 的一致快照发布到目标，返回是否完成了迁移。"""
    if target.is_symlink():
        raise RuntimeError("目标数据库不能是符号链接")
    if target.exists():
        if not target.is_file():
            raise RuntimeError("目标数据库路径不是文件")
        return False
    if source.is_symlink():
        raise RuntimeError("旧数据库不能是符号链接")
    if not source.exists():
        if any(Path(str(source) + suffix).exists() for suffix in ("-wal", "-shm")):
            raise RuntimeError("旧数据库主文件缺失但存在 WAL/SHM，已停止创建空库")
        target.parent.mkdir(parents=True, exist_ok=True)
        return False
    if not source.is_file():
        raise RuntimeError("旧数据库路径不是文件，请检查原 blog.db 挂载")

    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".blog-migration-", suffix=".db", dir=target.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    started = time.monotonic()

    def check_backup_progress(status, remaining, total):
        if time.monotonic() - started > 120:
            raise TimeoutError("读取旧数据库超过 120 秒，请确认没有长期占用的事务")

    try:
        # mode=ro 仍通过 SQLite 读取已提交 WAL；不能使用会忽略 WAL 的 immutable。
        source_uri = source.resolve().as_uri() + "?mode=ro"
        with closing(sqlite3.connect(source_uri, uri=True, timeout=30)) as original:
            with closing(sqlite3.connect(temporary)) as backup:
                original.execute("PRAGMA query_only=ON")
                original.backup(backup, pages=1024, progress=check_backup_progress, sleep=0.1)
                # 发布时只需要完整主文件，运行后由 ORM 统一开启 WAL 与 foreign_keys。
                backup.execute("PRAGMA journal_mode=DELETE")
                if backup.execute("PRAGMA quick_check").fetchone() != ("ok",):
                    raise RuntimeError("旧数据库完整性检查失败，已停止迁移")
        with temporary.open("r+b") as completed:
            os.fsync(completed.fileno())
        try:
            # 同目录硬链接是原子且不覆盖的发布；并发启动只能有一个发布者。
            os.link(temporary, target)
        except FileExistsError:
            return False
        return True
    except (sqlite3.Error, OSError) as error:
        raise RuntimeError("旧数据库或 WAL 无法安全迁移；原文件已保留，目标未被覆盖") from error
    finally:
        # closing 在异常期间同样释放句柄；只清理本次生成的临时文件。
        for suffix in ("", "-wal", "-shm", "-journal"):
            Path(str(temporary) + suffix).unlink(missing_ok=True)


def main():
    from sqlalchemy.engine import make_url

    database_url = make_url(os.environ.get("DATABASE_URL", "").strip() or "sqlite:///./blog.db")
    if database_url.get_backend_name() == "sqlite" and database_url.database not in (None, "", ":memory:"):
        if database_url.query:
            raise RuntimeError("自动迁移不支持带查询参数的 SQLite 地址")
        target = Path(database_url.database).resolve()
        source = Path(os.environ.get("LEGACY_DATABASE_PATH", "/legacy/blog.db"))
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise RuntimeError("目标数据库路径必须是普通文件")
        legacy_exists = source.exists() or source.is_symlink() or any(
            Path(str(source) + suffix).exists() for suffix in ("-wal", "-shm")
        )
        if not target.exists() and legacy_exists:
            raise RuntimeError(
                "检测到旧数据库，旧容器的 WAL 可能不在宿主目录，已阻止自动迁移。"
                "请先运行 python scripts/docker-upgrade.py --stop-old，"
                "它会停止并保留旧容器、导出完整数据库，完成后再启动新容器。"
                "只有来源明确且已停写的完整数据库才可使用 --source 配合 --maintenance。"
            )
        target.parent.mkdir(parents=True, exist_ok=True)
    command = sys.argv[1:]
    if not command:
        raise RuntimeError("没有提供容器启动命令")
    os.execvp(command[0], command)


if __name__ == "__main__":
    main()
