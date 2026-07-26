# Raspberry Pi 3B+ Setup Guide - Supabase Keep-Alive

This guide will help you set up the Supabase keep-alive script on your Raspberry Pi 3B+ to prevent your Supabase project from pausing due to inactivity.

## Prerequisites

- Raspberry Pi 3B+ with Raspbian/Raspberry Pi OS installed
- Internet connection
- Your Supabase project URL and anonymous key

## Quick Setup Commands

Run these commands on your Raspberry Pi:

### 1. Install Required Packages

```bash
sudo apt update
sudo apt install -y python3 python3-pip
pip3 install requests
```

### 2. Get Your Supabase Credentials

You need two values from your Supabase project:
- **Project URL**: Found in Project Settings → API → Project URL
- **Anon/Public Key**: Found in Project Settings → API → anon/public key

### 3. Copy the Script to Your Pi

Option A - If you have the file on a USB drive or can copy it directly:
```bash
# Copy the script to your home directory
cp /path/to/supabase-keepalive.py ~/supabase-keepalive.py
chmod +x ~/supabase-keepalive.py
```

Option B - Create the file directly on the Pi:
```bash
# Download from your repository or create it manually
nano ~/supabase-keepalive.py
# Paste the script content and save (Ctrl+X, Y, Enter)
chmod +x ~/supabase-keepalive.py
```

### 4. Test the Script Manually

Before setting up the service, test that it works:

```bash
# Set environment variables (replace with your actual values)
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key-here"

# Run the script
python3 ~/supabase-keepalive.py
```

Press `Ctrl+C` to stop the test. If you see "✓ Ping successful", it's working!

### 5. Set Up as a System Service (Auto-start on boot)

```bash
# Create the service file
sudo nano /etc/systemd/system/supabase-keepalive.service
```

Paste this content (replace the SUPABASE_URL and SUPABASE_ANON_KEY with your actual values):

```ini
[Unit]
Description=Supabase Keep-Alive Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi
Environment="SUPABASE_URL=https://YOUR-PROJECT.supabase.co"
Environment="SUPABASE_ANON_KEY=YOUR-ANON-KEY-HERE"
ExecStart=/usr/bin/python3 /home/pi/supabase-keepalive.py
Restart=always
RestartSec=10

StandardOutput=journal
StandardError=journal
SyslogIdentifier=supabase-keepalive

[Install]
WantedBy=multi-user.target
```

Save and exit (Ctrl+X, Y, Enter).

### 6. Enable and Start the Service

```bash
# Reload systemd to recognize the new service
sudo systemctl daemon-reload

# Enable the service to start on boot
sudo systemctl enable supabase-keepalive.service

# Start the service now
sudo systemctl start supabase-keepalive.service

# Check the service status
sudo systemctl status supabase-keepalive.service
```

## Useful Commands

### Check Service Status
```bash
sudo systemctl status supabase-keepalive.service
```

### View Recent Logs
```bash
# From systemd journal
sudo journalctl -u supabase-keepalive.service -f

# From the log file
tail -f ~/supabase-keepalive.log
```

### Stop the Service
```bash
sudo systemctl stop supabase-keepalive.service
```

### Restart the Service
```bash
sudo systemctl restart supabase-keepalive.service
```

### Disable Auto-start
```bash
sudo systemctl disable supabase-keepalive.service
```

### View Last 50 Log Lines
```bash
sudo journalctl -u supabase-keepalive.service -n 50
```

## Troubleshooting

### Service Won't Start
1. Check the service status: `sudo systemctl status supabase-keepalive.service`
2. View detailed logs: `sudo journalctl -u supabase-keepalive.service -n 100`
3. Verify your credentials are correct in the service file
4. Make sure the script file exists: `ls -l ~/supabase-keepalive.py`

### Connection Issues
1. Test internet connection: `ping google.com`
2. Test Supabase URL: `curl -I https://your-project.supabase.co`
3. Check the log file: `cat ~/supabase-keepalive.log`

### High Consecutive Failures
If you see warnings about consecutive failures:
- Check your internet connection
- Verify your Supabase project is active and accessible
- Check if Supabase is experiencing downtime: https://status.supabase.com

## Configuration

### Change Ping Interval
Edit the script and modify the `PING_INTERVAL` value (in seconds):
```bash
nano ~/supabase-keepalive.py
# Change: PING_INTERVAL = 300  # (5 minutes)
# To:     PING_INTERVAL = 600  # (10 minutes)
```

Then restart the service:
```bash
sudo systemctl restart supabase-keepalive.service
```

### Update Credentials
If you need to change your Supabase URL or key:
```bash
sudo nano /etc/systemd/system/supabase-keepalive.service
# Update the Environment variables
sudo systemctl daemon-reload
sudo systemctl restart supabase-keepalive.service
```

## Resource Usage

The script is very lightweight:
- **CPU**: < 0.1% average
- **Memory**: ~10-15 MB
- **Network**: ~1-2 KB per ping (every 5 minutes)
- **Disk**: Log file grows ~50-100 KB per day

The Pi 3B+ can handle this easily alongside other tasks.

## Security Notes

- Your Supabase anonymous key is stored in the service file, which is readable by root only
- The key is also visible in process lists. If this is a concern, consider using a secrets management solution
- The anonymous key is meant to be public-facing, so this script doesn't expose anything not already in your web app

## Complete One-Liner Setup

For quick setup (replace with your actual credentials):

```bash
sudo apt update && sudo apt install -y python3 python3-pip && pip3 install requests && curl -o ~/supabase-keepalive.py https://raw.githubusercontent.com/YOUR_REPO/supabase-keepalive.py && chmod +x ~/supabase-keepalive.py
```

Then create and configure the service file as described in step 5.
