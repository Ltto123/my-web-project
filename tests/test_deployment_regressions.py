"""部署与 SQLite 升级回归；所有 Docker/SSH 操作均为本地 mock。"""
from contextlib import closing, redirect_stdout
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent.parent


def load_script(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ENTRY = load_script("deployment_entrypoint_tests", "docker-entrypoint.py")
UPGRADE = load_script("deployment_upgrade_tests", "docker-upgrade.py")


class SQLiteDeploymentTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="blog-deployment-regression-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def create_wal_database(self):
        source = self.root / "old-container" / "blog.db"
        source.parent.mkdir()
        connection = sqlite3.connect(source)
        self.addCleanup(connection.close)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA wal_autocheckpoint=0")
        connection.executescript(
            "CREATE TABLE parents(id INTEGER PRIMARY KEY, label TEXT);"
            "CREATE TABLE children(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id));"
        )
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        connection.execute("INSERT INTO parents VALUES(1, 'committed in WAL')")
        connection.execute("INSERT INTO children VALUES(1, 1)")
        connection.commit()
        self.assertGreater(Path(str(source) + "-wal").stat().st_size, 0)
        return source

    def digest(self, path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def test_explicit_backup_preserves_committed_wal_and_original_files(self):
        source = self.create_wal_database()
        wal = Path(str(source) + "-wal")
        before = self.digest(source), self.digest(wal)
        target = self.root / "data" / "blog.db"
        self.assertTrue(ENTRY.migrate_legacy_database(source, target))
        self.assertEqual(before, (self.digest(source), self.digest(wal)))
        with closing(sqlite3.connect(target)) as connection:
            self.assertEqual(connection.execute("SELECT label FROM parents").fetchone(), ("committed in WAL",))
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(connection.execute("PRAGMA journal_mode=WAL").fetchone(), ("wal",))
            connection.execute("PRAGMA foreign_keys=ON")
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute("INSERT INTO children VALUES(2, 999)")
        self.assertFalse(list(target.parent.glob(".blog-migration-*")))

    def test_unknown_legacy_is_rejected_even_when_host_file_looks_valid(self):
        complete = self.create_wal_database()
        legacy = self.root / "host-blog.db"
        # 模拟旧单文件 bind：宿主有主文件，却没有旧容器中的已提交 WAL。
        shutil.copyfile(complete, legacy)
        with closing(sqlite3.connect(legacy)) as partial:
            self.assertEqual(partial.execute("SELECT COUNT(*) FROM parents").fetchone(), (0,))
        target = self.root / "data" / "blog.db"
        package = ModuleType("sqlalchemy")
        engine = ModuleType("sqlalchemy.engine")
        engine.make_url = lambda value: SimpleNamespace(
            database=str(target), query={}, get_backend_name=lambda: "sqlite"
        )
        with patch.dict(sys.modules, {"sqlalchemy": package, "sqlalchemy.engine": engine}), \
                patch.dict(os.environ, {"LEGACY_DATABASE_PATH": str(legacy)}), \
                patch.object(ENTRY.os, "execvp") as execute:
            with self.assertRaisesRegex(RuntimeError, "docker-upgrade"):
                ENTRY.main()
            execute.assert_not_called()
        self.assertFalse(target.exists())

    def test_existing_target_is_not_replaced(self):
        source = self.create_wal_database()
        target = self.root / "existing.db"
        with closing(sqlite3.connect(target)) as connection:
            connection.execute("CREATE TABLE original(id INTEGER)")
        before = self.digest(target)
        self.assertFalse(ENTRY.migrate_legacy_database(source, target))
        self.assertEqual(before, self.digest(target))
        with patch.object(UPGRADE, "docker_command") as docker:
            self.assertFalse(UPGRADE.upgrade_database(target))
            docker.assert_not_called()

    def test_failure_does_not_publish_partial_database(self):
        source = self.root / "broken.db"
        source.write_bytes(b"not a SQLite database")
        target = self.root / "data" / "blog.db"
        with self.assertRaises(RuntimeError):
            ENTRY.migrate_legacy_database(source, target)
        self.assertFalse(target.exists())
        self.assertFalse(list(target.parent.glob(".blog-migration-*")))
        source = self.create_wal_database()
        with patch.object(ENTRY.sqlite3, "connect", side_effect=sqlite3.OperationalError("readonly WAL")):
            with self.assertRaises(RuntimeError):
                ENTRY.migrate_legacy_database(source, target)
        self.assertFalse(target.exists())
        with patch.object(ENTRY.os, "link", side_effect=PermissionError("publication denied")):
            with self.assertRaises(RuntimeError):
                ENTRY.migrate_legacy_database(source, target)
        self.assertFalse(target.exists())
        self.assertFalse(list(target.parent.glob(".blog-migration-*")))

    def test_concurrent_publisher_is_never_overwritten(self):
        source = self.create_wal_database()
        target = self.root / "data" / "blog.db"
        original_link = os.link

        def another_publisher(temporary, destination):
            with closing(sqlite3.connect(destination)) as connection:
                connection.execute("CREATE TABLE winner(id INTEGER)")
                connection.execute("INSERT INTO winner VALUES(42)")
                connection.commit()
            return original_link(temporary, destination)

        with patch.object(ENTRY.os, "link", side_effect=another_publisher):
            self.assertFalse(ENTRY.migrate_legacy_database(source, target))
        with closing(sqlite3.connect(target)) as connection:
            self.assertEqual(connection.execute("SELECT id FROM winner").fetchone(), (42,))
        self.assertFalse(list(target.parent.glob(".blog-migration-*")))

    def test_orphan_wal_is_not_treated_as_empty_first_start(self):
        source = self.root / "missing.db"
        target = self.root / "data" / "blog.db"
        self.assertFalse(ENTRY.migrate_legacy_database(source, target))
        self.assertFalse(target.exists())
        Path(str(source) + "-wal").write_bytes(b"orphan WAL fixture")
        with self.assertRaisesRegex(RuntimeError, "WAL/SHM"):
            ENTRY.migrate_legacy_database(source, target)

    def test_stopped_container_copy_includes_wal_before_atomic_publish(self):
        source = self.create_wal_database()
        target = self.root / "data" / "blog.db"
        commands = []
        running = True

        def docker(arguments):
            nonlocal running
            commands.append(arguments)
            if arguments[0] == "compose":
                return "old-blog"
            if arguments[0] == "inspect":
                return "true" if running else "false"
            if arguments[0] == "stop":
                running = False
                return "old-blog"
            if arguments[0] == "cp":
                self.assertFalse(running, "copied database before container stopped")
                remote = arguments[1].split(":", 1)[1]
                fixture = source if remote.endswith("blog.db") else Path(str(source) + "-wal")
                shutil.copyfile(fixture, arguments[2])
                return ""
            self.fail(f"Unexpected Docker operation: {arguments[0]}")

        with patch.object(UPGRADE, "docker_command", side_effect=docker):
            self.assertTrue(UPGRADE.upgrade_database(target, stop_old=True))
        with closing(sqlite3.connect(target)) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM parents").fetchone(), (1,))
        self.assertEqual([command[0] for command in commands], ["compose", "inspect", "stop", "inspect", "cp", "cp"])
        self.assertTrue(commands[-1][1].endswith("blog.db-wal"))
        self.assertFalse(list(target.parent.glob(".docker-upgrade-*")))

    def test_running_or_unconfirmed_container_is_not_copied(self):
        target = self.root / "data" / "blog.db"
        with patch.object(UPGRADE, "docker_command", return_value="true") as docker:
            with self.assertRaisesRegex(RuntimeError, "stop-old"):
                UPGRADE.upgrade_database(target, container="old-blog")
            self.assertEqual(docker.call_count, 1)
        with patch.object(UPGRADE, "docker_command", return_value="true") as docker:
            with self.assertRaisesRegex(RuntimeError, "未停止"):
                UPGRADE.upgrade_database(target, container="old-blog", stop_old=True)
            self.assertFalse(any(call.args[0][0] == "cp" for call in docker.call_args_list))
        self.assertFalse(target.exists())

    def test_no_container_never_falls_back_to_host_database(self):
        target = self.root / "data" / "blog.db"
        with patch.object(UPGRADE, "docker_command", return_value=""):
            with self.assertRaisesRegex(RuntimeError, "source"):
                UPGRADE.upgrade_database(target)
        self.assertFalse(target.exists())

    def test_wal_absence_requires_explicit_docker_not_found(self):
        target = self.root / "blog.db-wal"
        missing = UPGRADE.DockerCommandError("Error: Could not find the file /app/blog.db-wal in container old-blog")
        with patch.object(UPGRADE, "docker_command", side_effect=missing):
            self.assertFalse(UPGRADE.copy_container_wal("old-blog", "/app/blog.db-wal", target))
        denied = UPGRADE.DockerCommandError("permission denied")
        with patch.object(UPGRADE, "docker_command", side_effect=denied):
            with self.assertRaisesRegex(RuntimeError, "WAL"):
                UPGRADE.copy_container_wal("old-blog", "/app/blog.db-wal", target)


class JWTDeploymentPreflightTests(unittest.TestCase):
    def setUp(self):
        self.script = (ROOT / "deploy.sh").read_text(encoding="utf-8")
        self.preflight = self.script.split("<<'BLOG_JWT_CHECK'\n", 1)[1].split("\nBLOG_JWT_CHECK", 1)[0]

    def test_jwt_preflight_rejects_missing_empty_or_public_secret_without_logging_value(self):
        dotenv = ModuleType("dotenv")
        for secret in (None, "", "   ", "blog-dev-secret-key-change-in-production"):
            dotenv.dotenv_values = lambda path, value=secret: {"JWT_SECRET_KEY": value}
            with patch.dict(sys.modules, {"dotenv": dotenv}), redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(SystemExit):
                    exec(self.preflight, {})
            self.assertEqual(output.getvalue(), "")
        dotenv.dotenv_values = lambda path: {"JWT_SECRET_KEY": "private-test-value-never-logged"}
        with patch.dict(sys.modules, {"dotenv": dotenv}), redirect_stdout(io.StringIO()) as output:
            exec(self.preflight, {})
        self.assertEqual(output.getvalue(), "")

    def test_failed_preflight_prevents_upload_and_restart(self):
        git_bash = Path(r"C:\Program Files\Git\bin\bash.exe")
        bash = str(git_bash) if git_bash.exists() else shutil.which("bash")
        if not bash:
            self.skipTest("Bash unavailable")
        with tempfile.TemporaryDirectory(prefix="deployment-ssh-mock-") as directory:
            root = Path(directory)
            (root / "backend").mkdir()
            (root / "backend" / "main.py").write_text("pass\n")
            (root / "bin").mkdir()
            shutil.copyfile(ROOT / "deploy.sh", root / "deploy.sh")
            mock = """#!/usr/bin/env bash
printf '%s\\n' "${!#}" >> "$DEPLOY_LOG"
if [[ "${!#}" == '/opt/blog/.venv/bin/python -' ]]; then
    cat > "$DEPLOY_PREFLIGHT"
    exit 17
fi
exit 99
"""
            ssh = root / "bin" / "ssh"
            ssh.write_text(mock, encoding="utf-8", newline="\n")
            ssh.chmod(0o700)

            def shell_path(path):
                value = path.resolve().as_posix()
                return "/" + value[0].lower() + value[2:] if os.name == "nt" else value

            environment = dict(os.environ, DEPLOY_LOG=shell_path(root / "commands.log"), DEPLOY_PREFLIGHT=shell_path(root / "preflight.py"))
            result = subprocess.run(
                [bash, "--noprofile", "--norc", "-c", 'export PATH="$1:/usr/bin:$PATH"; shift; exec bash "$@"',
                 "deployment-mock", shell_path(root / "bin"), shell_path(root / "deploy.sh"), "-b"],
                env=environment, capture_output=True,
            )
            self.assertEqual(result.returncode, 17)
            self.assertEqual((root / "commands.log").read_text().splitlines(), ["/opt/blog/.venv/bin/python -"])
            self.assertNotIn("部署完成".encode(), result.stdout)


if __name__ == "__main__":
    unittest.main()
