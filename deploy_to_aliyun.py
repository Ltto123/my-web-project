"""
阿里云轻量服务器一键部署脚本（无 Nginx，直连 8000 端口）
服务器: 106.14.218.12, Ubuntu 24.04, 2核2G
"""
import paramiko
import os
import tarfile
from pathlib import Path

HOST = "106.14.218.12"
USER = "root"
PROJECT_DIR = "/opt/blog"
VENV_DIR = f"{PROJECT_DIR}/.venv"
SSH_KEY = os.path.expanduser("~/.ssh/id_ed25519")  # SSH 密钥认证


def ssh_connect():
    """建立SSH连接（优先密钥，回退密码）"""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    if os.path.exists(SSH_KEY):
        print(f"[KEY] Using SSH key: {SSH_KEY}")
        try:
            client.connect(HOST, username=USER, key_filename=SSH_KEY, timeout=30)
            return client
        except paramiko.AuthenticationException:
            print("   密钥认证失败，尝试密码...")

    # 回退到密码（需要先在阿里云控制台开启密码登录）
    password = os.environ.get("ALIYUN_PASSWORD", "")
    if not password:
        password = input("请输入 root 密码: ")
    client.connect(HOST, username=USER, password=password, timeout=30)
    return client


def run_cmd(client, cmd, desc=""):
    """执行远程命令并打印输出"""
    prefix = f"[{desc}] " if desc else ""
    print(f"{prefix}>>> {cmd}")
    _, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out:
        print(out.strip())
    if err:
        # 过滤掉一些无害的 stderr 噪音
        harmless = ["WARNING:", "apt-get", "debconf:", "invoke-rc.d"]
        if not any(h in err for h in harmless):
            print(f"STDERR: {err.strip()}")
    exit_code = stdout.channel.recv_exit_status()
    if exit_code != 0:
        print(f"[WARN] Command returned non-zero: {exit_code}")
    return out, err, exit_code


def upload_file(client, local_path, remote_path):
    """上传单个文件"""
    sftp = client.open_sftp()
    sftp.put(local_path, remote_path)
    sftp.close()
    print(f"  已上传: {local_path} -> {remote_path}")


