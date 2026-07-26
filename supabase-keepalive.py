#!/usr/bin/env python3
"""
Supabase Keep-Alive Script
Prevents Supabase free tier project from pausing due to inactivity.
Runs on Raspberry Pi 3B+ and pings the project every 5 minutes.
"""

import os
import time
import requests
from datetime import datetime
import sys

# Configuration - Replace these with your actual values
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://your-project.supabase.co")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "your-anon-key-here")

# Ping interval in seconds (5 minutes)
PING_INTERVAL = 300

# Log file location
LOG_FILE = os.path.expanduser("~/supabase-keepalive.log")

def log(message):
    """Log message with timestamp"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_message = f"[{timestamp}] {message}"
    print(log_message)
    
    # Also write to log file
    try:
        with open(LOG_FILE, "a") as f:
            f.write(log_message + "\n")
    except Exception as e:
        print(f"Failed to write to log file: {e}")

def ping_supabase():
    """Send a lightweight request to keep Supabase active"""
    try:
        # Use auth health endpoint with API key
        headers = {
            "apikey": SUPABASE_ANON_KEY
        }
        
        response = requests.get(
            f"{SUPABASE_URL}/auth/v1/health",
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            log(f"✓ Ping successful (status: {response.status_code})")
            return True
        else:
            log(f"✗ Unexpected status code: {response.status_code}")
            return False
            
    except requests.exceptions.RequestException as e:
        log(f"✗ Ping failed: {str(e)}")
        return False
    except Exception as e:
        log(f"✗ Unexpected error: {str(e)}")
        return False

def main():
    log("=== Supabase Keep-Alive Script Started ===")
    log(f"Target: {SUPABASE_URL}")
    log(f"Ping interval: {PING_INTERVAL} seconds ({PING_INTERVAL // 60} minutes)")
    log(f"Log file: {LOG_FILE}")
    
    # Validate configuration
    if "your-project" in SUPABASE_URL or "your-anon-key" in SUPABASE_ANON_KEY:
        log("ERROR: Please configure SUPABASE_URL and SUPABASE_ANON_KEY environment variables!")
        sys.exit(1)
    
    consecutive_failures = 0
    max_consecutive_failures = 5
    
    while True:
        try:
            success = ping_supabase()
            
            if success:
                consecutive_failures = 0
            else:
                consecutive_failures += 1
                
            if consecutive_failures >= max_consecutive_failures:
                log(f"WARNING: {consecutive_failures} consecutive failures. Check your connection and Supabase status.")
                consecutive_failures = 0  # Reset to avoid spam
            
            # Wait before next ping
            time.sleep(PING_INTERVAL)
            
        except KeyboardInterrupt:
            log("=== Script stopped by user ===")
            sys.exit(0)
        except Exception as e:
            log(f"✗ Unexpected error in main loop: {str(e)}")
            time.sleep(60)  # Wait a minute before retrying

if __name__ == "__main__":
    main()
