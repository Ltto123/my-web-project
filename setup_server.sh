#!/bin/bash
# ============================================
# 一键部署脚本 — 粘贴到阿里云 Workbench 终端运行
# ============================================
set -e

echo "=========================================="
echo " 博客一键部署开始"
echo "=========================================="

# 1. 更新系统 & 安装依赖
echo "[1/6] 安装系统依赖..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip python3-venv nginx git curl

# 2. 创建目录
echo "[2/6] 创建项目目录..."
mkdir -p /opt/blog/uploads /opt/blog/backend/herb_model_data

# 3. 安装 Python 依赖
echo "[3/6] 安装 Python 包..."
python3 -m venv /opt/blog/.venv
/opt/blog/.venv/bin/pip install -q \
  fastapi==0.136.3 "uvicorn[standard]==0.48.0" sqlalchemy==2.0.50 \
  bcrypt==5.0.0 python-dotenv==1.2.2 python-multipart==0.0.32 \
  pydantic==2.13.4 "python-jose[cryptography]==3.5.0"

# PyTorch CPU 版（轻量，2G内存够用）
/opt/blog/.venv/bin/pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cpu

echo "安装完成！"
/opt/blog/.venv/bin/pip list 2>/dev/null | grep -E 'fastapi|uvicorn|sqlalchemy|torch|bcrypt'

# 4. 环境变量
echo "[4/6] 配置环境变量..."
cat > /opt/blog/.env << 'EOF'
BLOG_OWNER_USERNAME=Ltto123
JWT_SECRET_KEY=blog-prod-change-me-8a7f3c2d1e
EOF

# 5. systemd 服务
echo "[5/6] 创建系统服务..."
cat > /etc/systemd/system/blog.service << 'SERVICEEOF'
[Unit]
Description=Blog FastAPI
After=network.target

[Service]
User=root
WorkingDirectory=/opt/blog
ExecStart=/opt/blog/.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable blog.service

# 6. Nginx 反向代理（80端口 → 8000）
echo "[6/6] 配置 Nginx..."
cat > /etc/nginx/sites-available/blog << 'NGINXEOF'
server {
    listen 80;
    server_name _;
    client_max_body_size 1000m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /uploads {
        alias /opt/blog/uploads;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/blog /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo ""
echo "=========================================="
echo " 服务器环境准备完成！"
echo "=========================================="
echo "接下来把项目文件传上来"