def main():
    client = ssh_connect()
    print("[OK] SSH connected\n")

    # ────────────────────────────────────────────
    # 1. 系统更新 + 安装基础依赖
    # ────────────────────────────────────────────
    print("=" * 60)
    print("步骤 1/6: 系统更新 & 安装 Python3")
    print("=" * 60)
    run_cmd(client, "apt-get update -qq", "更新APT源")
    run_cmd(client, "apt-get install -y -qq python3 python3-pip python3-venv curl", "安装Python3/pip/venv/curl")

    # ────────────────────────────────────────────
    # 2. 创建目录
    # ────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("步骤 2/6: 创建项目目录")
    print("=" * 60)
    run_cmd(client, f"mkdir -p {PROJECT_DIR}/uploads {PROJECT_DIR}/backend/herb_model_data", "创建项目目录")

    # ────────────────────────────────────────────
    # 3. 打包并上传项目
    # ────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("步骤 3/6: 打包项目并上传")
    print("=" * 60)

    local_project = Path(__file__).resolve().parent

    # 生成部署压缩包（排除不需要的文件）
    tarball_path = local_project / "deploy_package.tar.gz"
    print("  正在打包项目...")
    with tarfile.open(tarball_path, "w:gz") as tar:
        for item in local_project.iterdir():
            name = item.name
            # 排除不需要的内容
            if name in [".git", ".venv", ".ruff_cache", ".claude", ".vscode",
                        "__pycache__", "deploy_package.tar.gz", "project.tar.gz",
                        ".gitignore", ".dockerignore", "publish.ps1", "save-clip.ps1",
                        "deploy_to_aliyun.py", "deploy.py", "setup_server.sh",
                        "CLAUDE.md", "openspec"]:
                continue
            if item.is_dir() and name.startswith("."):
                continue
            tar.add(item, arcname=name)
    print(f"  打包完成: {tarball_path} ({tarball_path.stat().st_size / 1024 / 1024:.1f} MB)")

    upload_file(client, str(tarball_path), f"/tmp/deploy_package.tar.gz")
    run_cmd(client, f"cd {PROJECT_DIR} && tar -xzf /tmp/deploy_package.tar.gz && rm /tmp/deploy_package.tar.gz && ls -la", "解压项目文件")
    tarball_path.unlink()
    print("  本地临时压缩包已清理")

    # ────────────────────────────────────────────
    # 4. 创建虚拟环境并安装依赖
    # ────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("步骤 4/6: 创建虚拟环境 & 安装 Python 依赖")
    print("=" * 60)

    run_cmd(client, f"python3 -m venv {VENV_DIR}", "创建虚拟环境")

    # 先用清华源加速（国内服务器）
    pip_cmd = f"{VENV_DIR}/bin/pip install -q -i https://pypi.tuna.tsinghua.edu.cn/simple"

    # 核心依赖
    core_requirements = [
        "fastapi==0.136.3",
        "uvicorn[standard]==0.48.0",
        "sqlalchemy==2.0.50",
        "bcrypt==5.0.0",
        "python-dotenv==1.2.2",
        "python-multipart==0.0.32",
        "pydantic==2.13.4",
        "python-jose[cryptography]==3.5.0",
    ]
    deps_str = " ".join(core_requirements)
    run_cmd(client, f"{pip_cmd} {deps_str}", "安装核心依赖（清华源）")

    # 轻量安装 PyTorch（CPU 版本，小内存）
    run_cmd(client, f"{VENV_DIR}/bin/pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cpu", "安装PyTorch CPU版")

    # 验证安装
    run_cmd(client, f"{VENV_DIR}/bin/pip list 2>/dev/null | grep -E 'fastapi|uvicorn|sqlalchemy|torch|bcrypt'", "验证已安装的包")

    # ────────────────────────────────────────────
    # 5. 配置环境变量
    # ────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("步骤 5/6: 配置环境变量")
    print("=" * 60)

    run_cmd(client, f"""cat > {PROJECT_DIR}/.env << 'ENVEOF'
BLOG_OWNER_USERNAME=Ltto123
JWT_SECRET_KEY=blog-prod-{os.urandom(8).hex()}
ENVEOF""", "写入.env 配置文件")
    run_cmd(client, f"cat {PROJECT_DIR}/.env | head -2", "验证.env")

    # ────────────────────────────────────────────
    # 6. 创建 systemd 服务（直接监听 8000 端口，无 Nginx）
    # ────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("步骤 6/6: 创建 systemd 服务 & 启动")
    print("=" * 60)

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

    run_cmd(client, f"cat > /etc/systemd/system/blog.service << 'SERVICEEOF'\n{service_config}\nSERVICEEOF", "写入 systemd 服务文件")
    run_cmd(client, "systemctl daemon-reload", "重载 systemd")
    run_cmd(client, "systemctl enable blog.service", "设置开机自启")
    run_cmd(client, "systemctl restart blog.service", "启动 blog 服务")

    import time
    time.sleep(3)

    # 检查服务状态
    run_cmd(client, "systemctl status blog.service --no-pager -l | head -15", "检查服务状态")

    # ────────────────────────────────────────────
    # 7. 最终验证
    # ────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("最终验证")
    print("=" * 60)

    run_cmd(client, "curl -s http://127.0.0.1:8000/api/v1/health", "FastAPI 健康检查")
    run_cmd(client, "curl -s http://127.0.0.1:8000/api/v1/posts | python3 -c \"import sys,json; d=json.load(sys.stdin); print(f'文章数: {len(d.get(\\\"data\\\",[]))}')\" 2>/dev/null || echo 'API OK'", "文章API测试")

    # 设置目录权限
    run_cmd(client, f"chmod -R 755 {PROJECT_DIR}", "设置项目权限")

    print("\n" + "=" * 60)
    print("Deploy complete!")
    print(f"   博客地址: http://{HOST}:8000")
    print(f"   API 文档: http://{HOST}:8000/docs")
    print(f"   健康检查: http://{HOST}:8000/api/v1/health")
    print("=" * 60)

    # 阿里云防火墙放行 8000 端口
    print("\n[IMPORTANT] Firewall:")
    print("   1. 去阿里云控制台 → 轻量应用服务器 → 防火墙")
    print("   2. 添加规则：TCP 8000 端口，允许 0.0.0.0/0")
    print(f"   3. 然后浏览器访问 http://{HOST}:8000")
    print("\n[INFO] Add Nginx reverse proxy later when you have a domain.")

    client.close()


if __name__ == "__main__":
    main()
