"""停止并保留旧容器，从完整 DB/WAL 升级 SQLite 持久化目录。"""
import argparse
from pathlib import Path
import runpy
import subprocess
import tempfile

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONTAINER_DATABASE = "/app/blog.db"


class DockerCommandError(RuntimeError):
    def __init__(self, stderr):
        self.stderr = stderr
        super().__init__(f"Docker 操作失败：{stderr.strip()}")


def docker_command(arguments):
    """参数直接传给 Docker，不通过 shell 拼接或执行。"""
    try:
        result = subprocess.run(
            ["docker", *arguments], cwd=PROJECT_ROOT, check=True,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
    except FileNotFoundError as error:
        raise RuntimeError("找不到 Docker 命令；不会回退读取宿主机旧库") from error
    except subprocess.CalledProcessError as error:
        raise DockerCommandError(error.stderr) from error
    return result.stdout.strip()


def find_old_container():
    found = docker_command(["compose", "ps", "--all", "--quiet", "blog"]).splitlines()
    if len(found) != 1:
        raise RuntimeError(
            "未找到唯一的旧 blog 容器；请用 --container 指定旧容器。"
            "若数据来自完整宿主目录，使用 --source 显式指定，工具不会自动猜测。"
        )
    return found[0]


def copy_container_wal(container, remote_path, local_path):
    """只接受 Docker 明确返回文件不存在；其他失败不能当成没有 WAL。"""
    try:
        docker_command(["cp", f"{container}:{remote_path}", str(local_path)])
    except DockerCommandError as error:
        expected = f"Could not find the file {remote_path} in container {container}"
        if expected in error.stderr:
            return False
        raise RuntimeError("不能确认旧容器 WAL 是否可读，已停止迁移") from error
    return True


def upgrade_database(target: Path, source: Path | None = None, container: str | None = None, stop_old=False):
    """旧容器必须停止后才拷贝 DB/WAL；仅显式 source 允许使用本地来源。"""
    migrate = runpy.run_path(str(Path(__file__).with_name("docker-entrypoint.py")))["migrate_legacy_database"]
    if target.is_symlink() or (target.exists() and not target.is_file()):
        raise RuntimeError("目标数据库路径必须是普通文件")
    if target.exists():
        print("目标数据库已存在，已保留；未执行导出或覆盖。")
        return False
    if source is not None:
        if not source.is_file():
            raise RuntimeError("显式指定的源数据库文件不存在")
        return migrate(source, target)

    container = container or find_old_container()
    state = docker_command(["inspect", "--format", "{{.State.Running}}", container])
    if state == "true":
        if not stop_old:
            raise RuntimeError("旧容器仍在运行；请使用 --stop-old 停止写入后再升级")
        docker_command(["stop", container])
    elif state != "false":
        raise RuntimeError("无法确认旧容器状态，已停止迁移")
    if docker_command(["inspect", "--format", "{{.State.Running}}", container]) != "false":
        raise RuntimeError("旧容器未停止，不能安全拷贝数据库与 WAL")

    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".docker-upgrade-", dir=target.parent) as temporary:
        local_source = Path(temporary) / "blog.db"
        docker_command(["cp", f"{container}:{CONTAINER_DATABASE}", str(local_source)])
        copy_container_wal(container, CONTAINER_DATABASE + "-wal", Path(str(local_source) + "-wal"))
        # 不复制 SHM：临时目录可写，SQLite 会从完整 WAL 重建索引。
        migrated = migrate(local_source, target)
    print("旧容器已停止并保留；数据库来源文件未修改。")
    return migrated


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="先停止旧 blog 容器，再导出 DB/WAL 到新数据目录；绝不自动猜测宿主来源。",
        epilog="容器模式使用 --stop-old；显式本地来源使用 --source PATH --maintenance。成功后运行 docker compose up -d。",
    )
    origin = parser.add_mutually_exclusive_group()
    origin.add_argument("--source", type=Path, help="明确包含全部 WAL 的实际 SQLite 文件路径")
    origin.add_argument("--container", help="明确指定旧容器的名称或 ID")
    parser.add_argument("--target", type=Path, default=PROJECT_ROOT / "data" / "blog.db")
    parser.add_argument("--stop-old", action="store_true", help="允许停止并保留旧容器，消除导出期间的写入")
    parser.add_argument("--maintenance", action="store_true", help="本地 source 模式确认源服务停写，且保持停写直到切换完成")
    args = parser.parse_args(argv)
    if args.source is not None and not args.maintenance:
        parser.error("本地来源须先停写，并使用 --source PATH --maintenance 明确确认完整来源")
    if upgrade_database(args.target.resolve(), args.source.resolve() if args.source else None, args.container, args.stop_old):
        print("完整数据库快照已安全发布。请运行 docker compose up -d 完成切换。")


if __name__ == "__main__":
    main()
