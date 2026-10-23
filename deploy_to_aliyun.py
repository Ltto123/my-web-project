"""阿里云首次部署工具。仅在主动运行本脚本时连接服务器。"""
import getpass
import os
from pathlib import Path
import shlex
import tarfile
import tempfile
import uuid

import paramiko

HOST = "106.14.218.12"
USER = "root"
PROJECT_DIR = "/opt/blog"
VENV_DIR = f"{PROJECT_DIR}/.venv"
SSH_KEY = os.path.expanduser("~/.ssh/id_ed25519")
DEPLOY_ITEMS = ("backend", "frontend", "requirements.txt")

# 这段代码在服务器生成随机值，命令与日志都不包含生成后的密钥。
ENV_UPDATE_SCRIPT = r'''
import os
from pathlib import Path
import secrets
import sys
from dotenv import dotenv_values, set_key

path = Path(sys.argv[1])
if path.is_symlink():
    raise RuntimeError(".env 不能是符号链接")
fd = os.open(path, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
os.close(fd)
os.chmod(path, 0o600)
values = dotenv_values(path)
secret = (values.get("JWT_SECRET_KEY") or "").strip()
if secret == "blog-dev-secret-key-change-in-production":
    raise RuntimeError("服务器仍使用公开示例 JWT 密钥，请先更换后再部署")
if not secret:
    set_key(path, "JWT_SECRET_KEY", secrets.token_urlsafe(48))
if not (values.get("BLOG_OWNER_USERNAME") or "").strip():
    set_key(path, "BLOG_OWNER_USERNAME", "Ltto123")
os.chmod(path, 0o600)
print("环境配置已检查；现有值已保留，缺失项已补全。")
'''


def ssh_connect():
    """只接受 known_hosts 中已核验的主机，密码输入不回显。"""
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    options = dict(hostname=HOST, username=USER, timeout=30,
                   banner_timeout=30, auth_timeout=30)
    try:
        try:
            client.connect(**options, key_filename=SSH_KEY if os.path.isfile(SSH_KEY) else None)
        except paramiko.AuthenticationException:
            password = os.environ.get("ALIYUN_PASSWORD") or getpass.getpass("请输入 root 密码: ")
            client.connect(**options, password=password, look_for_keys=False, allow_agent=False)
        return client
    except Exception:
        client.close()
        raise


def run_cmd(client, cmd, desc="远程命令"):
    """合并读取输出，任何失败立即终止；不回显命令内容。"""
    print(f"[{desc}]")
    transport = client.get_transport()
    if transport is None or not transport.is_active():
        raise RuntimeError("SSH 连接已断开")
    with transport.open_session(timeout=30) as channel:
        channel.set_combine_stderr(True)
        channel.exec_command(cmd)
        output = channel.makefile("rb", -1).read().decode("utf-8", errors="replace")
        exit_code = channel.recv_exit_status()
    if output.strip():
        print(output.strip())
    if exit_code:
        raise RuntimeError(f"{desc}失败，退出码 {exit_code}")
    return output


def upload_file(client, local_path, remote_path):
    with client.open_sftp() as sftp:
        sftp.put(str(local_path), remote_path)
    print(f"已上传运行时代码包：{remote_path}")


def archive_filter(member):
    """部署包只含运行时代码，递归剔除隐藏文件、缓存、链接和数据库。"""
    parts = Path(member.name).parts
    if any(part.startswith(".") or part == "__pycache__" for part in parts):
        return None
    if member.issym() or member.islnk():
        raise ValueError(f"不打包符号链接：{member.name}")
    if member.name.endswith((".pyc", ".pyo", ".db", ".db-wal", ".db-shm",
                             ".sqlite", ".sqlite3", ".sqlite-wal", ".sqlite-shm",
                             ".sqlite3-wal", ".sqlite3-shm")):
        return None
    return member


def build_archive(local_project, archive_path):
    """白名单避免将本地 .env、blog.db、uploads 或测试数据覆盖到服务器。"""
    with tarfile.open(archive_path, "w:gz") as archive:
        for name in DEPLOY_ITEMS:
            source = local_project / name
            if not source.exists():
                raise FileNotFoundError(f"缺少部署文件：{name}")
            archive.add(source, arcname=name, filter=archive_filter)


def deploy(client):
    project = shlex.quote(PROJECT_DIR)
    venv = shlex.quote(VENV_DIR)
    local_project = Path(__file__).resolve().parent

    run_cmd(client, "apt-get update -qq", "更新软件源")
    run_cmd(client, "apt-get install -y -qq python3 python3-pip python3-venv curl", "安装基础依赖")
    run_cmd(client, f"mkdir -p {project}/uploads {project}/backend/herb_model_data", "创建项目目录")

    remote_archive = f"/tmp/blog-deploy-{uuid.uuid4().hex}.tar.gz"
    with tempfile.TemporaryDirectory(prefix="blog-deploy-") as temporary:
        archive_path = Path(temporary) / "runtime.tar.gz"
        build_archive(local_project, archive_path)
        upload_file(client, archive_path, remote_archive)
        run_cmd(client, f"tar -xzf {shlex.quote(remote_archive)} -C {project} && rm -- {shlex.quote(remote_archive)}", "解压运行时代码")

    run_cmd(client, f"python3 -m venv {venv}", "准备 Python 虚拟环境")
    # 先安装 CPU 版；之后按项目同一份 requirements 补齐词汇解析等模块依赖。
    run_cmd(client, f"{venv}/bin/python -m pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cpu", "安装 PyTorch CPU 版")
    run_cmd(client, f"{venv}/bin/python -m pip install -q -r {project}/requirements.txt", "安装项目依赖")
    run_cmd(client, f"{venv}/bin/python - {shlex.quote(PROJECT_DIR + '/.env')} <<'BLOG_ENV_PY'\n{ENV_UPDATE_SCRIPT}\nBLOG_ENV_PY", "补全缺失环境配置")

    service_config = f"""[Unit]
Description=Blog FastAPI Application
After=network.target

[Service]
User=root
WorkingDirectory={PROJECT_DIR}
ExecStart={VENV_DIR}/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
"""
    run_cmd(client, "cat > /etc/systemd/system/blog.service <<'BLOG_SERVICE'\n" + service_config + "BLOG_SERVICE", "写入 systemd 服务")
    run_cmd(client, "systemctl daemon-reload && systemctl enable blog.service", "注册服务")
    run_cmd(client, "systemctl restart blog.service && systemctl is-active --quiet blog.service", "启动服务")
    run_cmd(client, "curl --fail --silent --show-error --retry 10 --retry-delay 1 --retry-connrefused --max-time 10 http://127.0.0.1:8000/api/v1/health", "健康检查")
    print(f"部署完成：http://{HOST}:8000")
    print("首次部署请确认阿里云防火墙已允许 TCP 8000。")


def main():
    client = ssh_connect()
    try:
        deploy(client)
    finally:
        client.close()


if __name__ == "__main__":
    main()
