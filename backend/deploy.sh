#!/bin/bash

# Exit immediately if any command fails
set -e

echo "=========================================================="
echo "QuantumCLK Backend Deployment Script"
echo "=========================================================="
echo "This script automates deployment on a fresh Linux VPS."
echo "Ensure you run this script as root/sudo."

# 1. Update OS Package Repositories
echo -e "\n[1/7] Updating package manager..."
sudo apt update -y

# 2. Install Node.js, Git, Nginx, PostgreSQL and SQLite
echo -e "\n[2/7] Installing Node.js, Nginx, PostgreSQL, SQLite3 and dependencies..."
sudo apt install -y curl git nginx sqlite3 postgresql postgresql-contrib
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install PM2 Process Manager globally
echo -e "\n[3/7] Installing PM2 globally..."
sudo npm install -g pm2

# 4. Install local dependencies
echo -e "\n[4/7] Installing backend NPM packages..."
npm install

# 5. Setup PostgreSQL Database
echo -e "\n[5/7] Setting up PostgreSQL database..."
sudo -u postgres psql -c "CREATE DATABASE attendance_system;" 2>/dev/null || echo "Database already exists."
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';" 2>/dev/null || true

# 6. Configure Nginx Reverse Proxy
echo -e "\n[6/7] Writing Nginx proxy configuration..."
NGINX_CONF="/etc/nginx/sites-available/attendance"

# Get domain or server IP from argument or prompt
VPS_HOST=$1
if [ -z "$VPS_HOST" ]; then
    read -p "Enter your VPS Domain Name or IP address (e.g. attendance.example.com): " VPS_HOST
fi

sudo bash -c "cat > $NGINX_CONF" <<EOF
server {
    listen 80;
    server_name $VPS_HOST;

    # Dynamic document upload storage size limit
    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Link Nginx sites and restart
sudo ln -sf /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default || true
sudo nginx -t
sudo systemctl restart nginx
echo "Nginx proxy configuration complete."

# 7. Launch Backend with PM2
echo -e "\n[7/7] Starting backend process under PM2..."
pm2 start server.js --name "quantumclk-backend" --env production
pm2 save
pm2 startup

echo -e "\n=========================================================="
echo "Deployment successful! The server is running via Nginx."
echo "Dashboard:     http://$VPS_HOST/"
echo "Health Check:  http://$VPS_HOST/api/health"
echo "API Endpoint:  http://$VPS_HOST/api/hardware/log"
echo "=========================================================="
