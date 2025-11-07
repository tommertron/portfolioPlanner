# Deployment Guide

This guide covers deploying Portfolio Planner to a server running nginx.

## Option 1: Docker Deployment (Recommended)

This is the easiest approach - run the app in a Docker container and use nginx as a reverse proxy.

### On Your Local Machine

1. **Build and test the Docker image:**
   ```bash
   docker-compose up --build
   ```

   Visit `http://localhost:5959` to verify it works.

2. **Push your code to your server:**
   ```bash
   # Option A: Using git
   git push origin main

   # Option B: Using rsync
   rsync -avz --exclude 'venv' --exclude '__pycache__' \
     . user@your-server:/path/to/portfolioPlanner
   ```

### On Your Server

1. **Install Docker and Docker Compose** (if not already installed):
   ```bash
   # Docker
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh

   # Docker Compose
   sudo apt-get update
   sudo apt-get install docker-compose-plugin
   ```

2. **Navigate to the app directory and start the container:**
   ```bash
   cd /path/to/portfolioPlanner
   docker-compose up -d
   ```

3. **Configure nginx as a reverse proxy:**
   ```bash
   # Copy the example nginx config
   sudo cp nginx-example.conf /etc/nginx/sites-available/portfolio-planner

   # Edit it to set your domain/IP
   sudo nano /etc/nginx/sites-available/portfolio-planner

   # Enable the site
   sudo ln -s /etc/nginx/sites-available/portfolio-planner /etc/nginx/sites-enabled/

   # Test nginx configuration
   sudo nginx -t

   # Reload nginx
   sudo systemctl reload nginx
   ```

4. **Access your app:**
   - Visit `http://your-domain.com` or `http://your-server-ip`

### Managing the Docker Container

```bash
# View logs
docker-compose logs -f

# Restart the container
docker-compose restart

# Stop the container
docker-compose down

# Rebuild and restart after code changes
docker-compose up -d --build
```

## Option 2: Systemd Service (Alternative)

If you prefer not to use Docker, you can run the Flask app as a systemd service.

### On Your Server

1. **Install Python and dependencies:**
   ```bash
   sudo apt-get update
   sudo apt-get install python3 python3-pip
   cd /path/to/portfolioPlanner
   pip3 install -r requirements.txt
   ```

2. **Create a systemd service file:**
   ```bash
   sudo nano /etc/systemd/system/portfolio-planner.service
   ```

   Add this content:
   ```ini
   [Unit]
   Description=Portfolio Planner Web Application
   After=network.target

   [Service]
   Type=simple
   User=www-data
   WorkingDirectory=/path/to/portfolioPlanner
   Environment="PATH=/usr/bin"
   ExecStart=/usr/bin/python3 -m webapp.app
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   ```

3. **Enable and start the service:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable portfolio-planner
   sudo systemctl start portfolio-planner
   sudo systemctl status portfolio-planner
   ```

4. **Configure nginx** (same as Docker option above)

## Adding SSL/HTTPS (Optional but Recommended)

Use Let's Encrypt for free SSL certificates:

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Get a certificate (follow prompts)
sudo certbot --nginx -d your-domain.com

# Certbot will automatically update your nginx config
```

## Data Persistence

Your portfolio data is stored in the `portfolios/` directory. This is automatically persisted when using Docker thanks to the volume mount in `docker-compose.yml`.

### Backing Up Data

```bash
# Backup portfolios directory
tar -czf portfolios-backup-$(date +%Y%m%d).tar.gz portfolios/

# Restore from backup
tar -xzf portfolios-backup-YYYYMMDD.tar.gz
```

## Troubleshooting

### Port 5959 already in use
```bash
# Find what's using the port
sudo lsof -i :5959

# Or change the port in docker-compose.yml
```

### Container won't start
```bash
# Check logs
docker-compose logs

# Check if portfolios directory has correct permissions
sudo chown -R 1000:1000 portfolios/
```

### nginx returns 502 Bad Gateway
```bash
# Check if the app is running
docker-compose ps
# or
sudo systemctl status portfolio-planner

# Check nginx error logs
sudo tail -f /var/log/nginx/error.log
```

### Can't access from outside
```bash
# Check firewall settings
sudo ufw status
sudo ufw allow 80
sudo ufw allow 443
```

## Public Demo Warning

If you're deploying this as a public demo where anyone can access and modify data, you can enable a warning banner at the top of the page.

### Option 1: Use the demo compose file (easiest)
```bash
docker-compose -f docker-compose.demo.yml up -d --build
```

### Option 2: Modify docker-compose.yml
Uncomment this line in `docker-compose.yml`:
```yaml
environment:
  - FLASK_ENV=production
  - PUBLIC_DEMO_MODE=true  # Uncomment this line
```

### Option 3: Set environment variable
For systemd service or manual runs:
```bash
export PUBLIC_DEMO_MODE=true
python3 wsgi.py
```

This displays a prominent red warning banner:
> **PUBLIC DEMO:** All information entered here is available to anyone on the public web. Do not enter confidential data here as it will be accessible to others. This is here for demo purposes only.

## Production Considerations

For production use, consider:

1. **Use a production WSGI server** like Gunicorn instead of Flask's development server
2. **Set up automatic backups** of the portfolios directory
3. **Configure log rotation** for application logs
4. **Monitor the service** with tools like systemd or Docker health checks
5. **Set FLASK_ENV=production** (already done in docker-compose.yml)

### Using Gunicorn (Production WSGI Server)

For better performance in production, use Gunicorn instead of Flask's development server.

Update `requirements.txt`:
```
python-dateutil>=2.8.2
Flask>=3.0.0
gunicorn>=21.0.0
```

Update `Dockerfile` CMD:
```dockerfile
CMD ["gunicorn", "--bind", "0.0.0.0:5959", "--workers", "4", "--timeout", "120", "wsgi:app"]
```

The `wsgi.py` file is already created and ready to use.

Rebuild and restart:
```bash
docker-compose up -d --build
```
